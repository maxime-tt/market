package poc

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/btcsuite/btcd/btcec/v2"
	abci "github.com/cometbft/cometbft/abci/types"
)

// fakeSwapMint is a NUT-01/NUT-03 mint that signs outputs with real keys, so
// the coordinator's unblinding can be checked without a live mint. It does not
// verify input witnesses: the point of these tests is the coordinator's own
// verification order, not the mint's.
type fakeSwapMint struct {
	server   *httptest.Server
	keysetID string
	keys     map[int64]*btcec.PrivateKey

	mu     sync.Mutex
	swaps  int
	inputs []mintSwapInput
}

func newFakeSwapMint(t *testing.T, amounts []int64) *fakeSwapMint {
	t.Helper()
	mint := &fakeSwapMint{keysetID: "00e8839167216bc1", keys: map[int64]*btcec.PrivateKey{}}
	for _, amount := range amounts {
		if _, exists := mint.keys[amount]; exists {
			continue
		}
		mint.keys[amount] = testPrivateKey(t)
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/keys", func(response http.ResponseWriter, _ *http.Request) {
		keys := map[string]string{}
		for amount, key := range mint.keys {
			keys[big.NewInt(amount).String()] = hex.EncodeToString(key.PubKey().SerializeCompressed())
		}
		writeJSON(response, http.StatusOK, map[string]any{
			"keysets": []map[string]any{{"id": mint.keysetID, "unit": "sat", "keys": keys}},
		})
	})
	mux.HandleFunc("POST /v1/swap", func(response http.ResponseWriter, request *http.Request) {
		var body mintSwapRequest
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			writeError(response, http.StatusBadRequest, err)
			return
		}
		mint.mu.Lock()
		mint.swaps++
		mint.inputs = append([]mintSwapInput(nil), body.Inputs...)
		mint.mu.Unlock()
		signatures := make([]map[string]any, 0, len(body.Outputs))
		for _, output := range body.Outputs {
			key, ok := mint.keys[output.Amount]
			if !ok {
				writeError(response, http.StatusBadRequest, errUnknownAmount)
				return
			}
			blinded, err := btcec.ParsePubKey(mustHex(output.B_))
			if err != nil {
				writeError(response, http.StatusBadRequest, err)
				return
			}
			curve := btcec.S256()
			keyBytes := key.Key.Bytes()
			cx, cy := curve.ScalarMult(blinded.X(), blinded.Y(), keyBytes[:])
			signatures = append(signatures, map[string]any{
				"id": output.ID, "amount": output.Amount,
				"C_": hex.EncodeToString(compressedPoint(cx, cy)),
			})
		}
		writeJSON(response, http.StatusOK, map[string]any{"signatures": signatures})
	})
	mint.server = httptest.NewServer(mux)
	t.Cleanup(mint.server.Close)
	return mint
}

var errUnknownAmount = &staticError{"fake mint has no key for that amount"}

type staticError struct{ text string }

func (e *staticError) Error() string { return e.text }

// refundableCashuFixture commits a mint-backed bid A and then a higher bid B
// that displaces it, leaving A's lock refundable. It returns the committed
// state, the seed, A's signing key, A's bid id, and the secrets/amounts that
// back A's receipt.
func refundableCashuFixture(t *testing.T) (State, []byte, *btcec.PrivateKey, *btcec.PrivateKey, string, []string, []int64) {
	t.Helper()
	state, seed, committee := cashuLockFixture(t)
	bidderA := testPrivateKey(t)
	secrets := []string{"refund-secret-one", "refund-secret-two"}
	amounts := []int64{64, 64}
	refs := make([]string, 0, len(secrets))
	for _, secret := range secrets {
		reference, err := demoMintProofY(secret)
		if err != nil {
			t.Fatal(err)
		}
		refs = append(refs, reference)
	}
	sort.Strings(refs)
	receiptA := testCashuLockReceipt(t, committee, "mint-backed", actorForKey(bidderA), 128,
		"op-refund-a", strings.Repeat("a", 64), 1_700, refs)
	eventA := testEvent(t, bidderA, 1_001, KindBid, bidContent{AuctionID: "mint-backed", Amount: 128, CashuLock: &receiptA})
	state, err := ApplyTransaction(state, Transaction{Version: TxVersion, Type: "event", Event: &eventA}, 1_001, DefaultPolicy(), seed)
	if err != nil {
		t.Fatalf("bid A: %v", err)
	}

	bidderB := testPrivateKey(t)
	refsB := testProofRefs(t, testPrivateKey(t))
	receiptB := testCashuLockReceipt(t, committee, "mint-backed", actorForKey(bidderB), 300,
		"op-refund-b", strings.Repeat("b", 64), 1_800, refsB)
	eventB := testEvent(t, bidderB, 1_002, KindBid, bidContent{AuctionID: "mint-backed", Amount: 300, CashuLock: &receiptB})
	state, err = ApplyTransaction(state, Transaction{Version: TxVersion, Type: "event", Event: &eventB}, 1_002, DefaultPolicy(), seed)
	if err != nil {
		t.Fatalf("bid B: %v", err)
	}
	if state.Locks[eventA.ID].Status != "refundable" {
		t.Fatalf("bid A lock status = %q, want refundable", state.Locks[eventA.ID].Status)
	}
	return state, seed, committee, bidderA, eventA.ID, secrets, amounts
}

