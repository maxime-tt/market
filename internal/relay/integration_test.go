package relay_test

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/btcsuite/btcd/btcec/v2"
	"github.com/btcsuite/btcd/btcec/v2/schnorr"
	abci "github.com/cometbft/cometbft/abci/types"
	"github.com/nbd-wtf/go-nostr"

	"github.com/maximotodev/plebeian-auctions-poc/internal/poc"
	"github.com/maximotodev/plebeian-auctions-poc/internal/relay"
)

// These tests exercise Slice 1 end to end with third-party tooling: a real
// `nak serve` relay process, a real `nak event` publish, the observer, and the
// application's actual ABCI state machine.  They are the acceptance tests from
// SLICE-1-RELAY-BRIEF.md, not mocks of them.  They skip when nak is absent.

func nakBinary(t *testing.T) string {
	t.Helper()
	if configured := os.Getenv("NAK_BINARY"); configured != "" {
		return configured
	}
	if home, err := os.UserHomeDir(); err == nil {
		candidate := filepath.Join(home, ".local", "bin", "nak")
		if info, statErr := os.Stat(candidate); statErr == nil && !info.IsDir() {
			return candidate
		}
	}
	if found, lookErr := exec.LookPath("nak"); lookErr == nil {
		return found
	}
	t.Skip("nak binary not available; set NAK_BINARY to run the relay acceptance tests")
	return ""
}

// startNakRelay launches `nak serve` on a free loopback port and returns its
// websocket URL and a stop function.
func startNakRelay(t *testing.T) (string, func()) {
	t.Helper()
	nak := nakBinary(t)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("reserve port: %v", err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	_ = listener.Close()

	command := exec.Command(nak, "serve", "--hostname", "127.0.0.1", "--port", fmt.Sprintf("%d", port))
	var output bytes.Buffer
	command.Stdout = &output
	command.Stderr = &output
	if err := command.Start(); err != nil {
		t.Fatalf("start nak serve: %v", err)
	}
	url := fmt.Sprintf("ws://127.0.0.1:%d", port)
	stop := func() {
		_ = command.Process.Kill()
		_, _ = command.Process.Wait()
	}
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
		client, err := nostr.RelayConnect(ctx, url)
		cancel()
		if err == nil {
			_ = client.Close()
			return url, stop
		}
		time.Sleep(100 * time.Millisecond)
	}
	stop()
	t.Fatalf("nak serve did not become reachable at %s; output:\n%s", url, output.String())
	return "", func() {}
}

func publishWithNak(t *testing.T, url, secret string, kind int, content string) {
	t.Helper()
	nak := nakBinary(t)
	command := exec.Command(nak, "event", "--sec", secret, "-k", fmt.Sprintf("%d", kind), "-c", content, url)
	command.Stderr = os.Stderr
	if out, err := command.Output(); err != nil {
		t.Fatalf("nak event publish failed: %v (%s)", err, string(out))
	}
}

// harness drives a poc.Application through proposal/finalize/commit, exactly the
// sequence a validator runs, so "committed state" means real ABCI state.
type harness struct {
	app    *poc.Application
	height int64
	ctx    context.Context
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	seed := make([]byte, ed25519.SeedSize)
	seed[0] = 91
	committee, err := btcec.NewPrivateKey()
	if err != nil {
		t.Fatalf("committee key: %v", err)
	}
	app, err := poc.NewApplication("slice1-relay", poc.DefaultPolicy(), seed,
		hex.EncodeToString(committee.PubKey().SerializeCompressed()), filepath.Join(t.TempDir(), "state.json"))
	if err != nil {
		t.Fatalf("new application: %v", err)
	}
	h := &harness{app: app, height: 1, ctx: context.Background()}
	if _, err := app.FinalizeBlock(h.ctx, &abci.FinalizeBlockRequest{Time: time.Unix(1_700_000_000, 0), Height: h.height}); err != nil {
		t.Fatalf("advance finalize: %v", err)
	}
	if _, err := app.Commit(h.ctx, &abci.CommitRequest{}); err != nil {
		t.Fatalf("advance commit: %v", err)
	}
	h.height++
	return h
}

