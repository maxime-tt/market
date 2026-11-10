package poc

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"testing"

	"github.com/btcsuite/btcd/btcec/v2"
)

// positionTokenDigest derives a distinct 64-hex token digest per leg from its
// operation id, so the proofs backing one leg can never alias another leg's
// token record.
func positionTokenDigest(operation string) string {
	sum := sha256.Sum256([]byte(operation))
	return hex.EncodeToString(sum[:])
}

// cashuLeg builds one fully authorized cashu_lock_v1 bid whose committed lock
// amount is the leg's delta.
func cashuLeg(t *testing.T, committee *btcec.PrivateKey, auctionID string, bidder *btcec.PrivateKey, amount, createdAt int64, operation string) SignedEvent {
	t.Helper()
	wallet := newWalletClaim(t)
	refs := testProofRefs(t, testPrivateKey(t))
	receipt := outcomeReceipt(t, committee, auctionID, actorForKey(bidder), amount, operation, positionTokenDigest(operation), 1_700, refs, wallet.key)
	authorization := testOutcomeAuthorizations(t, auctionID, refs, wallet)
	return testEvent(t, bidder, createdAt, KindBid, bidContent{
		AuctionID: auctionID, Amount: amount, CashuLock: &receipt, OutcomeAuthorizations: &authorization,
	})
}

// positionFixture commits a mint-backed auction with a chosen reserve and the
// default increment of 100, so leg arithmetic is easy to read.
func positionFixture(t *testing.T, reserve int64) (State, []byte, *btcec.PrivateKey) {
	t.Helper()
	seed := make([]byte, ed25519.SeedSize)
	seed[0] = 55
	committee := testPrivateKey(t)
	state, err := NewState("position-fixture", ed25519.NewKeyFromSeed(seed).Public().(ed25519.PublicKey),
		hex.EncodeToString(committee.PubKey().SerializeCompressed()))
	if err != nil {
		t.Fatal(err)
	}
	seller := testPrivateKey(t)
	create := testEvent(t, seller, 1_000, KindCreate, createContent{
		AuctionID: "position-auction", Title: "Position item", Duration: 600,
		StartingBid: 100, Reserve: reserve, FundingMode: FundingModeCashuLock,
	})
	state, err = ApplyTransaction(state, Transaction{Version: TxVersion, Type: "event", Event: &create}, 1_000, DefaultPolicy(), seed)
	if err != nil {
		t.Fatal(err)
	}
	return state, seed, committee
}

func applyPositionLeg(t *testing.T, state State, seed []byte, event SignedEvent, at int64) State {
	t.Helper()
	next, err := ApplyTransaction(state, Transaction{Version: TxVersion, Type: "event", Event: &event}, at, DefaultPolicy(), seed)
	if err != nil {
		t.Fatalf("apply leg at %d: %v", at, err)
	}
	return next
}

// TestPositionOwnRaiseAddsLegAndHighBidIsPositionTotal pins the core model: a
// bidder's second bid is an additional leg whose amount is a delta, the
// auction's HighBid is the resulting position total, and the raise releases
// nothing the bidder already holds.
func TestPositionOwnRaiseAddsLegAndHighBidIsPositionTotal(t *testing.T) {
	t.Parallel()
	state, seed, committee := positionFixture(t, 0)
	bidder := testPrivateKey(t)
	actor := actorForKey(bidder)

	leg1 := cashuLeg(t, committee, "position-auction", bidder, 128, 1_001, "op-leg-1")
	state = applyPositionLeg(t, state, seed, leg1, 1_001)
	if state.Auctions["position-auction"].HighBid != 128 {
		t.Fatalf("first leg HighBid = %d, want 128", state.Auctions["position-auction"].HighBid)
	}

	leg2 := cashuLeg(t, committee, "position-auction", bidder, 128, 1_002, "op-leg-2")
	state = applyPositionLeg(t, state, seed, leg2, 1_002)

	auction := state.Auctions["position-auction"]
	if auction.HighBid != 256 {
		t.Fatalf("HighBid after own raise = %d, want the position total 256", auction.HighBid)
	}
	if auction.LeaderBidID != leg2.ID {
		t.Fatalf("LeaderBidID = %q, want the raising leg %q", auction.LeaderBidID, leg2.ID)
	}
	if state.Locks[leg1.ID].Status != "locked" || state.Locks[leg2.ID].Status != "locked" {
		t.Fatalf("own raise released a leg: leg1=%q leg2=%q", state.Locks[leg1.ID].Status, state.Locks[leg2.ID].Status)
	}
	if got := bidderPosition(&state, "position-auction", actor); got != 256 {
		t.Fatalf("derived position = %d, want 256", got)
	}
}

