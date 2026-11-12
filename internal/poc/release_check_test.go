package poc

// Wave E4: the release check. Every committee spend signature is now produced
// only after the server re-derives, from its OWN committed state, that the spend
// is authorized and that its destination is the committed one. These tests pin
// the refusals by name and prove the check is not vacuous: the happy path still
// signs and the value still moves.
//
// They fail closed on NON-COLLUDING faults -- a lock a close moved out of the
// authorizing status, a winner that is another bid, a destination the caller
// substituted, a sigall template this validator's state does not agree with.
// They do NOT (and cannot) show anything about a hacked majority; see
// release_check.go for what the check does and does not buy.

import (
	"context"
	"encoding/hex"
	"strings"
	"testing"
	"time"
)

// TestReleaseCheckRefusesSettleWhenLockNotWinnerSelected pins that a settlement
// signature is not produced when the validator's own committed lock is not in
// winner_selected.
func TestReleaseCheckRefusesSettleWhenLockNotWinnerSelected(t *testing.T) {
	t.Parallel()
	state, _, committee, _, sellerWallet, _, auctionID, secrets, amounts := settleableCashuFixture(t)
	bidID := state.Auctions[auctionID].LeaderBidID
	lock := state.Locks[bidID]
	lock.Status = "locked"
	state.Locks[bidID] = lock
	mint := newFakeSwapMint(t, amounts)
	server := refundServer(t, state, committee, mint)

	_, err := server.demoMintCooperativeSpend(context.Background(), refundProofs(t, secrets, amounts, mint.keysetID),
		committeeSpendIntent{Outcome: "settle", AuctionID: auctionID, BidID: bidID, Recipient: sellerWallet.publicKey})
	if err == nil || !strings.Contains(err.Error(), "not winner_selected") {
		t.Fatalf("release check error = %v, want one naming the lock status", err)
	}
	if mint.swaps != 0 {
		t.Fatalf("a non-winner_selected lock reached the mint (%d swaps)", mint.swaps)
	}
}

// TestReleaseCheckRefusesSettleWhenWinnerIsAnotherBid pins that a settlement is
// refused when committed state says the winner is another bid, even though the
// lock's own status still reads winner_selected.
func TestReleaseCheckRefusesSettleWhenWinnerIsAnotherBid(t *testing.T) {
	t.Parallel()
	state, _, committee, _, sellerWallet, _, auctionID, secrets, amounts := settleableCashuFixture(t)
	bidID := state.Auctions[auctionID].LeaderBidID
	auction := state.Auctions[auctionID]
	auction.Winner = actorForKey(testPrivateKey(t))
	state.Auctions[auctionID] = auction
	mint := newFakeSwapMint(t, amounts)
	server := refundServer(t, state, committee, mint)

	_, err := server.demoMintCooperativeSpend(context.Background(), refundProofs(t, secrets, amounts, mint.keysetID),
		committeeSpendIntent{Outcome: "settle", AuctionID: auctionID, BidID: bidID, Recipient: sellerWallet.publicKey})
	if err == nil || !strings.Contains(err.Error(), "not the auction winner") {
		t.Fatalf("release check error = %v, want one naming the winner", err)
	}
	if mint.swaps != 0 {
		t.Fatalf("a settlement for a non-winning bid reached the mint (%d swaps)", mint.swaps)
	}
}

// TestReleaseCheckRefusesRefundWhenLockNotRefundable pins that a refund
// signature is not produced when the validator's own committed lock is not
// refundable.
func TestReleaseCheckRefusesRefundWhenLockNotRefundable(t *testing.T) {
	t.Parallel()
	state, _, committee, _, bidID, secrets, amounts := refundableCashuFixture(t)
	lock := state.Locks[bidID]
	lock.Status = "locked"
	state.Locks[bidID] = lock
	mint := newFakeSwapMint(t, amounts)
	server := refundServer(t, state, committee, mint)

	_, err := server.demoMintCooperativeSpend(context.Background(), refundProofs(t, secrets, amounts, mint.keysetID),
		committeeSpendIntent{Outcome: "refund", AuctionID: lock.AuctionID, BidID: bidID, Recipient: newWalletClaim(t).publicKey})
	if err == nil || !strings.Contains(err.Error(), "not refundable") {
		t.Fatalf("release check error = %v, want one naming the lock status", err)
	}
	if mint.swaps != 0 {
		t.Fatalf("a non-refundable lock reached the mint (%d swaps)", mint.swaps)
	}
}

// TestReleaseCheckRefusesSpendAtNonCommittedDestination pins that a settlement
// signature is not produced for a destination other than the auction's
// committed seller payout key, even when everything else is valid.
func TestReleaseCheckRefusesSpendAtNonCommittedDestination(t *testing.T) {
	t.Parallel()
	state, _, committee, _, _, _, auctionID, secrets, amounts := settleableCashuFixture(t)
	bidID := state.Auctions[auctionID].LeaderBidID
	mint := newFakeSwapMint(t, amounts)
	server := refundServer(t, state, committee, mint)

	// A perfectly valid destination key that is not the committed one.
	foreign := newWalletClaim(t).publicKey
	_, err := server.demoMintCooperativeSpend(context.Background(), refundProofs(t, secrets, amounts, mint.keysetID),
		committeeSpendIntent{Outcome: "settle", AuctionID: auctionID, BidID: bidID, Recipient: foreign})
	if err == nil || !strings.Contains(err.Error(), "destination is not the one committed state authorizes") {
		t.Fatalf("release check error = %v, want one naming the destination", err)
	}
	if mint.swaps != 0 {
		t.Fatalf("a settlement to a non-committed destination reached the mint (%d swaps)", mint.swaps)
	}
}

