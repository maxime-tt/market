package poc

import (
	"context"
	"crypto/ed25519"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/btcsuite/btcd/btcec/v2"
	"github.com/btcsuite/btcd/btcec/v2/schnorr"
)

func outcomeSweepSeed() []byte {
	seed := make([]byte, ed25519.SeedSize)
	seed[0] = 91
	return seed
}

func signSettleAuthorization(t *testing.T, key *btcec.PrivateKey, auctionID string, refs []string) string {
	t.Helper()
	signature, err := schnorr.Sign(key, sha256Sum(demoMintSettleClaimMessage(auctionID, refs)))
	if err != nil {
		t.Fatal(err)
	}
	return hex.EncodeToString(signature.Serialize())
}

func signRefundAuthorization(t *testing.T, key *btcec.PrivateKey, auctionID string, refs []string) string {
	t.Helper()
	outputs := make([]string, len(refs))
	for index := range outputs {
		outputs[index] = hex.EncodeToString(key.PubKey().SerializeCompressed())
	}
	signature, err := schnorr.Sign(key, sha256Sum(bidOutcomeRefundClaimMessageV2(auctionID, refs, outputs)))
	if err != nil {
		t.Fatal(err)
	}
	return hex.EncodeToString(signature.Serialize())
}

type outcomeSweepFixture struct {
	state       State
	seed        []byte
	committee   *btcec.PrivateKey
	mint        *fakeSwapMint
	auctionID   string
	settleBidID string
	refundBidID string
	secrets     []string
	amounts     []int64
	refSecrets  []string
	sellerKey   walletClaim
	bidderKey   walletClaim
}

// newOutcomeSweepFixture constructs committed state directly: a closed
// mint-backed auction whose winning lock is winner_selected (with a settle
// pre-authorization), and optionally a displaced lock that is refundable (with a
// refund pre-authorization). The proof references are the Y points of the
// secrets, exactly as the real receipt binds them.
func newOutcomeSweepFixture(t *testing.T, withSettle, withRefund bool) outcomeSweepFixture {
	t.Helper()
	seed := outcomeSweepSeed()
	committee := testPrivateKey(t)
	state, err := NewState("sweep-fixture", ed25519.NewKeyFromSeed(seed).Public().(ed25519.PublicKey),
		hex.EncodeToString(committee.PubKey().SerializeCompressed()))
	if err != nil {
		t.Fatal(err)
	}
	sellerKey := newWalletClaim(t)
	bidderKey := newWalletClaim(t)
	bidderNostr := actorForKey(testPrivateKey(t))
	sellerNostr := actorForKey(testPrivateKey(t))

	secrets := []string{"sweep-secret-one", "sweep-secret-two"}
	amounts := []int64{64, 64}
	refs := proofRefsFor(t, secrets)

	auctionID := "sweep-auction"
	settleBidID := "sweep-win-bid"
	settleToken := strings.Repeat("a", 64)
	settleLockReceipt := settleReceipt(t, committee, auctionID, bidderNostr, 128, "op-sweep-win", settleToken, 1_700, refs, bidderKey.key)
	state.Bids[settleBidID] = Bid{ID: settleBidID, AuctionID: auctionID, Bidder: bidderNostr, Amount: 128, CashuTokenSHA256: settleToken, CommittedAt: 1_001}
	state.CashuLocks[settleToken] = settleLockReceipt
	settleLock := Lock{ID: settleBidID, AuctionID: auctionID, BidID: settleBidID, Bidder: bidderNostr, Amount: 128, Status: "winner_selected"}
	if withSettle {
		settleLock.SettleAuthorization = signSettleAuthorization(t, bidderKey.key, auctionID, refs)
	}
	settleLock.RefundAuthorization = signRefundAuthorization(t, bidderKey.key, auctionID, refs)
	state.Locks[settleBidID] = settleLock

	state.Auctions[auctionID] = Auction{
		ID: auctionID, Seller: sellerNostr, FundingMode: FundingModeCashuLock,
		SellerCocoPaymentPublicKey: sellerKey.publicKey, StartingBid: 100, MinIncrement: 100,
		OriginalEndTime: 1_600, EndTime: 1_600, Status: "closed", LeaderBidID: settleBidID, Winner: bidderNostr,
	}

	refundBidID := "sweep-ref-bid"
	if withRefund {
		refundSecrets := []string{"sweep-refund-one", "sweep-refund-two"}
		refundRefs := proofRefsFor(t, refundSecrets)
		refundToken := strings.Repeat("c", 64)
		refundReceipt := settleReceipt(t, committee, auctionID, bidderNostr, 128, "op-sweep-ref", refundToken, 1_700, refundRefs, bidderKey.key)
		state.Bids[refundBidID] = Bid{ID: refundBidID, AuctionID: auctionID, Bidder: bidderNostr, Amount: 128, CashuTokenSHA256: refundToken, CommittedAt: 1_000}
		state.CashuLocks[refundToken] = refundReceipt
		state.Locks[refundBidID] = Lock{ID: refundBidID, AuctionID: auctionID, BidID: refundBidID, Bidder: bidderNostr,
			Amount: 128, Status: "refundable", RefundAuthorization: signRefundAuthorization(t, bidderKey.key, auctionID, refundRefs)}
	}

	return outcomeSweepFixture{
		state: state, seed: seed, committee: committee, auctionID: auctionID,
		settleBidID: settleBidID, refundBidID: refundBidID,
		secrets: secrets, amounts: amounts, refSecrets: secrets,
		sellerKey: sellerKey, bidderKey: bidderKey,
	}
}

