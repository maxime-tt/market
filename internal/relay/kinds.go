// Package relay is the observer half of Slice 1: it reads signed auction events
// (kinds 1440/1441/1443) from a Nostr relay and submits them to the chain as
// the same transaction the HTTP /api/event path builds.
//
// The relay itself is not implemented here.  It is an external process (the
// brief's `nak serve`, or any other NIP-01 relay) and it is transport only: it
// never timestamps, never orders, never decides validity beyond a signature
// check.  Every time rule keeps running on committed block time, and the chain
// stays the only source of truth.
//
// Storage: the auction kinds 1440/1441/1443 are NIP-01 REGULAR kinds
// (1000 <= n < 10000), so a conformant relay is expected to STORE them. This is
// why the kinds were moved out of the earlier ephemeral numbering (2864x, inside
// the 20000-29999 range): khatru refuses an EVENT for an ephemeral kind when no
// live subscription matches it ("mute: no one was listening for this") and does
// not buffer it, so nothing was ever retained. Two consequences remain worth
// stating for deployment:
//   - A regular kind is not addressable: the relay stores every version side by
//     side and performs no replacement. Supersession and latest-version
//     resolution are the application's job, not the relay's.
//   - The chain, not the relay, is still the record. An observer must be
//     subscribed to forward an event into consensus; tests wait for Subscribed().
package relay

import (
	"github.com/nbd-wtf/go-nostr"

	"github.com/maximotodev/plebeian-auctions-poc/internal/poc"
)

// AuctionKinds are the only kinds this observer transports: create, bid, refund.
var AuctionKinds = []int{poc.KindCreate, poc.KindBid, poc.KindRefund}

// IsAuctionKind reports whether kind is one this observer transports.
func IsAuctionKind(kind int) bool {
	for _, auctionKind := range AuctionKinds {
		if kind == auctionKind {
			return true
		}
	}
	return false
}

// ToSignedEvent converts a go-nostr event into the application's on-the-wire
// form.  Tag order and values are preserved exactly: the event id is a hash over
// them, so any reordering or loss would invalidate a legitimate event.
func ToSignedEvent(event *nostr.Event) poc.SignedEvent {
	converted := poc.SignedEvent{
		ID:        event.ID,
		PubKey:    event.PubKey,
		CreatedAt: int64(event.CreatedAt),
		Kind:      event.Kind,
		Content:   event.Content,
		Sig:       event.Sig,
	}
	converted.Tags = make([][]string, len(event.Tags))
	for index, tag := range event.Tags {
		converted.Tags[index] = append([]string(nil), tag...)
	}
	return converted
}

// FromSignedEvent is the inverse, used by tests and by anything that needs to
// hand an observed event back to go-nostr helpers (publishing, checkid).
func FromSignedEvent(event poc.SignedEvent) *nostr.Event {
	converted := &nostr.Event{
		ID:        event.ID,
		PubKey:    event.PubKey,
		CreatedAt: nostr.Timestamp(event.CreatedAt),
		Kind:      event.Kind,
		Content:   event.Content,
		Sig:       event.Sig,
	}
	converted.Tags = make(nostr.Tags, len(event.Tags))
	for index, tag := range event.Tags {
		converted.Tags[index] = nostr.Tag(append([]string(nil), tag...))
	}
	return converted
}
