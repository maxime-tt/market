package poc

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"testing"

	"github.com/btcsuite/btcd/btcec/v2"
	"github.com/btcsuite/btcd/btcec/v2/schnorr"
)

// settleReceipt is testCashuLockReceipt with the refund key supplied, because
// the settlement claim must be signed by the exact wallet key the receipt
// names. The shared helper generates a throwaway key and discards it.
func settleReceipt(t *testing.T, committee *btcec.PrivateKey, auctionID, bidder string, amount int64,
	operationID, tokenSHA256 string, locktime int64, refs []string, refund *btcec.PrivateKey) CashuLockReceipt {
	t.Helper()
	receipt := CashuLockReceipt{
		Schema: "PlebeianAuctionsPOCCashuLockV1", MintURL: CashuMintURL, AuctionID: auctionID,
		Bidder: bidder, Amount: amount, OperationID: operationID, TokenSHA256: tokenSHA256,
		CommitteePublicKey: hex.EncodeToString(committee.PubKey().SerializeCompressed()),
		RefundPublicKey:    hex.EncodeToString(refund.PubKey().SerializeCompressed()),
		Locktime:           locktime, ProofStateRefs: refs,
	}
	digest := cashuReceiptDigest(receipt)
	signature, err := schnorr.Sign(committee, digest[:])
	if err != nil {
		t.Fatal(err)
	}
	receipt.Signature = hex.EncodeToString(signature.Serialize())
	return receipt
}

// settleableCashuFixture commits a mint-backed auction that carries the
// seller's wallet payout key, a winning bid, and the close that selects it.
// The winning lock is left in winner_selected, which is the only state a
// settlement may start from.
func settleableCashuFixture(t *testing.T) (State, []byte, *btcec.PrivateKey, *btcec.PrivateKey, walletClaim, walletClaim, string, []string, []int64) {
	t.Helper()
	seed := make([]byte, 32)
	seed[0] = 77
	committee := testPrivateKey(t)
	state, err := NewState("settle-fixture", ed25519.NewKeyFromSeed(seed).Public().(ed25519.PublicKey), hex.EncodeToString(committee.PubKey().SerializeCompressed()))
	if err != nil {
		t.Fatal(err)
	}
	seller := testPrivateKey(t)
	sellerWallet := newWalletClaim(t)
	create := testEvent(t, seller, 1_000, KindCreate, createContent{
		AuctionID: "settle-auction", Title: "Settleable item", Duration: 600,
		StartingBid: 100, FundingMode: FundingModeCashuLock,
		SellerCocoPaymentPublicKey: sellerWallet.publicKey,
	})
	state, err = ApplyTransaction(state, Transaction{Version: TxVersion, Type: "event", Event: &create}, 1_000, DefaultPolicy(), seed)
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	bidder := testPrivateKey(t)
	bidderWallet := newWalletClaim(t)
	secrets := []string{"settle-secret-one", "settle-secret-two"}
	amounts := []int64{64, 64}
	refs := make([]string, 0, len(secrets))
	for _, secret := range secrets {
		reference, err := demoMintProofY(secret)
		if err != nil {
			t.Fatal(err)
		}
		refs = append(refs, reference)
	}
	sort.Strings(refs)
	receipt := settleReceipt(t, committee, "settle-auction", actorForKey(bidder), 128,
		"op-settle", strings.Repeat("c", 64), 1_700, refs, bidderWallet.key)
	bid := testEvent(t, bidder, 1_001, KindBid, bidContent{AuctionID: "settle-auction", Amount: 128, CashuLock: &receipt})
	state, err = ApplyTransaction(state, Transaction{Version: TxVersion, Type: "event", Event: &bid}, 1_001, DefaultPolicy(), seed)
	if err != nil {
		t.Fatalf("bid: %v", err)
	}
	state, err = ApplyTransaction(state, Transaction{Version: TxVersion, Type: "close", AuctionID: "settle-auction"}, 1_600, DefaultPolicy(), seed)
	if err != nil {
		t.Fatalf("close: %v", err)
	}
	auction := state.Auctions["settle-auction"]
	if auction.Status != "closed" || auction.Winner != actorForKey(bidder) {
		t.Fatalf("auction = %q winner %q, want closed and the bidder", auction.Status, auction.Winner)
	}
	if state.Locks[bid.ID].Status != "winner_selected" {
		t.Fatalf("winning lock = %q, want winner_selected", state.Locks[bid.ID].Status)
	}
	return state, seed, committee, bidder, sellerWallet, bidderWallet, "settle-auction", secrets, amounts
}

