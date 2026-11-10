package poc

// Wave E1: the consensus core of the escrow synthesis. Every rule of the brief
// that makes a carried proof set authoritative inside consensus is pinned here
// by a named test -- the pinned keyset (rules 2 and 3), the DLEQ (rule 4), the
// sum (rule 5), the existing reuse guard (rule 6) and the open-auction/not-the-
// seller rule (rule 1). Rule 7 (the strict 2-of-2 lock) is pinned in
// slice_e_lock_test.go.
//
// The proofs these tests carry are produced by a TEST-ONLY NUT-12 prover
// (mint.proofForSecret) that uses the SAME hash_to_curve the mint and wallet use.
// The verifier under test is the production one in dleq.go; nothing here
// re-implements verification.

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"math/big"
	"sort"
	"strconv"
	"strings"
	"testing"

	"github.com/btcsuite/btcd/btcec/v2"
	"github.com/btcsuite/btcd/btcec/v2/schnorr"
)

// testPinnedMint is a mint whose per-amount signing keys the test controls, so
// it can mint proofs the pinned keyset actually verifies.
type testPinnedMint struct {
	keysetID string
	keys     map[int64]*btcec.PrivateKey
}

func newTestPinnedMint(t *testing.T, amounts ...int64) testPinnedMint {
	t.Helper()
	mint := testPinnedMint{keysetID: "00e8839167216bc1", keys: map[int64]*btcec.PrivateKey{}}
	for _, amount := range amounts {
		mint.keys[amount] = testPrivateKey(t)
	}
	return mint
}

func (mint testPinnedMint) policy(t *testing.T) Policy {
	t.Helper()
	policy := DefaultPolicy()
	policy.KeysetID = mint.keysetID
	policy.KeysetKeys = map[string]string{}
	for amount, key := range mint.keys {
		policy.KeysetKeys[strconv.FormatInt(amount, 10)] = hex.EncodeToString(key.PubKey().SerializeCompressed())
	}
	return policy
}

// proofForSecret is the TEST-ONLY NUT-12 prover: given a secret and its amount,
// it produces the (C, DLEQ) the mint would return, using the same hash_to_curve
// the verifier and the mint use. The DLEQ statement is Chaum-Pedersen: A = k*G
// and C' = k*B', proven with a Schnorr-style (e, s) over a fresh nonce.
func (mint testPinnedMint) proofForSecret(t *testing.T, amount int64, secret string) demoMintSpendProof {
	t.Helper()
	key, ok := mint.keys[amount]
	if !ok {
		t.Fatalf("test mint has no key for amount %d", amount)
	}
	curve := btcec.S256()
	order := curve.Params().N
	y, err := cashuHashToCurve(secret)
	if err != nil {
		t.Fatal(err)
	}
	Ax, Ay := key.PubKey().X(), key.PubKey().Y()

	blinding := testScalar(t)
	nonce := testScalar(t)

	// B' = Y + r*G, C = k*Y, C' = k*B' = C + r*A.
	rGx, rGy := curve.ScalarBaseMult(blinding.Bytes())
	bpx, bpy := curve.Add(y.X(), y.Y(), rGx, rGy)
	cx, cy := curve.ScalarMult(y.X(), y.Y(), key.Serialize())
	c := hex.EncodeToString(compressedPoint(cx, cy))
	cpx, cpy := curve.ScalarMult(bpx, bpy, key.Serialize())

	// R1 = p*G, R2 = p*B', e = SHA256(uncompressed(R1)||uncompressed(R2)||A||C').
	r1x, r1y := curve.ScalarBaseMult(nonce.Bytes())
	r2x, r2y := curve.ScalarMult(bpx, bpy, nonce.Bytes())
	material := uncompressedHex(r1x, r1y) + uncompressedHex(r2x, r2y) + uncompressedHex(Ax, Ay) + uncompressedHex(cpx, cpy)
	challenge := sha256.Sum256([]byte(material))
	e := new(big.Int).SetBytes(challenge[:])

	// s = p + e*k mod N.
	s := new(big.Int).Mul(e, new(big.Int).SetBytes(key.Serialize()))
	s.Add(s, nonce)
	s.Mod(s, order)

	return demoMintSpendProof{
		Amount: amount, KeysetID: mint.keysetID, Secret: secret, C: c,
		DLEQ: &MintDLEQProof{E: scalarHex(e), S: scalarHex(s), R: scalarHex(blinding)},
	}
}