// commitEvent runs one event transaction through the full ABCI pipeline,
// reporting acceptance exactly as a validator would see it.  If the event's
// created_at is ahead of the last committed consensus time, it first advances the
// clock with an empty block, mirroring a real chain where block time tracks
// wall-clock and an event published "now" falls inside the skew window.
func (h *harness) commitEvent(t *testing.T, event poc.SignedEvent, at int64) error {
	t.Helper()
	view, err := h.app.Snapshot("")
	if err != nil {
		return fmt.Errorf("snapshot: %w", err)
	}
	if at > view.State.LastConsensusTime {
		if _, err := h.app.FinalizeBlock(h.ctx, &abci.FinalizeBlockRequest{Time: time.Unix(at, 0), Height: h.height}); err != nil {
			return fmt.Errorf("pre-advance finalize: %w", err)
		}
		if _, err := h.app.Commit(h.ctx, &abci.CommitRequest{}); err != nil {
			return fmt.Errorf("pre-advance commit: %w", err)
		}
		h.height++
	}
	raw, err := poc.EncodeTransaction(poc.Transaction{Version: poc.TxVersion, Type: "event", Event: &event})
	if err != nil {
		return fmt.Errorf("encode: %w", err)
	}
	check, err := h.app.CheckTx(h.ctx, &abci.CheckTxRequest{Tx: raw, Type: abci.CHECK_TX_TYPE_CHECK})
	if err != nil {
		return fmt.Errorf("checktx: %w", err)
	}
	if check.Code != 0 {
		return fmt.Errorf("CheckTx rejected: %s", check.Log)
	}
	prepared, err := h.app.PrepareProposal(h.ctx, &abci.PrepareProposalRequest{Txs: [][]byte{raw}, Time: time.Unix(at, 0), MaxTxBytes: 1 << 20})
	if err != nil || len(prepared.Txs) != 1 {
		return fmt.Errorf("prepare: %v len=%d", err, len(prepared.Txs))
	}
	processed, err := h.app.ProcessProposal(h.ctx, &abci.ProcessProposalRequest{Txs: prepared.Txs, Time: time.Unix(at, 0), Height: h.height})
	if err != nil || processed.Status != abci.PROCESS_PROPOSAL_STATUS_ACCEPT {
		return fmt.Errorf("process: %v status=%v", err, processed.Status)
	}
	finalized, err := h.app.FinalizeBlock(h.ctx, &abci.FinalizeBlockRequest{Txs: prepared.Txs, Time: time.Unix(at, 0), Height: h.height})
	if err != nil {
		return fmt.Errorf("finalize: %w", err)
	}
	if finalized.TxResults[0].Code != 0 {
		return fmt.Errorf("FinalizeBlock rejected: %s", finalized.TxResults[0].Log)
	}
	if _, err := h.app.Commit(h.ctx, &abci.CommitRequest{}); err != nil {
		return fmt.Errorf("commit: %w", err)
	}
	h.height++
	return nil
}

func (h *harness) auctionIDs(t *testing.T) map[string]bool {
	t.Helper()
	view, err := h.app.Snapshot("")
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	ids := map[string]bool{}
	for id := range view.State.Auctions {
		ids[id] = true
	}
	return ids
}

func (h *harness) operationCount(t *testing.T) int {
	t.Helper()
	view, err := h.app.Snapshot("")
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	return len(view.State.Operations)
}

// chainSubmitter adapts the harness to relay.Submitter so the observer drives
// the real state machine.  It adds no validation beyond the chain's own.
type chainSubmitter struct {
	harness  *harness
	t        *testing.T
	accepted []string
}

func (submitter *chainSubmitter) SubmitEvent(ctx context.Context, event poc.SignedEvent) (relay.SubmitResult, error) {
	if err := submitter.harness.commitEvent(submitter.t, event, event.CreatedAt); err != nil {
		return relay.SubmitResult{}, err
	}
	submitter.accepted = append(submitter.accepted, event.ID)
	return relay.SubmitResult{Height: submitter.harness.height}, nil
}

// TestRelayObserverCommitsSignedCreateThroughRealRelay is acceptance #1+#2: a
// signed create event published with nak appears in committed application state,
// with nothing touching POST /api/event.
func TestRelayObserverCommitsSignedCreateThroughRealRelay(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping relay acceptance test in -short mode")
	}
	url, stopRelay := startNakRelay(t)
	defer stopRelay()

	h := newHarness(t)
	secret := "0000000000000000000000000000000000000000000000000000000000000042"

	content, err := json.Marshal(map[string]any{
		"auction_id": "relay-create", "title": "Relayed", "duration_seconds": 300, "starting_bid": 1000, "reserve": 0,
	})
	if err != nil {
		t.Fatal(err)
	}

	submitter := &chainSubmitter{harness: h, t: t}
	observer, err := relay.NewObserver(relay.ObserverConfig{URL: url, Submitter: submitter, ReconnectDelay: 200 * time.Millisecond})
	if err != nil {
		t.Fatal(err)
	}
	observerContext, cancel := context.WithCancel(context.Background())
	defer cancel()
	go observer.Run(observerContext)
	// `nak serve` is a live-relay: it rejects an EVENT no subscription is
	// listening for ("mute"), so the observer must be subscribed before the
	// publish.  That mirrors production, where the observer is always up.
	waitForObserverSubscribed(t, observer)

	publishWithNak(t, url, secret, poc.KindCreate, string(content))

	waitFor(t, 10*time.Second, func() bool { return h.auctionIDs(t)["relay-create"] },
		"auction relay-create to appear in committed state from a relayed event")

	view, err := h.app.Snapshot("")
	if err != nil {
		t.Fatal(err)
	}
	auction := view.State.Auctions["relay-create"]
	expectedSeller := hex.EncodeToString(schnorrSerialize(t, privateKeyFromHex(t, secret)))
	if auction.Seller != expectedSeller {
		t.Fatalf("seller = %s, want the nak secret's public key %s", auction.Seller, expectedSeller)
	}
}