// TestReleaseCheckSignsTheCommittedRefundDestination is the non-vacuousness
// proof for the cooperative route: the check lets the happy path through and
// the mint swap actually happens, locking the fresh value to the recipient.
func TestReleaseCheckSignsTheCommittedRefundDestination(t *testing.T) {
	t.Parallel()
	state, _, committee, _, bidID, secrets, amounts := refundableCashuFixture(t)
	receipt := state.CashuLocks[state.Bids[bidID].CashuTokenSHA256]
	mint := newFakeSwapMint(t, amounts)
	server := refundServer(t, state, committee, mint)

	fresh, err := server.demoMintCooperativeSpend(context.Background(), refundProofs(t, secrets, amounts, mint.keysetID),
		committeeSpendIntent{Outcome: "refund", AuctionID: state.Locks[bidID].AuctionID, BidID: bidID, Recipient: receipt.RefundPublicKey})
	if err != nil {
		t.Fatalf("release check refused a valid refund: %v", err)
	}
	if len(fresh) != len(amounts) || mint.swaps != 1 {
		t.Fatalf("fresh=%d swaps=%d, want the committed proofs and exactly one swap", len(fresh), mint.swaps)
	}
	for _, proof := range fresh {
		if recipient := p2pkRecipient(t, proof.Secret); recipient != receipt.RefundPublicKey {
			t.Fatalf("fresh proof locked to %s, want the committed destination %s", recipient, receipt.RefundPublicKey)
		}
	}
}

// TestReleaseCheckSignsTheCommittedSettlementEndpoint is the endpoint-level
// non-vacuousness proof for the settle route: the winner's settlement still
// succeeds through the release check and pays the committed seller key.
func TestReleaseCheckSignsTheCommittedSettlementEndpoint(t *testing.T) {
	t.Parallel()
	state, _, committee, bidder, _, bidderWallet, auctionID, secrets, amounts := settleableCashuFixture(t)
	mint := newFakeSwapMint(t, amounts)
	server := refundServer(t, state, committee, mint)

	recorder := postSettle(t, server, settleBody(t, auctionID, refundProofs(t, secrets, amounts, mint.keysetID), settleEvent(t, bidder, auctionID), bidderWallet))
	if recorder.Code != 200 {
		t.Fatalf("settlement through the release check = %d %s", recorder.Code, recorder.Body.String())
	}
	if mint.swaps != 1 {
		t.Fatalf("mint swaps = %d, want 1", mint.swaps)
	}
}

// TestReleaseCheckRefusesNonCommittedSigAllTemplate pins the SIG_ALL half of the
// brief: the spend re-verifies the COMMITTED outcome_templates against the
// committed auction and receipt, so a template this validator's own state does
// not agree with is refused by name before any signature is produced.
func TestReleaseCheckRefusesNonCommittedSigAllTemplate(t *testing.T) {
	t.Parallel()
	fx := sigAllFixture(t)
	bidder := testPrivateKey(t)
	wallet := newWalletClaim(t)
	pinned := newTestPinnedMint(t, 64)
	policy := pinned.policy(t)

	content := sigAllTemplatedContent(t, fx, pinned, bidder, wallet, 128)
	event := testEvent(t, bidder, 1_001, KindBid, content, bidRootTag(t, fx.state, fx.auctionID))
	committed, err := ApplyTransaction(fx.state, Transaction{Version: TxVersion, Type: "event", Event: &event}, 1_001, policy, fx.seed)
	if err != nil {
		t.Fatalf("valid templated sigall bid was refused: %v", err)
	}
	auction := committed.Auctions[fx.auctionID]
	auction.Status = "closed"
	auction.Winner = actorForKey(bidder)
	auction.LeaderBidID = event.ID
	committed.Auctions[fx.auctionID] = auction
	lock := committed.Locks[event.ID]
	lock.Status = "winner_selected"
	committed.Locks[event.ID] = lock
	receipt := committed.CashuLocks[committed.Bids[event.ID].CashuTokenSHA256]

	// Corrupt the COMMITTED settle template's destination, as if this
	// validator's own committed state disagreed with the request.
	bid := committed.Bids[event.ID]
	bid.OutcomeTemplates.Settle.Outputs[0].Secret = sigAllOutputSecret(t, wallet.publicKey)
	committed.Bids[event.ID] = bid

	swapMint := newFakeSwapMint(t, []int64{128})
	server := &APIServer{
		manifest: NetworkManifest{
			ChainID: "legacy", Mode: "remote", ApplicationAuthority: ApplicationAuthorityLegacy,
			CashuMintURL: swapMint.server.URL, Policy: policy,
		},
		legacyInterim:          true,
		demoCommitteeKey:       fx.committee,
		demoCommitteePublicKey: hex.EncodeToString(fx.committee.PubKey().SerializeCompressed()),
		demoMintChecker:        &fakeMint{},
		demoMintKeyset:         NewMintKeySetFetcher(swapMint.server.URL, 2*time.Second),
		demoStateSnapshot:      func(context.Context) (State, error) { return committed, nil },
	}
	_, err = server.demoMintSigAllSpend(context.Background(), receipt, committeeSpendIntent{
		Outcome: "settle", AuctionID: fx.auctionID, BidID: event.ID, Recipient: fx.sellerKey.publicKey,
	})
	if err == nil || !strings.Contains(err.Error(), "seller payout key") {
		t.Fatalf("release check error = %v, want one naming the committed destination rule", err)
	}
	if swapMint.swaps != 0 {
		t.Fatalf("a non-committed sigall template reached the mint (%d swaps)", swapMint.swaps)
	}
}
