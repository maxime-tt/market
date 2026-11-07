package relay

import (
	"context"
	"errors"
	"sync"

	"github.com/nbd-wtf/go-nostr"
)

// Subscription is one live relay subscription over a websocket client.  Events
// is closed when the connection ends; CloseReason explains why.
type Subscription struct {
	Events chan *nostr.Event

	relay *nostr.Relay
	inner *nostr.Subscription

	mu     sync.Mutex
	reason error
	closed bool
}

// CloseReason returns the error that ended the subscription, or a generic reason
// if it ended without one.  The observer turns a non-nil reason into a reconnect.
func (subscription *Subscription) CloseReason() error {
	subscription.mu.Lock()
	defer subscription.mu.Unlock()
	if subscription.reason != nil {
		return subscription.reason
	}
	return errors.New("relay subscription ended")
}

// Close tears down the connection.  Safe to call more than once; the observer
// defers it on every session.
func (subscription *Subscription) Close() {
	subscription.mu.Lock()
	if subscription.closed {
		subscription.mu.Unlock()
		return
	}
	subscription.closed = true
	subscription.mu.Unlock()
	if subscription.inner != nil {
		subscription.inner.Close()
	}
	subscription.relay.Close()
}

// connectAndSubscribe dials the relay and opens a subscription for filters.
//
// The historical replay is the hard part of acceptance #4: go-nostr's Subscribe
// uses the filters' `since`, which a relay answers from its stored events, so a
// reconnect with an advanced `since` re-fetches exactly the window that may have
// been missed while this observer was down.
func connectAndSubscribe(ctx context.Context, url string, filters nostr.Filters) (*Subscription, error) {
	relay, err := nostr.RelayConnect(ctx, url)
	if err != nil {
		return nil, err
	}

	subscription := &Subscription{Events: make(chan *nostr.Event, 256), relay: relay}

	inner, err := relay.Subscribe(ctx, filters)
	if err != nil {
		relay.Close()
		return nil, err
	}
	subscription.inner = inner

	// go-nostr owns the raw channels; one goroutine pumps them onto Events and
	// records why the connection ended.  The relay is only closed after the pump
	// drains, which is what lets Close() be called from the session defer without
	// racing the event stream.
	go func() {
		defer close(subscription.Events)
		for event := range inner.Events {
			select {
			case subscription.Events <- event:
			case <-ctx.Done():
				subscription.setReason(ctx.Err())
				return
			}
		}
		if context.Cause(relay.Context()) != nil {
			subscription.setReason(context.Cause(relay.Context()))
		} else if relay.ConnectionError != nil {
			subscription.setReason(relay.ConnectionError)
		}
	}()
	return subscription, nil
}

func (subscription *Subscription) setReason(err error) {
	subscription.mu.Lock()
	if subscription.reason == nil && err != nil {
		subscription.reason = err
	}
	subscription.mu.Unlock()
}