func refundServer(t *testing.T, state State, committee *btcec.PrivateKey, mint *fakeSwapMint) *APIServer {
	t.Helper()
	return &APIServer{
		manifest: NetworkManifest{
			ChainID: "legacy", Mode: "remote", ApplicationAuthority: ApplicationAuthorityLegacy,
			CashuMintURL: mint.server.URL, Policy: DefaultPolicy(),
		},
		legacyInterim:          true,
		demoCommitteeKey:       committee,
		demoCommitteePublicKey: hex.EncodeToString(committee.PubKey().SerializeCompressed()),
		demoMintChecker:        &fakeMint{},
		demoMintKeyset:         NewMintKeySetFetcher(mint.server.URL, 2*time.Second),
		demoStateSnapshot:      func(context.Context) (State, error) { return state, nil },
	}
}

func refundProofs(t *testing.T, secrets []string, amounts []int64, keysetID string) []demoMintSpendProof {
	t.Helper()
	proofs := make([]demoMintSpendProof, 0, len(secrets))
	for index, secret := range secrets {
		proofs = append(proofs, demoMintSpendProof{
			Amount: amounts[index], KeysetID: keysetID, Secret: secret,
			C: hex.EncodeToString(testPrivateKey(t).PubKey().SerializeCompressed()),
		})
	}
	return proofs
}

func refundEvent(t *testing.T, key *btcec.PrivateKey, bidID string) SignedEvent {
	t.Helper()
	return testEvent(t, key, 1_003, KindRefund, refundContent{BidID: bidID})
}

func postRefund(t *testing.T, server *APIServer, body demoMintRefundBody) *httptest.ResponseRecorder {
	t.Helper()
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/api/demo/mint-refund", bytes.NewReader(raw))
	recorder := httptest.NewRecorder()
	server.demoMintRefund(recorder, request)
	return recorder
}

// TestCashuHashToCurveMatchesNUT00 pins the Go implementation to the values
// the Python cashu library produces. If this drifts, every real proof's Y
// reference stops matching the committed receipt and the endpoint refuses
// genuine refunds.
func TestCashuHashToCurveMatchesNUT00(t *testing.T) {
	t.Parallel()
	cases := map[string]string{
		"test-secret":       "023016ef4b4e5adccbb84990594ceb5dca9df363fe4d7325828f8bf87d0f0e6b8d",
		"refund-secret-one": "0272e166c8c50bc2e586a77df367a44e0edbd69917e6d3cb852acc978b4d69f1e5",
	}
	for secret, want := range cases {
		got, err := demoMintProofY(secret)
		if err != nil {
			t.Fatalf("%q: %v", secret, err)
		}
		if got != want {
			t.Fatalf("%q: Y = %s, want %s", secret, got, want)
		}
	}
}

