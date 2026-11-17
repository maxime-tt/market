# RESULT — the app-side lane (the parallel work of `HANDOVER-2026-11-17-app-parallel-work.md`)

**Written:** 2026-11-17 by the app-side session. **Base:** the union tip
`unite/1420-all` @ `3d9c61cab`. **Landed on:** `d7s2/app-side-merge` (pushed to `fork`
`maxime-tt/market` and `nostr`), which merges `d7s2/app-read-clock` (`02ba61972`) and
`d7s2/app-layout-a-port` (`07b6998cd`) plus one integration commit (`1bbaefb85`).

Every number below was measured by the parent session on the merged tree or on the running
system — not carried over from a subagent's report.

---

## 1. Done and verified

### 1.1 The read's commitment dedupe key includes `time`

- `platform/web/auctions/relay/arenaAuctionRead.ts` — the identity is now
  `(validatorPubkey, height, appHash, time)` (`time ?? 'no-time'`), and the sort is
  `height desc, time desc`, validator last. Fork/divergence detection still sees every
  `(height, app_hash)` pair.
- Test: `arenaAuctionRead.test.ts` — two commitments at one height with different `time`s no
  longer collapse, and the newest wins.

### 1.2 The chain clock — exposed, honest, and rendered

- New `platform/web/auctions/relay/arenaClock.ts` (+ `arenaClock.test.ts`): anchored
  `time`/`height`/validator/relays, `ageSec`, freshness `unknown | fresh | stale`
  (`ARENA_CHAIN_CLOCK_STALE_AFTER_SEC = 900`, tied to the protocol's `SettlementSafetySec` and
  its 60-900 s anti-snipe windows), a rules clock that takes the highest **agreed** height and
  refuses a forked one (`refusedHeights`), and a monotonic guard (`regressionRefused`). No `0`
  and no `Date.now()` is ever substituted for a chain time.
- Surfaced as `ArenaSurfacesReadState.chainClock` (`auctionSurfacesRead.ts`), with
  `chainClockLabel` in `ui/auction/arena/model.ts` as the only sentence a surface may say.
- **Rendered on the lot page** (the integration commit): the ported Layout A detail view takes
  the host's already-worded label, so the view formats no number itself.
- **Live evidence** on the deployed instance, lot `ccb95f56-afd7-4f95-89b7-5d631e263233`:

  `Chain time as of height 221, 6383 s ago — stale`

  i.e. the anchored time with its height and its age, marked stale rather than presented as
  "now". The chain's current cadence (every 100 blocks, no time bound on an on-demand-block
  chain) is exactly why the clock reads ~1.8 h old — the finding that motivates validator
  workstream A, and the app states it instead of hiding it.

### 1.3 + 1.4 The Layout A port, and one read instead of two

- The Layout A presentation (`ui/auctions/catalogue/catalogue-detail-view.tsx` + tests,
  `catalogue-theme.css` extension, `catalogue-view.tsx`) is ported **props-only** (no
  `@platform/…`, no `nostr-tools`, no `applesauce-*`, no fetching in `ui/`) onto the arena read
  seam; `bidMath.ts` (+ test) carries the delta-vs-position arithmetic.
- Both `/auctions` routes now render the ported views through the existing hosts and
  `useArenaSurfacesRead()`.
- **Deleted:** `platform/web/auctions/catalogue/catalogueQuery.ts` (the
  `fetch('/api/auctions/state')` poll — the second read) and the unrouted
  `platform/web/routes/auctions.catalogue.tsx`; `routeTree.gen.ts` was **regenerated**
  (`bun run generate-routes`), not copied. `platform/web/auctions/catalogue/` now holds only
  `bidMath.ts` + its test.
- The payload's `catalogueProtocolClient.ts` was never taken; the payload's `Header.tsx`
  catalogue link was not taken (Layout A *is* the auctions surface).
- Honesty: `fundingMode` dropped (no arena equivalent), status split into `phase` + `verdict` +
  the read's five-word state + `divergent`, an unstated end renders "End time unknown", verdict
  rows stay a claim rather than a receipt.
- The bid affordance is the host's existing arena bid panel through a `bidPanel` slot — one
  mechanism, no second funding path, no committee key, no new HTTP read.

---

## 2. Gates — measured on the merged tree (`d7s2/app-side-merge` @ `1bbaefb85`)

