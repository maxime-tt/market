# Slice 1 relay (transport only)

The auction-event relay is `nak serve` — an in-memory NIP-01 relay — launched as
an **external process**.  It is transport, not a source of truth: the CometBFT
chain is durable, and this relay can be restarted or lost without losing committed
state.  Nothing here installs or starts anything system-wide, and it never touches
the running `auctions-mvp-demo.service`.

## Run it

```bash
deploy/relay/run-relay.sh                       # ws://127.0.0.1:7777
RELAY_PORT=7778 deploy/relay/run-relay.sh       # another port
```

Or as a systemd **user** unit (not system-wide):

```bash
mkdir -p ~/.config/systemd/user
cp deploy/relay/plebeian-auctions-relay.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now plebeian-auctions-relay.service
```

## Point on a validator

Set `POC_RELAY_URL` on the validator that should observe the relay, e.g.
`POC_RELAY_URL=ws://127.0.0.1:7777`.  With it unset, the observer does not start
and `POST /api/event` is the only admission route, exactly as before.  Run one
observer per validator; the chain's per-event `Operations` keys make concurrent
observers converge on one committed event.

## Manual end-to-end check (third-party tooling → relay → observer → chain)

1. Start the relay: `deploy/relay/run-relay.sh` (note the port).
2. Start a validator/demo with `POC_RELAY_URL=ws://127.0.0.1:7777`.
3. Publish a signed create event with only `nak`, nothing touching the API:
   ```bash
   nak event --sec <hex-secret> -k 1440 \
     -c '{"auction_id":"manual","title":"Manual","duration_seconds":300,"starting_bid":1000,"reserve":0}' \
     ws://127.0.0.1:7777
   ```
4. Within a few seconds the auction appears in `GET /api/state` and on the page.

## Storage behaviour (regular kinds)

The auction kinds 1440/1441/1443 are **regular** kinds (1000 <= n < 10000), so
`nak serve` (khatru) is expected to **store** them.  They were moved out of the
earlier ephemeral numbering (2864x, inside 20000–29999), where khatru refused an
EVENT whenever **no live subscription matched** it (`mute: no one was listening
for this`) and buffered nothing — so nothing was ever retained.  Note:

- A regular kind is **not addressable**: the relay keeps every version side by
  side and does no replacement.  Create supersession and latest-version
  resolution are the application's job, not the relay's.
- The chain, not the relay, is the record.  Keep an observer subscribed so an
  event is forwarded into consensus; the Go tests wait for
  `Observer.Subscribed()`.  Point at a persisting relay, or preload a batch with
  `RELAY_EVENTS=batch.jsonl`, if you need the relay itself to survive a restart.