func proofRefsFor(t *testing.T, secrets []string) []string {
	t.Helper()
	refs := make([]string, 0, len(secrets))
	for _, secret := range secrets {
		reference, err := demoMintProofY(secret)
		if err != nil {
			t.Fatal(err)
		}
		refs = append(refs, reference)
	}
	return refs
}

// outcomeSweepServer builds a coordinator wired to the fixture: a mutable
// committed-state snapshot, a fake swap mint, a durable payout store in a temp
// dir, and a poster that records the KindOutcome the sweeper would submit.
func outcomeSweepServer(t *testing.T, fixture outcomeSweepFixture, current *State, posted *[]SignedEvent, dir string) *APIServer {
	t.Helper()
	return &APIServer{
		manifest: NetworkManifest{
			ChainID: "legacy", Mode: "remote", ApplicationAuthority: ApplicationAuthorityLegacy,
			CashuMintURL: fixture.mint.server.URL, Policy: DefaultPolicy(),
		},
		legacyInterim:          true,
		demoCommitteeKey:       fixture.committee,
		demoCommitteePublicKey: hex.EncodeToString(fixture.committee.PubKey().SerializeCompressed()),
		demoMintChecker:        &fakeMint{},
		demoMintKeyset:         NewMintKeySetFetcher(fixture.mint.server.URL, 2*time.Second),
		demoStateSnapshot:      func(context.Context) (State, error) { return *current, nil },
		demoSettlements:        settlementStore{dir: dir},
		demoOutcomePoster: func(_ context.Context, event SignedEvent) error {
			*posted = append(*posted, event)
			return nil
		},
	}
}

func TestDemoOutcomeSweeperSettlesClosedAuction(t *testing.T) {
	t.Parallel()
	fixture := newOutcomeSweepFixture(t, true, false)
	fixture.mint = newFakeSwapMint(t, fixture.amounts)
	current := fixture.state
	var posted []SignedEvent
	server := outcomeSweepServer(t, fixture, &current, &posted, t.TempDir())
	server.demoOutcomeProofs.put(fixture.settleBidID, refundProofs(t, fixture.secrets, fixture.amounts, fixture.mint.keysetID))
	sweeper := newDemoOutcomeSweeper(server, time.Now)

	if err := sweeper.Step(context.Background()); err != nil {
		t.Fatalf("sweep step: %v", err)
	}
	if fixture.mint.swaps != 1 {
		t.Fatalf("mint saw %d swaps, want 1", fixture.mint.swaps)
	}
	if len(posted) != 1 {
		t.Fatalf("posted %d outcome records, want 1", len(posted))
	}
	event := posted[0]
	if event.Kind != KindOutcome {
		t.Fatalf("posted kind = %d, want KindOutcome (%d)", event.Kind, KindOutcome)
	}
	var content outcomeContent
	if err := json.Unmarshal([]byte(event.Content), &content); err != nil {
		t.Fatal(err)
	}
	if content.Schema != "PlebeianAuctionsPOCOutcomeV1" || content.Outcome != "settle" ||
		content.BidID != fixture.settleBidID || content.AuctionID != fixture.auctionID {
		t.Fatalf("posted content = %+v", content)
	}
	if content.PayoutTokenSHA256 == "" {
		t.Fatal("posted outcome carries no payout digest")
	}
	// The coordinator's own key must be the authority the record is posted by,
	// and consensus must accept the record transition.
	if _, err := VerifyNostrEvent(event); err != nil {
		t.Fatalf("posted outcome is not a valid Nostr event: %v", err)
	}
	paid, err := ApplyTransaction(fixture.state, Transaction{Version: TxVersion, Type: "event", Event: &event}, event.CreatedAt, DefaultPolicy(), fixture.seed)
	if err != nil {
		t.Fatalf("consensus refused the sweeper's outcome record: %v", err)
	}
	if lock := paid.Locks[fixture.settleBidID]; lock.Status != "paid" || lock.CashuPayoutTokenSHA256 != content.PayoutTokenSHA256 {
		t.Fatalf("paid lock = %+v", lock)
	}
	// The payout is parked durably and locked to the SELLER's wallet key.
	stored, ok := server.demoSettlements.get(fixture.auctionID)
	if !ok || len(stored) != len(fixture.amounts) {
		t.Fatalf("parked payout = %d proofs (present %v), want %d", len(stored), ok, len(fixture.amounts))
	}
	for _, proof := range stored {
		if recipient := p2pkRecipient(t, proof.Secret); recipient != fixture.sellerKey.publicKey {
			t.Fatalf("payout is locked to %s, want the seller wallet key", recipient)
		}
	}
}

