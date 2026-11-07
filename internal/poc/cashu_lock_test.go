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
	response := checkTx(t, app, event)
	if response.Code == abci.CodeTypeOK || !strings.Contains(response.Log, "could not be verified at the mint") {
		t.Fatalf("unreachable mint response = %+v, want a fail-closed refusal", response)
	}

	// A mint that answers for only some references is not a pass either.
	app.SetMintChecker(&partialMint{})
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
// spent", so a real mint (Nutshell 0.19.2 among them) answers UNSPENT for a
// point it never issued. That makes NUT-07 useless as proof of issuance, and an
// issuance canary built on it can never pass against a real mint. The value
// proof is DLEQ against the published keyset, which the coordinator verifies
// before signing. This test pins the consequence: admission asks only the
// spend-state question, so a genuine mint-backed bid is admitted even though the
// mint is open-world.
func TestOpenWorldMintAdmitsGenuineMintBackedBid(t *testing.T) {
	t.Parallel()
	state, seed, committee := cashuLockFixture(t)
	app := applicationFor(t, state, seed, committee)
	bidder := testPrivateKey(t)
	refs := testProofRefs(t, testPrivateKey(t))
	receipt := testCashuLockReceipt(t, committee, "mint-backed", actorForKey(bidder), 120,
		"op-open-world", strings.Repeat("a", 64), 1_700, refs)
	event := testEvent(t, bidder, 1_001, KindBid, bidContent{AuctionID: "mint-backed", Amount: 120, CashuLock: &receipt})

	// fakeMint answers UNSPENT for every reference, including ones it has never
	// seen: exactly the open-world behaviour that used to refuse every bid.
	app.SetMintChecker(&fakeMint{})
	response := checkTx(t, app, event)
	if response.Code != abci.CodeTypeOK {
		t.Fatalf("a genuine mint-backed bid was refused: %s", response.Log)
	}
}

// VerifyCashuLockProofsAtMint answers one question only: is each proof still
// unspent? It must not pretend to prove issuance, and it must still refuse
// SPENT/PENDING and fail closed on anything it cannot answer.
func TestVerifyCashuLockProofsAtMintChecksOnlySpendState(t *testing.T) {
	t.Parallel()
	refs := testProofRefs(t, testPrivateKey(t))
	receipt := CashuLockReceipt{ProofStateRefs: refs}

	// Open-world UNSPENT is a pass: value is DLEQ's job, not NUT-07's.
	if err := VerifyCashuLockProofsAtMint(&fakeMint{}, receipt); err != nil {
		t.Fatalf("unspent proofs were refused: %v", err)
	}

	// SPENT and PENDING stay refusals.
	for _, state := range []MintProofState{MintProofSpent, MintProofPending} {
		checker := &fakeMint{states: map[string]MintProofState{refs[0]: state}}
		if err := VerifyCashuLockProofsAtMint(checker, receipt); err == nil {
			t.Fatalf("%s proof was accepted", state)
		}
	}

	// Fail closed: unreachable mint, partial answer, missing checker.
	if err := VerifyCashuLockProofsAtMint(&fakeMint{err: errors.New("mint down")}, receipt); err == nil {
		t.Fatal("an unreachable mint was treated as a pass")
	}
	if err := VerifyCashuLockProofsAtMint(partialMint{}, receipt); err == nil {
		t.Fatal("a partial mint answer was treated as a pass")
	}
	if err := VerifyCashuLockProofsAtMint(nil, receipt); err == nil {
		t.Fatal("a missing mint checker was treated as a pass")
	}
}