func testScalar(t *testing.T) *big.Int {
	t.Helper()
	order := btcec.S256().Params().N
	for {
		buf := make([]byte, 32)
		if _, err := rand.Read(buf); err != nil {
			t.Fatal(err)
		}
		value := new(big.Int).SetBytes(buf)
		if value.Sign() > 0 && value.Cmp(order) < 0 {
			return value
		}
	}
}

func scalarHex(value *big.Int) string {
	return hex.EncodeToString(value.FillBytes(make([]byte, 32)))
}

// carriedProofFixture is a committed state holding one open cashu_lock_v1
// auction plus a mint whose keys the network pinned at genesis.
type carriedProofFixture struct {
	state     State
	seed      []byte
	committee *btcec.PrivateKey
	mint      testPinnedMint
	policy    Policy
	auctionID string
	seller    *btcec.PrivateKey
	bidder    *btcec.PrivateKey
}

func newCarriedProofFixture(t *testing.T) carriedProofFixture {
	t.Helper()
	seed := make([]byte, ed25519.SeedSize)
	seed[0] = 91
	committee := testPrivateKey(t)
	mint := newTestPinnedMint(t, 32, 64)
	policy := mint.policy(t)
	state, err := NewState("carried-proof-fixture", ed25519.NewKeyFromSeed(seed).Public().(ed25519.PublicKey),
		hex.EncodeToString(committee.PubKey().SerializeCompressed()))
	if err != nil {
		t.Fatal(err)
	}
	seller := testPrivateKey(t)
	create := testEvent(t, seller, 1_000, KindCreate, createContent{
		AuctionID: "carried-proof-auction", Title: "Carried proof item", Duration: 600,
		StartingBid: 64, FundingMode: FundingModeCashuLock,
	})
	state, err = ApplyTransaction(state, Transaction{Version: TxVersion, Type: "event", Event: &create}, 1_000, policy, seed)
	if err != nil {
		t.Fatal(err)
	}
	return carriedProofFixture{state: state, seed: seed, committee: committee, mint: mint, policy: policy,
		auctionID: "carried-proof-auction", seller: seller, bidder: testPrivateKey(t)}
}

func (fx carriedProofFixture) mintProofs(t *testing.T, amounts ...int64) ([]demoMintSpendProof, []string) {
	t.Helper()
	proofs := make([]demoMintSpendProof, 0, len(amounts))
	refs := make([]string, 0, len(amounts))
	for _, amount := range amounts {
		secret := hex.EncodeToString(testPrivateKey(t).Serialize())
		proofs = append(proofs, fx.mint.proofForSecret(t, amount, secret))
		reference, err := demoMintProofY(secret)
		if err != nil {
			t.Fatal(err)
		}
		refs = append(refs, reference)
	}
	sort.Strings(refs)
	return proofs, refs
}

// testCarriedProofReceipt is a signed cashu_lock_v1 / cashu_sigall_v1 receipt
// binding the exact proof references and an explicit refund key.
func testCarriedProofReceipt(t *testing.T, committee *btcec.PrivateKey, auctionID, bidder string, amount, locktime int64, refundKey string, refs []string, mode string) CashuLockReceipt {
	t.Helper()
	receipt := CashuLockReceipt{
		Schema: "PlebeianAuctionsPOCCashuLockV1", MintURL: CashuMintURL, AuctionID: auctionID,
		Bidder: bidder, Amount: amount, OperationID: newDemoReservationID(), TokenSHA256: strings.Repeat("a", 64),
		CommitteePublicKey: hex.EncodeToString(committee.PubKey().SerializeCompressed()),
		RefundPublicKey:    refundKey, Locktime: locktime, ProofStateRefs: refs, FundingMode: mode,
	}
	digest := cashuReceiptDigest(receipt)
	signature, err := schnorr.Sign(committee, digest[:])
	if err != nil {
		t.Fatal(err)
	}
	receipt.Signature = hex.EncodeToString(signature.Serialize())
	return receipt
}

func (fx carriedProofFixture) content(t *testing.T, actor *btcec.PrivateKey, proofs []demoMintSpendProof, refs []string, amount int64, token string) bidContent {
	t.Helper()
	auction := fx.state.Auctions[fx.auctionID]
	refundKey := hex.EncodeToString(testPrivateKey(t).PubKey().SerializeCompressed())
	receipt := testCarriedProofReceipt(t, fx.committee, fx.auctionID, actorForKey(actor), amount, auction.EndTime+100, refundKey, refs, "")
	receipt.TokenSHA256 = token
	digest := cashuReceiptDigest(receipt)
	signature, err := schnorr.Sign(fx.committee, digest[:])
	if err != nil {
		t.Fatal(err)
	}
	receipt.Signature = hex.EncodeToString(signature.Serialize())
	return bidContent{AuctionID: fx.auctionID, Amount: amount, CashuLock: &receipt, Proofs: proofs}
}