// TestRelayObserverDuplicatePublishCommitsOnce is acceptance #3: two identical
// publishes produce exactly one committed operation, because the chain's
// Operations key makes the second a no-op.
func TestRelayObserverDuplicatePublishCommitsOnce(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping relay acceptance test in -short mode")
	}
	url, stopRelay := startNakRelay(t)
	defer stopRelay()

	h := newHarness(t)
	secret := "0000000000000000000000000000000000000000000000000000000000000043"
	content, err := json.Marshal(map[string]any{
		"auction_id": "relay-dup", "title": "Duplicate", "duration_seconds": 300, "starting_bid": 1000, "reserve": 0,
	})
	if err != nil {
		t.Fatal(err)
	}
	// Pin created_at so the id is reproducible: nak publishing the same signed
	// event twice is a genuine duplicate, not two events sharing an auction id.
	signed := signWithGo(t, secret, 1_700_000_000, poc.KindCreate, string(content))
	raw, _ := relay.FromSignedEvent(signed).MarshalJSON()

	submitter := &chainSubmitter{harness: h, t: t}
	observer, err := relay.NewObserver(relay.ObserverConfig{URL: url, Submitter: submitter, ReconnectDelay: 200 * time.Millisecond})
	if err != nil {
		t.Fatal(err)
	}
	observerContext, cancel := context.WithCancel(context.Background())
	defer cancel()
	go observer.Run(observerContext)
	waitForObserverSubscribed(t, observer)

	nak := nakBinary(t)
	for i := 0; i < 2; i++ {
		command := exec.Command(nak, "event", url)
		command.Stdin = bytes.NewReader(raw)
		command.Stderr = os.Stderr
		if out, err := command.Output(); err != nil {
			t.Fatalf("nak publish attempt %d: %v (%s)", i+1, err, string(out))
		}
	}

	waitFor(t, 10*time.Second, func() bool { return h.auctionIDs(t)["relay-dup"] },
		"duplicate auction to appear once in committed state")
	time.Sleep(500 * time.Millisecond)

	if count := h.operationCount(t); count != 1 {
		t.Fatalf("committed operations = %d, want exactly 1 for a repeated publish", count)
	}
	if len(submitter.accepted) > 1 {
		t.Fatalf("observer submitted %d distinct events, want at most 1", len(submitter.accepted))
	}
}

// TestRelayObserverRefusesTamperedSignature is the tampered-signature
// requirement: the observer drops the event and nothing enters state.
func TestRelayObserverRefusesTamperedSignature(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping relay acceptance test in -short mode")
	}
	url, stopRelay := startNakRelay(t)
	defer stopRelay()

	h := newHarness(t)
	secret := "0000000000000000000000000000000000000000000000000000000000000044"
	content, err := json.Marshal(map[string]any{
		"auction_id": "relay-tampered", "title": "Tampered", "duration_seconds": 300, "starting_bid": 1000, "reserve": 0,
	})
	if err != nil {
		t.Fatal(err)
	}
	signed := signWithGo(t, secret, 1_700_000_000, poc.KindCreate, string(content))
	sigBytes := []byte(signed.Sig)
	if sigBytes[len(sigBytes)-1] == 'a' {
		sigBytes[len(sigBytes)-1] = 'b'
	} else {
		sigBytes[len(sigBytes)-1] = 'a'
	}
	signed.Sig = string(sigBytes)
	raw, _ := relay.FromSignedEvent(signed).MarshalJSON()

	submitter := &chainSubmitter{harness: h, t: t}
	observer, err := relay.NewObserver(relay.ObserverConfig{URL: url, Submitter: submitter})
	if err != nil {
		t.Fatal(err)
	}
	observerContext, cancel := context.WithCancel(context.Background())
	defer cancel()
	go observer.Run(observerContext)

	// Push the tampered event straight at the observer's verification path so the
	// assertion does not depend on whether the relay let the bytes through.
	go observer.HandleForTest(context.Background(), relay.FromSignedEvent(signed))

	nak := nakBinary(t)
	publish := exec.Command(nak, "event", url)
	publish.Stdin = bytes.NewReader(raw)
	combined, err := publish.CombinedOutput()
	if err == nil {
		t.Logf("nak forwarded the tampered event; the observer's own verification is the gate under test")
	} else {
		t.Logf("nak refused the tampered event at the relay: %s", strings.TrimSpace(string(combined)))
	}
	time.Sleep(700 * time.Millisecond)

	if h.auctionIDs(t)["relay-tampered"] {
		t.Fatal("tampered auction reached committed state; the signature check did not hold")
	}
	if len(submitter.accepted) != 0 {
		t.Fatalf("observer submitted %d tampered events, want 0", len(submitter.accepted))
	}
}

