package relay

import (
	"context"
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/maximotodev/plebeian-auctions-poc/internal/poc"
)

// StartObserverForServer is the wiring that main.go registers with
// poc.SetRelayObserverStarter.  It reads the relay URL from poc's environment
// contract, builds a submitter bound to the server's own broadcast path, and
// runs one observer.
//
// It is a plain function over the concrete *poc.APIServer rather than a method
// because the import runs relay -> poc: poc defines the hook type, this package
// supplies the body.
func StartObserverForServer(ctx context.Context, server *poc.APIServer) (func(), error) {
	url := poc.RelayObserverURL()
	if url == "" {
		return func() {}, nil
	}
	if server == nil {
		return func() {}, errors.New("relay observer requires an API server")
	}
	submitter := ClientSubmitter{
		Broadcaster: APIServerBroadcaster{Submit: server.BroadcastRawEvent, Timeout: 20 * time.Second},
	}
	observer, err := NewObserver(ObserverConfig{URL: url, Submitter: submitter})
	if err != nil {
		return func() {}, err
	}
	observerContext, cancel := context.WithCancel(ctx)
	done := make(chan struct{})
	go func() {
		defer close(done)
		if err := observer.Run(observerContext); err != nil && !errors.Is(err, context.Canceled) {
			fmt.Fprintf(os.Stderr, "relay observer stopped: %v\n", err)
		}
	}()
	stop := func() {
		cancel()
		<-done
	}
	return stop, nil
}