func (fx carriedProofFixture) apply(t *testing.T, actor *btcec.PrivateKey, content bidContent) (State, error) {
	t.Helper()
	event := testEvent(t, actor, 1_001, KindBid, content)
	return ApplyTransaction(fx.state, Transaction{Version: TxVersion, Type: "event", Event: &event}, 1_001, fx.policy, fx.seed)
}

// TestCarriedProofsVerifyInsideConsensus is the happy path: a bid whose proofs
// name the pinned keyset, whose DLEQ verifies and whose amounts sum to the bid
// is admitted, and the committed lock records them.
func TestCarriedProofsVerifyInsideConsensus(t *testing.T) {
	t.Parallel()
	fx := newCarriedProofFixture(t)
	proofs, refs := fx.mintProofs(t, 64, 64)
	content := fx.content(t, fx.bidder, proofs, refs, 128, strings.Repeat("a", 64))
	next, err := fx.apply(t, fx.bidder, content)
	if err != nil {
		t.Fatalf("a fully backed carried-proof bid was refused: %v", err)
	}
	// The bid committed and its lock is a live leg whose receipt is stored.
	if _, ok := next.CashuLocks[content.CashuLock.TokenSHA256]; !ok {
		t.Fatal("the carried-proof bid committed no lock receipt")
	}
	auction := next.Auctions[fx.auctionID]
	if auction.LeaderBidID == "" || auction.HighBid != 128 {
		t.Fatalf("committed leader = %q high bid = %d, want a 128 leader", auction.LeaderBidID, auction.HighBid)
	}
}

// TestSliceERule1BidMustBeOpenAndNotTheSeller pins rule 1: the proof machinery
// runs only for an open auction and a bidder who is not the seller.
func TestSliceERule1BidMustBeOpenAndNotTheSeller(t *testing.T) {
	t.Parallel()
	fx := newCarriedProofFixture(t)
	proofs, refs := fx.mintProofs(t, 64, 64)

	// The seller cannot bid on its own auction, proofs or not.
	sellerContent := fx.content(t, fx.seller, proofs, refs, 128, strings.Repeat("a", 64))
	if _, err := fx.apply(t, fx.seller, sellerContent); err == nil || !strings.Contains(err.Error(), "seller cannot bid on own auction") {
		t.Fatalf("seller self-bid error = %v, want a seller-cannot-bid refusal", err)
	}

	// A bid naming an auction that does not exist is refused before anything
	// else.
	missing := fx.content(t, fx.bidder, proofs, refs, 128, strings.Repeat("a", 64))
	missing.AuctionID = "no-such-auction"
	if _, err := fx.apply(t, fx.bidder, missing); err == nil || !strings.Contains(err.Error(), "auction is not open") {
		t.Fatalf("missing-auction error = %v, want an auction-not-open refusal", err)
	}

	// A closed auction refuses a bid even with valid proofs.
	closed, err := fx.state.Clone()
	if err != nil {
		t.Fatal(err)
	}
	closedAuction := closed.Auctions[fx.auctionID]
	closedAuction.Status = "closed"
	closed.Auctions[fx.auctionID] = closedAuction
	closedContent := fx.content(t, fx.bidder, proofs, refs, 128, strings.Repeat("a", 64))
	closedEvent := testEvent(t, fx.bidder, 1_001, KindBid, closedContent)
	if _, err := ApplyTransaction(closed, Transaction{Version: TxVersion, Type: "event", Event: &closedEvent}, 1_001, fx.policy, fx.seed); err == nil || !strings.Contains(err.Error(), "auction is not open") {
		t.Fatalf("closed-auction error = %v, want an auction-not-open refusal", err)
	}
}

