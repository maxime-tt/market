package poc

// The release check: the guard at the committee signing boundary.
//
// WHY IT EXISTS. Slices E1-E3 made the two spend paths drive off committed,
// consensus-verified material, but the committee's half of a spend signature
// was still produced from a raw digest the caller built: CommitteeSigner was
// handed proofs and a recipient by the caller and only sanity-checked their
// shape, never consulting the validator's OWN committed state. E4 closes that.
// Before a committee spend signature is produced -- in the only two functions
// that ever produce one, demoMintCooperativeSpend and demoMintSigAllSpend --
// the server re-derives from its own committed state that the spend is
// authorized by policy and that its destination is the committed one, and
// refuses by name otherwise. The check runs immediately before
// CommitteeSigner.SignDigest, so a signature is never produced on the strength
// of caller-supplied values alone.
//
// WHAT IT BUYS, PLAINLY. It catches a coordinator or validator that acts on a
// fault it can SEE in its own committed state: a stale or forged request, a
// caller-supplied sigall template that is not the committed one, a lock a close
// or an earlier outcome already moved out of the authorizing status, or a
// destination the caller substituted for the committed one. These are
// NON-COLLUDING faults: the validator's own state contradicts the request, so
// refusing costs it nothing and needs no coordination.
//
// WHAT IT DOES NOT BUY. It does NOT stop a hacked majority. Every honest
// validator runs this check over the same committed state, so a supermajority
// that agrees to sign a spend its own state permits is unaffected -- that is
// exactly the ACCEPTED RESIDUAL the slice brief states (committee majority PLUS
// a victim that bid on the attacker's own auction). Nor does it make the
// committee threshold custody: CommitteeSigner still holds ONE local key today,
// so the deployed committee is a single key, not a 3-of-4 FROST group. The port
// remains the only place a committee spend signature is produced, so a FROST
// aggregate would slot in behind it unchanged; the release check would still
// gate it.

import (
	"context"
	"errors"
	"fmt"
)

// committeeSpendIntent names, in the terms the validator's committed state
// uses, exactly what a committee signature is being asked to authorize. It is
// what the release check re-derives: which outcome, for which auction and which
// lock, and to which destination key the fresh value must be locked.
type committeeSpendIntent struct {
	// Outcome is "settle" or "refund".
	Outcome string
	// AuctionID and BidID are the committed identities the caller claims.
	AuctionID string
	BidID     string
	// Recipient is the destination key the caller asks the outputs to be locked
	// to. The release check refuses unless committed state agrees it is the
	// committed destination for this outcome.
	Recipient string
}

// committeeRelease is the committed-state material a release check derives and
// hands back to the spend, so the spend submits exactly what the check verified
// rather than a caller-supplied copy.
type committeeRelease struct {
	lock    Lock
	auction Auction
	receipt CashuLockReceipt
	// templates is the committed sigall outcome_templates for a
	// cashu_sigall_v1 lock, nil for the cooperative route. The spend submits
	// these, never the caller's copy.
	templates *sigAllDepositTemplates
}

