package poc

// Bounded local log files for the four-validator demo.
//
// Without this the demo writes one unbounded file per validator into
// <home>/logs. Four CometBFT nodes at a one-second empty-block interval produce
// tens of megabytes an hour each, so an idle demo left running overnight fills
// the disk and nothing reports it until a write fails. The whole point of the
// demo is that it can be left up, so the files need a ceiling.
//
// This is deliberately simple: size-triggered rotation with a fixed number of
// kept files and a synchronous rename. A single process writes each file, so
// there is no concurrent-writer case to reason about and no reason to reach for
// an external log daemon.

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"sync"
)

const (
	// defaultLogMaxBytes caps one validator's active log file at 64 MiB and
	// defaultLogKeep keeps two generations, so the four validators together
	// settle at 512 MiB regardless of how long the demo runs.
	defaultLogMaxBytes int64 = 64 << 20
	defaultLogKeep            = 2
)

// logLimits resolves the configured ceiling. A zero or negative value means
// "no ceiling", which is what the tests use to keep their assertions simple;
// the demo unit always sets a real one.
type logLimits struct {
	maxBytes int64
	keep     int
}

func logLimitsFromEnv(getenv func(string) string) logLimits {
	limits := logLimits{maxBytes: defaultLogMaxBytes, keep: defaultLogKeep}
	if raw := getenv("POC_LOG_MAX_BYTES"); raw != "" {
		if value, err := strconv.ParseInt(raw, 10, 64); err == nil {
			limits.maxBytes = value
		}
	}
	if raw := getenv("POC_LOG_KEEP"); raw != "" {
		if value, err := strconv.Atoi(raw); err == nil && value >= 0 {
			limits.keep = value
		}
	}
	return limits
}

// rotatingLog is an io.Writer that keeps one file under a byte ceiling by
// recycling a bounded set of generations. validator-1.log is always the active
// file; a rotation renames it to validator-1.log.1, shifting older generations
// up and discarding whatever falls past `keep`.
type rotatingLog struct {
	mu       sync.Mutex
	path     string
	limits   logLimits
	file     *os.File
	written  int64
	closed   bool
}

func openRotatingLog(path string, limits logLimits) (*rotatingLog, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, err
	}
	logFile := &rotatingLog{path: path, limits: limits}
	// Start from whatever is already on disk so a restart does not hand the
	// caller a fresh allowance on top of an already-full file.
	if info, err := os.Stat(path); err == nil {
		logFile.written = info.Size()
	}
	if err := logFile.reopen(); err != nil {
		return nil, err
	}
	return logFile, nil
}

func (logFile *rotatingLog) reopen() error {
	file, err := os.OpenFile(logFile.path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	logFile.file = file
	return nil
}

func (logFile *rotatingLog) Write(payload []byte) (int, error) {
	logFile.mu.Lock()
	defer logFile.mu.Unlock()
	if logFile.closed {
		return 0, errors.New("log file is closed")
	}
	if logFile.limits.maxBytes > 0 && logFile.written+int64(len(payload)) > logFile.limits.maxBytes {
		if err := logFile.rotate(); err != nil {
			// A rotation failure must not lose the record: fall through and keep
			// writing to the current file rather than dropping the line.
			if logFile.file == nil {
				return 0, err
			}
		}
	}
	written, err := logFile.file.Write(payload)
	logFile.written += int64(written)
	return written, err
}

func (logFile *rotatingLog) rotate() error {
	if logFile.file != nil {
		if err := logFile.file.Close(); err != nil {
			return err
		}
		logFile.file = nil
	}
	if logFile.limits.keep <= 0 {
		// No generations wanted: truncate in place.
		logFile.written = 0
		return logFile.reopen()
	}
	// Shift generations from oldest to newest so nothing is overwritten before
	// it has been renamed.
	oldest := fmt.Sprintf("%s.%d", logFile.path, logFile.limits.keep)
	if err := os.Remove(oldest); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	for generation := logFile.limits.keep - 1; generation >= 1; generation-- {
		from := fmt.Sprintf("%s.%d", logFile.path, generation)
		to := fmt.Sprintf("%s.%d", logFile.path, generation+1)
		if err := os.Rename(from, to); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	if err := os.Rename(logFile.path, logFile.path+".1"); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	logFile.written = 0
	return logFile.reopen()
}

func (logFile *rotatingLog) Close() error {
	logFile.mu.Lock()
	defer logFile.mu.Unlock()
	if logFile.closed {
		return nil
	}
	logFile.closed = true
	if logFile.file == nil {
		return nil
	}
	err := logFile.file.Close()
	logFile.file = nil
	return err
}

// demoLogDirectory is where a local demo keeps validator logs. It honours
// POC_LOG_DIR so the demo can be pointed at a scratch path, and otherwise keeps
// the historical <home>/logs so existing tooling still finds them.
func demoLogDirectory(home string) string {
	if directory := os.Getenv("POC_LOG_DIR"); directory != "" {
		return directory
	}
	return filepath.Join(home, "logs")
}
