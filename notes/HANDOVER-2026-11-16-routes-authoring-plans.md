# HANDOVER — 2026-11-16 — the admin-routes authoring programme: plans landed, ingest gap found

**Where.** `/home/admin_maxime/work/market` (main, `master`), worktrees `wt-union-1420` (`unite/1420-all`),
`wt-admin-page-ui` (`d7s2/admin-page-ui`), `wt-page-identity` (`d7s2/page-identity`),
`wt-relay-page-store` (`d7s2/page-store-relay`). All at `1154be66a` unless noted.

**Read first:** `runs/2026-11-13-admin-routes/` on `master` — `ARCHITECTURE.md`, `IMPLEMENTATION-PLAN.md`
(1241 lines, increments 1–9), eleven owner rulings, and the two plans this session added.

---

## 1. What this session established

The owner's framing: an admin should *build a page*, *publish it under an app route*, and *open the pages
published under each route* — and the Routes section must point at page **identities**, not a pasted npub.

**What shipped is half of that.** The `Routes` page (`/dashboard/app-settings/routes`) has exactly three
inputs — path, author pubkey, `d` tag — and cannot build anything. The only page anyone can build is the
single storefront at `/dashboard/account/profile-page`, hard-wired to the signed-in user's own pubkey,
with `d` frozen to `STOREFRONT_PAGE_D_TAG = 'storefront-page'`. So there is exactly **one page per author**
and no page list anywhere in the tree.

## 2. THE CRITICAL FINDING — a published page is not a served page

Verified independently this session, five ways. **This is the reason the feature does not work end to end.**

- `platform/web/storefront/storefrontPublish.ts` publishes to **relays only**. It never calls the ingest.
- The **only** caller of `POST /api/app-events` in the whole web tree is the route-intent write
  (`platform/web/routes-authoring/routeTableQuery.ts:114`).
- The ingest is what populates the store: `platform/server/http/appEvents.ts:206` → `deps.pageStore.put(record)`.
- The serve path reads **only** the local store: `platform/server/buildServer.ts` → `pageStore.get(author, d)`,
  and 500 `binding-target-missing` when absent.
- `data/pages` does not exist — only `pages.example`. Nothing has ever been ingested.

**Consequence:** binding a path to a page today answers `binding-target-missing`. The Routes page's
"Found a published page" hint reads the *relay* copy, so it can report a page as found that the server
cannot serve. `IMPLEMENTATION-PLAN.md:556-557` names this divergence and assigns the fix to increment 3.

**Neither of the two plans owns this.** It is the next slice, and it is the critical path for the owner's
actual request. → **Slice 0 (the ingest switch):** publish a page through the ingest so the server can serve it.

## 3. The two plans landed this session

Both committed on `master` as `8e9ea3342` and pushed to `fork`:

- `runs/2026-11-13-admin-routes/PLAN-increment-2-reconciled.md` (35 KB)
- `runs/2026-11-13-admin-routes/PLAN-authoring-ui.md` (47 KB)

### Increment 2 reconciled — the page-path layer
10 parts survive, 9 refuted, 7 re-derived. Two findings the parent re-ran and reproduced:

- **The 32 KiB claim budget is refuted by measurement.** At ~335 B per binding the shipped serializer
  refuses the **98th** binding (97 = 32,563 B; 98 = 32,896 B; 500 = 167,562 B). R1 (ruling-d8) says an
  author may have **hundreds** of pages, so that cap breaks the requirement. Replacement: a 4 MiB runaway
  ceiling checked in `serializeRoutesFile`, refuse-never-truncate.
- **`order-increment-2.md`'s own byte figures do not reproduce** (25,651 vs its stated 32,681 at 230 claims).
- **`pickPathCandidate` cross-author oldest-wins has no reader** on this stack: a path is bound by exactly
  one routing-file row (`routeFile.ts:204-206`), so the tie-break is the binding, not `created_at`.

Design: `SeriesTarget { type:'series', series, author }` in `routeFile.ts`; a fourth rung in `resolve.ts`
fed an **injected** resolver via an optional `ResolveContext` so `resolve()` stays pure and does no I/O;
`platform/server/routes/series.ts` as the only caller of `pageStore.seriesMembers()` for resolution; a
`has(author,d)` accessor added to `PageStore`. Files: 4 new, 15 modified.

