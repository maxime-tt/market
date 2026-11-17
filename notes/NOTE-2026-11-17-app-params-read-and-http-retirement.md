# NOTE — the app reads the escrow terms from the relay; the HTTP path is retired (2026-11-17)

This is the app-side half of validator workstream **D** (`notes/NOTE-2026-11-17-validator-branch-deployed.md`),
landed once the chain's kind-1448 params event was live on `wss://relay.playday.it`.

## What changed

- **A params read for the app** — `platform/web/auctions/relay/arenaParamsRead.ts`: subscribes to kind
  **1448** (`arena.params.v1`), verifies it the way the verdict path verifies a kind-1445 verdict
  (signature, schema, the **mandatory anchor with the tag copy agreeing with the content copy**,
  roster membership), keeps the newest **anchored** reading by height, and exposes the escrow terms
  with every unknown as `null` (never a default, never a `0`). `params_version` is carried as an
  **opaque comparison token** and is never recomputed.
- **The last HTTP reader is gone** — `platform/web/auctions/relay/AuctionBidHost.tsx`'s
  `createHttpPorts({ apiBase: '/api/auctions' }).getConfig()` is replaced by that read. The committee
  key, mint, keyset, bounds, proof cap and threshold now come from the relay; the two locktime terms
  (`settlement_safety_sec`, `bid_to_consensus_latency_sec`) are taken from the relay and a missing one
  is a named refusal, not the old 900/15 fallback.
- **Deleted in the same change** — `platform/server/http/auctionsProtocol.ts`,
  `platform/web/auctions/protocol/{client,httpPorts}.ts`, their two tests, the `AUCTIONS_PROTOCOL_UPSTREAM_URL`
  export and the `buildAuctionsProtocolRoutes()` mount in `platform/server/buildServer.ts`. The retired
  MVP `reserve()` path went with `client.ts`; it had no caller but its own test.

No env file named `AUCTIONS_PROTOCOL_UPSTREAM_URL` (checked `.env*.example` and `deploy-simple/env/*`).

## Historical citations

Older dated notes — `notes/DECISION-auction-kinds-and-editable-allowlist.md`,
`notes/HANDOVER-2026-11-12-cms-auctions-analytics.md`, `notes/RESULT-2026-11-17-app-side-lane.md` — still
name the retired files. They are records of the state they were written in and are left as written; this
note is the current state. The two live _code_ comments that cited `protocol/client.ts` were re-pointed to
the reference chain's `BidContent` (`chain/app.go`).
