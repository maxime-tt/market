package poc

// The coordinator that acts alone.
//
// The bridge slice above makes both terminal money moves computable at bid
// time: a mint-backed bidder publishes a settle and a refund wallet-spend-key
// pre-signature with the bid, and consensus stores them on the lock. From that
// point the bidder can go offline. This file is the other half -- a background
// actor, OUTSIDE consensus, that watches committed state, performs the one mint
// swap a terminal lock calls for, and then posts the coordinator's own outcome
// record so the mirror agrees with the money.
//
// It is a coordinator-side actor exactly like r20CloseTrigger: it reads
// committed state, acts with a bounded step budget, and retries with the same
// backoff shape. It performs mint HTTP I/O, so it must never run inside a
// consensus transition (DeliverTx / BeginBlock / ProcessProposal). It never
// mutates committed state directly -- it can only propose the KindOutcome the
// application authority is allowed to post, and consensus decides.
//
// What it needs, and why it cannot be less: a NUT-11 swap needs the bearer
// input secrets, which only the holder has. The bidder therefore also deposits
// the locked proofs with the coordinator before going offline (see the deposit
// endpoint below); the pre-signatures come from consensus, the bearer proofs
// from the deposit. The coordinator holds them only for the one swap, parks the
// fresh output -- P2PK-locked to the beneficiary's own key, so custody of value
// never moves -- and never reuses them.

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	// demoOutcomeSweepInterval is how often the loop wakes to look for terminal
	// locks. The step itself may spend longer than this on a real swap.
	demoOutcomeSweepInterval = 2 * time.Second
	// demoOutcomeSweepStepTimeout bounds one pass, comfortably above the mint
	// swap timeout so a slow mint yields an unresolved outcome to retry rather
	// than an ambiguous one.
	demoOutcomeSweepStepTimeout = 30 * time.Second
)

// demoOutcomeProofStore is the coordinator-local, in-memory store of the bearer
// proofs a bidder deposits with their pre-authorization. It is deliberately
// never written to consensus: these carry secrets, so they must not be
// replicated. A deposit is consumed and discarded once the corresponding
// outcome is committed.
type demoOutcomeProofStore struct {
	mu    sync.Mutex
	byBid map[string][]demoMintSpendProof
}

func (store *demoOutcomeProofStore) put(bidID string, proofs []demoMintSpendProof) {
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.byBid == nil {
		store.byBid = map[string][]demoMintSpendProof{}
	}
	store.byBid[bidID] = append([]demoMintSpendProof(nil), proofs...)
}

func (store *demoOutcomeProofStore) get(bidID string) ([]demoMintSpendProof, bool) {
	store.mu.Lock()
	defer store.mu.Unlock()
	proofs, ok := store.byBid[bidID]
	if !ok {
		return nil, false
	}
	return append([]demoMintSpendProof(nil), proofs...), true
}

func (store *demoOutcomeProofStore) discard(bidID string) {
	store.mu.Lock()
	defer store.mu.Unlock()
	delete(store.byBid, bidID)
}

// demoOutcomeTarget is one lock the sweeper could resolve, and how.
type demoOutcomeTarget struct {
	bidID   string
	outcome string
}

// demoOutcomeSweeper is the background actor. It mirrors r20CloseTrigger's
// per-key backoff and quarantine so a permanently bad lock is not retried
// forever and a transient mint failure is retried with backoff.
type demoOutcomeSweeper struct {
	server *APIServer
	now    func() time.Time
	mu     sync.Mutex
	// quarantined holds lock+busy targets whose failure is deterministic, so
	// the loop stops retrying them.
	quarantined map[string]bool
	nextAttempt map[string]time.Time
	retryCount  map[string]uint8
}

func newDemoOutcomeSweeper(server *APIServer, now func() time.Time) *demoOutcomeSweeper {
	return &demoOutcomeSweeper{server: server, now: now,
		quarantined: map[string]bool{}, nextAttempt: map[string]time.Time{}, retryCount: map[string]uint8{}}
}

func (sweeper *demoOutcomeSweeper) scheduleBackoff(id string) {
	count := sweeper.retryCount[id]
	if count < 7 {
		count++
	}
	sweeper.retryCount[id] = count
	delay := 5 * time.Second * time.Duration(1<<min(int(count-1), 6))
	if delay > 5*time.Minute {
		delay = 5 * time.Minute
	}
	sweeper.nextAttempt[id] = sweeper.now().Add(delay)
}

func (sweeper *demoOutcomeSweeper) clearBackoff(id string) {
	delete(sweeper.nextAttempt, id)
	delete(sweeper.retryCount, id)
}

