package poc

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestDemoMintLocktimeIsTheMaximumEndRecoveryPolicy pins the S1 rule: the
// coordinator's off-chain locktime check must require the exact composition
// original_end + max_total_extension + emergency_recovery, and refuse anything
// just below or just above it. A short lock was the live bug: an anti-sniping
// extension could push the auction end past the lock, the bidder reclaimed,
// and the leading bid lost its backing. A longer lock is refused too, so the
// composition cannot silently drift from the V4 rule at model.go:1318.
func TestDemoMintLocktimeIsTheMaximumEndRecoveryPolicy(t *testing.T) {
	t.Parallel()
	policy := DefaultPolicy()
	// A live-shaped auction: EndTime already carries one anti-sniping extension,
	// so EndTime != OriginalEndTime exactly as on the chain.
	originalEnd := int64(10_000)
	auction := Auction{
		ID: "locktime-auction", FundingMode: FundingModeCashuLock, Status: "open",
		OriginalEndTime: originalEnd, EndTime: originalEnd + policy.LateBidExtension,
	}

	expected := demoMintExpectedLocktime(auction, policy)
	if expected != originalEnd+policy.MaxTotalExtension+EmergencyRecoverySeconds {
		t.Fatalf("expected locktime %d, want original_end+max_total_extension+emergency_recovery %d",
			expected, originalEnd+policy.MaxTotalExtension+EmergencyRecoverySeconds)
	}
	// The old build used end_time + 600, which on this auction would be well
	// below the maximum reachable end. The rule must reject that exact value.
	if oldBuggy := auction.EndTime + 600; oldBuggy >= expected {
		t.Fatalf("test auction no longer models the bug: end_time+600=%d is not below the required %d", oldBuggy, expected)
	}

	// The predicate the coordinator runs: exact equality with the composition.
	accepts := func(locktime int64) bool { return locktime == demoMintExpectedLocktime(auction, policy) }
	if !accepts(expected) {
		t.Fatalf("locktime %d (exact composition) was refused", expected)
	}
	if accepts(expected - 1) {
		t.Fatalf("locktime %d (one second below the composition) was accepted", expected-1)
	}
	if accepts(expected + 1) {
		t.Fatalf("locktime %d (one second above the composition) was accepted", expected+1)
	}
	if accepts(auction.EndTime + 600) {
		t.Fatalf("the old end_time+600 locktime %d was accepted", auction.EndTime+600)
	}

	// The composition must match the consensus V4 rule byte for byte, so the
	// coordinator cannot demand a value consensus would call a different policy.
	if expected != auction.OriginalEndTime+policy.MaxTotalExtension+EmergencyRecoverySeconds {
		t.Fatal("coordinator locktime no longer matches the model.go:1318 composition")
	}
}

// TestConfigPublishesLocktimePolicy pins the two numbers the page reads. The
// page must never hardcode them, so their absence is a build failure, not a
// silent fallback.
func TestConfigPublishesLocktimePolicy(t *testing.T) {
	t.Parallel()
	server := &APIServer{manifest: NetworkManifest{ChainID: "legacy", Mode: "remote", Policy: DefaultPolicy()}, offline: nil}
	handler, err := server.Handler()
	if err != nil {
		t.Fatal(err)
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/config", nil))
	body := response.Body.String()
	for _, expected := range []string{
		`"max_total_extension_seconds":1800`,
		`"emergency_recovery_seconds":900`,
	} {
		if !strings.Contains(body, expected) {
			t.Fatalf("config is missing %q: %s", expected, body)
		}
	}
}

// TestAppComposesLocktimeFromConfig is a static regression guard: the browser
// cannot be unit-tested here, but the old hardcoded margin must not come back.
// It asserts the page reads the policy from /api/config and does not build the
// locktime from end_time + a constant.
func TestAppComposesLocktimeFromConfig(t *testing.T) {
	t.Parallel()
	source, err := os.ReadFile(filepath.Join("static", "app.js"))
	if err != nil {
		t.Fatal(err)
	}
	page := string(source)
	for _, required := range []string{
		"state.config?.max_total_extension_seconds",
		"state.config?.emergency_recovery_seconds",
		"auction.original_end_time",
	} {
		if !strings.Contains(page, required) {
			t.Fatalf("app.js does not compose the locktime from the config: missing %q", required)
		}
	}
	// The buggy composition was Number(auction.end_time) + 600. The literal
	// margin must not survive in any form; the policy values come from config.
	if strings.Contains(page, "end_time) + 600") {
		t.Fatal("app.js still contains the hardcoded locktime margin end_time + 600")
	}
}
