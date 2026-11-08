package poc

import (
	"crypto/ed25519"
	"encoding/hex"
	"encoding/json"
	"sort"
	"strings"
	"testing"

	"github.com/btcsuite/btcd/btcec/v2"
	"github.com/btcsuite/btcd/btcec/v2/schnorr"
)

// sigAllTestKeyset is a placeholder keyset id for the template proofs. The
// coordinator only requires it to be non-empty at deposit time.
const sigAllTestKeyset = "00e8839167216bc1"

// TestSigAllDigestMatchesGoldenVector pins the frozen (§3) SIG_ALL digest
// convention against the shared vector both languages carry. If this changes,
// the mint stops accepting the bids, so it must not change silently.
func TestSigAllDigestMatchesGoldenVector(t *testing.T) {
	t.Parallel()
	got := sigAllDigest(sigAllGoldenInputs, sigAllGoldenBlinded)
	if hex.EncodeToString(got[:]) != sigAllGoldenDigest {
		t.Fatalf("sigAllDigest = %s, want the frozen golden vector %s", hex.EncodeToString(got[:]), sigAllGoldenDigest)
	}
	// Order matters: the secrets and the blinded points are concatenated in the
	// order the mint receives them.
	reordered := sigAllDigest(sigAllGoldenInputs, []string{sigAllGoldenBlinded[1], sigAllGoldenBlinded[0]})
	if hex.EncodeToString(reordered[:]) == sigAllGoldenDigest {
		t.Fatal("sigAllDigest ignored the output order")
	}
	// The output-point derivation (B_ = hash_to_curve(secret) + r*G) must also
	// agree with the TypeScript wallet, so the coordinator recomputes the exact
	// points the bidder signed. This vector was cross-checked against
	// sigall.ts's sigAllOutputPoint.
	secret := `["P2PK",{"nonce":"` + strings.Repeat("00", 16) + `","data":"02` + strings.Repeat("aa", 32) + `","tags":[["sigflag","SIG_INPUTS"]]}]`
	point, err := sigAllOutputPoint(secret, strings.Repeat("11", 32))
	if err != nil {
		t.Fatal(err)
	}
	if point != sigAllGoldenOutputPoint {
		t.Fatalf("sigAllOutputPoint = %s, want the shared golden point %s", point, sigAllGoldenOutputPoint)
	}
}

type sigAllFixtureState struct {
	state     State
	seed      []byte
	committee *btcec.PrivateKey
	auctionID string
	sellerKey walletClaim
}

// sigAllFixture commits a cashu_sigall_v1 auction with a committed seller
// payout key, exactly the shape settle destinations are checked against.
func sigAllFixture(t *testing.T) sigAllFixtureState {
	t.Helper()
	seed := make([]byte, ed25519.SeedSize)
	seed[0] = 77
	committee := testPrivateKey(t)
	state, err := NewState("sigall-fixture", ed25519.NewKeyFromSeed(seed).Public().(ed25519.PublicKey),
		hex.EncodeToString(committee.PubKey().SerializeCompressed()))
	if err != nil {
		t.Fatal(err)
	}
	sellerKey := newWalletClaim(t)
	seller := testPrivateKey(t)
	create := testEvent(t, seller, 1_000, KindCreate, createContent{
		AuctionID: "sigall-auction", Title: "SIG_ALL item", Duration: 600,
		StartingBid: 100, FundingMode: FundingModeCashuSigAll,
		SellerCocoPaymentPublicKey: sellerKey.publicKey,
	})
	state, err = ApplyTransaction(state, Transaction{Version: TxVersion, Type: "event", Event: &create}, 1_000, DefaultPolicy(), seed)
	if err != nil {
		t.Fatalf("create sigall auction: %v", err)
	}
	return sigAllFixtureState{state: state, seed: seed, committee: committee, auctionID: "sigall-auction", sellerKey: sellerKey}
}

