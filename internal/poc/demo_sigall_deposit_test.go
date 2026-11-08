package poc

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/btcsuite/btcd/btcec/v2"
	"github.com/btcsuite/btcd/btcec/v2/schnorr"
)

// sigAllDepositFixture is committed state holding one open cashu_sigall_v1
// auction and a committed sigall lock for one bidder, plus the two signed
// templates the wallet would deposit for it.
type sigAllDepositFixture struct {
	state      State
	seed       []byte
	committee  *btcec.PrivateKey
	auctionID  string
	bidder     string
	bidderKey  *btcec.PrivateKey
	bidID      string
	wallet     walletClaim
	receipt    CashuLockReceipt
	inputs     []sigAllTemplateInput
	sellerKey  walletClaim
	templates  sigAllDepositTemplates
	depositRec sigAllDepositReceipt
}

func sigAllDepositFixtureState(t *testing.T) sigAllDepositFixture {
	t.Helper()
	fx := sigAllFixture(t)
	wallet := newWalletClaim(t)
	bidderKey := testPrivateKey(t)
	bidder := actorForKey(bidderKey)
	inputs, refs := sigAllInputs(t)
	receipt := sigAllLockReceipt(t, fx.committee, fx.auctionID, bidder, 128, refs, wallet)
	templates, depositRec := sigAllDeposit(t, fx.committee, fx.auctionID, bidder, wallet, receipt, inputs, fx.sellerKey.publicKey)

	state := fx.state
	bidID := "sigall-bid-1"
	state.Bids[bidID] = Bid{ID: bidID, AuctionID: fx.auctionID, Bidder: bidder, Amount: 128, CashuTokenSHA256: receipt.TokenSHA256, CommittedAt: 1_001}
	state.CashuLocks[receipt.TokenSHA256] = receipt
	state.Locks[bidID] = Lock{ID: bidID, AuctionID: fx.auctionID, BidID: bidID, Bidder: bidder, Amount: 128, Status: "locked"}
	return sigAllDepositFixture{
		state: state, seed: fx.seed, committee: fx.committee, auctionID: fx.auctionID,
		bidder: bidder, bidderKey: bidderKey, bidID: bidID, wallet: wallet, receipt: receipt,
		inputs: inputs, sellerKey: fx.sellerKey, templates: templates, depositRec: depositRec,
	}
}

func sigAllDepositServer(t *testing.T, state State, committee *btcec.PrivateKey, dir string) *APIServer {
	t.Helper()
	return &APIServer{
		manifest: NetworkManifest{
			ChainID: "legacy", Mode: "remote", ApplicationAuthority: ApplicationAuthorityLegacy,
			CashuMintURL: CashuMintURL, Policy: DefaultPolicy(),
		},
		legacyInterim:          true,
		demoCommitteeKey:       committee,
		demoCommitteePublicKey: hex.EncodeToString(committee.PubKey().SerializeCompressed()),
		demoStateSnapshot:      func(context.Context) (State, error) { return state, nil },
		demoSigAllDeposits:     sigAllDepositStore{dir: dir},
	}
}

func postSigAllDeposit(t *testing.T, server *APIServer, body sigAllDepositRequest) *httptest.ResponseRecorder {
	t.Helper()
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/api/demo/sigall-deposit", bytes.NewReader(raw))
	recorder := httptest.NewRecorder()
	server.demoSigAllDeposit(recorder, request)
	return recorder
}

func verifySigAllDepositReceiptSignature(t *testing.T, receipt sigAllDepositReceipt) {
	t.Helper()
	point, err := btcec.ParsePubKey(mustHex(receipt.Signer))
	if err != nil {
		t.Fatalf("receipt signer is not a point: %v", err)
	}
	authority, err := schnorr.ParsePubKey(schnorr.SerializePubKey(point))
	if err != nil {
		t.Fatal(err)
	}
	signature, err := schnorr.ParseSignature(mustHex(receipt.Signature))
	if err != nil {
		t.Fatal(err)
	}
	digest := sigAllDepositReceiptDigest(receipt)
	if !signature.Verify(digest[:], authority) {
		t.Fatal("the deposit receipt signature does not verify under the signer key")
	}
}

