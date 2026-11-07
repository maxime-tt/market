package main

import (
	"fmt"
	"os"

	"github.com/maximotodev/plebeian-auctions-poc/internal/poc"
	"github.com/maximotodev/plebeian-auctions-poc/internal/relay"
)

func main() {
	// Wire the relay observer before RunCLI.  The observer implementation lives
	// in internal/relay (it imports poc for event types and the signature check),
	// so poc cannot reference it directly; this is the one place that sees both
	// packages, which is exactly what the hook is for.  With POC_RELAY_URL unset
	// the starter is never invoked and POST /api/event remains the only route.
	poc.SetRelayObserverStarter(relay.StartObserverForServer)

	if err := poc.RunCLI(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "plebeian-auctions-poc:", err)
		os.Exit(1)
	}
}
