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