// demoOutcomeTargets lists, deterministically, every lock that a stored
// authorization would let the coordinator resolve. It reads only committed
// state: a lock is listed only when its status and the auction's facts agree
// with the outcome, so a mislabeled lock can never be acted on.
func demoOutcomeTargets(state State) []demoOutcomeTarget {
	var targets []demoOutcomeTarget
	for _, lock := range state.Locks {
		switch lock.Status {
		case "winner_selected":
			// A lock is resolvable once the wallet-spend-key settle
			// authorization for this exact proof set is committed.
			if lock.SettleAuthorization == "" {
				continue
			}
			auction, ok := state.Auctions[lock.AuctionID]
			if !ok || auction.Status != "closed" ||
				(auction.FundingMode != FundingModeCashuLock && auction.FundingMode != FundingModeCashuSigAll) ||
				auction.LeaderBidID != lock.BidID {
				continue
			}
			targets = append(targets, demoOutcomeTarget{bidID: lock.BidID, outcome: "settle"})
		case "refundable":
			if lock.RefundAuthorization == "" {
				continue
			}
			targets = append(targets, demoOutcomeTarget{bidID: lock.BidID, outcome: "refund"})
		}
	}
	sort.Slice(targets, func(i, j int) bool {
		if targets[i].bidID != targets[j].bidID {
			return targets[i].bidID < targets[j].bidID
		}
		return targets[i].outcome < targets[j].outcome
	})
	return targets
}

// Step performs at most one terminal action, exactly like r20CloseTrigger. A
// nil return means there was nothing to do; an error is a fixed category the
// runner reports. Committed state is always re-read, so a second call after a
// committed outcome sees the lock already resolved and does nothing -- the
// no-double-act guarantee comes from consensus, not from local bookkeeping.
func (sweeper *demoOutcomeSweeper) Step(ctx context.Context) error {
	sweeper.mu.Lock()
	defer sweeper.mu.Unlock()
	state, err := sweeper.server.demoCommittedState(ctx)
	if err != nil {
		return errors.New("DEMO_OUTCOME_STATE_UNAVAILABLE")
	}
	for _, target := range demoOutcomeTargets(state) {
		key := target.bidID + ":" + target.outcome
		if sweeper.quarantined[key] || sweeper.now().Before(sweeper.nextAttempt[key]) {
			continue
		}
		lock, ok := state.Locks[target.bidID]
		if !ok {
			continue
		}
		proofs, haveProofs := sweeper.server.demoOutcomeProofs.get(target.bidID)
		parkKey := demoOutcomeParkKey(lock, target.outcome)
		if _, parked := sweeper.server.demoSettlements.get(parkKey); !haveProofs && !parked {
			// Nothing to act on yet: the bidder has not deposited the bearer
			// proofs and no payout was produced on an earlier attempt. Not an
			// error -- it is the expected state until one of those arrives.
			continue
		}
		if err := sweeper.resolve(ctx, state, lock, target.outcome, proofs); err != nil {
			if errors.Is(err, errDemoOutcomePermanent) {
				sweeper.quarantined[key] = true
				return errors.New("DEMO_OUTCOME_PERMANENT_REJECTION_QUARANTINED")
			}
			sweeper.scheduleBackoff(key)
			return errors.New("DEMO_OUTCOME_UNRESOLVED")
		}
		sweeper.clearBackoff(key)
		sweeper.server.demoOutcomeProofs.discard(target.bidID)
		return nil
	}
	return nil
}

// errDemoOutcomePermanent marks a target whose failure a retry cannot fix: a
// lock whose stored authorization does not match the outcome, or a deposit that
// does not match the committed receipt. Retrying those would only repeat the
// same deterministic refusal.
var errDemoOutcomePermanent = errors.New("demo outcome target is permanently invalid")

