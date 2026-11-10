package poc

// Wave E1, genesis plumbing: the pinned mint keyset must be written into the
// network manifest at genesis and read back by every validator, so consensus
// has the exact keys a carried proof is checked against and never a fetched or
// guessed one.

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestInitNetworkPinsMintKeysetAtGenesis is the genesis plumbing proof: a
// network initialized with a pinned keyset carries it through the manifest and
// back on load.
func TestInitNetworkPinsMintKeysetAtGenesis(t *testing.T) {
	t.Parallel()
	mint := newTestPinnedMint(t, 32, 64)
	policy := mint.policy(t)
	root := filepath.Join(t.TempDir(), "network")
	if _, err := InitLocalNetwork(root, policy); err != nil {
		t.Fatal(err)
	}
	loaded, err := LoadNetworkManifest(root)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Policy.KeysetID != policy.KeysetID {
		t.Fatalf("manifest keyset id = %q, want %q", loaded.Policy.KeysetID, policy.KeysetID)
	}
	if !loaded.Policy.Equal(policy) {
		t.Fatalf("loaded policy = %+v, want the pinned policy %+v", loaded.Policy, policy)
	}
	if key, ok := loaded.Policy.keysetKeyForAmount(64); !ok || key != policy.KeysetKeys["64"] {
		t.Fatalf("loaded keysetKeyForAmount(64) = %q,%v", key, ok)
	}
}

// TestInitNetworkRejectsAHalfPinnedKeyset pins the fail-closed genesis rule: a
// keyset id with no keys (or keys with no id) never starts a network.
func TestInitNetworkRejectsAHalfPinnedKeyset(t *testing.T) {
	t.Parallel()
	policy := DefaultPolicy()
	policy.KeysetID = "00e8839167216bc1"
	root := filepath.Join(t.TempDir(), "network")
	if _, err := InitLocalNetwork(root, policy); err == nil {
		t.Fatal("InitLocalNetwork accepted a keyset id with no keys")
	}
	if _, err := os.Stat(root); !os.IsNotExist(err) {
		t.Fatalf("a rejected init wrote output: %v", err)
	}
}

// TestLoadKeysetKeysFile pins the operator input path: a JSON object of amount
// to compressed key, and a refusal for everything else.
func TestLoadKeysetKeysFile(t *testing.T) {
	t.Parallel()
	mint := newTestPinnedMint(t, 64)
	key := mint.policy(t).KeysetKeys["64"]

	valid := filepath.Join(t.TempDir(), "keyset.json")
	if err := os.WriteFile(valid, []byte(`{"64":"`+key+`"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	keys, err := loadKeysetKeysFile(valid)
	if err != nil {
		t.Fatal(err)
	}
	if keys["64"] != key {
		t.Fatalf("loaded key = %q, want %q", keys["64"], key)
	}

	for name, body := range map[string]string{
		"empty object":  `{}`,
		"not an object": `[]`,
		"trailing junk": `{"64":"` + key + `"} extra`,
	} {
		path := filepath.Join(t.TempDir(), "keyset.json")
		if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
		if _, err := loadKeysetKeysFile(path); err == nil {
			t.Fatalf("%s: loadKeysetKeysFile accepted it", name)
		}
	}
	if _, err := loadKeysetKeysFile(filepath.Join(t.TempDir(), "missing.json")); err == nil {
		t.Fatal("loadKeysetKeysFile accepted a missing file")
	}
}

// TestPinnedKeysetAcceptsAmountsBeyondInt64 pins the fix for the real-mint
// genesis input: a standard Cashu mint's /keys object carries the amount 2^63
// as its top entry, which does not fit an int64. The keyset id and keys must
// both come from that object, so the validation must accept a positive decimal
// amount of any width rather than failing the init. The amount is recorded but
// is unreachable through keysetKeyForAmount (a proof amount is an int64), which
// is unchanged.
func TestPinnedKeysetAcceptsAmountsBeyondInt64(t *testing.T) {
	t.Parallel()
	mint := newTestPinnedMint(t, 64)
	key := mint.policy(t).KeysetKeys["64"]
	policy := mint.policy(t)
	policy.KeysetKeys["9223372036854775808"] = key // 2^63, the mint's top amount

	if err := policy.Validate(); err != nil {
		t.Fatalf("a keyset carrying the mint's own 2^63 amount was refused: %v", err)
	}
	if _, ok := policy.keysetKeyForAmount(64); !ok {
		t.Fatal("a representable amount stopped resolving once 2^63 was present")
	}

	// The operator input path (the mint's /keys object) must round-trip too.
	body, err := json.Marshal(policy.KeysetKeys)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "keyset.json")
	if err := os.WriteFile(path, body, 0o600); err != nil {
		t.Fatal(err)
	}
	keys, err := loadKeysetKeysFile(path)
	if err != nil {
		t.Fatalf("loadKeysetKeysFile refused the mint's own /keys object: %v", err)
	}
	if keys["9223372036854775808"] != key {
		t.Fatalf("the 2^63 key did not round-trip: %q", keys["9223372036854775808"])
	}

	// Shape refusals are unchanged: non-positive or non-decimal amounts still
	// fail closed.
	for _, bad := range []string{"0", "-64", "", "6.4", "64x", "-0"} {
		broken := mint.policy(t)
		broken.KeysetKeys[bad] = key
		if err := broken.Validate(); err == nil {
			t.Fatalf("a pinned keyset accepted the amount %q", bad)
		}
	}
}

// TestPinnedPolicyJSONOmitsWhenUnpinned pins the omitempty contract: an
// unpinned policy serializes byte-identically to the pre-existing shape, and a
// pinned one round-trips.
func TestPinnedPolicyJSONOmitsWhenUnpinned(t *testing.T) {
	t.Parallel()
	raw, err := json.Marshal(DefaultPolicy())
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "keyset") {
		t.Fatalf("an unpinned policy emitted a keyset field: %s", raw)
	}

	mint := newTestPinnedMint(t, 32, 64)
	policy := mint.policy(t)
	raw, err = json.Marshal(policy)
	if err != nil {
		t.Fatal(err)
	}
	var back Policy
	if err := json.Unmarshal(raw, &back); err != nil {
		t.Fatal(err)
	}
	if !policy.Equal(back) {
		t.Fatalf("pinned policy did not round-trip: %s", raw)
	}
}
