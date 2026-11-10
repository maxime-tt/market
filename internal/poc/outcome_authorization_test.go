package poc

import (
	"encoding/hex"
	"strings"
	"testing"

	"github.com/btcsuite/btcd/btcec/v2"
	"github.com/btcsuite/btcd/btcec/v2/schnorr"
)

// outcomeReceipt is testCashuLockReceipt with the wallet spend key supplied,
// because the outcome authorizations must be signed by the exact key the
// receipt commits as RefundPublicKey. The shared helper generates a throwaway
// key and discards it.
func outcomeReceipt(t *testing.T, committee *btcec.PrivateKey, auctionID, bidder string, amount int64,
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

// testOutcomeAuthorizations builds the wallet half of a mint-backed bid: the
// settle and refund consent signatures over the exact messages the coordinator
// will later verify, both by the wallet spend key.
func testOutcomeAuthorizations(t *testing.T, auctionID string, refs []string, wallet walletClaim) bidOutcomeAuthorizations {
	t.Helper()
	outputs := make([]string, len(refs))
	for index := range outputs {
		outputs[index] = wallet.publicKey
	}
	settleSignature, err := schnorr.Sign(wallet.key, sha256Sum(demoMintSettleClaimMessage(auctionID, refs)))
	if err != nil {
		t.Fatal(err)
	}
	refundSignature, err := schnorr.Sign(wallet.key, sha256Sum(bidOutcomeRefundClaimMessageV2(auctionID, refs, outputs)))
	if err != nil {
		t.Fatal(err)
	}
	return bidOutcomeAuthorizations{
		Schema:               "PlebeianAuctionsPOCBidOutcomesV1",
		SettleSpendSignature: hex.EncodeToString(settleSignature.Serialize()),
		RefundSpendSignature: hex.EncodeToString(refundSignature.Serialize()),
	}
}

func authorizedBidEvent(t *testing.T, committee, bidder *btcec.PrivateKey, auctionID string, amount, createdAt int64,
	operationID, tokenSHA256 string, wallet walletClaim) (SignedEvent, Policy) {
	t.Helper()
	proofs, refs := backedProofs(t, amount)
	receipt := outcomeReceipt(t, committee, auctionID, actorForKey(bidder), amount, operationID, tokenSHA256, 1_700, refs, wallet.key)
	authorization := testOutcomeAuthorizations(t, auctionID, refs, wallet)
	event := testEvent(t, bidder, createdAt, KindBid, bidContent{
		AuctionID: auctionID, Amount: amount, CashuLock: &receipt, OutcomeAuthorizations: &authorization, Proofs: proofs,
	})
	return event, backedPolicy(amount)
}

// TestBidOutcomeAuthorizationsAreMandatoryAtAdmission pins the local-admission
// rule: a mint-backed bid without valid settle and refund pre-signatures is
// refused, and a signature by any key but the receipt's wallet spend key is
// refused.
func TestBidOutcomeAuthorizationsAreMandatoryAtAdmission(t *testing.T) {
	t.Parallel()
	state, seed, committee := cashuLockFixture(t)
	policy := DefaultPolicy()
	bidder := testPrivateKey(t)
	refs := testProofRefs(t, testPrivateKey(t))
	wallet := newWalletClaim(t)
	authorization := testOutcomeAuthorizations(t, "mint-backed", refs, wallet)

	valid, validPolicy := authorizedBidEvent(t, committee, bidder, "mint-backed", 120, 1_001, "op-admit", strings.Repeat("a", 64), wallet)
	if err := ValidateForMempool(state, Transaction{Version: TxVersion, Type: "event", Event: &valid}, validPolicy, seed); err != nil {
		t.Fatalf("a fully authorized mint-backed bid was refused: %v", err)
	}

	receipt := outcomeReceipt(t, committee, "mint-backed", actorForKey(bidder), 120, "op-admit", strings.Repeat("a", 64), 1_700, refs, wallet.key)
	build := func(mutate func(*bidOutcomeAuthorizations)) SignedEvent {
		clone := authorization
		mutate(&clone)
		return testEvent(t, bidder, 1_001, KindBid, bidContent{
			AuctionID: "mint-backed", Amount: 120, CashuLock: &receipt, OutcomeAuthorizations: &clone,
		})
	}
	missing := testEvent(t, bidder, 1_001, KindBid, bidContent{AuctionID: "mint-backed", Amount: 120, CashuLock: &receipt})

	cases := map[string]struct {
		event  SignedEvent
		reason string
	}{
		"no authorizations at all": {missing, "must publish settle and refund outcome authorizations"},
		"no settle signature":      {build(func(a *bidOutcomeAuthorizations) { a.SettleSpendSignature = "" }), "settle authorization"},
		"no refund signature":      {build(func(a *bidOutcomeAuthorizations) { a.RefundSpendSignature = "" }), "refund authorization"},
		"wrong outcome schema":     {build(func(a *bidOutcomeAuthorizations) { a.Schema = "something-else" }), "must publish settle and refund outcome authorizations"},
	}
	for name, testCase := range cases {
		err := ValidateForMempool(state, Transaction{Version: TxVersion, Type: "event", Event: &testCase.event}, policy, seed)
		if err == nil || !strings.Contains(err.Error(), testCase.reason) {
			t.Fatalf("%s: error = %v, want one naming %q", name, err, testCase.reason)
		}
	}

	// A signature by a foreign key is refused even when it is well formed.
	foreign := newWalletClaim(t)
	foreignAuthorization := testOutcomeAuthorizations(t, "mint-backed", refs, foreign)
	foreignEvent := testEvent(t, bidder, 1_001, KindBid, bidContent{
		AuctionID: "mint-backed", Amount: 120, CashuLock: &receipt, OutcomeAuthorizations: &foreignAuthorization,
	})
	if err := ValidateForMempool(state, Transaction{Version: TxVersion, Type: "event", Event: &foreignEvent}, policy, seed); err == nil ||
		!strings.Contains(err.Error(), "does not verify") {
		t.Fatalf("a foreign-key authorization error = %v, want a verification refusal", err)
	}

	// A settle signature over a different auction's message is refused too.
	crossAuction := authorization
	crossSignature, err := schnorr.Sign(wallet.key, sha256Sum(demoMintSettleClaimMessage("another-auction", refs)))
	if err != nil {
		t.Fatal(err)
	}
	crossAuction.SettleSpendSignature = hex.EncodeToString(crossSignature.Serialize())
	crossEvent := testEvent(t, bidder, 1_001, KindBid, bidContent{
		AuctionID: "mint-backed", Amount: 120, CashuLock: &receipt, OutcomeAuthorizations: &crossAuction,
	})
	if err := ValidateForMempool(state, Transaction{Version: TxVersion, Type: "event", Event: &crossEvent}, policy, seed); err == nil ||
		!strings.Contains(err.Error(), "does not verify") {
		t.Fatalf("a cross-auction settle authorization error = %v, want a verification refusal", err)
	}
}

type outcomeFixtureState struct {
	state        State
	seed         []byte
	auctionID    string
	committee    *btcec.PrivateKey
	firstBidID   string // displaced intermediate leader, left refundable
	secondBidID  string // committed leader
	firstWallet  walletClaim
	secondWallet walletClaim
}

// newOutcomeFixture commits a mint-backed auction with two authorized bids: the
// first is displaced and left refundable, the second is the active leader. The
// auction is left open.
func newOutcomeFixture(t *testing.T) outcomeFixtureState {
	t.Helper()
	state, seed, committee := cashuLockFixture(t)
	auctionID := "mint-backed"

	first := testPrivateKey(t)
	firstWallet := newWalletClaim(t)
	firstEvent, firstPolicy := authorizedBidEvent(t, committee, first, auctionID, 120, 1_001, "op-first", strings.Repeat("a", 64), firstWallet)
	state, err := ApplyTransaction(state, Transaction{Version: TxVersion, Type: "event", Event: &firstEvent}, 1_001, firstPolicy, seed)
	if err != nil {
		t.Fatalf("first bid: %v", err)
	}

	second := testPrivateKey(t)
	secondWallet := newWalletClaim(t)
	secondEvent, secondPolicy := authorizedBidEvent(t, committee, second, auctionID, 300, 1_002, "op-second", strings.Repeat("b", 64), secondWallet)
	state, err = ApplyTransaction(state, Transaction{Version: TxVersion, Type: "event", Event: &secondEvent}, 1_002, secondPolicy, seed)
	if err != nil {
		t.Fatalf("second bid: %v", err)
	}
	if state.Locks[firstEvent.ID].Status != "refundable" {
		t.Fatalf("displaced lock status = %q, want refundable", state.Locks[firstEvent.ID].Status)
	}
	if state.Locks[secondEvent.ID].Status != "locked" {
		t.Fatalf("leader lock status = %q, want locked", state.Locks[secondEvent.ID].Status)
	}
	if state.Locks[secondEvent.ID].SettleAuthorization == "" || state.Locks[secondEvent.ID].RefundAuthorization == "" {
		t.Fatal("committed lock did not store the bid's outcome authorizations")
	}
	return outcomeFixtureState{
		state: state, seed: seed, auctionID: auctionID, committee: committee,
		firstBidID: firstEvent.ID, secondBidID: secondEvent.ID,
		firstWallet: firstWallet, secondWallet: secondWallet,
	}
}

func outcomeEvent(t *testing.T, key *btcec.PrivateKey, createdAt int64, auctionID, bidID, outcome, digest string) SignedEvent {
	t.Helper()
	return testEvent(t, key, createdAt, KindOutcome, outcomeContent{
		Schema: "PlebeianAuctionsPOCOutcomeV1", AuctionID: auctionID, BidID: bidID,
		Outcome: outcome, PayoutTokenSHA256: digest,
	})
}

// TestApplyOutcomeRecordRefundsAndSettles pins the new terminal transition: the
// application authority records a settle on a closed winner_selected lock and a
// refund on a refundable lock, issuing no note either way and carrying the
// payout digest.
func TestApplyOutcomeRecordRefundsAndSettles(t *testing.T) {
	t.Parallel()
	fixture := newOutcomeFixture(t)
	policy := DefaultPolicy()

	// Refund the displaced first bid.
	refundDigest := strings.Repeat("e", 64)
	notesBefore := len(fixture.state.Notes)
	refundEvent := outcomeEvent(t, fixture.committee, 1_003, fixture.auctionID, fixture.firstBidID, "refund", refundDigest)
	refunded, err := ApplyTransaction(fixture.state, Transaction{Version: TxVersion, Type: "event", Event: &refundEvent}, 1_003, policy, fixture.seed)
	if err != nil {
		t.Fatalf("refund outcome: %v", err)
	}
	if lock := refunded.Locks[fixture.firstBidID]; lock.Status != "refunded" || lock.CashuPayoutTokenSHA256 != refundDigest {
		t.Fatalf("refunded lock = %+v, want refunded with digest %s", lock, refundDigest)
	}
	if len(refunded.Notes) != notesBefore {
		t.Fatal("a refund outcome issued an IOU note; the mint swap is the money")
	}

	// Idempotent by op key: a second record with a different event id and the
	// same bid and outcome is refused.
	replay := outcomeEvent(t, fixture.committee, 1_004, fixture.auctionID, fixture.firstBidID, "refund", refundDigest)
	if _, err := ApplyTransaction(refunded, Transaction{Version: TxVersion, Type: "event", Event: &replay}, 1_004, policy, fixture.seed); err == nil ||
		!strings.Contains(err.Error(), "already committed") {
		t.Fatalf("replayed refund outcome error = %v, want an already-committed refusal", err)
	}

	// Close the auction so the leader becomes winner_selected, then settle.
	closed, err := ApplyTransaction(refunded, Transaction{Version: TxVersion, Type: "close", AuctionID: fixture.auctionID}, 1_600, policy, fixture.seed)
	if err != nil {
		t.Fatalf("close: %v", err)
	}
	if closed.Locks[fixture.secondBidID].Status != "winner_selected" {
		t.Fatalf("winning lock = %q, want winner_selected", closed.Locks[fixture.secondBidID].Status)
	}
	settleDigest := strings.Repeat("f", 64)
	settleEvent := outcomeEvent(t, fixture.committee, 1_601, fixture.auctionID, fixture.secondBidID, "settle", settleDigest)
	paid, err := ApplyTransaction(closed, Transaction{Version: TxVersion, Type: "event", Event: &settleEvent}, 1_601, policy, fixture.seed)
	if err != nil {
		t.Fatalf("settle outcome: %v", err)
	}
	if lock := paid.Locks[fixture.secondBidID]; lock.Status != "paid" || lock.CashuPayoutTokenSHA256 != settleDigest {
		t.Fatalf("paid lock = %+v, want paid with digest %s", lock, settleDigest)
	}
	if len(paid.Notes) != len(closed.Notes) {
		t.Fatal("a settle outcome issued an IOU note; the mint swap is the money")
	}
}

// TestApplyOutcomeRecordRefusals pins the narrowness of the transition: a wrong
// signer, a wrong outcome, and a lock with no matching authorization are all
// refused.
func TestApplyOutcomeRecordRefusals(t *testing.T) {
	t.Parallel()
	fixture := newOutcomeFixture(t)
	policy := DefaultPolicy()
	digest := strings.Repeat("a", 64)

	// Close the auction so the leader is winner_selected and the status checks
	// are reached; the displaced first lock stays refundable.
	closed, err := ApplyTransaction(fixture.state, Transaction{Version: TxVersion, Type: "close", AuctionID: fixture.auctionID}, 1_600, policy, fixture.seed)
	if err != nil {
		t.Fatalf("close: %v", err)
	}
	if closed.Locks[fixture.firstBidID].Status != "refundable" {
		t.Fatalf("displaced lock = %q, want refundable", closed.Locks[fixture.firstBidID].Status)
	}

	// A non-application-authority signer cannot post the record.
	stranger := outcomeEvent(t, testPrivateKey(t), 1_601, fixture.auctionID, fixture.firstBidID, "refund", digest)
	if _, err := ApplyTransaction(closed, Transaction{Version: TxVersion, Type: "event", Event: &stranger}, 1_601, policy, fixture.seed); err == nil ||
		!strings.Contains(err.Error(), "application authority") {
		t.Fatalf("stranger outcome error = %v, want an authority refusal", err)
	}

	// The wrong outcome for the lock's status is refused: settle on the
	// displaced bid, settle on a winning lock that is not yet selected, and
	// refund on the winner_selected winner.
	settleDisplaced := outcomeEvent(t, fixture.committee, 1_601, fixture.auctionID, fixture.firstBidID, "settle", digest)
	if _, err := ApplyTransaction(closed, Transaction{Version: TxVersion, Type: "event", Event: &settleDisplaced}, 1_601, policy, fixture.seed); err == nil ||
		!strings.Contains(err.Error(), "does not name the winning bid") {
		t.Fatalf("settle-on-displaced error = %v, want a winning-bid refusal", err)
	}
	notSelected := closed
	winnerLock := notSelected.Locks[fixture.secondBidID]
	winnerLock.Status = "locked"
	notSelected.Locks[fixture.secondBidID] = winnerLock
	settleNotSelected := outcomeEvent(t, fixture.committee, 1_601, fixture.auctionID, fixture.secondBidID, "settle", digest)
	if _, err := ApplyTransaction(notSelected, Transaction{Version: TxVersion, Type: "event", Event: &settleNotSelected}, 1_601, policy, fixture.seed); err == nil ||
		!strings.Contains(err.Error(), "not winner_selected") {
		t.Fatalf("settle-on-unselected error = %v, want a winner_selected refusal", err)
	}
	wrongWinner := outcomeEvent(t, fixture.committee, 1_601, fixture.auctionID, fixture.secondBidID, "refund", digest)
	if _, err := ApplyTransaction(closed, Transaction{Version: TxVersion, Type: "event", Event: &wrongWinner}, 1_601, policy, fixture.seed); err == nil ||
		!strings.Contains(err.Error(), "not refundable") {
		t.Fatalf("refund-on-winner error = %v, want a refundable refusal", err)
	}

	// A lock with no matching authorization is refused.
	stripped := closed
	lock := stripped.Locks[fixture.firstBidID]
	lock.RefundAuthorization = ""
	stripped.Locks[fixture.firstBidID] = lock
	unauthorized := outcomeEvent(t, fixture.committee, 1_601, fixture.auctionID, fixture.firstBidID, "refund", digest)
	if _, err := ApplyTransaction(stripped, Transaction{Version: TxVersion, Type: "event", Event: &unauthorized}, 1_601, policy, fixture.seed); err == nil ||
		!strings.Contains(err.Error(), "no refund authorization") {
		t.Fatalf("missing-authorization error = %v, want a no-authorization refusal", err)
	}
}

// TestCashuLockOutcomeAuthorizationsRoundTripKeepsLockFieldsStable pins that an
// unauthorized bid stores empty authorizations and cannot be resolved, while an
// authorized one stores both values.
func TestCashuLockOutcomeAuthorizationsRoundTripKeepsLockFieldsStable(t *testing.T) {
	t.Parallel()
	state, seed, committee := cashuLockFixture(t)
	bidder := testPrivateKey(t)
	wallet := newWalletClaim(t)
	event, eventPolicy := authorizedBidEvent(t, committee, bidder, "mint-backed", 120, 1_001, "op-roundtrip", strings.Repeat("a", 64), wallet)
	next, err := ApplyTransaction(state, Transaction{Version: TxVersion, Type: "event", Event: &event}, 1_001, eventPolicy, seed)
	if err != nil {
		t.Fatalf("authorized bid: %v", err)
	}
	lock := next.Locks[event.ID]
	if lock.SettleAuthorization == "" || lock.RefundAuthorization == "" {
		t.Fatalf("lock authorizations = %q / %q, want both stored", lock.SettleAuthorization, lock.RefundAuthorization)
	}

	// A plain (unauthorized) bid still commits at the transition but stores
	// empty authorizations, so applyOutcomeRecord can never resolve it.
	plainState, plainSeed, plainCommittee := cashuLockFixture(t)
	plainBidder := testPrivateKey(t)
	plainProofs, plainRefs := backedProofs(t, 120)
	receipt := testCashuLockReceipt(t, plainCommittee, "mint-backed", actorForKey(plainBidder), 120, "op-plain", strings.Repeat("c", 64), 1_700, plainRefs)
	plainEvent := testEvent(t, plainBidder, 1_001, KindBid, bidContent{AuctionID: "mint-backed", Amount: 120, CashuLock: &receipt, Proofs: plainProofs})
	plain, err := ApplyTransaction(plainState, Transaction{Version: TxVersion, Type: "event", Event: &plainEvent}, 1_001, backedPolicy(120), plainSeed)
	if err != nil {
		t.Fatalf("plain bid: %v", err)
	}
	if plain.Locks[plainEvent.ID].SettleAuthorization != "" || plain.Locks[plainEvent.ID].RefundAuthorization != "" {
		t.Fatal("a bid without authorizations stored a non-empty authorization")
	}
}
