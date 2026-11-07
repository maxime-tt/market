package poc

import (
	"context"
	"crypto/ed25519"
	"encoding/hex"
	"errors"
	"path/filepath"
	"strings"
	"testing"

	"github.com/btcsuite/btcd/btcec/v2"
	"github.com/btcsuite/btcd/btcec/v2/schnorr"
	abci "github.com/cometbft/cometbft/abci/types"
)

// fakeMint answers NUT-07 with a fixed map, or fails, so the admission-time
// check can be exercised without a real mint.
type fakeMint struct {
	states map[string]MintProofState
	err    error
	calls  int
}

// fakeIssuance is a mint that keeps per-proof records: it refuses to vouch for
// a canary point it cannot have issued. Tests that want the open-world behaviour
// use openWorldIssuance instead.
type fakeIssuance struct {
	known map[string]bool
	err   error
}

func (fake *fakeIssuance) IssuedProofs(refs []string) (map[string]bool, error) {
	if fake.err != nil {
		return nil, fake.err
	}
	answer := map[string]bool{}
	for _, ref := range refs {
		answer[ref] = fake.known == nil || fake.known[ref]
	}
	return answer, nil
}

// openWorldIssuance models a mint that answers UNSPENT for points it never
// issued, which is what Nutshell 0.19.2 does. It must refuse every bid.
type openWorldIssuance struct{}

func (openWorldIssuance) IssuedProofs([]string) (map[string]bool, error) {
	return nil, errors.New("this mint answers for proofs it has never seen, so it cannot confirm that any proof was issued")
}

func (fake *fakeMint) ProofStates(refs []string) (map[string]MintProofState, error) {
	fake.calls++
	if fake.err != nil {
		return nil, fake.err
	}
	answer := map[string]MintProofState{}
	for _, ref := range refs {
		if state, ok := fake.states[ref]; ok {
			answer[ref] = state
			continue
		}
		answer[ref] = MintProofUnspent
	}
	return answer, nil
}