func settleEvent(t *testing.T, key *btcec.PrivateKey, auctionID string) SignedEvent {
	t.Helper()
	return testEvent(t, key, 1_601, KindSettle, settleContent{AuctionID: auctionID, BidID: "unused"})
}

// settleBody assembles a complete, valid settlement request: the winner's
// signed KindSettle authorization plus a spend-key signature over the hashed
// claim message.
func settleBody(t *testing.T, auctionID string, proofs []demoMintSpendProof, event SignedEvent, wallet walletClaim) demoMintSettleBody {
	t.Helper()
	refs := make([]string, 0, len(proofs))
	for _, proof := range proofs {
		reference, err := demoMintProofY(proof.Secret)
		if err != nil {
			t.Fatal(err)
		}
		refs = append(refs, reference)
	}
	signature, err := schnorr.Sign(wallet.key, sha256Sum(demoMintSettleClaimMessage(auctionID, refs)))
	if err != nil {
		t.Fatal(err)
	}
	return demoMintSettleBody{
		AuctionID: auctionID, Proofs: proofs, Event: event,
		SpendSignature: hex.EncodeToString(signature.Serialize()),
	}
}

func postSettle(t *testing.T, server *APIServer, body demoMintSettleBody) *httptest.ResponseRecorder {
	t.Helper()
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/api/demo/mint-settle", bytes.NewReader(raw))
	recorder := httptest.NewRecorder()
	server.demoMintSettle(recorder, request)
	return recorder
}