// sigAllLockReceipt is a signed cashu_sigall_v1 lock receipt binding the exact
// proof references and the wallet spend key.
func sigAllLockReceipt(t *testing.T, committee *btcec.PrivateKey, auctionID, bidder string, amount int64, refs []string, wallet walletClaim) CashuLockReceipt {
	t.Helper()
	receipt := CashuLockReceipt{
		Schema: "PlebeianAuctionsPOCCashuLockV1", MintURL: CashuMintURL, AuctionID: auctionID,
		Bidder: bidder, Amount: amount, OperationID: "op-sigall", TokenSHA256: strings.Repeat("a", 64),
		CommitteePublicKey: hex.EncodeToString(committee.PubKey().SerializeCompressed()),
		RefundPublicKey:    wallet.publicKey, Locktime: 1_700, FundingMode: FundingModeCashuSigAll,
		ProofStateRefs: refs,
	}
	digest := cashuReceiptDigest(receipt)
	signature, err := schnorr.Sign(committee, digest[:])
	if err != nil {
		t.Fatal(err)
	}
	receipt.Signature = hex.EncodeToString(signature.Serialize())
	return receipt
}

// sigAllInputs builds two 64-sat bearer inputs and their committed NUT-07
// references (sorted).
func sigAllInputs(t *testing.T) ([]sigAllTemplateInput, []string) {
	t.Helper()
	inputs := make([]sigAllTemplateInput, 0, 2)
	refs := make([]string, 0, 2)
	for index := 0; index < 2; index++ {
		secretKey := testPrivateKey(t)
		secret := hex.EncodeToString(secretKey.Serialize())
		reference, err := demoMintProofY(secret)
		if err != nil {
			t.Fatal(err)
		}
		inputs = append(inputs, sigAllTemplateInput{
			Amount: 64, ID: sigAllTestKeyset, Secret: secret,
			C: hex.EncodeToString(testPrivateKey(t).PubKey().SerializeCompressed()),
		})
		refs = append(refs, reference)
	}
	sort.Strings(refs)
	return inputs, refs
}

// sigAllOutputSecret builds the P2PK output secret a template locks its fresh
// proof to, with the recipient's compressed key as the condition's data.
func sigAllOutputSecret(t *testing.T, recipient string) string {
	t.Helper()
	secret := []any{"P2PK", map[string]any{
		"nonce": hex.EncodeToString(testPrivateKey(t).Serialize()),
		"data":  recipient,
		"tags":  [][]string{{"sigflag", "SIG_INPUTS"}},
	}}
	encoded, err := json.Marshal(secret)
	if err != nil {
		t.Fatal(err)
	}
	return string(encoded)
}

// sigAllSignedTemplate builds one exact outcome transaction and the bidder's
// signature over its SIG_ALL digest.
func sigAllBuildSignedTemplate(t *testing.T, wallet walletClaim, inputs []sigAllTemplateInput, recipient string, amount int64) sigAllSignedTemplate {
	t.Helper()
	template := sigAllSignedTemplate{
		Inputs: inputs,
		Outputs: []sigAllTemplateOutput{{
			Amount: amount, ID: sigAllTestKeyset,
			Secret: sigAllOutputSecret(t, recipient),
			R:      hex.EncodeToString(testPrivateKey(t).Serialize()),
		}},
	}
	digest, err := sigAllTemplateDigest(template)
	if err != nil {
		t.Fatal(err)
	}
	template.Digest = digest
	signature, err := schnorr.Sign(wallet.key, mustHex(digest))
	if err != nil {
		t.Fatal(err)
	}
	template.BidderSignature = hex.EncodeToString(signature.Serialize())
	return template
}

// sigAllDeposit builds the two signed outcome templates and the deposit receipt
// that binds them to the auction and the bidder.
func sigAllDeposit(t *testing.T, committee *btcec.PrivateKey, auctionID, bidder string, wallet walletClaim, receipt CashuLockReceipt, inputs []sigAllTemplateInput, sellerRecipient string) (sigAllDepositTemplates, sigAllDepositReceipt) {
	t.Helper()
	settle := sigAllBuildSignedTemplate(t, wallet, inputs, sellerRecipient, receipt.Amount)
	refund := sigAllBuildSignedTemplate(t, wallet, inputs, wallet.publicKey, receipt.Amount)
	templates := sigAllDepositTemplates{Settle: settle, Refund: refund}
	deposit := sigAllDepositReceipt{
		Schema: SigAllDepositReceiptSchema, DepositID: "dep-sigall-1", AuctionID: auctionID, Bidder: bidder,
		SettleDigest: settle.Digest, RefundDigest: refund.Digest,
		Signer: hex.EncodeToString(committee.PubKey().SerializeCompressed()),
	}
	digest := sigAllDepositReceiptDigest(deposit)
	signature, err := schnorr.Sign(committee, digest[:])
	if err != nil {
		t.Fatal(err)
	}
	deposit.Signature = hex.EncodeToString(signature.Serialize())
	return templates, deposit
}