// TestPositionRaiseBelowIncrementIsRefused pins the uniform rule for the leader
// raising itself: the position must clear itself by the increment, so a dust
// leg is refused with the rule named.
func TestPositionRaiseBelowIncrementIsRefused(t *testing.T) {
	t.Parallel()
	state, seed, committee := positionFixture(t, 0)
	bidder := testPrivateKey(t)
	state = applyPositionLeg(t, state, seed, cashuLeg(t, committee, "position-auction", bidder, 128, 1_001, "op-leg-1"), 1_001)

	dust := cashuLeg(t, committee, "position-auction", bidder, 99, 1_002, "op-leg-dust")
	_, err := ApplyTransaction(state, Transaction{Version: TxVersion, Type: "event", Event: &dust}, 1_002, DefaultPolicy(), seed)
	if err == nil || !strings.Contains(err.Error(), "minimum increment over the leading position") {
		t.Fatalf("dust raise error = %v, want the named increment rule", err)
	}
}

// TestPositionNonLeaderMustClearLeader pins the other half of the same rule: a
// bidder below the leader must clear the LEADING POSITION, not its own prior
// commitment, by the increment.
func TestPositionNonLeaderMustClearLeader(t *testing.T) {
	t.Parallel()
	state, seed, committee := positionFixture(t, 0)
	holder := testPrivateKey(t)
	state = applyPositionLeg(t, state, seed, cashuLeg(t, committee, "position-auction", holder, 128, 1_001, "op-leader-leg"), 1_001)

	challenger := testPrivateKey(t)
	short := cashuLeg(t, committee, "position-auction", challenger, 150, 1_002, "op-short")
	_, err := ApplyTransaction(state, Transaction{Version: TxVersion, Type: "event", Event: &short}, 1_002, DefaultPolicy(), seed)
	if err == nil || !strings.Contains(err.Error(), "minimum increment over the leading position") {
		t.Fatalf("short challenger error = %v, want the named increment rule", err)
	}
}

// TestPositionOutbidReturnsEveryLeg pins all-or-nothing displacement: when
// another bidder takes the lead, EVERY leg of the previous leader is
// refundable, and the raiser's own leg is untouched.
func TestPositionOutbidReturnsEveryLeg(t *testing.T) {
	t.Parallel()
	state, seed, committee := positionFixture(t, 0)
	holder := testPrivateKey(t)
	state = applyPositionLeg(t, state, seed, cashuLeg(t, committee, "position-auction", holder, 128, 1_001, "op-hold-1"), 1_001)
	state = applyPositionLeg(t, state, seed, cashuLeg(t, committee, "position-auction", holder, 128, 1_002, "op-hold-2"), 1_002)

	challenger := testPrivateKey(t)
	outbid := cashuLeg(t, committee, "position-auction", challenger, 400, 1_003, "op-outbid")
	state = applyPositionLeg(t, state, seed, outbid, 1_003)

	for _, bid := range state.Bids {
		if bid.Bidder != actorForKey(holder) {
			continue
		}
		if state.Locks[bid.ID].Status != "refundable" {
			t.Fatalf("outbid leg %q lock = %q, want refundable", bid.ID, state.Locks[bid.ID].Status)
		}
	}
	if state.Locks[outbid.ID].Status != "locked" {
		t.Fatalf("raiser lock = %q, want locked", state.Locks[outbid.ID].Status)
	}
	if state.Auctions["position-auction"].HighBid != 400 {
		t.Fatalf("leading position = %d, want 400", state.Auctions["position-auction"].HighBid)
	}
}

// TestPositionCloseSelectsEveryLegAndReserveUsesTotal pins winner selection:
// the reserve is compared against the POSITION total (one leg alone is below
// it), and every leg of the winning position is marked winner_selected.
func TestPositionCloseSelectsEveryLegAndReserveUsesTotal(t *testing.T) {
	t.Parallel()
	state, seed, committee := positionFixture(t, 200)
	winner := testPrivateKey(t)
	leg1 := cashuLeg(t, committee, "position-auction", winner, 128, 1_001, "op-win-1")
	state = applyPositionLeg(t, state, seed, leg1, 1_001)
	leg2 := cashuLeg(t, committee, "position-auction", winner, 128, 1_002, "op-win-2")
	state = applyPositionLeg(t, state, seed, leg2, 1_002)

	if state.Auctions["position-auction"].HighBid != 256 || state.Locks[leg1.ID].Amount >= 200 {
		t.Fatalf("fixture did not build the intended below-single-leg, above-total position: HighBid=%d leg1=%d",
			state.Auctions["position-auction"].HighBid, state.Locks[leg1.ID].Amount)
	}

	closed, err := ApplyTransaction(state, Transaction{Version: TxVersion, Type: "close", AuctionID: "position-auction"}, 1_600, DefaultPolicy(), seed)
	if err != nil {
		t.Fatalf("close: %v", err)
	}
	if closed.Auctions["position-auction"].Winner != actorForKey(winner) {
		t.Fatalf("winner = %q, want the leading position's bidder", closed.Auctions["position-auction"].Winner)
	}
	for _, id := range []string{leg1.ID, leg2.ID} {
		if closed.Locks[id].Status != "winner_selected" {
			t.Fatalf("winning leg %q lock = %q, want winner_selected", id, closed.Locks[id].Status)
		}
	}
}