### The authoring UI
Also verified by the parent: `StorefrontBuilder` is pinned to `(pubkey, storefront-page)` in **eight** places
(the read, five draft calls, the publish hook's invalidation key), not one. The plan keeps its own list of
what it cannot satisfy from the owner's framing.

## 4. DONE — the merge's type errors, committed and pushed

Committed on `unite/1420-all` as **`8162a0f42`**, pushed to `fork` + `nostr`. Verified: typecheck **189**
with **zero new signatures** against the pre-slice baseline (it was 200 before the wave, 192 after the
merge with 3 new signatures). The three errors the five-way merge left were:

- `platform/web/notifications/monitor.ts` — (a) the `scheduleAuctionPhaseNotification` parameter was named
  `window`, shadowing the global, so `window.setTimeout` resolved to an arena-window member; renamed to
  `phaseWindow` and the DOM timer named explicitly. (b) the watched-bid feed was annotated `NDKEvent` where
  the extracted `arenaMonitorRules.ts` wants `ArenaEventLike`, losing `created_at`.
  **Also fixed a real latent bug:** `newHigherBidEvents` holds `{event, binding}` **pairs** but line ~816
  read `created_at` off the pair, so every higher-bid notification silently used `nowForBulk`.
- `platform/server/routes/pagesHttp.test.ts:490` — the test's own inline `warnings` annotation omitted
  `message`; the test passes 30/0 at runtime. Type-only.

**Proof, as run:** `NODE_OPTIONS=--max-old-space-size=6144 bunx tsc --noEmit -p tsconfig.json` → **189**
`error TS` lines, and `comm -13 /tmp/before.txt <sorted errors>` printed **nothing** (no new signature). The
label suite went 10 pass / 3 fail → **7 pass / 0 fail**, and the wide suite 6 fail → **3 fail / 1 error**
(the environmental Cashu-mint baseline).

**Trap hit twice here:** a targeted patch on `monitor.ts` silently **deleted `arenaBidBinding`** from the
import list (the new_string was a truncation of the old_string). Always read the returned diff on this file.

## 5. Open items and decisions

1. **The paid-lease half (increments 4–7) is HELD.** The owner approved stopping at admin-authored pages and
   routes. Those increments are zaps/nutzaps, reservations, the three-tier ACL, payment-proof persistence.
   Do not build them without a fresh go-ahead.
2. **The kind-30000 clobber** (`ruling-d3-persistence-and-redesign.md` §3): every vanity receipt rebuilds the
   event from an in-memory map holding only `vanity` entries, dropping route tags. The shipped routes feature
   writes a **local file** instead, so it may not be exposed — **verify before claiming either way.**
3. **Three known-red tests — WIPED (owner's call, 2026-11-16).** `platform/web/config/auctionTestLabelGate.test.ts`
   went 10 pass / 3 fail → **7 pass / 0 fail** (commit `0c481e5d8`, pushed), and the wide suite from 6 fail to
   **3 fail / 1 error** — the environmental Cashu-mint baseline. The three cases asserted that the gate HIDES
   an auction in `fetchAuctions`, which reads the retired 30408 family and has no importer, so nothing it
   returns can be hidden from anyone. The promise is kept against the LIVE arena list, where it passes. The
   fail-open and over-filter guards were kept. **The dead `fetchAuctions` function itself still exists** —
   only its three dead-path cases were removed.
4. **`market-e2e.playday.it` — RESEEDED, with one gap.** The in-memory `nak serve` relay I replaced lived
   only in memory, so its content died with it. The owner approved a re-seed; `bun run seed` was run with
   the unit's own environment (`set -a; . ~/.market-v4v-env; set +a`, `APP_STAGE=staging`; the seed forces
   `LOCAL_RELAY_ONLY=true` itself and reads `APP_RELAY_URL=wss://relay.playday.it`). It completed (exit 0)
   and the relay now holds 50× 30402 products, 25× 30018 collections, 25× 30406 shipping, orders and the
   featured lists. Verified in a browser: the home renders a seeded product with its image.
   **GAP — auctions are still empty, and this is a defect in the seed script, not in the reseed:**
   `scripts/seed.ts:447` hardcodes its coordinates as `30408:${pubkey}:${auctionId}` and
   `AUCTION_KIND = 30408` (`sdk/commerce/auctions/constants.ts:39`), i.e. it publishes the **retired**
   30408/1023/1025 family. The app's live auction surfaces read the consolidated **1440** arena series
   (`ARENA_AUCTION_KINDS`), of which the relay holds **0**. So `/auctions` will show nothing until the seed
   is migrated to 1440. Not yet dispatched.
5. **Dormant:** `contextvm` arena validator (retired; reinstating is a fresh build), nutzap seam,
   `profilePublish` merge base, and the NDK zero-removal programme (groups 3/5/6/7/8 + Wave-K deferrals).

## 6. Next actions, in order

1. **Slice 0 — the ingest switch.** DISPATCHED (`d7s2/ingest-switch`, worktree `wt-ingest-switch` off
   `0c481e5d8`). This is what makes the feature real, and its absence is why nothing serves.
2. Implement increment 2 from the reconciled plan. **Must come AFTER slice 0**: both edit
   `platform/web/storefront/storefrontPublish.ts` (slice 0 adds the ingest POST, increment 2 adds the
   `PageAddress` argument), so they serialise.
3. Implement the authoring UI from its plan — coordinating the `StorefrontBuilder` address seam, which is
   the declared cross-track interface, and which also serialises behind slice 0 on the same file.
4. Migrate `scripts/seed.ts` to the 1440 arena series (§5.4's gap), or accept an empty `/auctions` on e2e.