// releaseCheck re-derives, from the server's own committed state, that a
// committee spend of this intent is authorized, and returns the committed facts
// the spend then uses. proofs is the bearer proof set the caller offered; it is
// required for the cooperative route (cashu_lock_v1 / empty funding mode) and
// ignored for the sigall route, which spends the committed templates instead.
//
// It fails closed on every mismatch, each with a name that says which rule
// refused. It reads committed state through demoCommittedState, so a validator
// runs it over exactly what consensus accepted, not a cached or caller-supplied
// view.
func (server *APIServer) releaseCheck(ctx context.Context, intent committeeSpendIntent, proofs []demoMintSpendProof) (committeeRelease, error) {
	if intent.Outcome != "settle" && intent.Outcome != "refund" {
		return committeeRelease{}, fmt.Errorf("release check: unknown outcome %q", intent.Outcome)
	}
	state, err := server.demoCommittedState(ctx)
	if err != nil {
		return committeeRelease{}, fmt.Errorf("release check: committed state is unavailable: %w", err)
	}

	// (i) The lock and bid must exist in committed state, and the lock must be
	// the caller's claimed one for the claimed auction.
	lock, ok := state.Locks[intent.BidID]
	if !ok {
		return committeeRelease{}, errors.New("release check: the named lock does not exist in committed state")
	}
	if lock.AuctionID != intent.AuctionID {
		return committeeRelease{}, errors.New("release check: the named lock belongs to a different auction")
	}
	bid, ok := state.Bids[intent.BidID]
	if !ok || bid.CashuTokenSHA256 == "" {
		return committeeRelease{}, errors.New("release check: the named lock has no mint-backed bid in committed state")
	}
	receipt, ok := state.CashuLocks[bid.CashuTokenSHA256]
	if !ok {
		return committeeRelease{}, errors.New("release check: the committed receipt for the lock is missing")
	}
	auction, ok := state.Auctions[intent.AuctionID]
	if !ok {
		return committeeRelease{}, errors.New("release check: the named auction does not exist in committed state")
	}
	if !validCompressedPublicKey(intent.Recipient) {
		return committeeRelease{}, errors.New("release check: the spend names no valid destination key")
	}

	// (ii) The lock must be in the status that authorizes this outcome, and the
	// committed destination for it must equal the caller's recipient. The
	// destination is a committed fact: the auction's seller payout key for a
	// settle and the receipt's wallet spend key for a sigall refund. A
	// cooperative refund is the one case where committed state does not pin a
	// destination on its own: the live bidder may direct the return to a key
	// they freshly prove ownership of (the V2 claim, checked in the endpoint),
	// so no committed destination is available to compare against. When the
	// lock carries a committed refund pre-authorization -- the offline sweeper
	// route -- the receipt's key is the committed destination and is enforced.
	committedDestination := ""
	switch intent.Outcome {
	case "refund":
		if lock.Status != "refundable" {
			return committeeRelease{}, fmt.Errorf("release check: the lock is %q, not refundable, so a refund is not authorized by committed state", lock.Status)
		}
		committedDestination = receipt.RefundPublicKey
		if receipt.FundingMode != FundingModeCashuSigAll && lock.RefundAuthorization == "" {
			committedDestination = ""
		}
	case "settle":
		if lock.Status != "winner_selected" {
			return committeeRelease{}, fmt.Errorf("release check: the lock is %q, not winner_selected, so a settlement is not authorized by committed state", lock.Status)
		}
		if auction.Status != "closed" {
			return committeeRelease{}, fmt.Errorf("release check: the auction is %q, not closed, so a settlement is not authorized by committed state", auction.Status)
		}
		if auction.Winner == "" || lock.Bidder != auction.Winner {
			return committeeRelease{}, errors.New("release check: the lock's bidder is not the auction winner, so a settlement is not authorized by committed state")
		}
		committedDestination = auction.SellerCocoPaymentPublicKey
	}
	if committedDestination != "" {
		if !validCompressedPublicKey(committedDestination) {
			return committeeRelease{}, errors.New("release check: committed state names no destination key for this spend")
		}
		if intent.Recipient != committedDestination {
			return committeeRelease{}, fmt.Errorf("release check: the destination is not the one committed state authorizes for this %s", intent.Outcome)
		}
	}

	release := committeeRelease{lock: lock, auction: auction, receipt: receipt}

	// (iii) The material being spent must be the committed material. The sigall
	// route re-verifies the committed outcome_templates -- not a caller-supplied
	// copy -- against the committed auction and receipt; the cooperative route
	// re-binds the offered proofs to the committed receipt.
	if receipt.FundingMode == FundingModeCashuSigAll {
		templates := bid.OutcomeTemplates
		if templates == nil {
			return committeeRelease{}, errors.New("release check: the committed sigall bid carries no outcome templates")
		}
		template := templates.Settle
		if intent.Outcome == "refund" {
			template = templates.Refund
		}
		if len(template.Inputs) == 0 || len(template.Outputs) == 0 {
			return committeeRelease{}, fmt.Errorf("release check: the committed sigall %s template is empty", intent.Outcome)
		}
		// Rebuild the committed bid content the admission rule was written for.
		// Committed state keeps the proofs only as NUT-07 references, so the
		// template's own inputs -- which consensus already bound to those
		// references -- stand in for content.Proofs. The receipt binding is
		// re-checked explicitly below because this rebuild makes rule (b) of
		// verifySigAllBidTemplates self-consistent by construction.
		rebuiltProofs := make([]demoMintSpendProof, 0, len(template.Inputs))
		for _, input := range template.Inputs {
			rebuiltProofs = append(rebuiltProofs, demoMintSpendProof{Amount: input.Amount, KeysetID: input.ID, Secret: input.Secret, C: input.C})
		}
		content := bidContent{AuctionID: intent.AuctionID, Amount: bid.Amount, Proofs: rebuiltProofs, OutcomeTemplates: templates}
		if err := verifySigAllBidTemplates(auction, content, receipt, server.manifest.Policy); err != nil {
			return committeeRelease{}, fmt.Errorf("release check: the committed sigall %s template does not verify: %w", intent.Outcome, err)
		}
		if err := sigAllTemplateInputsAreReceipt(template, receipt); err != nil {
			return committeeRelease{}, fmt.Errorf("release check: the committed sigall %s template does not spend the committed proofs: %w", intent.Outcome, err)
		}
		release.templates = templates
		return release, nil
	}

	if err := demoMintVerifyProofSet(receipt, proofs, lock.Amount); err != nil {
		return committeeRelease{}, fmt.Errorf("release check: %w", err)
	}
	return release, nil
}
