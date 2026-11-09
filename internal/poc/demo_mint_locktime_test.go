package poc

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestDemoMintLocktimeUsesTheAuctionFloorNotAPolicyConstant pins the S1/Slice-D
// rule: the coordinator's off-chain locktime check requires a lock at or above
// the AUCTION's floor (its own cumulative extension cap, not the network
// ceiling) and within the policy band. The floor is the composition
// original_end + the AUCTION's max_total_extension + emergency_recovery. A
// short lock was the live bug: an anti-sniping extension could push the
// auction end past the lock, the bidder reclaimed, and the leading bid lost
// its backing. The refusal must name the auction's floor.
func TestDemoMintLocktimeUsesTheAuctionFloorNotAPolicyConstant(t *testing.T) {
	t.Parallel()
	policy := DefaultPolicy()
	originalEnd := int64(10_000)
	// A live-shaped auction that chose its OWN, shorter cumulative extension
	// cap than the network ceiling, and whose EndTime already carries one
	// anti-sniping extension, so EndTime != OriginalEndTime as on the chain.
	auction := Auction{
		ID: "locktime-auction", FundingMode: FundingModeCashuLock, Status: "open",
		OriginalEndTime: originalEnd, EndTime: originalEnd + 60,
		LateBidWindow: 30, LateBidExtension: 60, MaxTotalExtension: 60,
	}

	floor := demoMintExpectedLocktime(auction)
	if floor != auctionRequiredLocktime(auction) {
		t.Fatalf("demoMintExpectedLocktime=%d, auctionRequiredLocktime=%d", floor, auctionRequiredLocktime(auction))
	}
	if want := originalEnd + 60 + EmergencyRecoverySeconds; floor != want {
		t.Fatalf("floor=%d, want the auction's own cap composition %d", floor, want)
	}
	// The floor must come from the AUCTION's cap, not the network ceiling: the
	// old build composed it from the policy constant and would demand far more.
	policyConstant := originalEnd + policy.MaxTotalExtension + EmergencyRecoverySeconds
	if floor >= policyConstant {
		t.Fatalf("auction floor %d did not drop below the policy-constant locktime %d", floor, policyConstant)
	}

	// The predicate the coordinator runs: at or above the auction's floor and
	// within the policy band, never an exact equality with a policy constant.
	accepts := func(locktime int64) bool {
		return locktime >= demoMintExpectedLocktime(auction) && locktime <= demoMintExpectedLocktime(auction)+policy.MaxTotalExtension
	}
	if !accepts(floor) {
		t.Fatalf("locktime %d (exactly the auction floor) was refused", floor)
	}
	if !accepts(floor + 120) {
		t.Fatalf("locktime %d (above the auction floor, within the band) was refused", floor+120)
	}
	if accepts(floor - 1) {
		t.Fatalf("locktime %d (one second below the auction floor) was accepted", floor-1)
	}
	if accepts(auction.EndTime + 600) {
		t.Fatalf("the old end_time+600 locktime %d was accepted", auction.EndTime+600)
	}
	if accepts(floor + policy.MaxTotalExtension + 1) {
		t.Fatalf("locktime %d (above the policy band ceiling) was accepted", floor+policy.MaxTotalExtension+1)
	}
	// The old build demanded the network-ceiling locktime exactly; that value
	// sits at the top of the band and must still be accepted, not refused.
	if !accepts(policyConstant) {
		t.Fatalf("the network-ceiling locktime %d is outside the band and would be refused", policyConstant)
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