func TestDemoMintRefundReturnsFreshProofs(t *testing.T) {
	t.Parallel()
	state, _, committee, bidder, bidID, secrets, amounts := refundableCashuFixture(t)
	mint := newFakeSwapMint(t, amounts)
	server := refundServer(t, state, committee, mint)
	notesBefore := len(state.Notes)

	recorder := postRefund(t, server, demoMintRefundBody{
		BidID: bidID, Proofs: refundProofs(t, secrets, amounts, mint.keysetID),
		Event: refundEvent(t, bidder, bidID),
	})
	if recorder.Code != http.StatusOK {
		t.Fatalf("refund status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	var response demoMintRefundResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if len(response.Proofs) != len(amounts) {
		t.Fatalf("returned %d proofs, want %d", len(response.Proofs), len(amounts))
	}
	var total int64
	for _, proof := range response.Proofs {
		if !validCompressedPublicKey(proof.C) || proof.Secret == "" || proof.KeysetID != mint.keysetID {
			t.Fatalf("returned proof is malformed: %+v", proof)
		}
		total += proof.Amount
	}
	if total != 128 {
		t.Fatalf("returned proofs total %d, want 128", total)
	}
	if mint.swaps != 1 {
		t.Fatalf("mint saw %d swaps, want 1", mint.swaps)
	}
	// The coordinator must not have mutated committed state or issued a legacy
	// note: the money moved at the mint, and the state mirror is untouched.
	if len(state.Notes) != notesBefore {
		t.Fatalf("refund issued %d notes, want 0", len(state.Notes)-notesBefore)
	}
	if state.Locks[bidID].Status != "refundable" {
		t.Fatalf("lock status changed to %q; the coordinator must not mutate committed state", state.Locks[bidID].Status)
	}
}

func TestDemoMintRefundRefusesWrongBidder(t *testing.T) {
	t.Parallel()
	state, _, committee, _, bidID, secrets, amounts := refundableCashuFixture(t)
	mint := newFakeSwapMint(t, amounts)
	server := refundServer(t, state, committee, mint)

	recorder := postRefund(t, server, demoMintRefundBody{
		BidID: bidID, Proofs: refundProofs(t, secrets, amounts, mint.keysetID),
		Event: refundEvent(t, testPrivateKey(t), bidID),
	})
	if recorder.Code != http.StatusForbidden || !strings.Contains(recorder.Body.String(), "not the lock's bidder") {
		t.Fatalf("wrong bidder response = %d %s, want 403 naming the bidder", recorder.Code, recorder.Body.String())
	}
	if mint.swaps != 0 {
		t.Fatal("a wrong-bidder refund reached the mint")
	}
}

func TestDemoMintRefundRefusesProofSetThatDoesNotMatchReceipt(t *testing.T) {
	t.Parallel()
	state, _, committee, bidder, bidID, _, amounts := refundableCashuFixture(t)
	mint := newFakeSwapMint(t, amounts)
	server := refundServer(t, state, committee, mint)

	// Same shape, different secrets: their Y points are not in the receipt.
	recorder := postRefund(t, server, demoMintRefundBody{
		BidID: bidID, Proofs: refundProofs(t, []string{"not-the-committed-secret-1", "not-the-committed-secret-2"}, amounts, mint.keysetID),
		Event: refundEvent(t, bidder, bidID),
	})
	if recorder.Code != http.StatusUnprocessableEntity || !strings.Contains(recorder.Body.String(), "do not match the committed receipt") {
		t.Fatalf("mismatched proof set response = %d %s", recorder.Code, recorder.Body.String())
	}
	if mint.swaps != 0 {
		t.Fatal("a mismatched proof set reached the mint")
	}
}

func TestDemoMintRefundRefusesLockThatIsNotRefundable(t *testing.T) {
	t.Parallel()
	state, _, committee, bidder, bidID, secrets, amounts := refundableCashuFixture(t)
	// Move the lock out of "refundable" while keeping the same bidder, so the
	// status check is the one that refuses.
	lock := state.Locks[bidID]
	lock.Status = "locked"
	state.Locks[bidID] = lock
	mint := newFakeSwapMint(t, amounts)
	server := refundServer(t, state, committee, mint)

	recorder := postRefund(t, server, demoMintRefundBody{
		BidID: bidID, Proofs: refundProofs(t, secrets, amounts, mint.keysetID),
		Event: refundEvent(t, bidder, bidID),
	})
	if recorder.Code != http.StatusUnprocessableEntity || !strings.Contains(recorder.Body.String(), "not refundable") {
		t.Fatalf("non-refundable lock response = %d %s", recorder.Code, recorder.Body.String())
	}
	if mint.swaps != 0 {
		t.Fatal("a non-refundable lock reached the mint")
	}
}

func TestDemoMintRefundRefusesMissingAndUnderfundedProofs(t *testing.T) {
	t.Parallel()
	state, _, committee, bidder, bidID, secrets, amounts := refundableCashuFixture(t)
	mint := newFakeSwapMint(t, amounts)
	server := refundServer(t, state, committee, mint)

	// Missing: one of the two committed proofs.
	recorder := postRefund(t, server, demoMintRefundBody{
		BidID: bidID, Proofs: refundProofs(t, secrets[:1], amounts[:1], mint.keysetID),
		Event: refundEvent(t, bidder, bidID),
	})
	if recorder.Code != http.StatusUnprocessableEntity || !strings.Contains(recorder.Body.String(), "do not match the committed receipt") {
		t.Fatalf("missing proof response = %d %s", recorder.Code, recorder.Body.String())
	}

	// Underfunded: the right Y set, but the claimed amounts do not cover the
	// lock. The mint would reject the amount mismatch; the coordinator must
	// refuse before it signs anything.
	underfunded := refundProofs(t, secrets, amounts, mint.keysetID)
	underfunded[0].Amount = 1
	recorder = postRefund(t, server, demoMintRefundBody{
		BidID: bidID, Proofs: underfunded, Event: refundEvent(t, bidder, bidID),
	})
	if recorder.Code != http.StatusUnprocessableEntity || !strings.Contains(recorder.Body.String(), "less than the locked") {
		t.Fatalf("underfunded proof response = %d %s", recorder.Code, recorder.Body.String())
	}
	if mint.swaps != 0 {
		t.Fatal("an underfunded proof set reached the mint")
	}
}

func TestCheckTxRefusesLegacyRefundOfMintBackedBid(t *testing.T) {
	t.Parallel()
	state, seed, committee, bidder, bidID, _, _ := refundableCashuFixture(t)
	app := applicationFor(t, state, seed, committee)

	event := testEvent(t, bidder, 1_003, KindRefund, refundContent{BidID: bidID})
	response := checkTx(t, app, event)
	if response.Code == abci.CodeTypeOK {
		t.Fatal("CheckTx admitted a legacy refund of a mint-backed bid")
	}
	for _, expected := range []string{"legacy refund refused", "mint-backed", "double-credit"} {
		if !strings.Contains(response.Log, expected) {
			t.Fatalf("refusal log %q does not name %q", response.Log, expected)
		}
	}
}