// buildSigAllBid returns a fully authorized cashu_sigall_v1 bid plus the lock
// receipt it commits.
func buildSigAllBid(t *testing.T, fx sigAllFixtureState, bidder *btcec.PrivateKey, amount int64) (SignedEvent, CashuLockReceipt, *sigAllDepositReceipt) {
	t.Helper()
	wallet := newWalletClaim(t)
	inputs, refs := sigAllInputs(t)
	receipt := sigAllLockReceipt(t, fx.committee, fx.auctionID, actorForKey(bidder), amount, refs, wallet)
	templates, deposit := sigAllDeposit(t, fx.committee, fx.auctionID, actorForKey(bidder), wallet, receipt, inputs, fx.sellerKey.publicKey)
	content := bidContent{
		AuctionID: fx.auctionID, Amount: amount, CashuLock: &receipt,
		OutcomeTemplates: &sigAllOutcomeTemplates{
			Schema: SigAllTemplatesSchema, DepositID: deposit.DepositID,
			Settle: sigAllTemplateSignature{Digest: templates.Settle.Digest, BidderSignature: templates.Settle.BidderSignature},
			Refund: sigAllTemplateSignature{Digest: templates.Refund.Digest, BidderSignature: templates.Refund.BidderSignature},
		},
		SigAllDeposit: &deposit,
	}
	return testEvent(t, bidder, 1_001, KindBid, content), receipt, &deposit
}

// TestSigAllReceiptCommitsTwoKeyConditionAndMode pins the wave-1 receipt shape:
// a cashu_sigall_v1 lock commits with both the committee key and the wallet
// spend key recorded, and with the funding mode recorded.
func TestSigAllReceiptCommitsTwoKeyConditionAndMode(t *testing.T) {
	t.Parallel()
	fx := sigAllFixture(t)
	bidder := testPrivateKey(t)
	event, _, _ := buildSigAllBid(t, fx, bidder, 128)

	next, err := ApplyTransaction(fx.state, Transaction{Version: TxVersion, Type: "event", Event: &event}, 1_001, DefaultPolicy(), fx.seed)
	if err != nil {
		t.Fatalf("valid sigall bid: %v", err)
	}
	bid := next.Bids[event.ID]
	if bid.SigAllDepositID != "dep-sigall-1" {
		t.Fatalf("committed bid deposit id = %q, want dep-sigall-1", bid.SigAllDepositID)
	}
	if next.Locks[event.ID].SigAllDepositID != "dep-sigall-1" {
		t.Fatalf("committed lock deposit id = %q, want dep-sigall-1", next.Locks[event.ID].SigAllDepositID)
	}
	receipt, ok := next.CashuLocks[bid.CashuTokenSHA256]
	if !ok {
		t.Fatal("committed sigall bid stored no lock receipt")
	}
	if receipt.FundingMode != FundingModeCashuSigAll {
		t.Fatalf("receipt funding mode = %q, want %q", receipt.FundingMode, FundingModeCashuSigAll)
	}
	if receipt.CommitteePublicKey == "" || receipt.RefundPublicKey == "" {
		t.Fatal("receipt did not record both the committee key and the wallet spend key")
	}
}