// TestPositionOutcomeSettlesEveryWinningLeg pins the outcome record against the
// position: any leg of the winning position settles (not only the one that last
// established the lead), and a leg belonging to nobody's position is refused.
func TestPositionOutcomeSettlesEveryWinningLeg(t *testing.T) {
	t.Parallel()
	state, seed, committee := positionFixture(t, 0)

	winner := testPrivateKey(t)
	state = applyPositionLeg(t, state, seed, cashuLeg(t, committee, "position-auction", winner, 128, 1_001, "op-a-1"), 1_001)
	rival := testPrivateKey(t)
	rivalLeg := cashuLeg(t, committee, "position-auction", rival, 400, 1_002, "op-b-1")
	state = applyPositionLeg(t, state, seed, rivalLeg, 1_002)
	firstLeg := cashuLeg(t, committee, "position-auction", winner, 500, 1_003, "op-a-2")
	state = applyPositionLeg(t, state, seed, firstLeg, 1_003)
	secondLeg := cashuLeg(t, committee, "position-auction", winner, 128, 1_004, "op-a-3")
	state = applyPositionLeg(t, state, seed, secondLeg, 1_004)

	closed, err := ApplyTransaction(state, Transaction{Version: TxVersion, Type: "close", AuctionID: "position-auction"}, 1_600, DefaultPolicy(), seed)
	if err != nil {
		t.Fatalf("close: %v", err)
	}
	// The lead was last established by secondLeg, so firstLeg is the "second"
	// leg the one-lock assumption could not settle.
	if closed.Auctions["position-auction"].LeaderBidID != secondLeg.ID {
		t.Fatalf("LeaderBidID = %q, want %q", closed.Auctions["position-auction"].LeaderBidID, secondLeg.ID)
	}
	if closed.Locks[firstLeg.ID].Status != "winner_selected" || closed.Locks[secondLeg.ID].Status != "winner_selected" {
		t.Fatalf("winning legs not selected: first=%q second=%q", closed.Locks[firstLeg.ID].Status, closed.Locks[secondLeg.ID].Status)
	}

	digest := strings.Repeat("f", 64)
	settle := outcomeEvent(t, committee, 1_601, "position-auction", firstLeg.ID, "settle", digest)
	paid, err := ApplyTransaction(closed, Transaction{Version: TxVersion, Type: "event", Event: &settle}, 1_601, DefaultPolicy(), seed)
	if err != nil {
		t.Fatalf("settle a non-leading winning leg: %v", err)
	}
	if lock := paid.Locks[firstLeg.ID]; lock.Status != "paid" || lock.CashuPayoutTokenSHA256 != digest {
		t.Fatalf("settled leg = %+v, want paid with digest %s", lock, digest)
	}

	foreign := outcomeEvent(t, committee, 1_602, "position-auction", rivalLeg.ID, "settle", digest)
	if _, err := ApplyTransaction(closed, Transaction{Version: TxVersion, Type: "event", Event: &foreign}, 1_602, DefaultPolicy(), seed); err == nil ||
		!strings.Contains(err.Error(), "does not name the winning bid") {
		t.Fatalf("settle on a non-winning leg error = %v, want a winning-bid refusal", err)
	}
}

