package poc

import (
	"crypto/ed25519"
	"encoding/hex"
	"sort"
	"strings"
	"testing"

	"github.com/btcsuite/btcd/btcec/v2"
	"github.com/btcsuite/btcd/btcec/v2/schnorr"
)

// sigAllTestKeyset is a placeholder keyset id for the lock receipt's proof
// references. The coordinator only requires it to be non-empty.
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

// sigAllProofRefs builds the two committed NUT-07 references (sorted) the lock
// receipt binds.
func sigAllProofRefs(t *testing.T) []string {
	t.Helper()
	refs := make([]string, 0, 2)
	for index := 0; index < 2; index++ {
		secret := hex.EncodeToString(testPrivateKey(t).Serialize())
		reference, err := demoMintProofY(secret)
		if err != nil {
			t.Fatal(err)
		}
		refs = append(refs, reference)
	}
	sort.Strings(refs)
	return refs
}

// buildSigAllBid returns a committed cashu_sigall_v1 bid plus the lock receipt
// it commits. The bid carries the lock and, when a pinned mint policy is in
// play, its own proofs; here the lock alone is enough to exercise admission.
func buildSigAllBid(t *testing.T, fx sigAllFixtureState, bidder *btcec.PrivateKey, amount int64) (SignedEvent, CashuLockReceipt) {
	t.Helper()
	wallet := newWalletClaim(t)
	refs := sigAllProofRefs(t)
	receipt := sigAllLockReceipt(t, fx.committee, fx.auctionID, actorForKey(bidder), amount, refs, wallet)
	content := bidContent{AuctionID: fx.auctionID, Amount: amount, CashuLock: &receipt}
	return testEvent(t, bidder, 1_001, KindBid, content), receipt
}

// TestSigAllReceiptCommitsTwoKeyConditionAndMode pins the wave-1 receipt shape:
// a cashu_sigall_v1 lock commits with both the committee key and the wallet
// spend key recorded, and with the funding mode recorded.
func TestSigAllReceiptCommitsTwoKeyConditionAndMode(t *testing.T) {
	t.Parallel()
	fx := sigAllFixture(t)
	bidder := testPrivateKey(t)
	event, _ := buildSigAllBid(t, fx, bidder, 128)

	next, err := ApplyTransaction(fx.state, Transaction{Version: TxVersion, Type: "event", Event: &event}, 1_001, DefaultPolicy(), fx.seed)
	if err != nil {
		t.Fatalf("valid sigall bid: %v", err)
	}
	bid := next.Bids[event.ID]
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
	// With them, it commits.
	authorized := authorizedBidEvent(t, committee, bidder, "mint-backed", 120, 1_001, "op-plain", strings.Repeat("a", 64), refs, wallet)
	if _, err := ApplyTransaction(state, Transaction{Version: TxVersion, Type: "event", Event: &authorized}, 1_001, policy, seed); err != nil {
		t.Fatalf("authorized cashu_lock_v1 bid: %v", err)
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