// TestSliceERule2ProofMustNameThePinnedKeyset pins rule 2.
func TestSliceERule2ProofMustNameThePinnedKeyset(t *testing.T) {
	t.Parallel()
	fx := newCarriedProofFixture(t)
	proofs, refs := fx.mintProofs(t, 64, 64)

	depinned := fx.content(t, fx.bidder, proofs, refs, 128, strings.Repeat("a", 64))
	depinned.Proofs[0].KeysetID = "deadbeefdeadbeef"
	if _, err := fx.apply(t, fx.bidder, depinned); err == nil || !strings.Contains(err.Error(), "proof from unpinned keyset") {
		t.Fatalf("unpinned-keyset proof error = %v, want one naming the unpinned keyset", err)
	}

	// A network that pinned no keyset at all refuses every carried proof.
	unpinned := fx
	unpinned.policy = DefaultPolicy()
	content := fx.content(t, fx.bidder, proofs, refs, 128, strings.Repeat("a", 64))
	event := testEvent(t, fx.bidder, 1_001, KindBid, content)
	if _, err := ApplyTransaction(unpinned.state, Transaction{Version: TxVersion, Type: "event", Event: &event}, 1_001, unpinned.policy, unpinned.seed); err == nil || !strings.Contains(err.Error(), "proof from unpinned keyset") {
		t.Fatalf("unpinned-network error = %v, want one naming the unpinned keyset", err)
	}
}

// TestSliceERule3ProofAmountMustHaveAPinnedKey pins rule 3.
func TestSliceERule3ProofAmountMustHaveAPinnedKey(t *testing.T) {
	t.Parallel()
	fx := newCarriedProofFixture(t)
	proofs, refs := fx.mintProofs(t, 64, 64)
	content := fx.content(t, fx.bidder, proofs, refs, 128, strings.Repeat("a", 64))
	content.Proofs[0].Amount = 5
	if _, err := fx.apply(t, fx.bidder, content); err == nil || !strings.Contains(err.Error(), "bad proof amount") {
		t.Fatalf("unpinned-amount error = %v, want a bad-proof-amount refusal", err)
	}
}

// TestSliceERule4DLEQMustVerifyAgainstThePinnedKey pins rule 4, including the
// case where the proof names the right keyset and amount but its DLEQ belongs to
// a different mint key.
func TestSliceERule4DLEQMustVerifyAgainstThePinnedKey(t *testing.T) {
	t.Parallel()
	fx := newCarriedProofFixture(t)
	proofs, refs := fx.mintProofs(t, 64, 64)

	tampered := fx.content(t, fx.bidder, proofs, refs, 128, strings.Repeat("a", 64))
	tampered.Proofs[0].DLEQ.S = strings.Repeat("0", 64)
	if _, err := fx.apply(t, fx.bidder, tampered); err == nil || !strings.Contains(err.Error(), "DLEQ") {
		t.Fatalf("tampered-DLEQ error = %v, want a DLEQ refusal", err)
	}

	// A proof minted by a DIFFERENT key the network did not pin: same keyset id
	// and amount, so only the DLEQ check can catch it.
	other := newTestPinnedMint(t, 64)
	forged := fx.content(t, fx.bidder, proofs, refs, 128, strings.Repeat("a", 64))
	forged.Proofs[0] = other.proofForSecret(t, 64, proofs[0].Secret)
	if _, err := fx.apply(t, fx.bidder, forged); err == nil || !strings.Contains(err.Error(), "DLEQ") {
		t.Fatalf("foreign-key DLEQ error = %v, want a DLEQ refusal", err)
	}
}

// TestSliceERule5ProofAmountsMustSumToTheBid pins rule 5, naming both totals.
func TestSliceERule5ProofAmountsMustSumToTheBid(t *testing.T) {
	t.Parallel()
	fx := newCarriedProofFixture(t)
	proofs, refs := fx.mintProofs(t, 64, 64)
	content := fx.content(t, fx.bidder, proofs, refs, 128, strings.Repeat("a", 64))
	// Drop one proof: the sum is now 64 against a claimed 128.
	content.Proofs = content.Proofs[:1]
	_, err := fx.apply(t, fx.bidder, content)
	if err == nil || !strings.Contains(err.Error(), "sum to 64") || !strings.Contains(err.Error(), "claims 128") {
		t.Fatalf("amount-sum error = %v, want one naming both totals", err)
	}
}