func TestDemoOutcomeSweeperRefundsDisplacedLock(t *testing.T) {
	t.Parallel()
	fixture := newOutcomeSweepFixture(t, false, true)
	fixture.mint = newFakeSwapMint(t, fixture.amounts)
	current := fixture.state
	var posted []SignedEvent
	server := outcomeSweepServer(t, fixture, &current, &posted, t.TempDir())
	server.demoOutcomeProofs.put(fixture.refundBidID, refundProofs(t, []string{"sweep-refund-one", "sweep-refund-two"}, fixture.amounts, fixture.mint.keysetID))
	sweeper := newDemoOutcomeSweeper(server, time.Now)

	if err := sweeper.Step(context.Background()); err != nil {
		t.Fatalf("sweep step: %v", err)
	}
	if fixture.mint.swaps != 1 || len(posted) != 1 {
		t.Fatalf("swaps=%d posted=%d, want 1 and 1", fixture.mint.swaps, len(posted))
	}
	var content outcomeContent
	if err := json.Unmarshal([]byte(posted[0].Content), &content); err != nil {
		t.Fatal(err)
	}
	if content.Outcome != "refund" || content.BidID != fixture.refundBidID {
		t.Fatalf("posted content = %+v", content)
	}
	refunded, err := ApplyTransaction(fixture.state, Transaction{Version: TxVersion, Type: "event", Event: &posted[0]}, posted[0].CreatedAt, DefaultPolicy(), fixture.seed)
	if err != nil {
		t.Fatalf("consensus refused the refund outcome: %v", err)
	}
	if lock := refunded.Locks[fixture.refundBidID]; lock.Status != "refunded" {
		t.Fatalf("refunded lock status = %q, want refunded", lock.Status)
	}
	// The displaced bidder's payout is parked under the bid id and locked to
	// their own wallet key.
	stored, ok := server.demoSettlements.get(fixture.refundBidID)
	if !ok || len(stored) != len(fixture.amounts) {
		t.Fatalf("parked refund = %d proofs (present %v)", len(stored), ok)
	}
	for _, proof := range stored {
		if recipient := p2pkRecipient(t, proof.Secret); recipient != fixture.bidderKey.publicKey {
			t.Fatalf("refund is locked to %s, want the bidder wallet key", recipient)
		}
	}
}

func TestDemoOutcomeSweeperDoesNothingWithoutAuthorization(t *testing.T) {
	t.Parallel()
	fixture := newOutcomeSweepFixture(t, false, false)
	fixture.mint = newFakeSwapMint(t, fixture.amounts)
	current := fixture.state
	var posted []SignedEvent
	server := outcomeSweepServer(t, fixture, &current, &posted, t.TempDir())
	server.demoOutcomeProofs.put(fixture.settleBidID, refundProofs(t, fixture.secrets, fixture.amounts, fixture.mint.keysetID))
	sweeper := newDemoOutcomeSweeper(server, time.Now)

	if err := sweeper.Step(context.Background()); err != nil {
		t.Fatalf("sweep step: %v", err)
	}
	if fixture.mint.swaps != 0 || len(posted) != 0 {
		t.Fatalf("sweeper acted on a lock with no authorization: swaps=%d posted=%d", fixture.mint.swaps, len(posted))
	}
}