// TestSigAllAdmissionRefusals pins the local-admission rule: a sigall bid with
// no templates, with a mismatched digest, with a deposit naming another auction
// and with a deposit whose signature does not verify are all refused.
func TestSigAllAdmissionRefusals(t *testing.T) {
	t.Parallel()
	fx := sigAllFixture(t)
	bidder := testPrivateKey(t)
	policy := DefaultPolicy()
	valid, _, _ := buildSigAllBid(t, fx, bidder, 128)
	if err := ValidateForMempool(fx.state, Transaction{Version: TxVersion, Type: "event", Event: &valid}, policy, fx.seed); err != nil {
		t.Fatalf("a fully authorized sigall bid was refused: %v", err)
	}
	var content bidContent
	if err := decodeStrictContent(valid.Content, &content); err != nil {
		t.Fatal(err)
	}
	build := func(mutate func(*bidContent)) SignedEvent {
		clone := deepCopyBidContent(content)
		mutate(&clone)
		return testEvent(t, bidder, 1_001, KindBid, clone)
	}

	cases := map[string]struct {
		event  SignedEvent
		reason string
	}{
		"no templates": {build(func(c *bidContent) { c.OutcomeTemplates = nil }), "outcome_templates"},
		"mismatched digest": {build(func(c *bidContent) {
			c.OutcomeTemplates.Settle.Digest = strings.Repeat("b", 64)
		}), "does not match the stored deposit"},
		"deposit names another auction": {build(func(c *bidContent) { c.SigAllDeposit.AuctionID = "another-auction" }), "different auction"},
		"deposit signature does not verify": {build(func(c *bidContent) {
			c.SigAllDeposit.Signature = strings.Repeat("c", 128)
		}), "signature does not verify"},
	}
	for name, testCase := range cases {
		err := ValidateForMempool(fx.state, Transaction{Version: TxVersion, Type: "event", Event: &testCase.event}, policy, fx.seed)
		if err == nil || !strings.Contains(err.Error(), testCase.reason) {
			t.Fatalf("%s: error = %v, want one naming %q", name, err, testCase.reason)
		}
	}
}

// TestSigAllDepositRules names each of the five deposit rules the coordinator
// enforces before storing a deposit.
func TestSigAllDepositRules(t *testing.T) {
	t.Parallel()
	fx := sigAllFixture(t)
	auction := fx.state.Auctions[fx.auctionID]
	bidder := testPrivateKey(t)
	wallet := newWalletClaim(t)
	inputs, refs := sigAllInputs(t)
	receipt := sigAllLockReceipt(t, fx.committee, fx.auctionID, actorForKey(bidder), 128, refs, wallet)
	templates, _ := sigAllDeposit(t, fx.committee, fx.auctionID, actorForKey(bidder), wallet, receipt, inputs, fx.sellerKey.publicKey)

	if settle, refund, err := verifySigAllDeposit(receipt, auction, templates); err != nil {
		t.Fatalf("a valid deposit was refused: %v (settle %s refund %s)", err, settle, refund)
	}

	otherSecret := sigAllOutputSecret(t, hex.EncodeToString(testPrivateKey(t).PubKey().SerializeCompressed()))
	cases := map[string]struct {
		mutate func(*sigAllDepositTemplates)
		reason string
	}{
		"outputs do not conserve": {func(d *sigAllDepositTemplates) { d.Settle.Outputs[0].Amount = 129 }, "conserve"},
		"settle not seller key":   {func(d *sigAllDepositTemplates) { d.Settle.Outputs[0].Secret = otherSecret }, "seller payout key"},
		"refund not wallet key":   {func(d *sigAllDepositTemplates) { d.Refund.Outputs[0].Secret = otherSecret }, "wallet spend key"},
		"bidder signature": {func(d *sigAllDepositTemplates) {
			d.Settle.BidderSignature = strings.Repeat("d", 128)
		}, "does not verify"},
		"input refs": {func(d *sigAllDepositTemplates) {
			d.Refund.Inputs[0].Secret = hex.EncodeToString(testPrivateKey(t).Serialize())
		}, "input references"},
	}
	for name, testCase := range cases {
		clone := deepCopyTemplates(templates)
		testCase.mutate(&clone)
		_, _, err := verifySigAllDeposit(receipt, auction, clone)
		if err == nil || !strings.Contains(err.Error(), testCase.reason) {
			t.Fatalf("%s: error = %v, want one naming %q", name, err, testCase.reason)
		}
	}
}

