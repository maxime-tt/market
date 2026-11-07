package poc

import (
	"context"
	"fmt"
	"os"
	"strings"
)

// RelayObserverEnv names the environment variable that turns on the relay
// transport.  When it is unset, nothing changes: POST /api/event keeps working
// and no observer starts.  When it is set to a ws:// or wss:// URL, a validator
// process also observes that relay and submits what it reads as ordinary chain
// transactions through the same client selection the HTTP path uses.
const RelayObserverEnv = "POC_RELAY_URL"

// RelayObserverStarter attaches an observer to a running API server.  It is a
// function variable rather than a direct call only because of Go's import
// direction: the observer implementation lives in internal/relay and imports
// this package for the event types and the signature check, so this package
// cannot import it back.  main.go, which sees both, assigns the implementation.
type RelayObserverStarter func(ctx context.Context, server *APIServer) (stop func(), err error)

// relayObserverStarter is set once at process start, before any server
// goroutine runs, so it needs no locking.
var relayObserverStarter RelayObserverStarter

// SetRelayObserverStarter installs the observer implementation.  Called from
// main.go before RunCLI.
func SetRelayObserverStarter(starter RelayObserverStarter) { relayObserverStarter = starter }

// RelayObserverURL reports the configured relay URL, empty when disabled.
func RelayObserverURL() string { return strings.TrimSpace(os.Getenv(RelayObserverEnv)) }

// startRelayObserverIfConfigured starts the observer when the environment asks
// for one.  A configured-but-unusable relay is an error the caller surfaces,
// because an operator who set POC_RELAY_URL expects observation, not silence.
func startRelayObserverIfConfigured(ctx context.Context, server *APIServer) (func(), error) {
	url := RelayObserverURL()
	if url == "" {
		return func() {}, nil
	}
	if !strings.HasPrefix(url, "ws://") && !strings.HasPrefix(url, "wss://") {
		return func() {}, fmt.Errorf("%s must be a ws:// or wss:// URL, got %q", RelayObserverEnv, url)
	}
	if relayObserverStarter == nil {
		return func() {}, fmt.Errorf("%s is set but no relay observer implementation is linked", RelayObserverEnv)
	}
	return relayObserverStarter(ctx, server)
}