// resolve performs the one swap an outcome needs and posts the coordinator's
// record of it. It fails closed at every step and never acts on a lock whose
// stored authorization does not match the outcome it is about to perform.
func (sweeper *demoOutcomeSweeper) resolve(ctx context.Context, state State, lock Lock, outcome string, proofs []demoMintSpendProof) error {
	server := sweeper.server
	if server.demoCommitteeKey == nil || server.demoMintChecker == nil || server.demoMintKeyset == nil {
		return errors.New("demo outcome sweeper has no committee key or mint")
	}
	bid, ok := state.Bids[lock.BidID]
	if !ok || bid.CashuTokenSHA256 == "" {
		return fmt.Errorf("%w: lock names no mint-backed bid", errDemoOutcomePermanent)
	}
	receipt, ok := state.CashuLocks[bid.CashuTokenSHA256]
	if !ok {
		return fmt.Errorf("%w: committed receipt is missing", errDemoOutcomePermanent)
	}
	// A cashu_lock_v1 lock is authorized by the wallet-spend-key consent
	// signature stored on the lock, over the consent message for this exact
	// committed proof set, so the coordinator never acts on a lock whose
	// authorization names a different outcome or a different proof set.
	var recipient string
	switch outcome {
	case "settle":
		auction, ok := state.Auctions[lock.AuctionID]
		if !ok {
			return fmt.Errorf("%w: settle names no auction", errDemoOutcomePermanent)
		}
		if err := demoMintVerifySettleOwnership(lock.AuctionID, receipt.ProofStateRefs, receipt.RefundPublicKey, lock.SettleAuthorization); err != nil {
			return fmt.Errorf("%w: %v", errDemoOutcomePermanent, err)
		}
		recipient = auction.SellerCocoPaymentPublicKey
		if !validCompressedPublicKey(recipient) {
			return fmt.Errorf("%w: auction committed no seller wallet payout key", errDemoOutcomePermanent)
		}
	case "refund":
		if _, err := demoMintVerifyRefundOwnership(lock.AuctionID, receipt.ProofStateRefs, receipt.RefundPublicKey, lock.RefundAuthorization); err != nil {
			return fmt.Errorf("%w: %v", errDemoOutcomePermanent, err)
		}
		recipient = receipt.RefundPublicKey
	default:
		return fmt.Errorf("%w: unknown outcome %q", errDemoOutcomePermanent, outcome)
	}

	parkKey := demoOutcomeParkKey(lock, outcome)
	// The swap may already have happened on an earlier attempt whose outcome
	// record did not commit (a lost broadcast, or a restart). The fresh payout
	// is durable, so reuse it and only post the record: swapping again would be
	// a double spend, and after a restart the deposited proofs are gone.
	if fresh, ok := server.demoSettlements.get(parkKey); ok {
		digest, err := demoPayoutTokenDigest(fresh)
		if err != nil {
			return err
		}
		return sweeper.postOutcome(ctx, lock, outcome, digest)
	}

	var fresh []demoMintSpentProof
	var err error
	// The bearer proofs must be exactly the committed set and must cover the
	// lock. This also rejects a deposit that does not match.
	if err := demoMintVerifyProofSet(receipt, proofs, lock.Amount); err != nil {
		return fmt.Errorf("%w: %v", errDemoOutcomePermanent, err)
	}
	// The mint must still see every proof as unspent. Fail closed: a spent
	// proof outside our own durable payout means the value already moved
	// elsewhere.
	if err := VerifyCashuLockProofsAtMint(server.demoMintChecker, receipt); err != nil {
		if errors.Is(err, ErrMintProofSpent) {
			// Terminal: the mint settled this proof and it is not our
			// parked payout, so the value is gone. Retrying cannot fix it.
			return fmt.Errorf("%w: %v", errDemoOutcomePermanent, err)
		}
		return err
	}
	fresh, err = server.demoMintCooperativeSpend(ctx, proofs, recipient)
	if err != nil {
		return err
	}
	digest, err := demoPayoutTokenDigest(fresh)
	if err != nil {
		return err
	}
	// Park the fresh output before posting the record. It is P2PK-locked to the
	// beneficiary's own key, so this is not custody: only that key can spend it.
	if err := server.demoSettlements.put(parkKey, fresh); err != nil {
		return err
	}
	return sweeper.postOutcome(ctx, lock, outcome, digest)
}

// demoOutcomeParkKey is where a resolved outcome's fresh payout is parked. A
// settlement is keyed by auction so the seller fetches it as before; a swept
// refund is keyed by bid so the offline bidder can fetch theirs.
func demoOutcomeParkKey(lock Lock, outcome string) string {
	if outcome == "refund" {
		return lock.BidID
	}
	return lock.AuctionID
}

// postOutcome submits the coordinator's KindOutcome record, signed by the
// application authority -- the network's single secp256k1 committee key today,
// which is exactly the identity applyOutcomeRecord accepts. It is a mirror
// record: it moves no value, and its absence cannot cost anyone their money.
func (sweeper *demoOutcomeSweeper) postOutcome(ctx context.Context, lock Lock, outcome, digest string) error {
	content, err := json.Marshal(outcomeContent{
		Schema: "PlebeianAuctionsPOCOutcomeV1", AuctionID: lock.AuctionID,
		BidID: lock.BidID, Outcome: outcome, PayoutTokenSHA256: digest,
	})
	if err != nil {
		return err
	}
	event, err := SignNostrEvent(sweeper.server.demoCommitteeKey, sweeper.now().Unix(), KindOutcome, nil, string(content))
	if err != nil {
		return err
	}
	poster := sweeper.server.demoOutcomePoster
	if poster == nil {
		poster = sweeper.server.submitDemoOutcome
	}
	return poster(ctx, event)
}