func testCashuLockReceipt(t *testing.T, committee *btcec.PrivateKey, auctionID, bidder string, amount int64,
	operationID, tokenSHA256 string, locktime int64, refs []string) CashuLockReceipt {
	t.Helper()
	refund := testPrivateKey(t)
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

// cashuLockFixture builds a committed state holding one mint-backed auction.
func cashuLockFixture(t *testing.T) (State, []byte, *btcec.PrivateKey) {
	t.Helper()
	seed := make([]byte, ed25519.SeedSize)
	seed[0] = 41
	committee := testPrivateKey(t)
	state, err := NewState("cashu-lock-fixture", ed25519.NewKeyFromSeed(seed).Public().(ed25519.PublicKey),
		hex.EncodeToString(committee.PubKey().SerializeCompressed()))
	if err != nil {
		t.Fatal(err)
	}
	seller := testPrivateKey(t)
	create := testEvent(t, seller, 1_000, KindCreate, createContent{
		AuctionID: "mint-backed", Title: "Mint-backed item", Duration: 600,
		StartingBid: 100, FundingMode: FundingModeCashuLock,
	})
	state, err = ApplyTransaction(state, Transaction{Version: TxVersion, Type: "event", Event: &create}, 1_000, DefaultPolicy(), seed)
	if err != nil {
		t.Fatal(err)
	}
	return state, seed, committee
}

func TestCashuLockAuctionAcceptsOnlyMintBackedFunding(t *testing.T) {
	t.Parallel()
	state, seed, committee := cashuLockFixture(t)
	bidder := testPrivateKey(t)
	policy := DefaultPolicy()

	// A custodial reservation must not be accepted by a mint-backed auction:
	// that would silently fall back to attested funding.
	reservation := testReservationReceipt(t, committee, "mint-backed", actorForKey(bidder), 120, "res-1", "", 1_600)
	reservationEvent := testEvent(t, bidder, 1_001, KindBid, bidContent{AuctionID: "mint-backed", Amount: 120, Reservation: &reservation})
	if _, err := ApplyTransaction(state, Transaction{Version: TxVersion, Type: "event", Event: &reservationEvent}, 1_001, policy, seed); err == nil {
		t.Fatal("mint-backed auction accepted a custodial reservation")
	}

	// A mint-backed auction with no funding path at all is refused too.
	emptyEvent := testEvent(t, bidder, 1_001, KindBid, bidContent{AuctionID: "mint-backed", Amount: 120})
	if _, err := ApplyTransaction(state, Transaction{Version: TxVersion, Type: "event", Event: &emptyEvent}, 1_001, policy, seed); err == nil {
		t.Fatal("mint-backed auction accepted an unfunded bid")
	}
}

func TestCashuLockProofRefsMustBeCanonical(t *testing.T) {
	t.Parallel()
	state, seed, committee := cashuLockFixture(t)
	bidder := testPrivateKey(t)
	policy := DefaultPolicy()
	refs := testProofRefs(t, testPrivateKey(t), testPrivateKey(t))

	cases := []struct {
		name string
		refs []string
	}{
		{"empty", nil},
		{"unsorted", []string{refs[1], refs[0]}},
		{"duplicate", []string{refs[0], refs[0]}},
		{"not a point", []string{strings.Repeat("f", 66)}},
		{"truncated", []string{refs[0][:64]}},
	}
	for _, testCase := range cases {
		receipt := testCashuLockReceipt(t, committee, "mint-backed", actorForKey(bidder), 120, "op-"+testCase.name,
			strings.Repeat("a", 64), 1_700, testCase.refs)
		event := testEvent(t, bidder, 1_001, KindBid, bidContent{AuctionID: "mint-backed", Amount: 120, CashuLock: &receipt})
		if _, err := ApplyTransaction(state, Transaction{Version: TxVersion, Type: "event", Event: &event}, 1_001, policy, seed); err == nil {
			t.Fatalf("accepted %s proof references", testCase.name)
		}
	}
}

func TestCashuLockProofCannotFundTwoBids(t *testing.T) {
	t.Parallel()
	state, seed, committee := cashuLockFixture(t)
	policy := DefaultPolicy()
	refs := testProofRefs(t, testPrivateKey(t), testPrivateKey(t))

	first := testPrivateKey(t)
	firstReceipt := testCashuLockReceipt(t, committee, "mint-backed", actorForKey(first), 120, "op-first", strings.Repeat("a", 64), 1_700, refs)
	firstEvent := testEvent(t, first, 1_001, KindBid, bidContent{AuctionID: "mint-backed", Amount: 120, CashuLock: &firstReceipt})
	committed, err := ApplyTransaction(state, Transaction{Version: TxVersion, Type: "event", Event: &firstEvent}, 1_001, policy, seed)
	if err != nil {
		t.Fatalf("first mint-backed bid: %v", err)
	}

	// A different bidder, a different token digest, the same underlying proofs.
	second := testPrivateKey(t)
	secondReceipt := testCashuLockReceipt(t, committee, "mint-backed", actorForKey(second), 300, "op-second", strings.Repeat("b", 64), 1_800, refs)
	secondEvent := testEvent(t, second, 1_002, KindBid, bidContent{AuctionID: "mint-backed", Amount: 300, CashuLock: &secondReceipt})
	_, err = ApplyTransaction(committed, Transaction{Version: TxVersion, Type: "event", Event: &secondEvent}, 1_002, policy, seed)
	if err == nil || !strings.Contains(err.Error(), "already committed to another bid") {
		t.Fatalf("reused proofs error = %v, want a proof-reuse rejection", err)
	}

	// And the same bidder cannot re-bind them either.
	ownReceipt := testCashuLockReceipt(t, committee, "mint-backed", actorForKey(first), 500, "op-own", strings.Repeat("c", 64), 1_900, refs)
	ownEvent := testEvent(t, first, 1_003, KindBid, bidContent{AuctionID: "mint-backed", Amount: 500, CashuLock: &ownReceipt})
	if _, err := ApplyTransaction(committed, Transaction{Version: TxVersion, Type: "event", Event: &ownEvent}, 1_003, policy, seed); err == nil {
		t.Fatal("the same bidder re-used committed proofs")
	}
}

// applicationFor builds a live Application whose committed state already holds
// the mint-backed auction, so CheckTx can be driven end to end.
func applicationFor(t *testing.T, state State, seed []byte, committee *btcec.PrivateKey) *Application {
	t.Helper()
	statePath := filepath.Join(t.TempDir(), "state.json")
	if err := persistState(statePath, state); err != nil {
		t.Fatal(err)
	}
	app, err := NewApplication("cashu-lock-fixture", DefaultPolicy(), seed,
		hex.EncodeToString(committee.PubKey().SerializeCompressed()), statePath)
	if err != nil {
		t.Fatal(err)
	}
	return app
}

func checkTx(t *testing.T, app *Application, event SignedEvent) *abci.CheckTxResponse {
	t.Helper()
	raw, err := EncodeTransaction(Transaction{Version: TxVersion, Type: "event", Event: &event})
	if err != nil {
		t.Fatal(err)
	}
	response, err := app.CheckTx(context.Background(), &abci.CheckTxRequest{Tx: raw})
	if err != nil {
		t.Fatal(err)
	}
	return response
}

func TestCheckTxRefusesCashuLockWhenMintSaysSpent(t *testing.T) {
	t.Parallel()
	state, seed, committee := cashuLockFixture(t)
	app := applicationFor(t, state, seed, committee)
	bidder := testPrivateKey(t)
	refs := testProofRefs(t, testPrivateKey(t))
	receipt := testCashuLockReceipt(t, committee, "mint-backed", actorForKey(bidder), 120, "op-spent", strings.Repeat("a", 64), 1_700, refs)
	event := testEvent(t, bidder, 1_001, KindBid, bidContent{AuctionID: "mint-backed", Amount: 120, CashuLock: &receipt})

	// The mint confirms the proofs are unspent: admitted.
	app.SetMintChecker(&fakeMint{states: map[string]MintProofState{refs[0]: MintProofUnspent}})
	app.SetMintIssuanceChecker(&fakeIssuance{})
	if response := checkTx(t, app, event); response.Code != abci.CodeTypeOK {
		t.Fatalf("unspent proofs refused: %s", response.Log)
	}

	// The mint says the proof is already spent: refused, and the reason says so.
	app.SetMintChecker(&fakeMint{states: map[string]MintProofState{refs[0]: MintProofSpent}})
	response := checkTx(t, app, event)
	if response.Code == abci.CodeTypeOK || !strings.Contains(response.Log, "SPENT") {
		t.Fatalf("spent proof response = %+v, want a SPENT refusal", response)
	}

	// PENDING is a spend in flight, which is the same hazard.
	app.SetMintChecker(&fakeMint{states: map[string]MintProofState{refs[0]: MintProofPending}})
	if response := checkTx(t, app, event); response.Code == abci.CodeTypeOK {
		t.Fatal("pending proof was admitted")
	}
}

func TestCheckTxFailsClosedWhenTheMintCannotBeAsked(t *testing.T) {
	t.Parallel()
	state, seed, committee := cashuLockFixture(t)
	app := applicationFor(t, state, seed, committee)
	bidder := testPrivateKey(t)
	refs := testProofRefs(t, testPrivateKey(t))
	receipt := testCashuLockReceipt(t, committee, "mint-backed", actorForKey(bidder), 120, "op-unreachable", strings.Repeat("a", 64), 1_700, refs)
	event := testEvent(t, bidder, 1_001, KindBid, bidContent{AuctionID: "mint-backed", Amount: 120, CashuLock: &receipt})

	app.SetMintChecker(&fakeMint{err: errors.New("connection refused")})
	app.SetMintIssuanceChecker(&fakeIssuance{})
	response := checkTx(t, app, event)
	if response.Code == abci.CodeTypeOK || !strings.Contains(response.Log, "could not be verified at the mint") {
		t.Fatalf("unreachable mint response = %+v, want a fail-closed refusal", response)
	}

	// A mint that answers for only some references is not a pass either.
	app.SetMintChecker(&partialMint{})
	app.SetMintIssuanceChecker(&fakeIssuance{})
	if response := checkTx(t, app, event); response.Code == abci.CodeTypeOK {
		t.Fatal("a partial mint answer was treated as a pass")
	}
}

// partialMint answers with an empty state list, which must never be read as
// "everything is fine".
type partialMint struct{}

func (partialMint) ProofStates([]string) (map[string]MintProofState, error) {
	return map[string]MintProofState{}, nil
}

func TestNonMintBackedAuctionRejectsCashuLock(t *testing.T) {
	t.Parallel()
	seed := make([]byte, ed25519.SeedSize)
	seed[0] = 42
	committee := testPrivateKey(t)
	state, err := NewState("custodial-only", ed25519.NewKeyFromSeed(seed).Public().(ed25519.PublicKey),
		hex.EncodeToString(committee.PubKey().SerializeCompressed()))
	if err != nil {
		t.Fatal(err)
	}
	seller := testPrivateKey(t)
	create := testEvent(t, seller, 1_000, KindCreate, createContent{
		AuctionID: "custodial", Title: "Custodial item", Duration: 600, StartingBid: 100,
	})
	state, err = ApplyTransaction(state, Transaction{Version: TxVersion, Type: "event", Event: &create}, 1_000, DefaultPolicy(), seed)
	if err != nil {
		t.Fatal(err)
	}
	// A legacy auction has no custodial gate, so this exercises the new
	// cashu-lock gate specifically: before it existed, a legacy auction would
	// have accepted a mint-backed lock bid.
	markLegacyAuction(&state, "custodial")
	bidder := testPrivateKey(t)
	refs := testProofRefs(t, testPrivateKey(t))
	receipt := testCashuLockReceipt(t, committee, "custodial", actorForKey(bidder), 120, "op-x", strings.Repeat("a", 64), 1_700, refs)
	event := testEvent(t, bidder, 1_001, KindBid, bidContent{AuctionID: "custodial", Amount: 120, CashuLock: &receipt})
	_, err = ApplyTransaction(state, Transaction{Version: TxVersion, Type: "event", Event: &event}, 1_001, DefaultPolicy(), seed)
	if err == nil || !strings.Contains(err.Error(), "only a mint-backed auction") {
		t.Fatalf("cashu lock on a custodial auction error = %v", err)
	}
}

// NUT-07 defines UNSPENT as "the mint has no record of it being pending or
// spent", so an invented point is indistinguishable from a genuine one when the
// mint is open-world. Verified against Nutshell 0.19.2, which answers UNSPENT
// for arbitrary compressed points. This test pins the consequence: a
// reference-only receipt must be refused against such a mint, or the whole
// funding mode could be satisfied by naming points that hold no value.
func TestOpenWorldMintCannotVouchForIssuance(t *testing.T) {
	t.Parallel()
	refs := testProofRefs(t, testPrivateKey(t))

	openWorld := NewHTTPMintStateChecker("http://127.0.0.1:1", mintCheckTimeout)
	_ = openWorld // the points below are the subject, not an HTTP call

	if err := VerifyProofsIssuedByMint(openWorldIssuance{}, refs); err == nil {
		t.Fatal("an open-world mint was accepted as proof of issuance")
	}

	// A mint that keeps per-proof records is accepted.
	if err := VerifyProofsIssuedByMint(&fakeIssuance{}, refs); err != nil {
		t.Fatalf("a per-proof-record mint was refused: %v", err)
	}

	// A mint whose records do not contain the reference is refused.
	known := map[string]bool{}
	if err := VerifyProofsIssuedByMint(&fakeIssuance{known: known}, refs); err == nil {
		t.Fatal("a reference the mint has no record of was accepted")
	}

	// And an unanswerable question is a refusal, never a pass.
	if err := VerifyProofsIssuedByMint(&fakeIssuance{err: errors.New("mint down")}, refs); err == nil {
		t.Fatal("an unanswerable issuance question was treated as a pass")
	}
	if err := VerifyProofsIssuedByMint(nil, refs); err == nil {
		t.Fatal("a missing issuance checker was treated as a pass")
	}
}

func TestCheckTxRefusesBidAgainstOpenWorldMint(t *testing.T) {
	t.Parallel()
	state, seed, committee := cashuLockFixture(t)
	app := applicationFor(t, state, seed, committee)
	bidder := testPrivateKey(t)
	refs := testProofRefs(t, testPrivateKey(t))
	receipt := testCashuLockReceipt(t, committee, "mint-backed", actorForKey(bidder), 120,
		"op-open-world", strings.Repeat("a", 64), 1_700, refs)
	event := testEvent(t, bidder, 1_001, KindBid, bidContent{AuctionID: "mint-backed", Amount: 120, CashuLock: &receipt})

	// The mint claims the proofs are unspent -- but claims that for anything.
	app.SetMintChecker(&fakeMint{states: map[string]MintProofState{refs[0]: MintProofUnspent}})
	app.SetMintIssuanceChecker(openWorldIssuance{})
	response := checkTx(t, app, event)
	if response.Code == abci.CodeTypeOK {
		t.Fatal("a bid was admitted against a mint that cannot vouch for issuance")
	}
	if !strings.Contains(response.Log, "never seen") {
		t.Fatalf("refusal reason = %q, want the open-world explanation", response.Log)
	}
}
