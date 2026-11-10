package poc

// The coordinator's KindOutcome record must resolve a cashu_sigall_v1 lock from
// the bidder's committed pre-signed template. Without this the value could move
// at the mint while the lock stayed in its pre-outcome status, because the
// legacy wallet-spend-key consent field is empty on the sigall route.

import (
	"strings"
	"testing"
)

func TestOutcomeRecordResolvesSigAllLockFromCommittedTemplate(t *testing.T) {
	t.Parallel()
	committee := compressed(testPrivateKey(t))
	newState := func() *State {
		return &State{
			CommitteePublicKey: committee,
			Auctions: map[string]Auction{"a1": {
				ID: "a1", Status: "closed", FundingMode: FundingModeCashuSigAll, Winner: "bidder",
			}},
			Locks: map[string]Lock{"b1": {
				ID: "b1", AuctionID: "a1", BidID: "b1", Bidder: "bidder", Amount: 100, Status: "winner_selected",
			}},
			Bids: map[string]Bid{"b1": {
				ID: "b1", AuctionID: "a1", Bidder: "bidder", Amount: 100,
				OutcomeTemplates: &sigAllDepositTemplates{
					Settle: sigAllSignedTemplate{BidderSignature: strings.Repeat("a", 128)},
					Refund: sigAllSignedTemplate{BidderSignature: strings.Repeat("b", 128)},
				},
			}},
			Operations: map[string]bool{},
		}
	}
	digest := strings.Repeat("c", 64)

	// Settle: the committed settle template is the warrant; the lock goes paid.
	state := newState()
	actor := applicationAuthorityPubKey(*state)
	if err := applyOutcomeRecord(state, actor, outcomeContent{
		Schema: "PlebeianAuctionsPOCOutcomeV1", AuctionID: "a1", BidID: "b1", Outcome: "settle", PayoutTokenSHA256: digest,
	}); err != nil {
		t.Fatalf("a sigall settle record was refused: %v", err)
	}
	if state.Locks["b1"].Status != "paid" {
		t.Fatalf("settle did not mark the lock paid: %q", state.Locks["b1"].Status)
	}

	// Refund mirror: a refundable sigall lock resolves from its committed refund template.
	state = newState()
	refundable := state.Locks["b1"]
	refundable.Status = "refundable"
	state.Locks["b1"] = refundable
	if err := applyOutcomeRecord(state, actor, outcomeContent{
		Schema: "PlebeianAuctionsPOCOutcomeV1", AuctionID: "a1", BidID: "b1", Outcome: "refund", PayoutTokenSHA256: digest,
	}); err != nil {
		t.Fatalf("a sigall refund record was refused: %v", err)
	}
	if state.Locks["b1"].Status != "refunded" {
		t.Fatalf("refund did not mark the lock refunded: %q", state.Locks["b1"].Status)
	}

	// No warrant at all -- no consent field and no committed template -- is refused.
	state = newState()
	unwarranted := state.Bids["b1"]
	unwarranted.OutcomeTemplates = nil
	state.Bids["b1"] = unwarranted
	if err := applyOutcomeRecord(state, actor, outcomeContent{
		Schema: "PlebeianAuctionsPOCOutcomeV1", AuctionID: "a1", BidID: "b1", Outcome: "settle", PayoutTokenSHA256: digest,
	}); err == nil {
		t.Fatal("a settle record with no warrant was accepted")
	}
}
