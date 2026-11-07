package poc

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRotatingLogKeepsTotalSizeBounded(t *testing.T) {
	t.Parallel()
	path := filepath.Join(t.TempDir(), "validator-1.log")
	const maxBytes int64 = 1024
	const keep = 2
	logFile, err := openRotatingLog(path, logLimits{maxBytes: maxBytes, keep: keep})
	if err != nil {
		t.Fatal(err)
	}
	defer logFile.Close()

	// Write far more than the ceiling: 64 lines of 128 bytes against a 1 KiB cap.
	line := strings.Repeat("x", 127) + "\n"
	for index := 0; index < 64; index++ {
		if _, err := logFile.Write([]byte(line)); err != nil {
			t.Fatalf("write %d: %v", index, err)
		}
	}

	// The active file plus every kept generation must stay inside
	// maxBytes*(keep+1). That is the whole point: a demo left running cannot
	// grow without bound.
	var total int64
	for _, candidate := range []string{path, path + ".1", path + ".2"} {
		if info, err := os.Stat(candidate); err == nil {
			total += info.Size()
		}
	}
	if ceiling := maxBytes * (keep + 1); total > ceiling {
		t.Fatalf("total log bytes = %d, want at most %d", total, ceiling)
	}
	// And it must still be recording: the newest line has to be present.
	active, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(active), "\n") {
		t.Fatal("the active log stopped recording")
	}
}

func TestRotatingLogShiftsGenerationsOldestFirst(t *testing.T) {
	t.Parallel()
	directory := t.TempDir()
	path := filepath.Join(directory, "validator-2.log")
	logFile, err := openRotatingLog(path, logLimits{maxBytes: 64, keep: 2})
	if err != nil {
		t.Fatal(err)
	}
	defer logFile.Close()

	// Each write is large enough to force a rotation, and each generation is
	// labelled so the ordering can be read back.
	for generation := 1; generation <= 3; generation++ {
		if _, err := logFile.Write([]byte(fmt.Sprintf("generation-%d%s\n", generation, strings.Repeat("y", 80)))); err != nil {
			t.Fatal(err)
		}
	}

	previous, err := os.ReadFile(path + ".1")
	if err != nil {
		t.Fatalf("expected one kept generation: %v", err)
	}
	older, err := os.ReadFile(path + ".2")
	if err != nil {
		t.Fatalf("expected two kept generations: %v", err)
	}
	// .1 must be newer than .2 -- generations shift away from the active file.
	firstIndex := strings.Index(string(previous), "generation-")
	secondIndex := strings.Index(string(older), "generation-")
	if firstIndex < 0 || secondIndex < 0 {
		t.Fatalf("generations not labelled: %q / %q", previous, older)
	}
	if string(previous)[firstIndex:firstIndex+12] <= string(older)[secondIndex:secondIndex+12] {
		t.Fatalf(".1 (%q) should hold a newer generation than .2 (%q)", previous[:14], older[:14])
	}
	// Nothing beyond the kept count may exist.
	if _, err := os.Stat(path + ".3"); !os.IsNotExist(err) {
		t.Fatal("a generation beyond the configured keep count survived")
	}
}

func TestRotatingLogWithNoCeilingDoesNotRotate(t *testing.T) {
	t.Parallel()
	path := filepath.Join(t.TempDir(), "validator-3.log")
	logFile, err := openRotatingLog(path, logLimits{maxBytes: 0, keep: 2})
	if err != nil {
		t.Fatal(err)
	}
	defer logFile.Close()
	for index := 0; index < 100; index++ {
		if _, err := logFile.Write([]byte("a line that is deliberately long enough to matter\n")); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := os.Stat(path + ".1"); !os.IsNotExist(err) {
		t.Fatal("a zero ceiling must not rotate")
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Size() < 4000 {
		t.Fatalf("expected the whole payload in one file, got %d bytes", info.Size())
	}
}

func TestLogLimitsComeFromTheEnvironment(t *testing.T) {
	t.Parallel()
	values := map[string]string{"POC_LOG_MAX_BYTES": "2048", "POC_LOG_KEEP": "7"}
	limits := logLimitsFromEnv(func(key string) string { return values[key] })
	if limits.maxBytes != 2048 || limits.keep != 7 {
		t.Fatalf("limits = %+v, want 2048/7", limits)
	}
	// Unset falls back to a real ceiling rather than to none, because "no
	// ceiling" is the failure this file exists to prevent.
	fallback := logLimitsFromEnv(func(string) string { return "" })
	if fallback.maxBytes != defaultLogMaxBytes || fallback.keep != defaultLogKeep {
		t.Fatalf("fallback = %+v, want the bounded default", fallback)
	}
}

func TestDemoLogDirectoryHonoursOverride(t *testing.T) {
	t.Setenv("POC_LOG_DIR", "/tmp/elsewhere")
	if got := demoLogDirectory("/home/example/net"); got != "/tmp/elsewhere" {
		t.Fatalf("log directory = %q, want the override", got)
	}
	t.Setenv("POC_LOG_DIR", "")
	if got := demoLogDirectory("/home/example/net"); got != "/home/example/net/logs" {
		t.Fatalf("log directory = %q, want the historical default", got)
	}
}