func TestDemoMintSettlePaysTheSeller(t *testing.T) {
	t.Parallel()
	state, _, committee, bidder, sellerWallet, bidderWallet, auctionID, secrets, amounts := settleableCashuFixture(t)
	mint := newFakeSwapMint(t, amounts)
	server := refundServer(t, state, committee, mint)
	notesBefore := len(state.Notes)

	recorder := postSettle(t, server, settleBody(t, auctionID, refundProofs(t, secrets, amounts, mint.keysetID), settleEvent(t, bidder, auctionID), bidderWallet))
	if recorder.Code != http.StatusOK {
		t.Fatalf("settle status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	var response demoMintRefundResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if len(response.Proofs) != len(amounts) {
		t.Fatalf("returned %d proofs, want %d", len(response.Proofs), len(amounts))
	}
	var total int64
	for _, proof := range response.Proofs {
		if !validCompressedPublicKey(proof.C) || proof.Secret == "" || proof.KeysetID != mint.keysetID {
			t.Fatalf("returned proof is malformed: %+v", proof)
		}
		// The value must land on the SELLER's committed wallet key, not on the
		// winner's and not on the seller's Nostr identity.
		if recipient := p2pkRecipient(t, proof.Secret); recipient != sellerWallet.publicKey {
			t.Fatalf("payout is locked to %s, want the seller wallet key %s", recipient, sellerWallet.publicKey)
		}
		total += proof.Amount
	}
	if total != 128 {
		t.Fatalf("payout totals %d, want 128", total)
	}
	if mint.swaps != 1 {
		t.Fatalf("mint saw %d swaps, want 1", mint.swaps)
	}
	// The coordinator must not mutate committed state or issue a legacy note:
	// the money moved at the mint, the chain is only the mirror.
	if len(state.Notes) != notesBefore {
		t.Fatalf("settlement issued %d notes, want 0", len(state.Notes)-notesBefore)
	}
	if state.Locks[state.Auctions[auctionID].LeaderBidID].Status != "winner_selected" {
		t.Fatal("the coordinator mutated the committed lock; only a KindSettle event may do that")
	}

	// The seller's browser fetches the same payout from the store.
	request := httptest.NewRequest(http.MethodGet, "/api/demo/settlement/"+auctionID, nil)
	request.SetPathValue("auction_id", auctionID)
	lookup := httptest.NewRecorder()
	server.demoSettlement(lookup, request)
	if lookup.Code != http.StatusOK {
		t.Fatalf("settlement lookup = %d %s", lookup.Code, lookup.Body.String())
	}
	var stored demoMintRefundResponse
	if err := json.Unmarshal(lookup.Body.Bytes(), &stored); err != nil {
		t.Fatal(err)
	}
	if len(stored.Proofs) != len(response.Proofs) {
		t.Fatalf("stored %d proofs, want %d", len(stored.Proofs), len(response.Proofs))
	}
	for index := range stored.Proofs {
		if stored.Proofs[index].Secret != response.Proofs[index].Secret {
			t.Fatalf("stored proof %d differs from the one returned to the winner", index)
		}
	}
}

// TestSettledProofsAreSpendableByTheSellerKey exercises the NUT-11 witness the
// seller's wallet must produce. The mint is not involved: what is checked is
// that the payout secret names the seller's key and that a signature by that
// key over sha256(secret) verifies against it, which is exactly what the mint
// requires for a P2PK input.
func TestSettledProofsAreSpendableByTheSellerKey(t *testing.T) {
	t.Parallel()
	state, _, committee, bidder, sellerWallet, bidderWallet, auctionID, secrets, amounts := settleableCashuFixture(t)
	mint := newFakeSwapMint(t, amounts)
	server := refundServer(t, state, committee, mint)

	recorder := postSettle(t, server, settleBody(t, auctionID, refundProofs(t, secrets, amounts, mint.keysetID), settleEvent(t, bidder, auctionID), bidderWallet))
	if recorder.Code != http.StatusOK {
		t.Fatalf("settle status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	var response demoMintRefundResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	for _, proof := range response.Proofs {
		recipient := p2pkRecipient(t, proof.Secret)
		point, err := btcec.ParsePubKey(mustHex(recipient))
		if err != nil {
			t.Fatalf("payout recipient is not a curve point: %v", err)
		}
		spendKey, err := schnorr.ParsePubKey(schnorr.SerializePubKey(point))
		if err != nil {
			t.Fatal(err)
		}
		digest := sha256.Sum256([]byte(proof.Secret))
		witness, err := schnorr.Sign(sellerWallet.key, digest[:])
		if err != nil {
			t.Fatal(err)
		}
		if !witness.Verify(digest[:], spendKey) {
			t.Fatal("the seller's own witness does not verify against the payout's P2PK key")
		}
		// And nobody else's does.
		stranger, err := schnorr.Sign(testPrivateKey(t), digest[:])
		if err != nil {
			t.Fatal(err)
		}
		if stranger.Verify(digest[:], spendKey) {
			t.Fatal("a stranger's witness verifies against the seller's payout key")
		}
	}
}

func TestDemoMintSettleRefusesNonWinner(t *testing.T) {
	t.Parallel()
	state, _, committee, _, _, bidderWallet, auctionID, secrets, amounts := settleableCashuFixture(t)
	mint := newFakeSwapMint(t, amounts)
	server := refundServer(t, state, committee, mint)

	recorder := postSettle(t, server, settleBody(t, auctionID, refundProofs(t, secrets, amounts, mint.keysetID), settleEvent(t, testPrivateKey(t), auctionID), bidderWallet))
	if recorder.Code != http.StatusForbidden || !strings.Contains(recorder.Body.String(), "not the auction winner") {
		t.Fatalf("non-winner response = %d %s, want 403 naming the winner", recorder.Code, recorder.Body.String())
	}
	if mint.swaps != 0 {
		t.Fatal("a non-winner settlement reached the mint")
	}
}

func TestDemoMintSettleRefusesOpenAuction(t *testing.T) {
	t.Parallel()
	state, _, committee, bidder, _, bidderWallet, auctionID, secrets, amounts := settleableCashuFixture(t)
	// Reopen the auction while keeping the winner and the lock, so the status
	// check is the one that refuses.
	auction := state.Auctions[auctionID]
	auction.Status = "open"
	state.Auctions[auctionID] = auction
	mint := newFakeSwapMint(t, amounts)
	server := refundServer(t, state, committee, mint)

	recorder := postSettle(t, server, settleBody(t, auctionID, refundProofs(t, secrets, amounts, mint.keysetID), settleEvent(t, bidder, auctionID), bidderWallet))
	if recorder.Code != http.StatusUnprocessableEntity || !strings.Contains(recorder.Body.String(), "not closed") {
		t.Fatalf("open-auction response = %d %s, want 422 naming the status", recorder.Code, recorder.Body.String())
	}
	if mint.swaps != 0 {
		t.Fatal("an open auction reached the mint")
	}
}

func TestDemoMintSettleRefusesLockThatIsNotWinnerSelected(t *testing.T) {
	t.Parallel()
	state, _, committee, bidder, _, bidderWallet, auctionID, secrets, amounts := settleableCashuFixture(t)
	bidID := state.Auctions[auctionID].LeaderBidID
	lock := state.Locks[bidID]
	lock.Status = "locked"
	state.Locks[bidID] = lock
	mint := newFakeSwapMint(t, amounts)
	server := refundServer(t, state, committee, mint)

	recorder := postSettle(t, server, settleBody(t, auctionID, refundProofs(t, secrets, amounts, mint.keysetID), settleEvent(t, bidder, auctionID), bidderWallet))
	if recorder.Code != http.StatusUnprocessableEntity || !strings.Contains(recorder.Body.String(), "not winner_selected") {
		t.Fatalf("wrong-lock response = %d %s, want 422 naming the lock status", recorder.Code, recorder.Body.String())
	}
	if mint.swaps != 0 {
		t.Fatal("a non-winning lock reached the mint")
	}
}

func TestDemoMintSettleRefusesAuctionWithoutPayoutKey(t *testing.T) {
	t.Parallel()
	state, _, committee, bidder, _, bidderWallet, auctionID, secrets, amounts := settleableCashuFixture(t)
	auction := state.Auctions[auctionID]
	auction.SellerCocoPaymentPublicKey = ""
	state.Auctions[auctionID] = auction
	mint := newFakeSwapMint(t, amounts)
	server := refundServer(t, state, committee, mint)

	recorder := postSettle(t, server, settleBody(t, auctionID, refundProofs(t, secrets, amounts, mint.keysetID), settleEvent(t, bidder, auctionID), bidderWallet))
	if recorder.Code != http.StatusUnprocessableEntity || !strings.Contains(recorder.Body.String(), "no seller wallet payout key") {
		t.Fatalf("no-payout-key response = %d %s, want 422 naming the missing key", recorder.Code, recorder.Body.String())
	}
	if mint.swaps != 0 {
		t.Fatal("an auction with no payout destination reached the mint")
	}
}

func TestDemoMintSettleRefusesProofSetThatDoesNotMatchReceipt(t *testing.T) {
	t.Parallel()
	state, _, committee, bidder, _, bidderWallet, auctionID, _, amounts := settleableCashuFixture(t)
	mint := newFakeSwapMint(t, amounts)
	server := refundServer(t, state, committee, mint)

	recorder := postSettle(t, server, settleBody(t, auctionID, refundProofs(t, []string{"not-the-settled-secret-1", "not-the-settled-secret-2"}, amounts, mint.keysetID), settleEvent(t, bidder, auctionID), bidderWallet))
	if recorder.Code != http.StatusUnprocessableEntity || !strings.Contains(recorder.Body.String(), "do not match the committed receipt") {
		t.Fatalf("mismatched proof set response = %d %s", recorder.Code, recorder.Body.String())
	}
	if mint.swaps != 0 {
		t.Fatal("a mismatched proof set reached the mint")
	}
}

func TestDemoMintSettleRefusesMissingOrWrongSpendSignature(t *testing.T) {
	t.Parallel()
	state, _, committee, bidder, _, bidderWallet, auctionID, secrets, amounts := settleableCashuFixture(t)
	mint := newFakeSwapMint(t, amounts)
	server := refundServer(t, state, committee, mint)
	proofs := refundProofs(t, secrets, amounts, mint.keysetID)

	cases := map[string]struct {
		mutate func(*demoMintSettleBody)
		reason string
	}{
		"no signature": {
			mutate: func(body *demoMintSettleBody) { body.SpendSignature = "" },
			reason: "carries no wallet spend-key signature",
		},
		"malformed signature": {
			mutate: func(body *demoMintSettleBody) { body.SpendSignature = "not-hex" },
			reason: "is not a 64-byte hex Schnorr signature",
		},
		"signature by another key": {
			mutate: func(body *demoMintSettleBody) {
				other := newWalletClaim(t)
				refs := make([]string, 0, len(proofs))
				for _, proof := range proofs {
					reference, err := demoMintProofY(proof.Secret)
					if err != nil {
						t.Fatal(err)
					}
					refs = append(refs, reference)
				}
				signature, err := schnorr.Sign(other.key, sha256Sum(demoMintSettleClaimMessage(auctionID, refs)))
				if err != nil {
					t.Fatal(err)
				}
				body.SpendSignature = hex.EncodeToString(signature.Serialize())
			},
			reason: "does not verify over the auction id and proof set",
		},
		"signature over another auction": {
			mutate: func(body *demoMintSettleBody) {
				refs := make([]string, 0, len(proofs))
				for _, proof := range proofs {
					reference, err := demoMintProofY(proof.Secret)
					if err != nil {
						t.Fatal(err)
					}
					refs = append(refs, reference)
				}
				signature, err := schnorr.Sign(bidderWallet.key, sha256Sum(demoMintSettleClaimMessage("another-auction", refs)))
				if err != nil {
					t.Fatal(err)
				}
				body.SpendSignature = hex.EncodeToString(signature.Serialize())
			},
			reason: "does not verify over the auction id and proof set",
		},
	}
	for name, testCase := range cases {
		body := settleBody(t, auctionID, proofs, settleEvent(t, bidder, auctionID), bidderWallet)
		testCase.mutate(&body)
		recorder := postSettle(t, server, body)
		if recorder.Code != http.StatusUnprocessableEntity || !strings.Contains(recorder.Body.String(), testCase.reason) {
			t.Fatalf("%s: response = %d %s, want 422 naming %q", name, recorder.Code, recorder.Body.String(), testCase.reason)
		}
	}
	if mint.swaps != 0 {
		t.Fatalf("mint saw %d swaps, want 0: an unproven claim reached the mint", mint.swaps)
	}
}

func TestDemoMintSettleRefusesWrongEventKindOrAuction(t *testing.T) {
	t.Parallel()
	state, _, committee, bidder, _, bidderWallet, auctionID, secrets, amounts := settleableCashuFixture(t)
	mint := newFakeSwapMint(t, amounts)
	server := refundServer(t, state, committee, mint)
	proofs := refundProofs(t, secrets, amounts, mint.keysetID)

	// A refund event is not a settlement authorization.
	refund := testEvent(t, bidder, 1_601, KindRefund, refundContent{BidID: "whatever"})
	recorder := postSettle(t, server, settleBody(t, auctionID, proofs, refund, bidderWallet))
	if recorder.Code != http.StatusUnprocessableEntity || !strings.Contains(recorder.Body.String(), "must be a KindSettle") {
		t.Fatalf("wrong-kind response = %d %s", recorder.Code, recorder.Body.String())
	}

	// The winner's own key, but the event authorizes a different auction.
	other := testEvent(t, bidder, 1_601, KindSettle, settleContent{AuctionID: "another-auction", BidID: "x"})
	recorder = postSettle(t, server, settleBody(t, auctionID, proofs, other, bidderWallet))
	if recorder.Code != http.StatusUnprocessableEntity || !strings.Contains(recorder.Body.String(), "names a different auction") {
		t.Fatalf("other-auction response = %d %s", recorder.Code, recorder.Body.String())
	}
	if mint.swaps != 0 {
		t.Fatal("an unauthorized settlement reached the mint")
	}
}

// TestApplySettleRecordsPaidLock pins the consensus record: the lock becomes
// paid and carries the payout digest, and no note is issued.
func TestApplySettleRecordsPaidLock(t *testing.T) {
	t.Parallel()
	state, seed, _, bidder, _, _, auctionID, _, _ := settleableCashuFixture(t)
	bidID := state.Auctions[auctionID].LeaderBidID
	digest := strings.Repeat("d", 64)
	event := testEvent(t, bidder, 1_601, KindSettle, settleContent{AuctionID: auctionID, BidID: bidID, PayoutTokenSHA256: digest})
	next, err := ApplyTransaction(state, Transaction{Version: TxVersion, Type: "event", Event: &event}, 1_601, DefaultPolicy(), seed)
	if err != nil {
		t.Fatalf("settle event: %v", err)
	}
	lock := next.Locks[bidID]
	if lock.Status != "paid" {
		t.Fatalf("lock status = %q, want paid", lock.Status)
	}
	if lock.CashuPayoutTokenSHA256 != digest {
		t.Fatalf("payout digest = %q, want %q", lock.CashuPayoutTokenSHA256, digest)
	}
	if len(next.Notes) != len(state.Notes) {
		t.Fatal("a settlement record issued a note; it must move no value")
	}
}

func TestApplySettleRefusesNonWinnerAndOpenAuction(t *testing.T) {
	t.Parallel()
	state, seed, _, _, _, _, auctionID, _, _ := settleableCashuFixture(t)
	bidID := state.Auctions[auctionID].LeaderBidID
	digest := strings.Repeat("d", 64)

	stranger := testEvent(t, testPrivateKey(t), 1_601, KindSettle, settleContent{AuctionID: auctionID, BidID: bidID, PayoutTokenSHA256: digest})
	if _, err := ApplyTransaction(state, Transaction{Version: TxVersion, Type: "event", Event: &stranger}, 1_601, DefaultPolicy(), seed); err == nil || !strings.Contains(err.Error(), "not the auction winner") {
		t.Fatalf("non-winner settle error = %v, want a winner refusal", err)
	}

	open := state
	auction := open.Auctions[auctionID]
	auction.Status = "open"
	open.Auctions[auctionID] = auction
	winner := testEvent(t, testPrivateKey(t), 1_601, KindSettle, settleContent{AuctionID: auctionID, BidID: bidID, PayoutTokenSHA256: digest})
	if _, err := ApplyTransaction(open, Transaction{Version: TxVersion, Type: "event", Event: &winner}, 1_601, DefaultPolicy(), seed); err == nil || !strings.Contains(err.Error(), "closed auction") {
		t.Fatalf("open-auction settle error = %v, want a closed-auction refusal", err)
	}
}

// TestCashuLockAuctionMayCommitSellerPayoutKey pins the acceptance relaxation:
// a mint-backed auction may carry the seller's wallet payout key, and the key
// is still validated as a compressed point that is not the seller's Nostr
// identity.
func TestCashuLockAuctionMayCommitSellerPayoutKey(t *testing.T) {
	t.Parallel()
	state, seed, _ := cashuLockFixture(t)
	seller := testPrivateKey(t)
	wallet := newWalletClaim(t)

	create := testEvent(t, seller, 1_000, KindCreate, createContent{
		AuctionID: "payout-key-auction", Title: "Payout key item", Duration: 600,
		StartingBid: 100, FundingMode: FundingModeCashuLock,
		SellerCocoPaymentPublicKey: wallet.publicKey,
	})
	next, err := ApplyTransaction(state, Transaction{Version: TxVersion, Type: "event", Event: &create}, 1_000, DefaultPolicy(), seed)
	if err != nil {
		t.Fatalf("mint-backed auction with a payout key was refused: %v", err)
	}
	if next.Auctions["payout-key-auction"].SellerCocoPaymentPublicKey != wallet.publicKey {
		t.Fatal("the committed auction did not keep the seller payout key")
	}

	// The seller's Nostr identity is not a wallet key.
	identity := testEvent(t, seller, 1_000, KindCreate, createContent{
		AuctionID: "identity-key-auction", Title: "Identity key item", Duration: 600,
		StartingBid: 100, FundingMode: FundingModeCashuLock,
		SellerCocoPaymentPublicKey: "02" + actorForKey(seller),
	})
	if _, err := ApplyTransaction(state, Transaction{Version: TxVersion, Type: "event", Event: &identity}, 1_000, DefaultPolicy(), seed); err == nil {
		t.Fatal("a mint-backed auction accepted the seller's Nostr identity as its payout key")
	}

	// And it must be a real point.
	notAPoint := testEvent(t, seller, 1_000, KindCreate, createContent{
		AuctionID: "bad-key-auction", Title: "Bad key item", Duration: 600,
		StartingBid: 100, FundingMode: FundingModeCashuLock,
		SellerCocoPaymentPublicKey: "02" + strings.Repeat("0", 64),
	})
	if _, err := ApplyTransaction(state, Transaction{Version: TxVersion, Type: "event", Event: &notAPoint}, 1_000, DefaultPolicy(), seed); err == nil {
		t.Fatal("a mint-backed auction accepted a non-point payout key")
	}
}
