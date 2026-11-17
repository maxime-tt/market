# NOTE — the validator branch is deployed to the live chain (2026-11-17)

Deployed by the market-side session, at the owner's direction, after reviewing
`docs/VALIDATOR-WORKSTREAMS-2026-11-17-RESULT.md` (see
`notes/REVIEW-2026-11-17-validator-workstreams.md` in this tree).

## What was deployed, and how

- Source: `~/work/wt-validator` @ `feat/validator-workstreams` (`8633e40`, code state `328ce53`).
- `cd chain && go build -o ../bin/arena .` → 49,317,280 bytes; `web/` rebuilt with `npm run build`.
- The live unit `arena-chain.service` runs `/home/admin_maxime/work/arena-merged-ref/bin/arena`
  against the **existing** root `run/chain`. The binary and `web/dist` were replaced in place:
  - previous binary kept as `bin/arena.prev-20261117-before-validator-workstreams`
    (sha256 `286ea7b4331cce2823cfc11a9c88cbe31818ae30a247e39f0a2f4694b284d7d4`),
  - new binary sha256 `2bf70140f721ff04543f76c79506d12b967ccafd7224ec81b61551a1ec5003c9`,
  - `web/dist` kept as `web/dist.prev-20261117` beside the new one.
- `systemctl --user restart arena-chain.service` → `active`, `NRestarts=0`, MainPID 4038665.
- **`arena init` was NOT run.** A re-init regenerates the FROST group key and would strand every
  escrow the app has locked.

## Proof from the outside

- The root was preserved, not re-initialised: `/api/state` went from height **311** to **344** across
  the restart (a fresh root would report single digits), and its 10 auctions are still there.
- The new schemas are in the running binary (`strings bin/arena | grep -c arena.params.v1` → 1, same
  for `arena.statepulse.v1`; the previous binary had **0** of both).
- **Kind 1448 is live**: four params events at 18:45:49, all at height 344, from the four live
  validators (`1e17774d…`, `42178359…`, `4e1c04b9…`, `b81658eb…`) — `group_key`, `mint_url`,
  `keyset_id`, the bounds, `threshold`, `validators`, plus `params_version`.
- **The 10 s commitment heartbeat is live and is the clock win**: the relay now carries several
  distinct `time`s at one unchanged height (height 347 and height 357 each showed 4 timestamps over
  an 11 s span), where the old gate committed a height once. That is exactly the data shape that made
  the read's dedupe key (`time` included) load-bearing.
- **End-to-end on the market app** (which reads the stored 1447 and is already deployed at the same
  commit): the lot page's clock line moved from `Chain time as of height 221, 6383 s ago — stale`
  before the deploy to **`Chain time as of height 361, 6 s ago`** after it.

## The pulse (kind 21447) is undeliverable — measured, not assumed

`nak req -k 21447 wss://relay.playday.it` for 20 s received **nothing**, while the publisher swallows
the relay's `mute: no one was listening for this` by design. Reproduced deliberately: with a live
subscriber for kind 21447 connected, publishing an ephemeral event from a second connection was still
answered `mute: no one was listening for this`, and the subscriber received nothing — the same result
against a stock local `nak serve`. So the pulse cannot reach a client on this stack, and the app must
not be built on it as its clock. The validators' `publishPulse` is best-effort by design, so this cost
nothing except the feature; the stored, time-gated 1447 is what actually delivers the clock.

## Relay noise to be aware of when reading params

`wss://relay.playday.it` holds 12 kind-1448 events from **three** chains: two foreign short-lived test
chains (heights 2 and 20, 15:58–16:00 UTC, two different validator sets) and now the live deployment
(height 344+). A client must anchor-check (`height` + `app_hash` in both the tags and the content,
against a commitment it trusts) rather than taking the newest event.
