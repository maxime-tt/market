package poc

import (
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/btcsuite/btcd/btcec/v2"
)

// feedbackTestKey is a throwaway secret. Feedback carries no authority, so a
// fixed key in a test is fine; it only has to produce a genuine signature.
const feedbackTestKey = "0000000000000000000000000000000000000000000000000000000000000003"

// postFeedback drives the real handler with a JSON body and returns the
// recorder so a test can assert the status and the stored line.
func postFeedback(t *testing.T, event SignedEvent, tab string) *httptest.ResponseRecorder {
	t.Helper()
	body, err := json.Marshal(feedbackRequest{Event: event, Tab: tab})
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	request := httptest.NewRequest(http.MethodPost, "/api/feedback", strings.NewReader(string(body)))
	request.Header.Set("content-type", "application/json")
	recorder := httptest.NewRecorder()
	(&APIServer{}).feedback(recorder, request)
	return recorder
}

func signedFeedback(t *testing.T, content string) SignedEvent {
	t.Helper()
	raw, err := hex.DecodeString(feedbackTestKey)
	if err != nil {
		t.Fatalf("decode test key: %v", err)
	}
	key, _ := btcec.PrivKeyFromBytes(raw)
	event, err := SignNostrEvent(key, 1_760_000_000, KindFeedback, [][]string{{"t", "auctions-lab-feedback"}}, content)
	if err != nil {
		t.Fatalf("sign feedback note: %v", err)
	}
	return event
}

// TestFeedbackNoteIsStoredAndVerified pins the behaviour the floating button
// depends on: a genuine kind 1 note is accepted and appended to the durable
// copy, and a forged or mislabelled note is refused rather than stored.
func TestFeedbackNoteIsStoredAndVerified(t *testing.T) {
	root := t.TempDir()
	t.Setenv("POC_DEMO_NETWORK_ROOT", root)

	recorder := postFeedback(t, signedFeedback(t, "the raise-bid button is confusing"), "bidder-2")
	if recorder.Code != http.StatusOK {
		t.Fatalf("valid note answered %d: %s", recorder.Code, recorder.Body.String())
	}
	var reply map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &reply); err != nil {
		t.Fatalf("reply is not JSON: %v", err)
	}
	if reply["stored"] != true {
		t.Fatalf("note was not reported as stored: %v", reply)
	}
	if reply["relay_sent"] != false {
		t.Fatalf("no relay is configured in this test, so relay_sent must be false: %v", reply)
	}
	if message, _ := reply["relay_error"].(string); !strings.Contains(message, "no relay is configured") {
		t.Fatalf("relay failure must be reported honestly, got %q", message)
	}

	raw, err := os.ReadFile(filepath.Join(root, feedbackFilename))
	if err != nil {
		t.Fatalf("durable copy missing: %v", err)
	}
	var record feedbackRecord
	if err := json.Unmarshal([]byte(strings.TrimSpace(string(raw))), &record); err != nil {
		t.Fatalf("stored line is not JSON: %v", err)
	}
	if record.Event.Content != "the raise-bid button is confusing" {
		t.Fatalf("stored content = %q", record.Event.Content)
	}
	if record.Tab != "bidder-2" {
		t.Fatalf("stored tab = %q, want bidder-2", record.Tab)
	}
	if record.Event.Kind != KindFeedback {
		t.Fatalf("stored kind = %d, want %d", record.Event.Kind, KindFeedback)
	}

	// An operator can read the notes back, newest first.
	notes := httptest.NewRecorder()
	(&APIServer{}).feedbackNotes(notes, httptest.NewRequest(http.MethodGet, "/api/feedback", nil))
	if notes.Code != http.StatusOK {
		t.Fatalf("notes listing answered %d", notes.Code)
	}
	var listing struct {
		Count int              `json:"count"`
		Notes []feedbackRecord `json:"notes"`
	}
	if err := json.Unmarshal(notes.Body.Bytes(), &listing); err != nil {
		t.Fatalf("listing is not JSON: %v", err)
	}
	if listing.Count != 1 || listing.Notes[0].Event.ID != record.Event.ID {
		t.Fatalf("listing = %+v", listing)
	}
}

func TestFeedbackRefusesMislabeledAndForgedNotes(t *testing.T) {
	t.Setenv("POC_DEMO_NETWORK_ROOT", t.TempDir())

	// A chain transaction kind must not masquerade as feedback.
	raw, err := hex.DecodeString(feedbackTestKey)
	if err != nil {
		t.Fatalf("decode test key: %v", err)
	}
	key, _ := btcec.PrivKeyFromBytes(raw)
	bid, err := SignNostrEvent(key, 1_760_000_000, KindBid, nil, "{}")
	if err != nil {
		t.Fatalf("sign bid: %v", err)
	}
	if recorder := postFeedback(t, bid, "bidder-1"); recorder.Code != http.StatusUnprocessableEntity {
		t.Fatalf("non-feedback kind answered %d, want 422", recorder.Code)
	}

	// Empty content is not a report.
	empty := signedFeedback(t, "   ")
	if recorder := postFeedback(t, empty, "seller"); recorder.Code != http.StatusUnprocessableEntity {
		t.Fatalf("empty note answered %d, want 422", recorder.Code)
	}

	// A signature that does not match the claimed author is refused.
	forged := signedFeedback(t, "pretending to be someone else")
	forged.Sig = strings.Repeat("0", len(forged.Sig))
	if recorder := postFeedback(t, forged, "seller"); recorder.Code != http.StatusUnprocessableEntity {
		t.Fatalf("forged note answered %d, want 422", recorder.Code)
	}

	if _, err := os.Stat(filepath.Join(os.Getenv("POC_DEMO_NETWORK_ROOT"), feedbackFilename)); !os.IsNotExist(err) {
		t.Fatalf("refused notes must not be stored, stat error = %v", err)
	}
}