// TestCashuLockModeIsUnaffected is the regression pin: the additive SIG_ALL
// work leaves cashu_lock_v1 unchanged -- the receipt records no mode, and the
// wallet-spend-key authorizations are still required at admission.
func TestCashuLockModeIsUnaffected(t *testing.T) {
	t.Parallel()
	state, seed, committee := cashuLockFixture(t)
	bidder := testPrivateKey(t)
	policy := DefaultPolicy()
	refs := testProofRefs(t, testPrivateKey(t))
	wallet := newWalletClaim(t)
	receipt := outcomeReceipt(t, committee, "mint-backed", actorForKey(bidder), 120, "op-plain", strings.Repeat("a", 64), 1_700, refs, wallet.key)
	if receipt.FundingMode != "" {
		t.Fatalf("a cashu_lock_v1 receipt recorded a funding mode %q", receipt.FundingMode)
	}
	// No outcome authorizations: still refused, exactly as before wave 1.
	plain := testEvent(t, bidder, 1_001, KindBid, bidContent{AuctionID: "mint-backed", Amount: 120, CashuLock: &receipt})
	if err := ValidateForMempool(state, Transaction{Version: TxVersion, Type: "event", Event: &plain}, policy, seed); err == nil ||
		!strings.Contains(err.Error(), "outcome authorizations") {
		t.Fatalf("cashu_lock_v1 admission error = %v, want the authorization rule", err)
	}
	// With them, it commits and stores no sigall deposit id.
	authorized := authorizedBidEvent(t, committee, bidder, "mint-backed", 120, 1_001, "op-plain", strings.Repeat("a", 64), refs, wallet)
	next, err := ApplyTransaction(state, Transaction{Version: TxVersion, Type: "event", Event: &authorized}, 1_001, policy, seed)
	if err != nil {
		t.Fatalf("authorized cashu_lock_v1 bid: %v", err)
	}
	if next.Bids[authorized.ID].SigAllDepositID != "" {
		t.Fatal("a cashu_lock_v1 bid recorded a sigall deposit id")
	}
	if next.Locks[authorized.ID].SigAllDepositID != "" {
		t.Fatal("a cashu_lock_v1 lock recorded a sigall deposit id")
	}
}

// TestCommitteeSignerPort pins the single-key implementation behind the FROST
// seam: the public key is the compressed committee key and a digest signature
// verifies under it.
func TestCommitteeSignerPort(t *testing.T) {
	t.Parallel()
	key := testPrivateKey(t)
	signer, err := NewLocalCommitteeSigner(key)
	if err != nil {
		t.Fatal(err)
	}
	want := hex.EncodeToString(key.PubKey().SerializeCompressed())
	if signer.PublicKey() != want {
		t.Fatalf("port public key = %s, want %s", signer.PublicKey(), want)
	}
	digest := sigAllDigest(sigAllGoldenInputs, sigAllGoldenBlinded)
	signature, err := signer.SignDigest(digest[:])
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := schnorr.ParseSignature(signature)
	if err != nil {
		t.Fatal(err)
	}
	public, err := schnorr.ParsePubKey(schnorr.SerializePubKey(key.PubKey()))
	if err != nil {
		t.Fatal(err)
	}
	if !parsed.Verify(digest[:], public) {
		t.Fatal("the port signature did not verify under the committee public key")
	}
	if _, err := NewLocalCommitteeSigner(nil); err == nil {
		t.Fatal("the port accepted a nil committee key")
	}
}

// deepCopyBidContent round-trips a bid content through JSON so a mutation in one
// test case cannot leak into the shared fixture. Every field is JSON-tagged.
func deepCopyBidContent(content bidContent) bidContent {
	raw, err := json.Marshal(content)
	if err != nil {
		panic(err)
	}
	var clone bidContent
	if err := json.Unmarshal(raw, &clone); err != nil {
		panic(err)
	}
	return clone
}

// deepCopyTemplates does the same for the deposit templates.
func deepCopyTemplates(templates sigAllDepositTemplates) sigAllDepositTemplates {
	raw, err := json.Marshal(templates)
	if err != nil {
		panic(err)
	}
	var clone sigAllDepositTemplates
	if err := json.Unmarshal(raw, &clone); err != nil {
		panic(err)
	}
	return clone
}
