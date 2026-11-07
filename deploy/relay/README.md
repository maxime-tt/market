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
   nak event --sec <hex-secret> -k 28640 \
     -c '{"auction_id":"manual","title":"Manual","duration_seconds":300,"starting_bid":1000,"reserve":0}' \
     ws://127.0.0.1:7777
   ```
4. Within a few seconds the auction appears in `GET /api/state` and on the page.

## Known limitation (verified)

The auction kinds 28640/28641/28642 are inside NIP-01's ephemeral range
(20000–29999).  `nak serve` is khatru, and khatru refuses an EVENT for an
ephemeral kind when **no live subscription matches** it — the publish fails with
`mute: no one was listening for this`.  So:

- Keep an observer subscribed before producers publish.  In production the
  observer is always up; the Go tests wait for `Observer.Subscribed()`.
- An event published while no observer is connected is **dropped** by nak/khatru.
  That is safe here (the chain is the record, not the relay), but it means the
  relay is not a durable buffer.  Point at a persisting relay if you need one, or
  preload a batch with `RELAY_EVENTS=batch.jsonl`.