// TestSliceERule6ReusedProofReferenceIsRefused pins rule 6: the existing reuse
// guard, reached through the proof set because the proofs must be exactly the
// receipt's committed references. A second bid reusing the same references is
// refused even though its token digest differs.
func TestSliceERule6ReusedProofReferenceIsRefused(t *testing.T) {
	t.Parallel()
	fx := newCarriedProofFixture(t)
	proofs, refs := fx.mintProofs(t, 64, 64)
	first := fx.content(t, fx.bidder, proofs, refs, 128, strings.Repeat("a", 64))
	committed, err := fx.apply(t, fx.bidder, first)
	if err != nil {
		t.Fatalf("the first carried-proof bid was refused: %v", err)
	}
	// A different bidder, a different token, a larger bid that clears the
	// increment, and the SAME proof references among its proofs. The reuse guard
	// must refuse it on the reference, not on the amount.
	fresh, freshRefs := fx.mintProofs(t, 64, 64)
	reused := append(append([]demoMintSpendProof(nil), proofs...), fresh...)
	allRefs := append(append([]string(nil), refs...), freshRefs...)
	sort.Strings(allRefs)
	other := testPrivateKey(t)
	second := fx.content(t, other, reused, allRefs, 256, strings.Repeat("b", 64))
	event := testEvent(t, other, 1_002, KindBid, second)
	if _, err := ApplyTransaction(committed, Transaction{Version: TxVersion, Type: "event", Event: &event}, 1_002, fx.policy, fx.seed); err == nil || !strings.Contains(err.Error(), "already committed to another bid") {
		t.Fatalf("reused-proof error = %v, want an already-committed refusal", err)
	}
}

// TestCarriedProofsMustBeTheReceiptReferences pins the binding between the
// carried proofs and the lock receipt: a proof set that is not exactly the
// receipt's references is refused, so the reuse guard cannot be bypassed by
// carrying refs the receipt never committed.
func TestCarriedProofsMustBeTheReceiptReferences(t *testing.T) {
	t.Parallel()
	fx := newCarriedProofFixture(t)
	proofs, refs := fx.mintProofs(t, 64, 64)
	content := fx.content(t, fx.bidder, proofs, refs, 128, strings.Repeat("a", 64))
	// Point the receipt at a different, unused reference set.
	extraProofs, extraRefs := fx.mintProofs(t, 64)
	_ = extraProofs
	content.CashuLock.ProofStateRefs = append(append([]string(nil), refs...), extraRefs...)
	sort.Strings(content.CashuLock.ProofStateRefs)
	if _, err := fx.apply(t, fx.bidder, content); err == nil {
		t.Fatal("a proof set that is not the receipt's references was accepted")
	}
}

// TestBidWithoutProofsIsRefused is the inverse of the old back-compat guard:
// the field is MANDATORY, so a mint-backed bid that carries only references --
// no proofs for consensus to re-derive -- is refused by name. There is no
// proofs-less shape that is admitted, legacy or otherwise.
func TestBidWithoutProofsIsRefused(t *testing.T) {
	t.Parallel()
	fx := newCarriedProofFixture(t)
	_, refs := fx.mintProofs(t, 64, 64)
	auction := fx.state.Auctions[fx.auctionID]
	refundKey := hex.EncodeToString(testPrivateKey(t).PubKey().SerializeCompressed())
	receipt := testCarriedProofReceipt(t, fx.committee, fx.auctionID, actorForKey(fx.bidder), 128, auction.EndTime+100, refundKey, refs, "")
	content := bidContent{AuctionID: fx.auctionID, Amount: 128, CashuLock: &receipt}
	_, err := fx.apply(t, fx.bidder, content)
	if err == nil {
		t.Fatal("a proof-less mint-backed bid was admitted; the proofs must be mandatory")
	}
	if !strings.Contains(err.Error(), "mint-backed bid carries no proofs") {
		t.Fatalf("proof-less bid error = %v, want a refusal naming the missing proofs", err)
	}
}

// TestPolicyPinnedKeysetRoundTrips pins keysetKeyForAmount and the genesis
// validation of the pinned identity.
func TestPolicyPinnedKeysetRoundTrips(t *testing.T) {
	t.Parallel()
	mint := newTestPinnedMint(t, 32, 64)
	policy := mint.policy(t)
	if err := policy.Validate(); err != nil {
		t.Fatalf("a fully pinned policy failed validation: %v", err)
	}
	if key, ok := policy.keysetKeyForAmount(64); !ok || key != policy.KeysetKeys["64"] {
		t.Fatalf("keysetKeyForAmount(64) = %q,%v", key, ok)
	}
	if _, ok := policy.keysetKeyForAmount(5); ok {
		t.Fatal("keysetKeyForAmount returned a key for an unpublished amount")
	}
	// Half a keyset is not a keyset.
	half := policy
	half.KeysetKeys = nil
	if err := half.Validate(); err == nil {
		t.Fatal("a keyset id with no keys validated")
	}
	// DefaultPolicy pins nothing and must remain valid.
	if err := DefaultPolicy().Validate(); err != nil {
		t.Fatalf("DefaultPolicy is invalid: %v", err)
	}
}