// TestPositionMintBidCannotExitByAssertingReplacement pins that the "no exit"
// rule holds even if a mint-backed bid carries a bare ReplacesBidID: it has no
// replacement mechanism, so it is admitted as a leg and releases nothing.
func TestPositionMintBidCannotExitByAssertingReplacement(t *testing.T) {
	t.Parallel()
	state, seed, committee := positionFixture(t, 0)
	bidder := testPrivateKey(t)
	leg1 := cashuLeg(t, committee, "position-auction", bidder, 128, 1_001, "op-leg-1")
	state = applyPositionLeg(t, state, seed, leg1, 1_001)

	wallet := newWalletClaim(t)
	refs := testProofRefs(t, testPrivateKey(t))
	receipt := outcomeReceipt(t, committee, "position-auction", actorForKey(bidder), 128, "op-leg-2", positionTokenDigest("op-leg-2"), 1_700, refs, wallet.key)
	authorization := testOutcomeAuthorizations(t, "position-auction", refs, wallet)
	sneaky := testEvent(t, bidder, 1_002, KindBid, bidContent{
		AuctionID: "position-auction", Amount: 128, ReplacesBidID: leg1.ID,
		CashuLock: &receipt, OutcomeAuthorizations: &authorization,
	})
	state = applyPositionLeg(t, state, seed, sneaky, 1_002)

	if state.Locks[leg1.ID].Status != "locked" {
		t.Fatalf("a mint-backed bid released its own leg via ReplacesBidID: leg1=%q", state.Locks[leg1.ID].Status)
	}
	if state.Auctions["position-auction"].HighBid != 256 {
		t.Fatalf("position total = %d, want 256", state.Auctions["position-auction"].HighBid)
	}
}

// TestPositionSingleLegRegression pins that a one-leg auction behaves exactly as
// before the position model, for both mint-backed routes.
func TestPositionSingleLegRegression(t *testing.T) {
	t.Parallel()

	t.Run("cashu_lock_v1", func(t *testing.T) {
		t.Parallel()
		state, seed, committee := cashuLockFixture(t)
		bidder := testPrivateKey(t)
		refs := testProofRefs(t, testPrivateKey(t))
		wallet := newWalletClaim(t)
		event := authorizedBidEvent(t, committee, bidder, "mint-backed", 128, 1_001, "op-regress", strings.Repeat("a", 64), refs, wallet)

		next, err := ApplyTransaction(state, Transaction{Version: TxVersion, Type: "event", Event: &event}, 1_001, DefaultPolicy(), seed)
		if err != nil {
			t.Fatalf("single cashu_lock_v1 bid: %v", err)
		}
		if next.Auctions["mint-backed"].HighBid != 128 || next.Auctions["mint-backed"].LeaderBidID != event.ID {
			t.Fatalf("single-leg auction = high %d leader %q, want 128 / %q",
				next.Auctions["mint-backed"].HighBid, next.Auctions["mint-backed"].LeaderBidID, event.ID)
		}
		closed, err := ApplyTransaction(next, Transaction{Version: TxVersion, Type: "close", AuctionID: "mint-backed"}, 1_600, DefaultPolicy(), seed)
		if err != nil {
			t.Fatalf("close: %v", err)
		}
		if closed.Auctions["mint-backed"].Winner != actorForKey(bidder) || closed.Locks[event.ID].Status != "winner_selected" {
			t.Fatalf("single-leg close = winner %q lock %q", closed.Auctions["mint-backed"].Winner, closed.Locks[event.ID].Status)
		}
	})

	t.Run("cashu_sigall_v1", func(t *testing.T) {
		t.Parallel()
		fx := sigAllFixture(t)
		bidder := testPrivateKey(t)
		wallet := newWalletClaim(t)
		mint := newTestPinnedMint(t, 64)
		policy := mint.policy(t)
		event := sigAllBackedBid(t, fx, mint, bidder, wallet, 128)

		next, err := ApplyTransaction(fx.state, Transaction{Version: TxVersion, Type: "event", Event: &event}, 1_001, policy, fx.seed)
		if err != nil {
			t.Fatalf("single cashu_sigall_v1 bid: %v", err)
		}
		if next.Auctions[fx.auctionID].HighBid != 128 || next.Auctions[fx.auctionID].LeaderBidID != event.ID {
			t.Fatalf("single-leg sigall auction = high %d leader %q, want 128 / %q",
				next.Auctions[fx.auctionID].HighBid, next.Auctions[fx.auctionID].LeaderBidID, event.ID)
		}
		closed, err := ApplyTransaction(next, Transaction{Version: TxVersion, Type: "close", AuctionID: fx.auctionID}, 1_600, policy, fx.seed)
		if err != nil {
			t.Fatalf("close: %v", err)
		}
		if closed.Auctions[fx.auctionID].Winner != actorForKey(bidder) || closed.Locks[event.ID].Status != "winner_selected" {
			t.Fatalf("single-leg sigall close = winner %q lock %q", closed.Auctions[fx.auctionID].Winner, closed.Locks[event.ID].Status)
		}
	})
}
