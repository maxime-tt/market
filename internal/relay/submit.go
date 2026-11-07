package relay

import (
	"context"
	"fmt"
	"sync"
	"time"

	cmttypes "github.com/cometbft/cometbft/types"

	"github.com/maximotodev/plebeian-auctions-poc/internal/poc"
)

// Submitter turns an observed signed event into a committed chain transaction.
//
// It is deliberately an interface with one method: the observer loop has no
// business knowing whether the transaction reaches the chain through a local
// CometBFT RPC client, a remote one, or something else.  That is what lets one
// observer run per validator without the loop changing.
type Submitter interface {
	SubmitEvent(ctx context.Context, event poc.SignedEvent) (SubmitResult, error)
}

// SubmitResult mirrors what the HTTP handler already reports back: the height
// the transaction landed at and the two application codes.  A caller can log it
// and a test can assert on it.
type SubmitResult struct {
	Height      int64
	CheckCode   uint32
	DeliverCode uint32
	TxHash      string
}

// EventTransaction builds the exact Transaction the HTTP /api/event handler
// builds.  Both transports must agree byte for byte, so there is one function
// and not two.
func EventTransaction(event poc.SignedEvent) (poc.Transaction, error) {
	// Copy the event so a caller cannot mutate the transaction after the fact.
	copied := event
	copied.Tags = make([][]string, len(event.Tags))
	for index, tag := range event.Tags {
		copied.Tags[index] = append([]string(nil), tag...)
	}
	tx := poc.Transaction{Version: poc.TxVersion, Type: "event", Event: &copied}
	// Encode/decode round-trip validates the shape now rather than at submit
	// time, and it proves the transport preserves the wire form exactly.
	raw, err := poc.EncodeTransaction(tx)
	if err != nil {
		return poc.Transaction{}, err
	}
	if _, err := poc.DecodeTransaction(raw); err != nil {
		return poc.Transaction{}, err
	}
	return tx, nil
}

// TxEncoder is the function a client uses to turn a Transaction into broadcast
// bytes.  It is a field rather than a direct call so tests can supply a fake and
// the observer never links the CometBFT HTTP client itself.
type TxEncoder func(tx poc.Transaction) ([]byte, error)

// Broadcaster is the minimal CometBFT capability the observer needs: broadcast
// one transaction and commit it.  A thin adapter over *rpchttp.HTTP satisfies
// it, and a test can satisfy it with a closure.
type Broadcaster interface {
	BroadcastTxCommit(ctx context.Context, tx cmttypes.Tx) (SubmitResult, error)
}

// ClientSubmitter submits events through a Broadcaster.  It encodes with the
// application's own encoder so the bytes on the wire are identical to the ones
// the HTTP path produces.
type ClientSubmitter struct {
	Broadcaster Broadcaster
	// Timeout bounds a single submission.  Zero means 20s, the same ceiling the
	// HTTP handler uses.
	Timeout time.Duration
}

func (submitter ClientSubmitter) SubmitEvent(ctx context.Context, event poc.SignedEvent) (SubmitResult, error) {
	if submitter.Broadcaster == nil {
		return SubmitResult{}, fmt.Errorf("no broadcaster configured")
	}
	timeout := submitter.Timeout
	if timeout <= 0 {
		timeout = 20 * time.Second
	}
	tx, err := EventTransaction(event)
	if err != nil {
		return SubmitResult{}, err
	}
	raw, err := poc.EncodeTransaction(tx)
	if err != nil {
		return SubmitResult{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	result, err := submitter.Broadcaster.BroadcastTxCommit(ctx, cmttypes.Tx(raw))
	if err != nil {
		return SubmitResult{}, err
	}
	return result, nil
}

// MemorySubmitter records submissions in memory.  It exists so the observer loop
// and its reconnect behaviour can be tested without a chain, and so a validator
// process that only wants to *observe* can be started without a broadcaster.
type MemorySubmitter struct {
	mu          sync.Mutex
	submissions []poc.SignedEvent
	failures    map[string]error
}

func NewMemorySubmitter() *MemorySubmitter {
	return &MemorySubmitter{failures: map[string]error{}}
}

// FailEvery makes the submitter return err for the named event, once.
func (submitter *MemorySubmitter) FailEvery(eventID string, err error) {
	submitter.mu.Lock()
	defer submitter.mu.Unlock()
	submitter.failures[eventID] = err
}
func (submitter *MemorySubmitter) SubmitEvent(ctx context.Context, event poc.SignedEvent) (SubmitResult, error) {
	submitter.mu.Lock()
	defer submitter.mu.Unlock()
	if err, ok := submitter.failures[event.ID]; ok {
		delete(submitter.failures, event.ID)
		return SubmitResult{}, err
	}
	submitter.submissions = append(submitter.submissions, event)
	return SubmitResult{Height: int64(len(submitter.submissions)), CheckCode: 0, DeliverCode: 0, TxHash: event.ID}, nil
}

// Submissions returns the events accepted so far, oldest first.  The slice is a
// copy, so a test cannot accidentally mutate the record.
func (submitter *MemorySubmitter) Submissions() []poc.SignedEvent {
	submitter.mu.Lock()
	defer submitter.mu.Unlock()
	out := make([]poc.SignedEvent, len(submitter.submissions))
	copy(out, submitter.submissions)
	return out
}
