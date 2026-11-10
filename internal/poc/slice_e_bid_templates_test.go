package poc

// Wave E2b: the bidder's pre-signed SIG_ALL outcome templates travel INSIDE the
// committed bid content, and every validator verifies them inside consensus.
//
// The refusal table drives the real transition (ApplyTransaction), not the
// helper in isolation, so it pins that a malformed or unauthorized template is
// refused by name on the path every validator runs. The positive test builds a
// valid sigall bid, applies it, and shows the committed lock becomes
// sweep-targetable and the coordinator submits exactly the committed template's
// own inputs and outputs.

import (
	"context"
	"encoding/hex"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/btcsuite/btcd/btcec/v2"
)

// sigAllTemplatedContent builds a fully-backed, consensus-valid cashu_sigall_v1
// bid content: two 64-sat proofs locked exactly 2-of-2 SIG_ALL to
// [wallet, committee], with the bidder's pre-signed settle (to the auction's
// committed seller key) and refund (to the wallet spend key) templates.
func sigAllTemplatedContent(t *testing.T, fx sigAllFixtureState, mint testPinnedMint, bidder *btcec.PrivateKey, wallet walletClaim, amount int64) bidContent {
	t.Helper()
	required := auctionRequiredLocktime(fx.state.Auctions[fx.auctionID])
	var proofs []demoMintSpendProof
	var refs []string
	for index := 0; index < 2; index++ {
		secret := sigAllLockSecret(t, wallet.publicKey, compressed(fx.committee), required)
		proofs = append(proofs, mint.proofForSecret(t, 64, secret))
		reference, err := demoMintProofY(secret)
		if err != nil {
			t.Fatal(err)
		}
		refs = append(refs, reference)
	}
	sort.Strings(refs)
	receipt := testCarriedProofReceipt(t, fx.committee, fx.auctionID, actorForKey(bidder), amount, required, wallet.publicKey, refs, FundingModeCashuSigAll)
	templates := sigAllSignedTemplates(t, mint.keysetID, wallet, proofs, fx.sellerKey.publicKey, amount)
	return bidContent{
		AuctionID: fx.auctionID, Amount: amount, CashuLock: &receipt, Proofs: proofs,
		OutcomeTemplates: &templates,
	}
}

func applySigAllContent(t *testing.T, fx sigAllFixtureState, policy Policy, bidder *btcec.PrivateKey, content bidContent) (State, error) {
	t.Helper()
	event := testEvent(t, bidder, 1_001, KindBid, content)
	return ApplyTransaction(fx.state, Transaction{Version: TxVersion, Type: "event", Event: &event}, 1_001, policy, fx.seed)
}

// TestSigAllBidTemplateRefusalsByName pins each rule (a)-(g) of
// verifySigAllBidTemplates by name, on the consensus transition path.
func TestSigAllBidTemplateRefusalsByName(t *testing.T) {
	t.Parallel()
	fx := sigAllFixture(t)
	bidder := testPrivateKey(t)
	wallet := newWalletClaim(t)
	mint := newTestPinnedMint(t, 64)
	policy := mint.policy(t)

	base := func() bidContent { return sigAllTemplatedContent(t, fx, mint, bidder, wallet, 128) }

	// Sanity: the unmutated bid is admitted, or the whole table proves nothing.
	if _, err := applySigAllContent(t, fx, policy, bidder, base()); err != nil {
		t.Fatalf("a valid templated sigall bid was refused: %v", err)
	}

	cases := []struct {
		name   string
		mutate func(*bidContent)
		reason string
	}{
		{
			"(a) no outcome_templates published",
			func(content *bidContent) { content.OutcomeTemplates = nil },
			"must publish outcome_templates",
		},
		{
			"(b) settle inputs are not the committed proof secrets",
			func(content *bidContent) {
				content.OutcomeTemplates.Settle.Inputs[0].Secret = hex.EncodeToString(testPrivateKey(t).Serialize())
			},
			"not the committed proof's secret",
		},
		{
			"(b) refund input count does not match the bid's proofs",
			func(content *bidContent) {
				content.OutcomeTemplates.Refund.Inputs = content.OutcomeTemplates.Refund.Inputs[:1]
			},
			"but the bid carries 2 proofs",
		},
		{
			"(c) settle outputs do not sum to the bid amount",
			func(content *bidContent) { content.OutcomeTemplates.Settle.Outputs[0].Amount = 127 },
			"not the bid's amount 128",
		},
		{
			"(c) refund output names a foreign keyset",
			func(content *bidContent) { content.OutcomeTemplates.Refund.Outputs[0].ID = "deadbeefdeadbeef" },
			"not the pinned",
		},
		{
			"(d) settle output is not locked to the seller payout key",
			func(content *bidContent) {
				content.OutcomeTemplates.Settle.Outputs[0].Secret = sigAllOutputSecret(t, wallet.publicKey)
			},
			"seller payout key",
		},
		{
			"(e) refund output is not locked to the wallet spend key",
			func(content *bidContent) {
				content.OutcomeTemplates.Refund.Outputs[0].Secret = sigAllOutputSecret(t, fx.sellerKey.publicKey)
			},
			"wallet spend key",
		},
		{
			"(f) settle digest does not match its inputs and outputs",
			func(content *bidContent) { content.OutcomeTemplates.Settle.Digest = strings.Repeat("0", 64) },
			"digest does not match",
		},
		{
			"(g) settle bidder signature does not verify",
			func(content *bidContent) {
				content.OutcomeTemplates.Settle.BidderSignature = strings.Repeat("0", 128)
			},
			"does not verify over the template digest",
		},
	}
	for _, testCase := range cases {
		content := base()
		testCase.mutate(&content)
		_, err := applySigAllContent(t, fx, policy, bidder, content)
		if err == nil {
			t.Fatalf("%s: the mutated bid was ACCEPTED", testCase.name)
		}
		if !strings.Contains(err.Error(), testCase.reason) {
			t.Fatalf("%s: error = %q, want it to name %q", testCase.name, err.Error(), testCase.reason)
		}
	}
}

