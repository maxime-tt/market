package relay

import (
	"context"
	"fmt"
	"time"

	cmttypes "github.com/cometbft/cometbft/types"

	"github.com/maximotodev/plebeian-auctions-poc/internal/poc"
)

// EventSubmitter is the poc.APIServer capability the adapter needs: broadcast
// one already-encoded transaction and report the commit outcome.  poc.APIServer
// satisfies it with BroadcastRawEvent.
type EventSubmitter func(ctx context.Context, raw []byte) (poc.BroadcastOutcome, error)

// APIServerBroadcaster adapts such a function into the Broadcaster the observer
// uses, so the relay package never links the CometBFT HTTP client itself.
type APIServerBroadcaster struct {
	// Submit is poc.APIServer.BroadcastRawEvent or an equivalent.
	Submit EventSubmitter
	// Timeout bounds one call; zero means 20s, the HTTP handler's ceiling.
	Timeout time.Duration
}

func (broadcaster APIServerBroadcaster) BroadcastTxCommit(ctx context.Context, tx cmttypes.Tx) (SubmitResult, error) {
	if broadcaster.Submit == nil {
		return SubmitResult{}, fmt.Errorf("no broadcast function configured")
	}
	timeout := broadcaster.Timeout
	if timeout <= 0 {
		timeout = 20 * time.Second
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	outcome, err := broadcaster.Submit(ctx, []byte(tx))
	if err != nil {
		return SubmitResult{}, err
	}
	return SubmitResult{
		Height:      outcome.Height,
		CheckCode:   outcome.CheckCode,
		DeliverCode: outcome.DeliverCode,
		TxHash:      outcome.TxHash,
	}, nil
}