// TestDemoOutcomeSweeperDoesNotDoubleActAcrossTicks proves idempotence comes
// from consensus: after the first tick's outcome record commits, the lock is
// no longer in a terminal-pending state, so a second tick does nothing.
func TestDemoOutcomeSweeperDoesNotDoubleActAcrossTicks(t *testing.T) {
	t.Parallel()
	fixture := newOutcomeSweepFixture(t, true, false)
	fixture.mint = newFakeSwapMint(t, fixture.amounts)
	current := fixture.state
	var posted []SignedEvent
	server := outcomeSweepServer(t, fixture, &current, &posted, t.TempDir())
	server.demoOutcomeProofs.put(fixture.settleBidID, refundProofs(t, fixture.secrets, fixture.amounts, fixture.mint.keysetID))
	sweeper := newDemoOutcomeSweeper(server, time.Now)

	if err := sweeper.Step(context.Background()); err != nil {
		t.Fatalf("first step: %v", err)
	}
	if len(posted) != 1 || fixture.mint.swaps != 1 {
		t.Fatalf("first tick: swaps=%d posted=%d", fixture.mint.swaps, len(posted))
	}
	// Simulate the block committing the first outcome.
	committed, err := ApplyTransaction(fixture.state, Transaction{Version: TxVersion, Type: "event", Event: &posted[0]}, posted[0].CreatedAt, DefaultPolicy(), fixture.seed)
	if err != nil {
		t.Fatalf("commit first outcome: %v", err)
	}
	current = committed

	if err := sweeper.Step(context.Background()); err != nil {
		t.Fatalf("second step: %v", err)
	}
	if fixture.mint.swaps != 1 || len(posted) != 1 {
		t.Fatalf("second tick re-acted: swaps=%d posted=%d, want 1 and 1", fixture.mint.swaps, len(posted))
	}
}

// TestDemoOutcomeSweeperQuarantinesMismatchedAuthorization proves the sweeper
// never acts on a lock whose stored authorization does not match the outcome:
// a foreign-key settle signature is a deterministic refusal, not a retry.
func TestDemoOutcomeSweeperQuarantinesMismatchedAuthorization(t *testing.T) {
	t.Parallel()
	fixture := newOutcomeSweepFixture(t, true, false)
	fixture.mint = newFakeSwapMint(t, fixture.amounts)
	stripped := fixture.state
	lock := stripped.Locks[fixture.settleBidID]
	lock.SettleAuthorization = signSettleAuthorization(t, testPrivateKey(t), fixture.auctionID, proofRefsFor(t, fixture.secrets))
	stripped.Locks[fixture.settleBidID] = lock
	current := stripped
	var posted []SignedEvent
	server := outcomeSweepServer(t, fixture, &current, &posted, t.TempDir())
	server.demoOutcomeProofs.put(fixture.settleBidID, refundProofs(t, fixture.secrets, fixture.amounts, fixture.mint.keysetID))
	sweeper := newDemoOutcomeSweeper(server, time.Now)

	err := sweeper.Step(context.Background())
	if err == nil || !strings.Contains(err.Error(), "PERMANENT_REJECTION_QUARANTINED") {
		t.Fatalf("mismatched authorization error = %v, want a quarantine", err)
	}
	if fixture.mint.swaps != 0 || len(posted) != 0 {
		t.Fatalf("sweeper acted on a mismatched authorization: swaps=%d posted=%d", fixture.mint.swaps, len(posted))
	}
	if !sweeper.quarantined[fixture.settleBidID+":settle"] {
		t.Fatal("the mismatched target was not quarantined")
	}
}