// TestDemoSigAllDepositStoresAndSignsReceipt is the happy path: a valid deposit
// is verified, stored durably under a deterministic id, and acknowledged with a
// receipt whose signature verifies under the application authority key.
func TestDemoSigAllDepositStoresAndSignsReceipt(t *testing.T) {
	t.Parallel()
	fx := sigAllDepositFixtureState(t)
	server := sigAllDepositServer(t, fx.state, fx.committee, t.TempDir())

	recorder := postSigAllDeposit(t, server, sigAllDepositRequest{AuctionID: fx.auctionID, Bidder: fx.bidder, Templates: fx.templates})
	if recorder.Code != http.StatusOK {
		t.Fatalf("deposit status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	var receipt sigAllDepositReceipt
	if err := json.Unmarshal(recorder.Body.Bytes(), &receipt); err != nil {
		t.Fatal(err)
	}
	if receipt.Schema != SigAllDepositReceiptSchema {
		t.Fatalf("receipt schema = %q", receipt.Schema)
	}
	if !validOperationID(receipt.DepositID) {
		t.Fatalf("deposit id %q is not a valid operation id", receipt.DepositID)
	}
	if receipt.AuctionID != fx.auctionID || receipt.Bidder != fx.bidder {
		t.Fatalf("receipt names %q/%q", receipt.AuctionID, receipt.Bidder)
	}
	if receipt.SettleDigest != fx.templates.Settle.Digest || receipt.RefundDigest != fx.templates.Refund.Digest {
		t.Fatalf("receipt digests do not match the verified templates")
	}
	if receipt.Signer != server.demoCommitteePublicKey {
		t.Fatalf("receipt signer = %s, want the application authority %s", receipt.Signer, server.demoCommitteePublicKey)
	}
	verifySigAllDepositReceiptSignature(t, receipt)

	// The bearer templates are stored, with the committed settle destination.
	stored, ok := server.demoSigAllDeposits.get(receipt.DepositID)
	if !ok {
		t.Fatal("the deposit was not stored")
	}
	if stored.Templates.Settle.Digest != fx.templates.Settle.Digest || stored.Templates.Refund.Digest != fx.templates.Refund.Digest {
		t.Fatal("the stored templates do not match the deposited ones")
	}
	if stored.SettleDestination != fx.sellerKey.publicKey {
		t.Fatalf("stored settle destination = %q, want the seller key", stored.SettleDestination)
	}

	// A retry with the same digests derives the same id and is idempotent.
	again := postSigAllDeposit(t, server, sigAllDepositRequest{AuctionID: fx.auctionID, Bidder: fx.bidder, Templates: fx.templates})
	if again.Code != http.StatusOK {
		t.Fatalf("idempotent retry status = %d, body = %s", again.Code, again.Body.String())
	}
	var retried sigAllDepositReceipt
	if err := json.Unmarshal(again.Body.Bytes(), &retried); err != nil {
		t.Fatal(err)
	}
	if retried.DepositID != receipt.DepositID {
		t.Fatalf("retry deposit id = %q, want the same %q", retried.DepositID, receipt.DepositID)
	}
}

// TestDemoSigAllDepositRefusesEachRule pins that each of the five §5 rules is
// refused with its rule named, and that a sigall deposit is refused when the
// auction is closed, when there is no receipt for the auction+bidder, when the
// receipt is not a sigall lock, and when the auction committed no payout key.
func TestDemoSigAllDepositRefusesEachRule(t *testing.T) {
	t.Parallel()
	fx := sigAllDepositFixtureState(t)
	server := sigAllDepositServer(t, fx.state, fx.committee, t.TempDir())

	otherSecret := sigAllOutputSecret(t, hex.EncodeToString(testPrivateKey(t).PubKey().SerializeCompressed()))
	cases := map[string]struct {
		mutate func(*sigAllDepositTemplates)
		reason string
	}{
		"outputs do not conserve": {func(d *sigAllDepositTemplates) { d.Settle.Outputs[0].Amount = 129 }, "conserve"},
		"settle not seller key":   {func(d *sigAllDepositTemplates) { d.Settle.Outputs[0].Secret = otherSecret }, "seller payout key"},
		"refund not wallet key":   {func(d *sigAllDepositTemplates) { d.Refund.Outputs[0].Secret = otherSecret }, "wallet spend key"},
		"bidder signature":        {func(d *sigAllDepositTemplates) { d.Settle.BidderSignature = strings.Repeat("d", 128) }, "does not verify"},
		"input refs": {func(d *sigAllDepositTemplates) {
			d.Refund.Inputs[0].Secret = hex.EncodeToString(testPrivateKey(t).Serialize())
		}, "input references"},
	}
	for name, testCase := range cases {
		templates := deepCopyTemplates(fx.templates)
		testCase.mutate(&templates)
		recorder := postSigAllDeposit(t, server, sigAllDepositRequest{AuctionID: fx.auctionID, Bidder: fx.bidder, Templates: templates})
		if recorder.Code != http.StatusUnprocessableEntity || !strings.Contains(recorder.Body.String(), testCase.reason) {
			t.Fatalf("%s: response = %d %s, want 422 naming %q", name, recorder.Code, recorder.Body.String(), testCase.reason)
		}
	}
	// None of the refusals stored anything.
	if _, ok := server.demoSigAllDeposits.get(sigAllDepositID(fx.auctionID, fx.bidder, fx.templates.Settle.Digest, fx.templates.Refund.Digest)); ok {
		t.Fatal("a refused deposit was stored")
	}

	// No receipt for this auction+bidder.
	noLock := sigAllDepositFixtureState(t)
	delete(noLock.state.Locks, noLock.bidID)
	noLockServer := sigAllDepositServer(t, noLock.state, noLock.committee, t.TempDir())
	recorder := postSigAllDeposit(t, noLockServer, sigAllDepositRequest{AuctionID: noLock.auctionID, Bidder: noLock.bidder, Templates: noLock.templates})
	if recorder.Code != http.StatusUnprocessableEntity || !strings.Contains(recorder.Body.String(), "no lock receipt") {
		t.Fatalf("no-receipt response = %d %s", recorder.Code, recorder.Body.String())
	}

	// A cashu_lock_v1 receipt is not a sigall lock.
	notSigAll := sigAllDepositFixtureState(t)
	plain := notSigAll.state.CashuLocks[notSigAll.receipt.TokenSHA256]
	plain.FundingMode = ""
	notSigAll.state.CashuLocks[notSigAll.receipt.TokenSHA256] = plain
	notSigAllServer := sigAllDepositServer(t, notSigAll.state, notSigAll.committee, t.TempDir())
	recorder = postSigAllDeposit(t, notSigAllServer, sigAllDepositRequest{AuctionID: notSigAll.auctionID, Bidder: notSigAll.bidder, Templates: notSigAll.templates})
	if recorder.Code != http.StatusUnprocessableEntity || !strings.Contains(recorder.Body.String(), "not a cashu_sigall_v1 lock") {
		t.Fatalf("cashu_lock receipt response = %d %s", recorder.Code, recorder.Body.String())
	}

	// A closed auction.
	closed := sigAllDepositFixtureState(t)
	auction := closed.state.Auctions[closed.auctionID]
	auction.Status = "closed"
	closed.state.Auctions[closed.auctionID] = auction
	closedServer := sigAllDepositServer(t, closed.state, closed.committee, t.TempDir())
	recorder = postSigAllDeposit(t, closedServer, sigAllDepositRequest{AuctionID: closed.auctionID, Bidder: closed.bidder, Templates: closed.templates})
	if recorder.Code != http.StatusUnprocessableEntity || !strings.Contains(recorder.Body.String(), "not open") {
		t.Fatalf("closed-auction response = %d %s", recorder.Code, recorder.Body.String())
	}

	// An auction with no committed seller payout key.
	noKey := sigAllDepositFixtureState(t)
	auction = noKey.state.Auctions[noKey.auctionID]
	auction.SellerCocoPaymentPublicKey = ""
	noKey.state.Auctions[noKey.auctionID] = auction
	noKeyServer := sigAllDepositServer(t, noKey.state, noKey.committee, t.TempDir())
	recorder = postSigAllDeposit(t, noKeyServer, sigAllDepositRequest{AuctionID: noKey.auctionID, Bidder: noKey.bidder, Templates: noKey.templates})
	if recorder.Code != http.StatusUnprocessableEntity || !strings.Contains(recorder.Body.String(), "no seller payout key") {
		t.Fatalf("no-payout-key response = %d %s", recorder.Code, recorder.Body.String())
	}
}

// TestDemoSigAllDepositRefusesSecondDifferentDeposit pins the second-deposit
// rule: once a deposit for an auction+bidder is stored, another deposit whose
// digests differ is refused.
func TestDemoSigAllDepositRefusesSecondDifferentDeposit(t *testing.T) {
	t.Parallel()
	fx := sigAllDepositFixtureState(t)
	server := sigAllDepositServer(t, fx.state, fx.committee, t.TempDir())

	if recorder := postSigAllDeposit(t, server, sigAllDepositRequest{AuctionID: fx.auctionID, Bidder: fx.bidder, Templates: fx.templates}); recorder.Code != http.StatusOK {
		t.Fatalf("first deposit status = %d, body = %s", recorder.Code, recorder.Body.String())
	}

	// A second, independently built deposit over the same refs has different
	// digests (fresh output openings), so it is a different deposit.
	second, _ := sigAllDeposit(t, fx.committee, fx.auctionID, fx.bidder, fx.wallet, fx.receipt, fx.inputs, fx.sellerKey.publicKey)
	if second.Settle.Digest == fx.templates.Settle.Digest {
		t.Fatal("the two deposits share a digest; the test cannot exercise the rule")
	}
	recorder := postSigAllDeposit(t, server, sigAllDepositRequest{AuctionID: fx.auctionID, Bidder: fx.bidder, Templates: second})
	if recorder.Code != http.StatusUnprocessableEntity || !strings.Contains(recorder.Body.String(), "different deposit") {
		t.Fatalf("second-deposit response = %d %s, want 422 naming the different deposit", recorder.Code, recorder.Body.String())
	}
}

// TestSigAllDepositStoreSurvivesReopen proves a deposit is durable: a fresh
// store over the same directory serves what a previous process stored.
func TestSigAllDepositStoreSurvivesReopen(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	deposit := sigAllStoredDeposit{
		Receipt: sigAllDepositReceipt{
			Schema: SigAllDepositReceiptSchema, DepositID: "dep-abc", AuctionID: "reopen-auction", Bidder: "reopen-bidder",
			SettleDigest: strings.Repeat("a", 64), RefundDigest: strings.Repeat("b", 64),
			Signer: strings.Repeat("02", 33)[:66], Signature: strings.Repeat("c", 128),
		},
		Templates:         sigAllDepositTemplates{Settle: sigAllSignedTemplate{Digest: strings.Repeat("a", 64)}},
		SettleDestination: strings.Repeat("02", 33)[:66],
	}
	first := sigAllDepositStore{dir: dir}
	if err := first.put(deposit); err != nil {
		t.Fatalf("put: %v", err)
	}
	info, err := os.Stat(first.path("dep-abc"))
	if err != nil {
		t.Fatalf("deposit file missing: %v", err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("deposit file mode = %o, want 0600", info.Mode().Perm())
	}

	second := sigAllDepositStore{dir: dir}
	if err := second.reload(); err != nil {
		t.Fatalf("reload: %v", err)
	}
	recovered, ok := second.get("dep-abc")
	if !ok {
		t.Fatal("reloaded store did not serve the deposit")
	}
	if recovered.Receipt.SettleDigest != deposit.Receipt.SettleDigest || recovered.Receipt.RefundDigest != deposit.Receipt.RefundDigest {
		t.Fatalf("recovered digests differ: %+v", recovered.Receipt)
	}
	if recovered.SettleDestination != deposit.SettleDestination {
		t.Fatalf("recovered settle destination = %q", recovered.SettleDestination)
	}
	if _, ok := second.findForAuctionBidder("reopen-auction", "reopen-bidder"); !ok {
		t.Fatal("reloaded store could not find the deposit by auction+bidder")
	}

	// A memory-only store still works.
	memoryOnly := sigAllDepositStore{}
	if err := memoryOnly.put(deposit); err != nil {
		t.Fatalf("memory-only put: %v", err)
	}
	if _, ok := memoryOnly.get("dep-abc"); !ok {
		t.Fatal("memory-only store lost its deposit")
	}
}

// sigAllSpendServer wires a coordinator to a fake swap mint and a snapshot of
// committed state, for the submit-path tests.
func sigAllSpendServer(t *testing.T, state State, committee *btcec.PrivateKey, mint *fakeSwapMint) *APIServer {
	t.Helper()
	server := refundServer(t, state, committee, mint)
	return server
}

// TestDemoMintSigAllSpendSubmitsOnlyTheTemplate pins the submit path: with a
// stubbed mint, a settle submits exactly the template's inputs and outputs, and
// the witness carries two signatures over the committed digest.
func TestDemoMintSigAllSpendSubmitsOnlyTheTemplate(t *testing.T) {
	t.Parallel()
	fx := sigAllDepositFixtureState(t)
	mint := newFakeSwapMint(t, []int64{fx.receipt.Amount})
	server := sigAllSpendServer(t, fx.state, fx.committee, mint)
	stored := sigAllStoredDeposit{Receipt: fx.depositRec, Templates: fx.templates, SettleDestination: fx.sellerKey.publicKey}

	fresh, err := server.demoMintSigAllSpend(context.Background(), fx.receipt, stored, "settle")
	if err != nil {
		t.Fatalf("sigall settle: %v", err)
	}
	if mint.swaps != 1 {
		t.Fatalf("mint saw %d swaps, want 1", mint.swaps)
	}
	if len(fresh) != len(fx.templates.Settle.Outputs) {
		t.Fatalf("returned %d proofs, want %d", len(fresh), len(fx.templates.Settle.Outputs))
	}
	var total int64
	for _, proof := range fresh {
		if recipient := p2pkRecipient(t, proof.Secret); recipient != fx.sellerKey.publicKey {
			t.Fatalf("payout is locked to %s, want the seller key", recipient)
		}
		if !validCompressedPublicKey(proof.C) {
			t.Fatalf("returned proof C is not a point: %s", proof.C)
		}
		total += proof.Amount
	}
	if total != fx.receipt.Amount {
		t.Fatalf("returned total %d, want %d", total, fx.receipt.Amount)
	}

	// The swap body is the template's own inputs, each carrying both signatures.
	if len(mint.inputs) != len(fx.templates.Settle.Inputs) {
		t.Fatalf("mint saw %d inputs, want %d", len(mint.inputs), len(fx.templates.Settle.Inputs))
	}
	for index, input := range mint.inputs {
		templateInput := fx.templates.Settle.Inputs[index]
		if input.Secret != templateInput.Secret || input.C != templateInput.C || input.Amount != templateInput.Amount || input.ID != templateInput.ID {
			t.Fatalf("input %d does not match the template: %+v", index, input)
		}
		var witness struct {
			Signatures []string `json:"signatures"`
		}
		if err := json.Unmarshal([]byte(input.Witness), &witness); err != nil {
			t.Fatalf("input %d witness is not JSON: %v", index, err)
		}
		if len(witness.Signatures) != 2 {
			t.Fatalf("input %d witness carries %d signatures, want 2", index, len(witness.Signatures))
		}
		if witness.Signatures[0] != fx.templates.Settle.BidderSignature {
			t.Fatalf("input %d witness does not carry the bidder's signature first", index)
		}
		// The committee's half must verify over the committed digest.
		point, err := btcec.ParsePubKey(mustHex(server.demoCommitteePublicKey))
		if err != nil {
			t.Fatal(err)
		}
		authority, err := schnorr.ParsePubKey(schnorr.SerializePubKey(point))
		if err != nil {
			t.Fatal(err)
		}
		signature, err := schnorr.ParseSignature(mustHex(witness.Signatures[1]))
		if err != nil {
			t.Fatalf("committee signature is malformed: %v", err)
		}
		if !signature.Verify(mustHex(fx.templates.Settle.Digest), authority) {
			t.Fatal("the committee signature does not verify over the committed digest")
		}
	}
}

// TestDemoMintSigAllSpendRefusesRedirectedOutput pins that a template whose
// output is locked somewhere other than the committed destination is refused
// BEFORE any mint call. The deposit receipt digests match the templates, so only
// the destination check can be the refusal.
func TestDemoMintSigAllSpendRefusesRedirectedOutput(t *testing.T) {
	t.Parallel()
	fx := sigAllDepositFixtureState(t)
	mint := newFakeSwapMint(t, []int64{fx.receipt.Amount})
	server := sigAllSpendServer(t, fx.state, fx.committee, mint)

	attacker := hex.EncodeToString(testPrivateKey(t).PubKey().SerializeCompressed())
	settle := sigAllBuildSignedTemplate(t, fx.wallet, fx.inputs, attacker, fx.receipt.Amount)
	refund := sigAllBuildSignedTemplate(t, fx.wallet, fx.inputs, fx.wallet.publicKey, fx.receipt.Amount)
	templates := sigAllDepositTemplates{Settle: settle, Refund: refund}
	receipt := sigAllDepositReceipt{
		Schema: SigAllDepositReceiptSchema, DepositID: "dep-redirect", AuctionID: fx.auctionID, Bidder: fx.bidder,
		SettleDigest: settle.Digest, RefundDigest: refund.Digest, Signer: server.demoCommitteePublicKey,
	}
	digest := sigAllDepositReceiptDigest(receipt)
	signature, err := schnorr.Sign(fx.committee, digest[:])
	if err != nil {
		t.Fatal(err)
	}
	receipt.Signature = hex.EncodeToString(signature.Serialize())

	// The stored destination is the committed seller key, but the template pays
	// the attacker: the destination check, not the digest, is the refusal.
	stored := sigAllStoredDeposit{Receipt: receipt, Templates: templates, SettleDestination: fx.sellerKey.publicKey}
	if _, err := server.demoMintSigAllSpend(context.Background(), fx.receipt, stored, "settle"); err == nil ||
		!strings.Contains(err.Error(), "not locked to the committed destination") {
		t.Fatalf("redirected output error = %v, want a destination refusal", err)
	}
	if mint.swaps != 0 {
		t.Fatalf("mint saw %d swaps, want 0: a redirected template reached the mint", mint.swaps)
	}
}

// TestDemoMintSigAllSpendRefusesMissingDeposit pins that a sigall lock with no
// stored deposit is refused, with no fallback to a locally-built transaction.
func TestDemoMintSigAllSpendRefusesMissingDeposit(t *testing.T) {
	t.Parallel()
	fx := sigAllDepositFixtureState(t)
	mint := newFakeSwapMint(t, []int64{fx.receipt.Amount})
	server := sigAllSpendServer(t, fx.state, fx.committee, mint)

	if _, err := server.demoMintSigAllSpend(context.Background(), fx.receipt, sigAllStoredDeposit{}, "settle"); err == nil ||
		!strings.Contains(err.Error(), "no stored deposit receipt") {
		t.Fatalf("missing-deposit error = %v, want a named refusal", err)
	}
	if mint.swaps != 0 {
		t.Fatalf("mint saw %d swaps, want 0", mint.swaps)
	}
}

// TestDemoMintSigAllSpendRefusesDigestMismatch pins the fail-closed digest check:
// a template whose recomputed digest differs from the committed one is refused.
func TestDemoMintSigAllSpendRefusesDigestMismatch(t *testing.T) {
	t.Parallel()
	fx := sigAllDepositFixtureState(t)
	mint := newFakeSwapMint(t, []int64{fx.receipt.Amount})
	server := sigAllSpendServer(t, fx.state, fx.committee, mint)

	stored := sigAllStoredDeposit{Receipt: fx.depositRec, Templates: fx.templates, SettleDestination: fx.sellerKey.publicKey}
	// Corrupt the committed digest so the recomputed template digest no longer
	// matches what the deposit receipt bound.
	stored.Receipt.SettleDigest = strings.Repeat("e", 64)
	if _, err := server.demoMintSigAllSpend(context.Background(), fx.receipt, stored, "settle"); err == nil ||
		!strings.Contains(err.Error(), "does not match the committed digest") {
		t.Fatalf("digest-mismatch error = %v, want a digest refusal", err)
	}
	if mint.swaps != 0 {
		t.Fatalf("mint saw %d swaps, want 0", mint.swaps)
	}
}

// TestDemoOutcomeSweeperSettlesSigAllLock pins the sweeper wiring: a sigall lock
// resolves through its stored template, the payout is parked for the seller, and
// the coordinator posts a KindOutcome that consensus accepts.
func TestDemoOutcomeSweeperSettlesSigAllLock(t *testing.T) {
	t.Parallel()
	fx := sigAllDepositFixtureState(t)
	state := fx.state
	auction := state.Auctions[fx.auctionID]
	auction.Status = "closed"
	auction.Winner = fx.bidder
	auction.LeaderBidID = fx.bidID
	state.Auctions[fx.auctionID] = auction
	lock := state.Locks[fx.bidID]
	lock.Status = "winner_selected"
	lock.SigAllDepositID = fx.depositRec.DepositID
	// A cashu_sigall_v1 lock carries NO wallet-spend-key consent signature: the
	// bidder authorized the two exact transactions with SIG_ALL templates at bid
	// time, and the deposit id on the lock is that authorization. Consensus must
	// therefore accept the outcome record on the deposit alone.
	lock.SettleAuthorization = ""
	lock.RefundAuthorization = ""
	state.Locks[fx.bidID] = lock

	mint := newFakeSwapMint(t, []int64{fx.receipt.Amount})
	current := state
	var posted []SignedEvent
	server := &APIServer{
		manifest: NetworkManifest{
			ChainID: "legacy", Mode: "remote", ApplicationAuthority: ApplicationAuthorityLegacy,
			CashuMintURL: mint.server.URL, Policy: DefaultPolicy(),
		},
		legacyInterim:          true,
		demoCommitteeKey:       fx.committee,
		demoCommitteePublicKey: hex.EncodeToString(fx.committee.PubKey().SerializeCompressed()),
		demoMintChecker:        &fakeMint{},
		demoMintKeyset:         NewMintKeySetFetcher(mint.server.URL, 2*time.Second),
		demoStateSnapshot:      func(context.Context) (State, error) { return current, nil },
		demoSettlements:        settlementStore{dir: t.TempDir()},
		demoSigAllDeposits:     sigAllDepositStore{dir: t.TempDir()},
		demoOutcomePoster: func(_ context.Context, event SignedEvent) error {
			posted = append(posted, event)
			return nil
		},
	}
	if err := server.demoSigAllDeposits.put(sigAllStoredDeposit{Receipt: fx.depositRec, Templates: fx.templates, SettleDestination: fx.sellerKey.publicKey}); err != nil {
		t.Fatal(err)
	}
	sweeper := newDemoOutcomeSweeper(server, time.Now)

	if err := sweeper.Step(context.Background()); err != nil {
		t.Fatalf("sweep step: %v", err)
	}
	if mint.swaps != 1 {
		t.Fatalf("mint saw %d swaps, want 1", mint.swaps)
	}
	if len(posted) != 1 {
		t.Fatalf("posted %d outcome records, want 1", len(posted))
	}
	var content outcomeContent
	if err := json.Unmarshal([]byte(posted[0].Content), &content); err != nil {
		t.Fatal(err)
	}
	if content.Outcome != "settle" || content.BidID != fx.bidID || content.AuctionID != fx.auctionID {
		t.Fatalf("posted content = %+v", content)
	}
	if content.PayoutTokenSHA256 == "" {
		t.Fatal("posted outcome carries no payout digest")
	}
	// Consensus must accept the record: the mirror agrees with the money.
	paid, err := ApplyTransaction(state, Transaction{Version: TxVersion, Type: "event", Event: &posted[0]}, posted[0].CreatedAt, DefaultPolicy(), fx.seed)
	if err != nil {
		t.Fatalf("consensus refused the sigall outcome record: %v", err)
	}
	if paid.Locks[fx.bidID].Status != "paid" {
		t.Fatalf("paid lock status = %q, want paid", paid.Locks[fx.bidID].Status)
	}
	// The payout is parked durably and locked to the seller.
	stored, ok := server.demoSettlements.get(fx.auctionID)
	if !ok || len(stored) != len(fx.templates.Settle.Outputs) {
		t.Fatalf("parked payout = %d proofs (present %v)", len(stored), ok)
	}
	for _, proof := range stored {
		if recipient := p2pkRecipient(t, proof.Secret); recipient != fx.sellerKey.publicKey {
			t.Fatalf("payout is locked to %s, want the seller key", recipient)
		}
	}
}

// TestDemoOutcomeSweeperRefusesSigAllWithoutDeposit pins that a sigall lock whose
// deposit is not stored is a deterministic refusal: the coordinator never acts on
// a lock it cannot resolve through a pre-authorized template.
func TestDemoOutcomeSweeperRefusesSigAllWithoutDeposit(t *testing.T) {
	t.Parallel()
	fx := sigAllDepositFixtureState(t)
	state := fx.state
	auction := state.Auctions[fx.auctionID]
	auction.Status = "closed"
	auction.Winner = fx.bidder
	auction.LeaderBidID = fx.bidID
	state.Auctions[fx.auctionID] = auction
	lock := state.Locks[fx.bidID]
	lock.Status = "winner_selected"
	lock.SigAllDepositID = "dep-never-stored"
	state.Locks[fx.bidID] = lock

	mint := newFakeSwapMint(t, []int64{fx.receipt.Amount})
	current := state
	var posted []SignedEvent
	server := &APIServer{
		manifest: NetworkManifest{
			ChainID: "legacy", Mode: "remote", ApplicationAuthority: ApplicationAuthorityLegacy,
			CashuMintURL: mint.server.URL, Policy: DefaultPolicy(),
		},
		legacyInterim:          true,
		demoCommitteeKey:       fx.committee,
		demoCommitteePublicKey: hex.EncodeToString(fx.committee.PubKey().SerializeCompressed()),
		demoMintChecker:        &fakeMint{},
		demoMintKeyset:         NewMintKeySetFetcher(mint.server.URL, 2*time.Second),
		demoStateSnapshot:      func(context.Context) (State, error) { return current, nil },
		demoSettlements:        settlementStore{dir: t.TempDir()},
		demoSigAllDeposits:     sigAllDepositStore{dir: t.TempDir()},
		demoOutcomePoster:      func(_ context.Context, event SignedEvent) error { posted = append(posted, event); return nil },
	}
	sweeper := newDemoOutcomeSweeper(server, time.Now)

	err := sweeper.Step(context.Background())
	if err == nil || !strings.Contains(err.Error(), "PERMANENT_REJECTION_QUARANTINED") {
		t.Fatalf("missing-deposit sweep error = %v, want a quarantine", err)
	}
	if mint.swaps != 0 || len(posted) != 0 {
		t.Fatalf("sweeper acted on a lock with no deposit: swaps=%d posted=%d", mint.swaps, len(posted))
	}
}

// TestDemoMintSettleSigAllResolvesThroughTemplate pins the cooperative settle
// endpoint's sigall branch: a sigall lock settles through its stored template
// (no freshly-built transaction) and the payout lands on the seller key.
func TestDemoMintSettleSigAllResolvesThroughTemplate(t *testing.T) {
	t.Parallel()
	fx := sigAllDepositFixtureState(t)
	state := fx.state
	auction := state.Auctions[fx.auctionID]
	auction.Status = "closed"
	auction.Winner = fx.bidder
	auction.LeaderBidID = fx.bidID
	state.Auctions[fx.auctionID] = auction
	lock := state.Locks[fx.bidID]
	lock.Status = "winner_selected"
	lock.SigAllDepositID = fx.depositRec.DepositID
	state.Locks[fx.bidID] = lock

	mint := newFakeSwapMint(t, []int64{fx.receipt.Amount})
	server := refundServer(t, state, fx.committee, mint)
	if err := server.demoSigAllDeposits.put(sigAllStoredDeposit{Receipt: fx.depositRec, Templates: fx.templates, SettleDestination: fx.sellerKey.publicKey}); err != nil {
		t.Fatal(err)
	}

	event := testEvent(t, fx.bidderKey, 1_601, KindSettle, settleContent{AuctionID: fx.auctionID, BidID: fx.bidID})
	recorder := postSettle(t, server, demoMintSettleBody{AuctionID: fx.auctionID, Event: event})
	if recorder.Code != http.StatusOK {
		t.Fatalf("sigall settle status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	var response demoMintRefundResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if len(response.Proofs) == 0 {
		t.Fatal("sigall settlement returned no proofs")
	}
	for _, proof := range response.Proofs {
		if recipient := p2pkRecipient(t, proof.Secret); recipient != fx.sellerKey.publicKey {
			t.Fatalf("payout is locked to %s, want the seller key", recipient)
		}
	}
	if mint.swaps != 1 {
		t.Fatalf("mint saw %d swaps, want 1", mint.swaps)
	}
	// The payout is parked for the seller.
	if _, ok := server.demoSettlements.get(fx.auctionID); !ok {
		t.Fatal("sigall settlement did not park the payout")
	}
}

// TestDemoMintSettleSigAllWithoutDepositRefused pins the named refusal when the
// cooperative settle endpoint is used for a sigall lock whose deposit is absent.
func TestDemoMintSettleSigAllWithoutDepositRefused(t *testing.T) {
	t.Parallel()
	fx := sigAllDepositFixtureState(t)
	state := fx.state
	auction := state.Auctions[fx.auctionID]
	auction.Status = "closed"
	auction.Winner = fx.bidder
	auction.LeaderBidID = fx.bidID
	state.Auctions[fx.auctionID] = auction
	lock := state.Locks[fx.bidID]
	lock.Status = "winner_selected"
	lock.SigAllDepositID = "dep-never-stored"
	state.Locks[fx.bidID] = lock

	mint := newFakeSwapMint(t, []int64{fx.receipt.Amount})
	server := refundServer(t, state, fx.committee, mint)
	event := testEvent(t, fx.bidderKey, 1_601, KindSettle, settleContent{AuctionID: fx.auctionID, BidID: fx.bidID})
	recorder := postSettle(t, server, demoMintSettleBody{AuctionID: fx.auctionID, Event: event})
	if recorder.Code != http.StatusUnprocessableEntity || !strings.Contains(recorder.Body.String(), "deposited outcome templates, which are not stored") {
		t.Fatalf("missing-deposit settle response = %d %s", recorder.Code, recorder.Body.String())
	}
	if mint.swaps != 0 {
		t.Fatalf("mint saw %d swaps, want 0", mint.swaps)
	}
}

// TestDemoOutcomeSweeperCashuLockStillCooperative is the regression pin: the
// additive SIG_ALL work leaves the cashu_lock_v1 sweeper path unchanged -- a
// displaced-cooperative settle still swaps through demoMintCooperativeSpend and
// no sigall deposit is consulted.
func TestDemoOutcomeSweeperCashuLockStillCooperative(t *testing.T) {
	t.Parallel()
	fixture := newOutcomeSweepFixture(t, true, false)
	fixture.mint = newFakeSwapMint(t, fixture.amounts)
	current := fixture.state
	var posted []SignedEvent
	server := outcomeSweepServer(t, fixture, &current, &posted, t.TempDir())
	server.demoOutcomeProofs.put(fixture.settleBidID, refundProofs(t, fixture.secrets, fixture.amounts, fixture.mint.keysetID))
	sweeper := newDemoOutcomeSweeper(server, time.Now)

	if err := sweeper.Step(context.Background()); err != nil {
		t.Fatalf("cooperative sweep step: %v", err)
	}
	if fixture.mint.swaps != 1 || len(posted) != 1 {
		t.Fatalf("cooperative settle: swaps=%d posted=%d, want 1 and 1", fixture.mint.swaps, len(posted))
	}
	var content outcomeContent
	if err := json.Unmarshal([]byte(posted[0].Content), &content); err != nil {
		t.Fatal(err)
	}
	if content.Outcome != "settle" || content.BidID != fixture.settleBidID {
		t.Fatalf("cooperative settle content = %+v", content)
	}
}

// TestDemoSigAllDepositRefusesPostedReceiptRules pins the checks the coordinator
// runs on the lock receipt a bidder posts in the deposit body, before it is
// used: the schema, the cashu_sigall_v1 mode, the auction and bidder binding,
// and the application-authority signature. Each case re-signs the mutated
// receipt where the mutation changes signed bytes, so only the rule under test
// can be the refusal.
func TestDemoSigAllDepositRefusesPostedReceiptRules(t *testing.T) {
	t.Parallel()
	fx := sigAllFixture(t)
	wallet := newWalletClaim(t)
	bidderKey := testPrivateKey(t)
	bidder := actorForKey(bidderKey)
	inputs, refs := sigAllInputs(t)
	receipt := sigAllLockReceipt(t, fx.committee, fx.auctionID, bidder, 128, refs, wallet)
	templates, _ := sigAllDeposit(t, fx.committee, fx.auctionID, bidder, wallet, receipt, inputs, fx.sellerKey.publicKey)

	// resign re-signs a mutated receipt with the authority key, so a case whose
	// mutation changes signed bytes still fails only on its own binding rule.
	resign := func(candidate CashuLockReceipt) CashuLockReceipt {
		digest := cashuReceiptDigest(candidate)
		signature, err := schnorr.Sign(fx.committee, digest[:])
		if err != nil {
			t.Fatal(err)
		}
		candidate.Signature = hex.EncodeToString(signature.Serialize())
		return candidate
	}
	withSchema := receipt
	withSchema.Schema = "PlebeianAuctionsPOCNotACashuLock"
	withMode := receipt
	withMode.FundingMode = ""
	withAuction := receipt
	withAuction.AuctionID = "another-auction"
	withBidder := receipt
	withBidder.Bidder = actorForKey(testPrivateKey(t))
	badSignature := receipt
	badSignature.Signature = strings.Repeat("c", schnorr.SignatureSize*2)

	cases := []struct {
		name    string
		receipt CashuLockReceipt
		reason  string
	}{
		{"schema is not the Cashu lock receipt", resign(withSchema), "not a Cashu lock receipt"},
		{"receipt is a cashu_lock_v1 lock", resign(withMode), "not a cashu_sigall_v1 lock"},
		{"receipt names another auction", resign(withAuction), "different auction"},
		{"receipt names another bidder", resign(withBidder), "different bidder"},
		{"receipt signature does not verify", badSignature, "signature does not verify"},
	}
	server := sigAllDepositServer(t, fx.state, fx.committee, t.TempDir())
	for _, testCase := range cases {
		posted := testCase.receipt
		recorder := postSigAllDeposit(t, server, sigAllDepositRequest{AuctionID: fx.auctionID, Bidder: bidder, Templates: templates, Receipt: &posted})
		if recorder.Code != http.StatusUnprocessableEntity || !strings.Contains(recorder.Body.String(), testCase.reason) {
			t.Fatalf("%s: response = %d %s, want 422 naming %q", testCase.name, recorder.Code, recorder.Body.String(), testCase.reason)
		}
	}
	if _, ok := server.demoSigAllDeposits.findForAuctionBidder(fx.auctionID, bidder); ok {
		t.Fatal("a refused receipt-carrying deposit was stored")
	}

	// The same receipt, unmutated, is accepted: the refusals above are the rules
	// and not a blanket refusal of the body receipt.
	good := receipt
	if recorder := postSigAllDeposit(t, server, sigAllDepositRequest{AuctionID: fx.auctionID, Bidder: bidder, Templates: templates, Receipt: &good}); recorder.Code != http.StatusOK {
		t.Fatalf("valid receipt-carrying deposit status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
}

// TestDemoSigAllDepositLiveOrderingWithoutCommittedLock pins the live ordering
// the first live end-to-end run broke on. With NO committed lock or bid for the
// auction+bidder, a deposit that carries the authority-signed cashu_sigall_v1
// lock receipt in its body is accepted and stored; the bid that then carries
// outcome_templates + sigall_deposit passes the REAL admission path the live node
// uses (ValidateForMempool then ApplyTransaction) and commits, and the sweeper
// then resolves the committed lock through the stored pre-authorized template.
func TestDemoSigAllDepositLiveOrderingWithoutCommittedLock(t *testing.T) {
	t.Parallel()
	fx := sigAllFixture(t)
	wallet := newWalletClaim(t)
	bidderKey := testPrivateKey(t)
	bidder := actorForKey(bidderKey)
	inputs, refs := sigAllInputs(t)
	receipt := sigAllLockReceipt(t, fx.committee, fx.auctionID, bidder, 128, refs, wallet)
	templates, _ := sigAllDeposit(t, fx.committee, fx.auctionID, bidder, wallet, receipt, inputs, fx.sellerKey.publicKey)

	// The defect: nothing is committed for this auction+bidder yet, so a
	// committed-lock lookup cannot supply the receipt.
	if len(fx.state.Locks) != 0 || len(fx.state.Bids) != 0 {
		t.Fatalf("fixture is not empty: locks=%d bids=%d", len(fx.state.Locks), len(fx.state.Bids))
	}

	mint := newFakeSwapMint(t, []int64{receipt.Amount})
	current := fx.state
	var posted []SignedEvent
	server := &APIServer{
		manifest: NetworkManifest{
			ChainID: "legacy", Mode: "remote", ApplicationAuthority: ApplicationAuthorityLegacy,
			CashuMintURL: mint.server.URL, Policy: DefaultPolicy(),
		},
		legacyInterim:          true,
		demoCommitteeKey:       fx.committee,
		demoCommitteePublicKey: hex.EncodeToString(fx.committee.PubKey().SerializeCompressed()),
		demoMintChecker:        &fakeMint{},
		demoMintKeyset:         NewMintKeySetFetcher(mint.server.URL, 2*time.Second),
		demoStateSnapshot:      func(context.Context) (State, error) { return current, nil },
		demoSettlements:        settlementStore{dir: t.TempDir()},
		demoSigAllDeposits:     sigAllDepositStore{dir: t.TempDir()},
		demoOutcomePoster: func(_ context.Context, event SignedEvent) error {
			posted = append(posted, event)
			return nil
		},
	}

	// Step 4 of the live route: the deposit carries the receipt from mint-lock.
	body := sigAllDepositRequest{AuctionID: fx.auctionID, Bidder: bidder, Templates: templates, Receipt: &receipt}
	recorder := postSigAllDeposit(t, server, body)
	if recorder.Code != http.StatusOK {
		t.Fatalf("receipt-carrying deposit status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	var depositReceipt sigAllDepositReceipt
	if err := json.Unmarshal(recorder.Body.Bytes(), &depositReceipt); err != nil {
		t.Fatal(err)
	}
	verifySigAllDepositReceiptSignature(t, depositReceipt)
	stored, ok := server.demoSigAllDeposits.get(depositReceipt.DepositID)
	if !ok || stored.Templates.Settle.Digest != templates.Settle.Digest || stored.Templates.Refund.Digest != templates.Refund.Digest {
		t.Fatalf("the receipt-carrying deposit was not stored (ok=%v)", ok)
	}

	// Step 5: the bid the wallet publishes carries the compact commitment plus
	// the coordinator's signed deposit receipt.
	event := testEvent(t, bidderKey, 1_001, KindBid, bidContent{
		AuctionID: fx.auctionID, Amount: 128, CashuLock: &receipt,
		OutcomeTemplates: &sigAllOutcomeTemplates{
			Schema: SigAllTemplatesSchema, DepositID: depositReceipt.DepositID,
			Settle: sigAllTemplateSignature{Digest: templates.Settle.Digest, BidderSignature: templates.Settle.BidderSignature},
			Refund: sigAllTemplateSignature{Digest: templates.Refund.Digest, BidderSignature: templates.Refund.BidderSignature},
		},
		SigAllDeposit: &depositReceipt,
	})

	// The real admission path the live node uses: local admission, then commit.
	tx := Transaction{Version: TxVersion, Type: "event", Event: &event}
	if err := ValidateForMempool(fx.state, tx, DefaultPolicy(), fx.seed); err != nil {
		t.Fatalf("the receipt-backed sigall bid was refused by local admission: %v", err)
	}
	next, err := ApplyTransaction(fx.state, tx, 1_001, DefaultPolicy(), fx.seed)
	if err != nil {
		t.Fatalf("the receipt-backed sigall bid was refused at commit: %v", err)
	}
	if next.Locks[event.ID].SigAllDepositID != depositReceipt.DepositID {
		t.Fatalf("committed lock deposit id = %q, want %q", next.Locks[event.ID].SigAllDepositID, depositReceipt.DepositID)
	}

	// The auction closes and the committed lock is the winner, so the sweeper
	// resolves it through the stored template with no further bidder input.
	auction := next.Auctions[fx.auctionID]
	auction.Status = "closed"
	auction.Winner = bidder
	auction.LeaderBidID = event.ID
	next.Auctions[fx.auctionID] = auction
	lock := next.Locks[event.ID]
	lock.Status = "winner_selected"
	next.Locks[event.ID] = lock
	current = next

	sweeper := newDemoOutcomeSweeper(server, time.Now)
	if err := sweeper.Step(context.Background()); err != nil {
		t.Fatalf("sweep step: %v", err)
	}
	if mint.swaps != 1 {
		t.Fatalf("mint saw %d swaps, want 1", mint.swaps)
	}
	if len(posted) != 1 {
		t.Fatalf("posted %d outcome records, want 1", len(posted))
	}
	var outcome outcomeContent
	if err := json.Unmarshal([]byte(posted[0].Content), &outcome); err != nil {
		t.Fatal(err)
	}
	if outcome.Outcome != "settle" || outcome.BidID != event.ID || outcome.AuctionID != fx.auctionID {
		t.Fatalf("posted outcome = %+v", outcome)
	}
	// The parked payout is locked to the seller, so custody never moved to the
	// coordinator.
	payout, ok := server.demoSettlements.get(fx.auctionID)
	if !ok || len(payout) == 0 {
		t.Fatalf("the payout was not parked (ok=%v)", ok)
	}
	for _, proof := range payout {
		if recipient := p2pkRecipient(t, proof.Secret); recipient != fx.sellerKey.publicKey {
			t.Fatalf("payout is locked to %s, want the seller key", recipient)
		}
	}
}

// TestStartDemoOutcomeSweeperResolvesTerminalLock pins the deployment wiring, not
// the actor: startDemoOutcomeSweeper is the one call both server paths make, and
// this asserts that calling it really drives the loop until a terminal sigall
// lock is resolved. The local-demo path shipped without this call, so on the
// running demo nothing ever settled a lock with no browser open; a unit test
// that calls Step directly (as the other sweeper tests do) cannot catch that.
func TestStartDemoOutcomeSweeperResolvesTerminalLock(t *testing.T) {
	t.Parallel()
	fx := sigAllDepositFixtureState(t)
	state := fx.state
	auction := state.Auctions[fx.auctionID]
	auction.Status = "closed"
	auction.Winner = fx.bidder
	auction.LeaderBidID = fx.bidID
	state.Auctions[fx.auctionID] = auction
	lock := state.Locks[fx.bidID]
	lock.Status = "winner_selected"
	lock.SigAllDepositID = fx.depositRec.DepositID
	state.Locks[fx.bidID] = lock

	mint := newFakeSwapMint(t, []int64{fx.receipt.Amount})
	current := state
	posted := make(chan outcomeContent, 4)
	server := &APIServer{
		manifest: NetworkManifest{
			ChainID: "legacy", Mode: "remote", ApplicationAuthority: ApplicationAuthorityLegacy,
			CashuMintURL: mint.server.URL, Policy: DefaultPolicy(),
		},
		legacyInterim:          true,
		demoCommitteeKey:       fx.committee,
		demoCommitteePublicKey: hex.EncodeToString(fx.committee.PubKey().SerializeCompressed()),
		demoMintChecker:        &fakeMint{},
		demoMintKeyset:         NewMintKeySetFetcher(mint.server.URL, 2*time.Second),
		demoStateSnapshot:      func(context.Context) (State, error) { return current, nil },
		demoSettlements:        settlementStore{dir: t.TempDir()},
		demoSigAllDeposits:     sigAllDepositStore{dir: t.TempDir()},
		demoOutcomePoster: func(_ context.Context, event SignedEvent) error {
			var content outcomeContent
			if err := json.Unmarshal([]byte(event.Content), &content); err != nil {
				return err
			}
			posted <- content
			return nil
		},
	}
	if err := server.demoSigAllDeposits.put(sigAllStoredDeposit{Receipt: fx.depositRec, Templates: fx.templates, SettleDestination: fx.sellerKey.publicKey}); err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	startDemoOutcomeSweeper(ctx, server)

	select {
	case content := <-posted:
		if content.Outcome != "settle" || content.BidID != fx.bidID {
			t.Fatalf("posted outcome = %+v", content)
		}
	case <-time.After(15 * time.Second):
		t.Fatal("startDemoOutcomeSweeper never resolved the terminal sigall lock")
	}
	if mint.swaps != 1 {
		t.Fatalf("mint saw %d swaps, want exactly 1", mint.swaps)
	}
}

// TestBothServerPathsStartTheOutcomeSweeper is a source guard for the bug this
// slice shipped with: the local-demo server path started validators, the pruner
// and the relay observer but never the outcome sweeper, so on the running demo
// nothing could resolve a terminal lock unless a browser called an endpoint.
// Both server paths must go through the one shared starter.
func TestBothServerPathsStartTheOutcomeSweeper(t *testing.T) {
	t.Parallel()
	raw, err := os.ReadFile("runtime.go")
	if err != nil {
		t.Fatal(err)
	}
	if count := strings.Count(string(raw), "startDemoOutcomeSweeper(ctx, api)"); count < 2 {
		t.Fatalf("runtime.go starts the outcome sweeper %d time(s), want at least 2 (site path and local-demo path)", count)
	}
}

// TestDemoSigAllRefundParksOutcomeForSweeper pins the cooperative sigall refund
// path end to end: the refund branch spends the pre-authorized template, parks
// the payout under the bid id (the sweeper's refund park key), and the sweeper
// then posts the refund outcome that consensus turns into `refunded` -- all
// without a second swap. Before this the endpoint spent the proofs but never
// parked or recorded anything, so the lock stayed `refundable` while its proofs
// were already SPENT at the mint.
func TestDemoSigAllRefundParksOutcomeForSweeper(t *testing.T) {
	t.Parallel()
	fx := sigAllDepositFixtureState(t)
	state := fx.state
	lock := state.Locks[fx.bidID]
	lock.Status = "refundable"
	lock.SigAllDepositID = fx.depositRec.DepositID
	lock.RefundAuthorization = ""
	state.Locks[fx.bidID] = lock

	mint := newFakeSwapMint(t, []int64{fx.receipt.Amount})
	current := state
	var posted []SignedEvent
	server := &APIServer{
		manifest: NetworkManifest{
			ChainID: "legacy", Mode: "remote", ApplicationAuthority: ApplicationAuthorityLegacy,
			CashuMintURL: mint.server.URL, Policy: DefaultPolicy(),
		},
		legacyInterim:          true,
		demoCommitteeKey:       fx.committee,
		demoCommitteePublicKey: hex.EncodeToString(fx.committee.PubKey().SerializeCompressed()),
		demoMintChecker:        &fakeMint{},
		demoMintKeyset:         NewMintKeySetFetcher(mint.server.URL, 2*time.Second),
		demoStateSnapshot:      func(context.Context) (State, error) { return current, nil },
		demoSettlements:        settlementStore{dir: t.TempDir()},
		demoSigAllDeposits:     sigAllDepositStore{dir: t.TempDir()},
		demoOutcomePoster:      func(_ context.Context, event SignedEvent) error { posted = append(posted, event); return nil },
	}
	if err := server.demoSigAllDeposits.put(sigAllStoredDeposit{Receipt: fx.depositRec, Templates: fx.templates, SettleDestination: fx.sellerKey.publicKey}); err != nil {
		t.Fatal(err)
	}

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/demo/sigall-refund", nil)
	server.demoSigAllOutcome(recorder, request, lock, fx.receipt, "refund")
	if recorder.Code != http.StatusOK {
		t.Fatalf("sigall refund status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	if mint.swaps != 1 {
		t.Fatalf("mint saw %d swaps, want 1", mint.swaps)
	}
	stored, ok := server.demoSettlements.get(fx.bidID)
	if !ok || len(stored) != len(fx.templates.Refund.Outputs) {
		t.Fatalf("refund payout not parked under the bid id: present=%v n=%d", ok, len(stored))
	}
	for _, proof := range stored {
		if recipient := p2pkRecipient(t, proof.Secret); recipient != fx.receipt.RefundPublicKey {
			t.Fatalf("refund payout is locked to %s, want the bidder refund key", recipient)
		}
	}

	// The sweeper resolves the refundable lock from the parked payout: it posts
	// the refund outcome and swaps nothing.
	sweeper := newDemoOutcomeSweeper(server, time.Now)
	if err := sweeper.Step(context.Background()); err != nil {
		t.Fatalf("sweep step after refund: %v", err)
	}
	if mint.swaps != 1 {
		t.Fatalf("sweeper swapped a second time: %d", mint.swaps)
	}
	if len(posted) != 1 {
		t.Fatalf("posted %d outcome records, want 1", len(posted))
	}
	var content outcomeContent
	if err := json.Unmarshal([]byte(posted[0].Content), &content); err != nil {
		t.Fatal(err)
	}
	if content.Outcome != "refund" || content.BidID != fx.bidID {
		t.Fatalf("posted refund content = %+v", content)
	}
	refunded, err := ApplyTransaction(state, Transaction{Version: TxVersion, Type: "event", Event: &posted[0]}, posted[0].CreatedAt, DefaultPolicy(), fx.seed)
	if err != nil {
		t.Fatalf("consensus refused the sigall refund outcome: %v", err)
	}
	if refunded.Locks[fx.bidID].Status != "refunded" {
		t.Fatalf("refunded lock status = %q, want refunded", refunded.Locks[fx.bidID].Status)
	}
}
