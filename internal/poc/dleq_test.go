package poc

import (
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"testing"

	"github.com/btcsuite/btcd/btcec/v2"
)

// dleqVector is a REAL NUT-12 vector captured from the running Nutshell 0.19.2
// mint: two proofs (64 and 32 sats) with the DLEQ proofs the mint returned, plus
// the published per-amount keys from /v1/keys. Testing against genuine mint
// output rather than a self-consistent construction is the whole point -- a
// verifier that only agrees with itself proves nothing.
//
// Regenerate with webwallet: mint 96 sats, then emit each proof's amount, id, Y,
// C and dleq{e,s,r} alongside the keyset's key for that amount.
type dleqVector struct {
	Mint     string            `json:"mint"`
	KeysetID string            `json:"keyset_id"`
	Keys     map[string]string `json:"keys"`
	Bindings []MintProofBinding `json:"bindings"`
}

func loadDLEQVector(t *testing.T) (dleqVector, *MintKeySet) {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", "dleq-vector.json"))
	if err != nil {
		t.Fatal(err)
	}
	var vector dleqVector
	if err := json.Unmarshal(raw, &vector); err != nil {
		t.Fatal(err)
	}
	keyset := &MintKeySet{ID: vector.KeysetID, Unit: "sat", Keys: map[int64]*btcec.PublicKey{}}
	for amount, encoded := range vector.Keys {
		decoded, err := hex.DecodeString(encoded)
		if err != nil {
			t.Fatalf("keyset key %s: %v", amount, err)
		}
		key, err := btcec.ParsePubKey(decoded)
		if err != nil {
			t.Fatalf("keyset key %s: %v", amount, err)
		}
		value, err := strconv.ParseInt(amount, 10, 64)
		if err != nil {
			t.Fatalf("keyset amount %q: %v", amount, err)
		}
		keyset.Keys[value] = key
	}
	return vector, keyset
}

func TestRealMintDLEQVerifies(t *testing.T) {
	t.Parallel()
	vector, keyset := loadDLEQVector(t)
	if len(vector.Bindings) < 2 {
		t.Fatalf("vector carries %d bindings, want at least 2", len(vector.Bindings))
	}
	for index, binding := range vector.Bindings {
		if err := VerifyProofBinding(binding, keyset); err != nil {
			t.Fatalf("real mint binding %d (amount %d) failed verification: %v", index, binding.Amount, err)
		}
	}
	// And the bundle is worth exactly what the proofs say it is.
	total, err := VerifiedBacking(vector.Bindings, keyset)
	if err != nil {
		t.Fatalf("VerifiedBacking: %v", err)
	}
	var expected int64
	for _, binding := range vector.Bindings {
		expected += binding.Amount
	}
	if total != expected || total != 96 {
		t.Fatalf("verified backing = %d, want %d (96)", total, expected)
	}
}

func TestDLEQRejectsEveryTamperedVariant(t *testing.T) {
	t.Parallel()
	clone := func(bindings []MintProofBinding) []MintProofBinding {
		copied := make([]MintProofBinding, len(bindings))
		copy(copied, bindings)
		for index := range copied {
			proof := *copied[index].DLEQ
			copied[index].DLEQ = &proof
		}
		return copied
	}
	fresh := func(t *testing.T) ([]MintProofBinding, *MintKeySet) {
		vector, keys := loadDLEQVector(t)
		return clone(vector.Bindings), keys
	}

	// A proof relabelled as a larger amount must fail. This is the claim the
	// whole mechanism exists to protect: you cannot assert value you do not hold.
	if bindings, keys := fresh(t); true {
		bindings[0].Amount = 128
		if _, err := VerifiedBacking(bindings, keys); err == nil {
			t.Fatal("a proof relabelled to a larger amount verified")
		}
	}

	// A dampened C is a proof the mint never signed.
	if bindings, keys := fresh(t); true {
		original := bindings[0].C
		flipped := "03" + original[2:]
		if flipped == original {
			flipped = "02" + original[2:]
		}
		bindings[0].C = flipped
		if err := VerifyProofBinding(bindings[0], keys); err == nil {
			t.Fatal("a tampered C verified")
		}
	}

	// A tampered response scalar.
	if bindings, keys := fresh(t); true {
		bindings[0].DLEQ.S = "00" + bindings[0].DLEQ.S[2:]
		if err := VerifyProofBinding(bindings[0], keys); err == nil {
			t.Fatal("a tampered DLEQ scalar verified")
		}
	}

	// A tampered challenge.
	if bindings, keys := fresh(t); true {
		bindings[0].DLEQ.E = "00" + bindings[0].DLEQ.E[2:]
		if err := VerifyProofBinding(bindings[0], keys); err == nil {
			t.Fatal("a tampered DLEQ challenge verified")
		}
	}

	// Proofs whose Y and DLEQ belong to different amounts.
	if bindings, keys := fresh(t); true {
		bindings[0].Y, bindings[1].Y = bindings[1].Y, bindings[0].Y
		if err := VerifyProofBinding(bindings[0], keys); err == nil {
			t.Fatal("a mismatched Y verified")
		}
	}

	// An unknown keyset, an unpublished amount, and a missing proof.
	if bindings, keys := fresh(t); true {
		bindings[0].KeysetID = "deadbeefdeadbeef"
		if err := VerifyProofBinding(bindings[0], keys); err == nil {
			t.Fatal("an unknown keyset verified")
		}
	}
	if bindings, keys := fresh(t); true {
		bindings[0].Amount = 5
		if err := VerifyProofBinding(bindings[0], keys); err == nil {
			t.Fatal("an unpublished amount verified")
		}
	}
	if bindings, keys := fresh(t); true {
		bindings[0].DLEQ = nil
		if err := VerifyProofBinding(bindings[0], keys); err == nil {
			t.Fatal("a binding with no DLEQ verified")
		}
	}

	// A nil keyset must be a refusal, never a pass.
	if bindings, _ := fresh(t); true {
		if err := VerifyProofBinding(bindings[0], nil); err == nil {
			t.Fatal("a nil keyset was treated as a pass")
		}
	}
}

// A proof reference that is well formed but was never issued cannot be dressed
// up with a DLEQ, because producing one requires the mint's signature on it.
// This is the property that makes DLEQ strictly stronger than the NUT-07 check
// it replaces.
func TestDLEQCannotBeForgedForAnUnissuedPoint(t *testing.T) {
	t.Parallel()
	vector, keyset := loadDLEQVector(t)

	forged := vector.Bindings[0]
	// Keep the mint's real signature and DLEQ, but point them at a different,
	// never-issued Y.
	other := testPrivateKey(t)
	forged.Y = hex.EncodeToString(other.PubKey().SerializeCompressed())
	if err := VerifyProofBinding(forged, keyset); err == nil {
		t.Fatal("a DLEQ verified against a Y it was not issued for")
	}
}
