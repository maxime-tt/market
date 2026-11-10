package poc

// Wave E3: after the carried proofs became MANDATORY for every mint-backed bid
// (verifyBidProofs no longer returns early on an empty proof set), every test
// that commits a mint-backed bid must carry a real, pinned-keyset proof set --
// a bid with references but no proofs is now refused by name. These helpers
// mint that set for the fixtures.
//
// The per-amount mint key is DETERMINISTIC, so a test can pin a keyset
// (backedPolicy) and mint proofs that verify against it (backedProofs) without
// threading a fixture object between the two.

import (
	"crypto/sha256"
	"encoding/hex"
	"sort"
	"strconv"
	"testing"

	"github.com/btcsuite/btcd/btcec/v2"
)

// testBackingKeysetID is the keyset id every mint-backed test proof names. It
// matches the fake swap mint's keyset so the refund/settle request bodies the
// fixtures hand back stay consistent with the committed receipt.
const testBackingKeysetID = "00e8839167216bc1"

// testBackingKey derives a deterministic per-amount mint signing key. The same
// amount always yields the same key, so the policy and the prover agree.
func testBackingKey(amount int64) *btcec.PrivateKey {
	material := sha256.Sum256([]byte("poc-test-backing-key-v1|" + strconv.FormatInt(amount, 10)))
	key, _ := btcec.PrivKeyFromBytes(material[:])
	return key
}

// backedPolicy pins exactly the requested amounts' mint keys, so a proof set
// from backedProofs names this keyset and verifies its DLEQ. With no amounts it
// pins nothing and behaves like DefaultPolicy (for tests that carry no proofs,
// e.g. custodial or reservation bids).
func backedPolicy(amounts ...int64) Policy {
	policy := DefaultPolicy()
	if len(amounts) == 0 {
		return policy
	}
	policy.KeysetID = testBackingKeysetID
	policy.KeysetKeys = map[string]string{}
	for _, amount := range amounts {
		policy.KeysetKeys[strconv.FormatInt(amount, 10)] = hex.EncodeToString(testBackingKey(amount).PubKey().SerializeCompressed())
	}
	return policy
}

// backedProofs mints one real NUT-12 proof per amount, each with a fresh secret,
// and returns them with their canonical (sorted) references. A bid that carries
// these proofs must be applied under backedPolicy(amounts...).
func backedProofs(t *testing.T, amounts ...int64) ([]demoMintSpendProof, []string) {
	t.Helper()
	proofs := make([]demoMintSpendProof, 0, len(amounts))
	refs := make([]string, 0, len(amounts))
	for _, amount := range amounts {
		secret := newTestProofSecret(t)
		mint := testPinnedMint{keysetID: testBackingKeysetID, keys: map[int64]*btcec.PrivateKey{amount: testBackingKey(amount)}}
		proofs = append(proofs, mint.proofForSecret(t, amount, secret))
		reference, err := demoMintProofY(secret)
		if err != nil {
			t.Fatal(err)
		}
		refs = append(refs, reference)
	}
	sort.Strings(refs)
	return proofs, refs
}

// newTestProofSecret is the bearer secret of a test proof: a fresh scalar, so
// its hash_to_curve reference cannot collide with any other proof's.
func newTestProofSecret(t *testing.T) string {
	t.Helper()
	return hex.EncodeToString(testPrivateKey(t).Serialize())
}

// secretsOf and amountsOf read the fields the refund/settle fixtures hand back
// to their callers so the request-body proofs keep the same distinct secrets.
func secretsOf(proofs []demoMintSpendProof) []string {
	secrets := make([]string, len(proofs))
	for index, proof := range proofs {
		secrets[index] = proof.Secret
	}
	return secrets
}

func amountsOf(proofs []demoMintSpendProof) []int64 {
	amounts := make([]int64, len(proofs))
	for index, proof := range proofs {
		amounts[index] = proof.Amount
	}
	return amounts
}

// policyPinningBidProofs builds the pinned policy a bid's own proofs need, read
// straight from the event content, so a generic apply helper can pin the right
// keyset without the caller threading one.
func policyPinningBidProofs(t *testing.T, event SignedEvent) Policy {
	t.Helper()
	var content bidContent
	if err := decodeStrictContent(event.Content, &content); err != nil {
		t.Fatalf("decode bid content: %v", err)
	}
	return backedPolicy(amountsOf(content.Proofs)...)
}
