# B1 — the multi-relay auction read adapter (stage 2)

Branch: `d7s2/auctions-read-adapter`, off `0a65b4ce6` (stage 1).
Commit: **`7f8e1275d248a0276b31aeab8566d8fc81e6a7be`** — not pushed.
Worktree: `/home/admin_maxime/work/wt-auction-read`.

## Files

Created (only these; nothing else in the tree was written):

- `platform/web/auctions/relay/arenaAuctionRead.ts` — 1326 lines
- `platform/web/auctions/relay/arenaAuctionRead.test.ts` — 645 lines

## The seam decision, and the rule actually cited

The order says to respect "the read seam, and the `ui/` ↔ `platform/` split" in
`AGENTS.md`. **`AGENTS.md` states neither rule by that name.** Its "Primary
directories" (`AGENTS.md:14-23`) still lists `src/`, which does not exist in this
tree; and nothing in it describes a read seam or a `ui`/`platform` split. The
rules that *do* exist and that decide this placement are:

- `sdk/AGENTS.md:38-53` — "Read API doctrine — stream-first": `EventReadContext.stream(filters)`
  "is the default read path"; "Use `stream` for anything list-based or live —
  … bids and auction activity". This module is written against exactly that, and
  `snapshot()` is the bounded form the same paragraph describes.
- `sdk/AGENTS.md:59-61` — `sdk/` stays rxjs-free; the platform adapter owns the
  RxJS→`AsyncIterable` mapping, so transport-touching code belongs in `platform/web/`.
- `ui/AGENTS.md:18-28` — the enforced hard boundary (`ui/boundary.test.ts`): `ui/`
  may not import `@platform/…`, `nostr-tools` or `applesauce-*`.
- `ui/AGENTS.md:120` — "No data fetching. No `fetch`, no `useQuery`, no `useStore`."
- `ui/AGENTS.md:38-41` — "Data adapters … are invoked by the platform/assembler and
  passed down as props." This module is that adapter.
- `AGENTS.md:85-87` — all new relay I/O routes through `sdk/core/nostr-io` via
  `platform/web/sdkNostrIo.ts`.
- `scripts/check-auctions-ndk-surface.sh` — "Route relay I/O, signing, and identity
  through `platform/web/sdkNostrIo.ts`."

Placement: **data side of the read seam, in `platform/web/auctions/relay/`**, beside
stage 1. The one transport-touching function (`createWebArenaAuctionRead`) goes
through `createWebRelayReadContext` from `platform/web/sdkNostrIo.ts`; everything
else in the module is transport-free and testable with fakes.

## What it does

- Subscribes to `1440/1441/1445/1447` — **one independent subscription per relay**,
  not one pooled subscription. That is deliberate: `notes/REPLY-nostr-verdict-contract.md`
  §2 names equivocation as the weakness of a relay-fed read and says the mitigation
  is "publish to ≥2 and have the client diff them"; a pooled subscription cannot diff.
  The module exposes the diff: `verdictDivergence`, `commitmentForks`, and a per-event
  `relays[]` provenance array.