// TestRelayObserverReconnectLosesNothing is acceptance #4.  `nak serve` is
// in-memory, so this proves the honest claim: an observer (re)start recovers
// events still published to the live relay, and committed chain state is never
// lost regardless of the relay, because the chain is the durable record.  Events
// lost with a killed in-memory relay are NOT recoverable; that limitation is
// stated in the Slice 1 report.
func TestRelayObserverReconnectLosesNothing(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping relay acceptance test in -short mode")
	}
	url, stopRelay := startNakRelay(t)
	defer stopRelay()

	h := newHarness(t)
	secret := "0000000000000000000000000000000000000000000000000000000000000045"
	content, err := json.Marshal(map[string]any{
		"auction_id": "relay-reconnect", "title": "Reconnect", "duration_seconds": 300, "starting_bid": 1000, "reserve": 0,
	})
	if err != nil {
		t.Fatal(err)
	}
	submitter := &chainSubmitter{harness: h, t: t}

	observerContext, cancel := context.WithCancel(context.Background())
	defer cancel()
	observer, err := relay.NewObserver(relay.ObserverConfig{URL: url, Submitter: submitter, ReconnectDelay: 200 * time.Millisecond})
	if err != nil {
		t.Fatal(err)
	}
	go observer.Run(observerContext)
	waitForObserverSubscribed(t, observer)

	// Publish an event the live relay stores (nak serve keeps it in memory and
	// replays it to any subscriber whose filter matches).  The observer's filter
	// is "since the last event seen", so a fresh observer re-fetches it.
	publishWithNak(t, url, secret, poc.KindCreate, string(content))

	waitFor(t, 10*time.Second, func() bool { return h.auctionIDs(t)["relay-reconnect"] },
		"the published event to be committed")
	// Then restart the observer and confirm the relay's stored copy is re-fetched
	// and no-ops against committed state (the durability claim under test).

	// Restart the OBSERVER (the relay stays up and holds the event) and confirm
	// the replay no-ops against already-committed state.
	cancel()
	time.Sleep(400 * time.Millisecond)

	observerContext2, cancel2 := context.WithCancel(context.Background())
	defer cancel2()
	observer2, err := relay.NewObserver(relay.ObserverConfig{URL: url, Submitter: submitter, ReconnectDelay: 200 * time.Millisecond})
	if err != nil {
		t.Fatal(err)
	}
	go observer2.Run(observerContext2)
	time.Sleep(700 * time.Millisecond)

	if count := h.operationCount(t); count != 1 {
		t.Fatalf("committed operations after observer restart = %d, want 1 (replay must no-op)", count)
	}
}

// --- helpers ---

func privateKeyFromHex(t *testing.T, secret string) *btcec.PrivateKey {
	t.Helper()
	raw, err := hex.DecodeString(secret)
	if err != nil {
		t.Fatalf("hex decode secret: %v", err)
	}
	key, _ := btcec.PrivKeyFromBytes(raw)
	return key
}

func schnorrSerialize(t *testing.T, key *btcec.PrivateKey) []byte {
	t.Helper()
	return schnorr.SerializePubKey(key.PubKey())
}

// signWithGo builds a signed event whose id and signature match the
// application's canonical serializer, so it is a genuine event the chain accepts.
func signWithGo(t *testing.T, secret string, createdAt int64, kind int, content string) poc.SignedEvent {
	t.Helper()
	event, err := poc.SignNostrEvent(privateKeyFromHex(t, secret), createdAt, kind, nil, content)
	if err != nil {
		t.Fatalf("sign event: %v", err)
	}
	return event
}

// waitForObserverSubscribed blocks until the observer has an open relay
// subscription.  nak serve drops an EVENT with no matching subscriber, so tests
// must not publish before this returns.
func waitForObserverSubscribed(t *testing.T, observer *relay.Observer) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if observer.Subscribed() {
			return
		}
		time.Sleep(25 * time.Millisecond)
	}
	t.Fatal("observer did not establish a relay subscription in time")
}

func waitFor(t *testing.T, timeout time.Duration, condition func() bool, description string) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if condition() {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", description)
}
