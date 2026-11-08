package poc

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// KindFeedback is a plain NIP-01 text note (kind 1). Feedback is deliberately
// not a chain transaction: it never enters consensus, no validator orders it,
// and it cannot affect an auction. It is a note an operator reads.
//
// It is published to the relay the demo already runs AND kept in a durable file
// beside the network root. Both, because the relay is in memory: publishing
// only there would lose every note on the next relay restart, and a test round
// is exactly when someone restarts something.
const KindFeedback = 1

// feedbackFilename is the durable copy, one JSON object per line.
const feedbackFilename = "feedback.jsonl"

// feedbackMaxContent bounds a note so one client cannot fill the disk. It is
// generous for a bug report and small enough to be harmless.
const feedbackMaxContent = 4000

type feedbackRequest struct {
	Event SignedEvent `json:"event"`
	// Tab is the lab tab the note was written from, e.g. "seller" or "bidder-2".
	// It is advisory context, not authority: the signed event is the record.
	Tab string `json:"tab,omitempty"`
	// Context is the page's own report: protocol in force, app height, the
	// console ring buffer. It is advisory too, and bounded so a tester cannot
	// fill the disk with one note. It also rides inside the signed note, so a
	// relay query carries the same detail.
	Context json.RawMessage `json:"context,omitempty"`
}

// feedbackMaxContext bounds the structured context. The page sends a small
// object; the limit exists so a hand-crafted request cannot write megabytes.
const feedbackMaxContext = 32 * 1024

// feedbackRecord is what lands on disk: the note as signed, plus what the
// server could observe about its arrival.
type feedbackRecord struct {
	ReceivedAt int64           `json:"received_at"`
	Remote     string          `json:"remote,omitempty"`
	Tab        string          `json:"tab,omitempty"`
	Context    json.RawMessage `json:"context,omitempty"`
	Event      SignedEvent     `json:"event"`
	RelaySent  bool            `json:"relay_sent"`
	RelayError string          `json:"relay_error,omitempty"`
}

// feedbackWriteMu serialises appends so two notes arriving together cannot
// interleave inside one line.
var feedbackWriteMu sync.Mutex

// feedbackPath is the durable copy's path, empty when the server was started
// without a network root (in which case the relay copy is all there is).
func feedbackPath() string {
	root := strings.TrimSpace(os.Getenv("POC_DEMO_NETWORK_ROOT"))
	if root == "" {
		return ""
	}
	return filepath.Join(root, feedbackFilename)
}