- Dedupe by event id; order `created_at` descending, ties to the **lexically lowest
  id** — derived from `sdk/core/event-store/mergeRules.ts:24-28` ("NIP-01: newer
  `created_at` wins; ties go to the lexically lowest id") and
  `sdk/core/event-store/filter.ts:32-34` (`selectMatching`). Bids order ascending.
- 1440 resolution: root = earliest by `created_at` for `(seller, d)`; a later version
  is an update only if `e` names the root; accepted only if all eleven frozen fields
  (`ARENA_CREATE_IMMUTABLE_FIELDS`, from the decision note §3) are unchanged;
  canonical = latest accepted. Rejected versions land in `snapshot.rejectedCreates`
  with the field that moved (`arena.immutable_field_changed`).
- Resilience: per-relay pumps, a per-relay deadline, and partial results. `snapshot()`
  never rejects on network trouble; it returns what arrived plus `health`.
- No validator contact: the module imports no HTTP client and has no URL other than
  the relay URLs it is given.

## Typecheck

Command (as the order specifies, with the local `bunx` on PATH):

```
NODE_OPTIONS=--max-old-space-size=12288 /home/admin_maxime/.bun/bin/bunx tsc --noEmit
```

| tree | error TS lines |
| --- | --- |
| `0a65b4ce6` + these two files removed (base) | **205** |
| `0a65b4ce6` + these two files | **205** |
| errors in the two new files | **0** |

**Contradiction with the order:** the stated baseline of *exactly 522* did not
reproduce. Measured on this exact base with the exact command and the repo's own
lockfile (`bun install --frozen-lockfile`, typescript 5.9.3), the count is **205**,
and it is 205 after. Two artefacts worth naming, because they explain a wrong
number rather than a wrong tree:

- a fresh worktree has no `node_modules`, and `bunx tsc` then downloads
  typescript@latest and reports **15215** errors on the untouched base;
- symlinking `/home/admin_maxime/work/market/node_modules` into the worktree
  reports **334**, because `@cashu/cashu-ts`'s own `.d.ts` relative imports break
  through the symlink (34 `TS2307`).

Conservation holds where it can be checked: 205 → 205, delta 0.

## Tests

```
/home/admin_maxime/.bun/bin/bun test platform/web/auctions/relay/arenaAuctionRead.test.ts
→ 31 pass, 0 fail, 94 expect() calls

/home/admin_maxime/.bun/bin/bun test platform/web/auctions/relay/
→ 46 pass, 0 fail (31 new + 15 stage-1)

/home/admin_maxime/.bun/bin/bun test platform/__tests__/auctions-ndk-surface-guard.test.ts
→ 11 pass, 0 fail (the strict run against the real repo still passes)
```

Cases covered: the exact four-kind filter; one subscription per relay; dedupe across
three relays with provenance; ordering and the id tie-break; mutable edit supersedes;
latest *accepted* wins; immutable-field edit rejected and named; non-superseding
version rejected; dead relay; slow relay dropped at the deadline (60 ms) with partial
data; empty relay vs unreachable relay; lying relay (wrong kind, bad JSON, immutable
flip); no relays configured; every relay failing; silent-never-EOSE; live stream
caught-up marker; `close()`; caller abort; `projectArenaEvents` standalone.

## Measured against a live local relay — the real read

Two `nak serve` instances were listening (`127.0.0.1:7777`, `127.0.0.1:3299`). Four
events were published to both (a 1440 create, a 1441 bid of 1500, a 1445 verdict
`winner` at height 4242 / `deadbeef`, a 1447 commitment at height 4242 / `cafebabe`),
then read back through the **production wiring** (`createWebArenaAuctionRead` over
`createWebRelayReadContext`), with a third, dead relay `ws://127.0.0.1:9` in the list:

```
bounded snapshot(), 3 relays, deadline 3000ms → 45ms
  auctions: 1   title "Probe lot"   startingBid 1000   versions 1
  bids: 1   topBid { total: 1500 }
  verdicts: [ winner @4242 deadbeef ]
  highestCommitment: { height: 4242, appHash: "cafebabe" }
  auction relays: ["ws://127.0.0.1:3299", "ws://127.0.0.1:7777"]
  both live relays: 4 events, 0 refusals
```

Live read (`events()`), same relays, deadline 6000 ms:

```
wss://7777 → status ok, 4 events, eose true
wss://9    → status timeout, 0 events
health.answered ["ws://127.0.0.1:7777"], health.pending ["ws://127.0.0.1:9"]
```

That live run changed the implementation: the first version inferred "answered" from
`CaughtUpInfo.eose.includes(url)` and reported the *healthy* relay as `'timeout'`,
because the web transport does not reliably surface EOSE (4.8 s in, `info.eose` was
still empty). Health now has `answered` — "delivered an event, or reported EOSE" —
and `eose` is kept literal.

Second measured limitation, stated rather than hidden: on a **bounded** read the
transport's `fetchEvents` turns a connection failure into an empty array
(`sdk/core/ports/poolRelayPort.ts:14-18`), so the dead port 9 came back `status ok,
0 events` on the snapshot path. A bounded read cannot distinguish "empty" from
"unreachable"; `events()` can. Both behaviours are pinned by tests.

## What could not be verified

- **No browser.** The adapter was exercised from Bun against real relays, not from
  the app in a browser; the applesauce pool behaved identically in both, but the
  browser path is unverified.
- **No hostile-relay test with real signatures.** Signature verification is the
  transport's job (`AGENTS.md:39-40`, untrusted relay data), and the fakes do not
  sign. A relay that forges an event's `pubkey`/`created_at` would be caught by the
  transport's Schnorr check, not by this module — unverified here.
- **Quorum is not implemented.** Per-validator verdicts are surfaced and divergences
  flagged; turning them into a winner is stage 3's business.
- **Bids on a 1440 update.** Bids bind to the root id (`e`), per the decision note
  §4.2; no event was observed that binds to a *version* id, so that path is untested
  against the wire.

## Not touched

`/home/admin_maxime/work/wt-e2e`, `/home/admin_maxime/work/auctions-simplify`,
`/home/admin_maxime/work/compare/plebeian-arena-auctions`, and
`runs/2026-11-13-admin-routes/`. Nothing deployed, nothing pushed.