// submitDemoOutcome is the production poster: it encodes the signed event as a
// transaction and submits it through the same node selection and result
// interpretation POST /api/event uses.
func (server *APIServer) submitDemoOutcome(ctx context.Context, event SignedEvent) error {
	raw, err := EncodeTransaction(Transaction{Version: TxVersion, Type: "event", Event: &event})
	if err != nil {
		return err
	}
	_, err = server.BroadcastRawEvent(ctx, raw)
	return err
}

// demoPayoutTokenDigest is the deterministic digest of a fresh payout proof
// set. Consensus cannot verify it -- the proofs are P2PK-locked to the
// beneficiary's key and only they can spend them -- so it is a record the
// outcome carries, not a proof of anything.
func demoPayoutTokenDigest(proofs []demoMintSpentProof) (string, error) {
	raw, err := json.Marshal(proofs)
	if err != nil {
		return "", err
	}
	digest := sha256.Sum256(raw)
	return hex.EncodeToString(digest[:]), nil
}

// startDemoOutcomeSweeper starts the coordinator's background outcome sweeper
// on a server path. Both the site path and the local-demo path call it: a
// deployment where the coordinator never acts alone would leave a bidder's
// closed browser as the only thing that can settle a lock, which is exactly
// what this background actor exists to prevent. It is a no-op without a
// committee key, i.e. when no mint-backed demo coordinator exists at all.
func startDemoOutcomeSweeper(ctx context.Context, api *APIServer) {
	if api == nil || api.demoCommitteeKey == nil {
		return
	}
	go runDemoOutcomeSweeper(ctx, newDemoOutcomeSweeper(api, time.Now), func(category string) {
		fmt.Fprintf(os.Stderr, "DEMO_OUTCOME_SWEEPER|%s\n", category)
	})
}

// runDemoOutcomeSweeper drives Step on a fixed interval until the context ends,
// reporting one fixed category per failure exactly like runR20CloseTrigger. It
// returns only when asked to stop or when a category is fatal.
func runDemoOutcomeSweeper(ctx context.Context, sweeper *demoOutcomeSweeper, report func(string)) {
	ticker := time.NewTicker(demoOutcomeSweepInterval)
	defer ticker.Stop()
	for {
		stepCtx, cancel := context.WithTimeout(ctx, demoOutcomeSweepStepTimeout)
		err := sweeper.Step(stepCtx)
		cancel()
		if err != nil {
			report(err.Error())
			if strings.HasPrefix(err.Error(), "DEMO_OUTCOME_FATAL_") {
				return
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

// demoOutcomeDepositBody is the bidder's deposit of the bearer proofs the
// coordinator will need if the bidder goes offline before a terminal outcome.
// The proofs are secrets, so they are never stored in consensus and never
// logged; the pre-signatures that warrant the swap live in the bid content.
type demoOutcomeDepositBody struct {
	BidID  string               `json:"bid_id"`
	Proofs []demoMintSpendProof `json:"proofs"`
}

// demoOutcomeDeposit accepts the bearer proofs a bidder deposits so the
// coordinator can settle or refund without them. It is the demo's stand-in for
// a transport the bidder trusts with the one spend; it validates shapes and
// stores in-memory only. The sweeper independently re-verifies the proofs
// against committed state before it moves anything, so a bad deposit can only
// make the sweeper refuse, never act wrongly.
func (server *APIServer) demoOutcomeDeposit(response http.ResponseWriter, request *http.Request) {
	if !server.legacyInterim || server.manifest.ApplicationAuthority != ApplicationAuthorityLegacy {
		writeError(response, http.StatusNotFound, errors.New("demo outcome deposit is available only on a legacy loopback network"))
		return
	}
	if server.demoCommitteeKey == nil {
		writeError(response, http.StatusServiceUnavailable, errors.New("demo outcome deposit has no committee key"))
		return
	}
	var body demoOutcomeDepositBody
	if err := decodeBody(request, &body); err != nil {
		writeError(response, http.StatusBadRequest, err)
		return
	}
	if !validIdentifier(body.BidID) {
		writeError(response, http.StatusBadRequest, errors.New("demo outcome deposit requires a valid bid id"))
		return
	}
	if len(body.Proofs) == 0 || len(body.Proofs) > MaxInputs {
		writeError(response, http.StatusBadRequest, errors.New("demo outcome deposit requires a bounded nonempty proof set"))
		return
	}
	for index, proof := range body.Proofs {
		if proof.Amount <= 0 || proof.KeysetID == "" || proof.Secret == "" || len(proof.Secret) > 4096 || !validCompressedPublicKey(proof.C) {
			writeError(response, http.StatusBadRequest, fmt.Errorf("demo outcome deposit proof %d is malformed", index))
			return
		}
	}
	server.demoOutcomeProofs.put(body.BidID, body.Proofs)
	writeJSON(response, http.StatusOK, map[string]any{"bid_id": body.BidID, "stored": len(body.Proofs)})
}