// feedback accepts a signed kind-1 note, verifies its signature, appends it to
// the durable copy, and publishes it to the relay.
//
// The signature is checked with the same verifier the relay observer and the
// chain admission use, so a note attributed to a key is one that key actually
// signed. A note is worthless to forge: it carries no authority, and the UI
// only ever displays it as someone's words.
func (server *APIServer) feedback(response http.ResponseWriter, request *http.Request) {
	var body feedbackRequest
	if err := json.NewDecoder(http.MaxBytesReader(response, request.Body, 1<<20)).Decode(&body); err != nil {
		writeError(response, http.StatusBadRequest, errors.New("feedback body is not valid JSON"))
		return
	}
	event := body.Event
	if event.Kind != KindFeedback {
		writeError(response, http.StatusUnprocessableEntity, errors.New("feedback must be a kind 1 note"))
		return
	}
	text := strings.TrimSpace(event.Content)
	if text == "" {
		writeError(response, http.StatusUnprocessableEntity, errors.New("feedback note is empty"))
		return
	}
	if len(text) > feedbackMaxContent {
		writeError(response, http.StatusUnprocessableEntity, errors.New("feedback note is longer than the limit"))
		return
	}
	actor, err := VerifyNostrEvent(event)
	if err != nil {
		writeError(response, http.StatusUnprocessableEntity, err)
		return
	}
	if len(body.Context) > feedbackMaxContext {
		writeError(response, http.StatusUnprocessableEntity, errors.New("feedback context is larger than the limit"))
		return
	}
	if len(body.Context) > 0 && !json.Valid(body.Context) {
		writeError(response, http.StatusUnprocessableEntity, errors.New("feedback context is not valid JSON"))
		return
	}

	record := feedbackRecord{
		ReceivedAt: time.Now().Unix(),
		Remote:     request.RemoteAddr,
		Tab:        strings.TrimSpace(body.Tab),
		Context:    body.Context,
		Event:      event,
	}
	if relayErr := publishFeedbackToRelay(request.Context(), event); relayErr != nil {
		record.RelayError = relayErr.Error()
	} else {
		record.RelaySent = true
	}

	if path := feedbackPath(); path != "" {
		line, err := json.Marshal(record)
		if err != nil {
			writeError(response, http.StatusInternalServerError, err)
			return
		}
		feedbackWriteMu.Lock()
		file, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
		if err == nil {
			_, err = file.Write(append(line, '\n'))
			closeErr := file.Close()
			if err == nil {
				err = closeErr
			}
		}
		feedbackWriteMu.Unlock()
		if err != nil {
			// The note is already on the relay; say what failed rather than
			// pretending it is safe, so an operator can copy it by hand.
			writeJSON(response, http.StatusInternalServerError, map[string]any{
				"error": "the note reached the relay but could not be stored durably: " + err.Error(),
				"id":    event.ID,
			})
			return
		}
	}

	writeJSON(response, http.StatusOK, map[string]any{
		"id":          event.ID,
		"signed_by":   actor,
		"relay_sent":  record.RelaySent,
		"relay_error": record.RelayError,
		"stored":      feedbackPath() != "",
	})
}

// feedbackNotes serves the durable copy for an operator, newest first.
func (server *APIServer) feedbackNotes(response http.ResponseWriter, request *http.Request) {
	path := feedbackPath()
	notes := []feedbackRecord{}
	if path != "" {
		raw, err := os.ReadFile(path)
		if err == nil || errors.Is(err, os.ErrNotExist) {
			for _, line := range strings.Split(strings.TrimSpace(string(raw)), "\n") {
				if strings.TrimSpace(line) == "" {
					continue
				}
				var record feedbackRecord
				if json.Unmarshal([]byte(line), &record) != nil {
					continue
				}
				notes = append(notes, record)
			}
		}
	}
	// Newest first, bounded so the response stays readable.
	for left, right := 0, len(notes)-1; left < right; left, right = left+1, right-1 {
		notes[left], notes[right] = notes[right], notes[left]
	}
	if len(notes) > 200 {
		notes = notes[:200]
	}
	writeJSON(response, http.StatusOK, map[string]any{"count": len(notes), "notes": notes})
}

// publishFeedbackToRelay sends the note as a NIP-01 EVENT to the demo relay when
// one is configured. Best effort by design: the durable copy is the record, and
// a relay that is down must not lose a tester's report.
func publishFeedbackToRelay(ctx context.Context, event SignedEvent) error {
	url := RelayObserverURL()
	if url == "" {
		return errors.New("no relay is configured for this deployment")
	}
	dialCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	conn, _, err := websocket.DefaultDialer.DialContext(dialCtx, url, nil)
	if err != nil {
		return err
	}
	defer conn.Close()
	_ = conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
	if err := conn.WriteJSON([]any{"EVENT", event}); err != nil {
		return err
	}
	// The relay answers ["OK", <id>, true|false, <message>]. Wait for it so a
	// rejection is reported instead of assumed away.
	_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	var reply []json.RawMessage
	if err := conn.ReadJSON(&reply); err != nil {
		return err
	}
	if len(reply) >= 4 {
		var ok bool
		if json.Unmarshal(reply[2], &ok) == nil && !ok {
			var message string
			_ = json.Unmarshal(reply[3], &message)
			return errors.New("relay refused the note: " + message)
		}
	}
	return nil
}