| gate | before (union tip) | after (merged) |
|---|---|---|
| `bun run test:unit` | 4759 pass / 1 skip / **2 fail** | **4800 pass / 1 skip / 2 fail** (+41) |
| `bun test ui` | 976 pass / 1 fail | **992 pass / 1 fail** (+16) |
| `bunx tsc --noEmit` | **196** errors | **185** (improved by 11, not grown) |
| `check-ui-assembler.sh` | exit 1 — footprint 133 / baseline 138 | exit 1 — footprint **132**; the `auctions.catalogue.tsx` over-baseline row is **gone** |
| `check-ui-styles.sh` | OK | OK |
| `check-src-boundary.sh` | OK | OK |
| `check-auctions-ndk-surface.sh` | OK | OK (76 files, floor 76) |
| `format:check` | red tree-wide (146 files) | unchanged; touched files formatted only |

The 2 unit failures and the 1 ui failure are **pre-existing on the union tip** and identical
before and after: `Platform dependency boundary > web code does not pull server modules into the
browser bundle`, and the `F4` deferred-fix record. `check-ui-assembler.sh`'s exit 1 is also
pre-existing (three `_dashboard-layout/dashboard/app-settings/*` rows sit above the baseline) —
this lane removed one such row and added none. **No assertion was weakened.**

---

## 3. Deployed

`/home/admin_maxime/work/wt-e2e` now serves `1bbaefb85` (previous SHA `3d9c61cab`, kept for
rollback); `market-e2e.service` restarted, `active`, `NRestarts=0`. `https://market-e2e.playday.it`
answers **200 with a non-empty body** on `/`, `/auctions` and `/api/config` (1479b / 1479b /
1786b — a status-only check would pass on a blank site, so the body was checked).

Live browser verification: the list renders the Layout A cards (5 lots, honest incomplete-read
banner, per-card "N of 7 relays answered"); the detail page renders the Layout A detail, the
arena bid panel in its slot, the verdict panel, and the chain-clock sentence above.

---

## 4. Blocked — named, not worked around

| item | blocked on | state |
|---|---|---|
| the bid action bound to the relay params | validator **D** (the new stored params event) | the presentation and the read landed without it; the escrow's terms still come over HTTP and **no committee key was hardcoded** |
| deleting the proxy + `platform/web/auctions/protocol/{client,httpPorts}.ts` + `AUCTIONS_PROTOCOL_UPSTREAM_URL` | validator **D**, and the last HTTP reader moving | **untouched, on purpose** — the last reader is `AuctionBidHost.tsx`'s config read, which needs D first |
| the clock's fast tick (the ephemeral heartbeat) | validator **A** | built against the commitment; a tick becomes a second source later |
| bid-confirmation timing (1-2 s) | validator **C** (prompt block production) | not "fixed" with a longer client wait |

---

## 5. Findings this lane produced

1. **21 of the 25 kind-1440 events on `wss://relay.playday.it` are refused by the app's own
   decoder** with `arena.bad_content: create content has no auction_id` — chain-side test
   fixtures that put the identity only in the `d` tag. The app requires the two to agree, which
   is a deliberate, documented decision; the chain tolerates the field rather than requiring it.
   A wire-contract question for **increment 2**, not changed unilaterally here.
2. **The refund and settle kinds are empty on the live relay**: 1443 = 0, 1444 = 0 (1440 = 25,
   1441 = 25, 1445 = 179, 1447 = 177). That matches the plan — increments 4 and 5 are not
   implemented chain-side yet.
3. **The superseded arena presentation is only retired from `/auctions`.** `ArenaAuctionCard` is
   still rendered by `platform/web/featured/FeaturedSections.tsx` and
   `platform/web/dashboard/SellerAuctionsListHost.tsx`, and `ArenaAuctionDetail` by
   `platform/web/dashboard/SellerAuctionLotHost.tsx` (whose test this lane updated for the read
   shape). Ruling 1 says Layout A replaces the arena presentation, so these three consumers are
   the follow-up that finishes the replacement — reported rather than swept, because they are
   different surfaces (featured strip, seller dashboard) and sweeping them changes behaviour
   the owner has not ruled on.
4. **`unite/1420-all` has not been advanced.** The branch is checked out in
   `~/work/wt-union-1420`, where another session is live; moving the ref under it would leave
   its working tree stale and dirty. The work is on `d7s2/app-side-merge`, pushed to `fork` and
   `nostr`, and the union tip is a direct ancestor of it — so it fast-forwards cleanly whenever
   that tree is free.