// TestDemoOutcomeSweeperReusesParkedPayoutOnRetry covers the honest failure
// window: the swap succeeded and the payout is parked durably, but the outcome
// record did not commit. A retry -- even a fresh process with no deposited
// proofs left in memory -- must post the record without swapping again.
func TestDemoOutcomeSweeperReusesParkedPayoutOnRetry(t *testing.T) {
	t.Parallel()
	fixture := newOutcomeSweepFixture(t, true, false)
	fixture.mint = newFakeSwapMint(t, fixture.amounts)
	current := fixture.state
	var posted []SignedEvent
	server := outcomeSweepServer(t, fixture, &current, &posted, t.TempDir())
	server.demoOutcomeProofs.put(fixture.settleBidID, refundProofs(t, fixture.secrets, fixture.amounts, fixture.mint.keysetID))
	failFirst := true
	server.demoOutcomePoster = func(_ context.Context, event SignedEvent) error {
		if failFirst {
			failFirst = false
			return errors.New("broadcast lost")
		}
		posted = append(posted, event)
		return nil
	}
	now := time.Now()
	sweeper := newDemoOutcomeSweeper(server, func() time.Time { return now })

	if err := sweeper.Step(context.Background()); err == nil {
		t.Fatal("first step reported success despite a lost broadcast")
	}
	if fixture.mint.swaps != 1 {
		t.Fatalf("first attempt swapped %d times, want 1", fixture.mint.swaps)
	}
	if _, ok := server.demoSettlements.get(fixture.auctionID); !ok {
		t.Fatal("the produced payout was not parked")
	}
	// Simulate a restart: the in-memory deposit is gone, only the durable payout
	// remains. The retry must reuse it rather than swap again.
	server.demoOutcomeProofs.discard(fixture.settleBidID)
	now = now.Add(10 * time.Minute)
	if err := sweeper.Step(context.Background()); err != nil {
		t.Fatalf("retry step: %v", err)
	}
	if fixture.mint.swaps != 1 {
		t.Fatalf("retry swapped again: %d swaps, want 1", fixture.mint.swaps)
	}
	if len(posted) != 1 {
		t.Fatalf("retry posted %d records, want 1", len(posted))
	}
	var content outcomeContent
	if err := json.Unmarshal([]byte(posted[0].Content), &content); err != nil {
		t.Fatal(err)
	}
	if content.Outcome != "settle" || content.PayoutTokenSHA256 == "" {
		t.Fatalf("retry content = %+v", content)
	}
}

func TestSettlementStoreSurvivesReload(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	proofs := []demoMintSpentProof{
		{Amount: 64, KeysetID: "00e8839167216bc1", Secret: "parked-secret-one", C: hex.EncodeToString(testPrivateKey(t).PubKey().SerializeCompressed())},
		{Amount: 64, KeysetID: "00e8839167216bc1", Secret: "parked-secret-two", C: hex.EncodeToString(testPrivateKey(t).PubKey().SerializeCompressed())},
	}
	first := settlementStore{dir: dir}
	if err := first.put("reload-auction", proofs); err != nil {
		t.Fatalf("put: %v", err)
	}
	info, err := os.Stat(first.path("reload-auction"))
	if err != nil {
		t.Fatalf("payout file missing: %v", err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("payout file mode = %o, want 0600", info.Mode().Perm())
	}
	// A fresh process (new store) must read the payout back from disk.
	second := settlementStore{dir: dir}
	if err := second.reload(); err != nil {
		t.Fatalf("reload: %v", err)
	}
	recovered, ok := second.get("reload-auction")
	if !ok {
		t.Fatal("reloaded store did not serve the parked payout")
	}
	if len(recovered) != len(proofs) {
		t.Fatalf("recovered %d proofs, want %d", len(recovered), len(proofs))
	}
	for index := range proofs {
		if recovered[index].Secret != proofs[index].Secret || recovered[index].C != proofs[index].C {
			t.Fatalf("recovered proof %d differs: %+v", index, recovered[index])
		}
	}
	// A store with no directory is memory-only and still works.
	memoryOnly := settlementStore{}
	if err := memoryOnly.put("mem-auction", proofs); err != nil {
		t.Fatalf("memory-only put: %v", err)
	}
	if _, ok := memoryOnly.get("mem-auction"); !ok {
		t.Fatal("memory-only store lost its payout")
	}
}

func TestDemoOutcomeDepositStoresProofs(t *testing.T) {
	t.Parallel()
	fixture := newOutcomeSweepFixture(t, true, false)
	fixture.mint = newFakeSwapMint(t, fixture.amounts)
	current := fixture.state
	var posted []SignedEvent
	server := outcomeSweepServer(t, fixture, &current, &posted, "")
	proofs := refundProofs(t, fixture.secrets, fixture.amounts, fixture.mint.keysetID)
	raw, err := json.Marshal(demoOutcomeDepositBody{BidID: fixture.settleBidID, Proofs: proofs})
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/api/demo/outcome-deposit", strings.NewReader(string(raw)))
	recorder := httptest.NewRecorder()
	server.demoOutcomeDeposit(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("deposit status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	if stored, ok := server.demoOutcomeProofs.get(fixture.settleBidID); !ok || len(stored) != len(proofs) {
		t.Fatalf("deposit was not stored: present=%v count=%d", ok, len(stored))
	}
}