// TestSigAllCommittedTemplatesBecomeSweepTargetable is the positive test: a valid
// templated sigall bid commits, the lock's committed bid makes it
// sweep-targetable, and the coordinator submits exactly the committed
// template's own inputs and outputs (never a locally-built transaction).
func TestSigAllCommittedTemplatesBecomeSweepTargetable(t *testing.T) {
	t.Parallel()
	fx := sigAllFixture(t)
	bidder := testPrivateKey(t)
	wallet := newWalletClaim(t)
	pinnedMint := newTestPinnedMint(t, 64)
	policy := pinnedMint.policy(t)

	content := sigAllTemplatedContent(t, fx, pinnedMint, bidder, wallet, 128)
	event := testEvent(t, bidder, 1_001, KindBid, content)
	committed, err := ApplyTransaction(fx.state, Transaction{Version: TxVersion, Type: "event", Event: &event}, 1_001, policy, fx.seed)
	if err != nil {
		t.Fatalf("a valid templated sigall bid was refused: %v", err)
	}
	bid := committed.Bids[event.ID]
	if bid.OutcomeTemplates == nil {
		t.Fatal("the committed bid did not carry its outcome templates")
	}

	// Close the auction and select the lock, exactly as a close would.
	state := committed
	auction := state.Auctions[fx.auctionID]
	auction.Status = "closed"
	auction.Winner = actorForKey(bidder)
	auction.LeaderBidID = event.ID
	state.Auctions[fx.auctionID] = auction
	lock := state.Locks[event.ID]
	lock.Status = "winner_selected"
	state.Locks[event.ID] = lock

	targets := demoOutcomeTargets(state)
	if len(targets) != 1 || targets[0].bidID != event.ID || targets[0].outcome != "settle" {
		t.Fatalf("demoOutcomeTargets = %+v, want one settle target for %q", targets, event.ID)
	}

	// Drive the sweeper. The coordinator's mint is a swap stub; the mint's
	// keyset id matches the pinned one so the swap body names the committed
	// keyset.
	swapMint := newFakeSwapMint(t, []int64{128})
	current := state
	var posted []SignedEvent
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
		demoStateSnapshot:      func(context.Context) (State, error) { return current, nil },
		demoSettlements:        settlementStore{dir: t.TempDir()},
		demoOutcomePoster: func(_ context.Context, outcome SignedEvent) error {
			posted = append(posted, outcome)
			return nil
		},
	}
	sweeper := newDemoOutcomeSweeper(server, time.Now)
	if err := sweeper.Step(context.Background()); err != nil {
		t.Fatalf("sweep step: %v", err)
	}
	if swapMint.swaps != 1 || len(posted) != 1 {
		t.Fatalf("swaps=%d posted=%d, want 1 and 1", swapMint.swaps, len(posted))
	}

	// The mint received exactly the committed template's own inputs.
	settle := bid.OutcomeTemplates.Settle
	if len(swapMint.inputs) != len(settle.Inputs) {
		t.Fatalf("mint received %d inputs, want the committed %d", len(swapMint.inputs), len(settle.Inputs))
	}
	for index, input := range swapMint.inputs {
		if input.Secret != settle.Inputs[index].Secret || input.Amount != settle.Inputs[index].Amount || input.ID != settle.Inputs[index].ID {
			t.Fatalf("submitted input %d = %+v, want the committed template input %+v", index, input, settle.Inputs[index])
		}
		// The witness must carry the bidder's committed pre-signature; the
		// committee adds its half.
		if !strings.Contains(input.Witness, settle.BidderSignature) {
			t.Fatalf("submitted input %d witness does not carry the committed bidder signature", index)
		}
	}

	// The parked payout is exactly the committed template's own outputs: each
	// fresh proof's secret is the committed output secret.
	parked, ok := server.demoSettlements.get(fx.auctionID)
	if !ok || len(parked) != len(settle.Outputs) {
		t.Fatalf("parked payout = %d proofs (present %v), want %d", len(parked), ok, len(settle.Outputs))
	}
	for index, proof := range parked {
		if proof.Secret != settle.Outputs[index].Secret {
			t.Fatalf("payout proof %d secret = %q, want the committed output secret", index, proof.Secret)
		}
		// And it lands on the auction's committed seller payout key.
		if recipient := p2pkRecipient(t, proof.Secret); recipient != fx.sellerKey.publicKey {
			t.Fatalf("payout is locked to %s, want the committed seller key %s", recipient, fx.sellerKey.publicKey)
		}
	}
}
