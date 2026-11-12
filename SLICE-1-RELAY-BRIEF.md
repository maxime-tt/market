# Slice 1 — Relay transport (validators observe Nostr events)

Objective: a Nostr relay is the transport for auction events. Validators *observe* the
relay and submit what they see as chain transactions. Nobody POSTs a signed event to the
validator API to get it committed. HTTP stays alive as a fallback during the transition.

Status: IN PROGRESS. Owner approved the slice order on 2026-11-07.

## Design (keep it small)

- One relay process on loopback (khatru, Go, or go-nostr + a thin server). Persistence:
  in-memory or a single SQLite file. No auth, no moderation, fake-money demo.
- One observer loop per validator: subscribe to kinds 1440 (create), 1441 (bid),
  1443 (refund) since the last seen created_at, verify the event signature (go-nostr
  does this), then submit it as the existing `Transaction{Event: ...}` to CometBFT.
- Idempotence: the chain already has `Operations[...]` keys per event id, so a duplicate
  submission is a no-op. This is what makes multi-validator observation safe.
- **The relay is transport only.** Never a clock, never a sequence source. All time rules
  keep running on committed block time.
- The producer side (the page) publishes to the relay instead of calling POST /api/event.
  Keep POST /api/event working behind a flag so a relay outage cannot make the demo
  unbiddable mid-testing.

## Acceptance (owner clickable)

1. `wscat`/a script publishes a signed create event to the relay; nothing touches the API.
2. Within a few seconds the auction appears in `GET /api/state` and on the page, and the
   committed block shows the event.
3. Two identical publishes produce exactly one committed auction.
4. Stop the relay, publish attempt fails; restart it, publish succeeds, nothing is lost.

## Gates

- `export PATH="$HOME/.local/go/bin:$PATH"; GOWORK=off GOTOOLCHAIN=local go build ./...`
- `GOWORK=off GOTOOLCHAIN=local go test -mod=readonly -count=1 ./internal/poc/`
- The event-signature path must go through the same verification as today (no bypass).
- Independent verification by the parent: drive the relay from outside the app.
