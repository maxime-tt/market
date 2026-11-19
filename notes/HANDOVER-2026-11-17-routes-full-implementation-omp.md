# HANDOVER — the routes-authoring programme, for full implementation

**For:** an omp session taking over the implementation.
**Written:** 2026-11-17 by the Hermes session that produced the plans below.
**Repo:** `/home/admin_maxime/work/market` (main checkout, `master`). Bun runtime, React 19, TanStack Router + Query.

This document is self-contained. Read §1 for the requirement, §2 for what already works, §3 for the work order,
§4 for the house rules that will otherwise cost you a day, §5 for the measured baselines you must not regress.

---

## 1. The requirement

The owner's words, which are the specification:

> "my imagining was that I could go and basically build a page somewhere … and basically be able to publish that
> page underneath a route of the app, and then similarly, I could go to the routes section and then open up the
> pages that I've published under each of the different routes. **Those are not storefronts for users. Those are
> pages in the app.**"

And on the authoring shape:

> "we would need a second way to open that same editor as a custom page editor … I would add a create route which
> allows you to create a new page … and then an edit route which allows you to edit an existing page. Obviously you
> can edit either the name or you can edit the page itself. The routes name, yeah it's basically just a name and
> then the page you could pick between existing pages."

And on rendering, a constraint not a detail:

> "I wouldn't have a default component inside of the page, because the page itself should be the one deciding what
> to display … you can put a block inside that's the title block. But then I can still go in the CMS and delete that
> block. It's not built into the page."

**The owner's ruling on scope for this version:** an admin-authored page may **replace a built-in dashboard view**,
but since the CMS cannot yet compose app pages, **do not allow writing over app pages in this first version** —
that is a later feature. The "escape hatch" idea he offered for a later version: a prefixed path such as
`__/default/<original-route>` so a replaced app route stays reachable.

## 2. The architecture is already ruled — do not re-design it

The design programme exists and is **binding**. Read it before writing code:

- `runs/2026-11-13-admin-routes/ARCHITECTURE.md` — the architecture, with revisions
- `runs/2026-11-13-admin-routes/IMPLEMENTATION-PLAN.md` — 1241 lines, **increments 1–9 in dependency order**, each with goal, exact files, evidence commands with expected numbers, exit criteria, and what it does not do
- `runs/2026-11-13-admin-routes/*.md` — **eleven owner rulings**, several quoting him verbatim. Where a ruling and the plan disagree, the ruling wins.
- `runs/2026-11-13-admin-routes/PLAN-increment-2-reconciled.md` — increment 2, reconciled against the shipped stack (see §3)
- `runs/2026-11-13-admin-routes/PLAN-authoring-ui.md` — the authoring UI plan (see §3)
- `notes/HANDOVER-2026-11-16-routes-authoring-plans.md` — the prior session's handover, with the verified findings

Two rulings that shape everything:

- **`ruling-d8-multipage-and-lists.md`** — one page per author was a misunderstanding. **Many pages per author, hundreds.** Each has a unique path. A general path (e.g. `/featured`) resolves to the **newest** page of its series. The home is just another path. It also **rejects** the idea of a single rewritten kind-30000 event carrying hundreds of page entries (size ceiling, lost updates, wrong authorship): pages are their own addressable events and the route table is a **resolution layer over them**.
- **`ruling-react-components-and-deferred-widgets.md`** — the widget/web-component layer is **DEFERRED**; pages use **the existing React block types**. Do not build a widget bundle system.

And the standing architectural invariant (`ARCHITECTURE.md` §2): **nothing on the read/serve path may consult a
relay or an indexer** to decide which path matched, or to render a bound page.

## 3. The work order

Dependency-ordered. Items 1 and 2 are **done**; start at item 3.

### ✅ DONE — Increment 1 (built and merged, long before this handover)
The routing file, the local page store, the resolution ladder, and one ingest endpoint:
`platform/server/routes/{routeFile,resolve,pageStore,pageRender,pageHtml,routeTable,shell}.ts`,
`platform/server/http/appEvents.ts`, `sdk/config/routeNames.ts`, wired in `platform/server/buildServer.ts`.
`pageStore.ts` also maintains an **on-disk series index** at `data/pages/series/<key>/<author>.json` with a
`seriesMembers(series, author)` accessor — **but nothing calls it for resolution yet.** That is item 3's job.

### ✅ DONE — Slice 0, the ingest switch (built, verified, merged)
Merged as `7b253ec88` on `unite/1420-all`. **This was the missing link and it is why nothing served before.**

The defect: `platform/web/storefront/storefrontPublish.ts` published a page to **relays only**, while the serve
path reads **only** the local page store (`buildServer.ts` → `pageStore.get`), which is populated **only** by the
ingest (`appEvents.ts` → `pageStore.put`). So a published page was never servable, and a bound path answered 500
`binding-target-missing` forever.

What was fixed: `publishStorefrontPage` now POSTs the same signed event to `/api/app-events` after the relay ACK
(request shape copied from `platform/web/routes-authoring/routeTableQuery.ts`), requires `stored: true` rather than
just HTTP 200, and **throws an honest error** when the ingest leg fails — telling the author the page reached N
relays but is not servable on this instance, and that the relay copy stands. `unpublishStorefrontPage` delegates
there, so the `enabled:false` document travels the same path. The serve path additionally refuses a stored page
whose `document.enabled !== true`, so a withdrawn page stops answering at its bound path.

**Verified by the writing session, not just claimed:** 152 pass / 0 fail across `platform/web/storefront/` +
`platform/server/routes/`; and **RED proven** by reverting only the implementation and re-running the child's own
tests — 6 failed, including the end-to-end case "publish → ingest → store → the bound path answers with the page
bytes". New file `platform/web/storefront/storefrontIngest.e2e.test.ts` is the reusable harness for this.

### ▶ NEXT — Increment 2: the page-path layer
**Plan:** `runs/2026-11-13-admin-routes/PLAN-increment-2-reconciled.md`. Implement it; do not re-derive it.

What it delivers: **per-page identity** (a page publishable at an arbitrary `d` instead of the single frozen
`STOREFRONT_PAGE_D_TAG = 'storefront-page'`), **path → page** resolution, and **series → newest page**. Files: 4
new, 15 modified (pageStore gains a `has(author,d)` accessor; `routeFile.ts` gains `SeriesTarget { type:'series',
series, author }`; a new `platform/server/routes/series.ts` is the only caller of `seriesMembers()` for resolution;
`resolve.ts` gains a rung fed an **injected** resolver via an optional `ResolveContext` so it stays pure and does
no I/O).

Two findings from the reconciliation that the plan records and you should trust over the older order:
- **The old 32 KiB claim budget is refuted by measurement.** At ~335 B per binding the shipped serializer refuses
  the **98th** binding (97 = 32,563 B; 98 = 32,896 B; 500 = 167,562 B — re-measured independently and
  reproduced). The owner requires *hundreds* of pages, so that cap would break the requirement. Replacement: a
  **4 MiB** runaway ceiling checked in `serializeRoutesFile`, refuse-never-truncate.
- **The order's own byte figures do not reproduce** (25,651 vs its stated 32,681 at 230 claims).
- **`order-increment-2.md` was written for the kind-30000 sdk claim table, which never merged.** 10 parts survive,
  9 are refuted, 7 re-derived. The plan says which is which, item by item.

### ▶ THEN — Increment 3: serving and the client seam
`/` becomes just another path (the default), and the client hydrates the server-rendered DOM rather than
re-rendering it. `IMPLEMENTATION-PLAN.md` increment 3; note the plan's own "no relay on the read path" invariant.

### ▶ THEN — the authoring UI
**Plan:** `runs/2026-11-13-admin-routes/PLAN-authoring-ui.md`. It covers the page identity UI, the **page picker
that replaces the pasted npub** in the Routes table, and the create-route / edit-route flows.

What exists today and is the wrong shape: the `Routes` page at `/dashboard/app-settings/routes` has exactly three
inputs (path, author pubkey, `d` tag) and **cannot build anything**; its `validateDraft` requires the operator to
**paste an npub**. The only page anyone can build is the single storefront at
`/dashboard/account/profile-page`, hard-wired to the signed-in user's own pubkey.

Two things the plan measured that you must respect:
- **`StorefrontBuilder` is pinned to `(pubkey, storefront-page)` in EIGHT places**, not one: the read
  (`useStorefrontPage(pubkey)` never passes a `dTag`), five draft calls (`loadStorefrontDraft` /
  `saveStorefrontDraft` / `clearStorefrontDraft`), and the publish hook's invalidation key. Widen the signature
  deliberately; do not fork the component.
- **This is the declared cross-track interface**: increment 2 changes `storefrontPublish.ts`'s signature (an
  optional `PageAddress` with `dTag` and `series`); the UI consumes it. Land increment 2 first.

Placement rules (ADR-0007): `ui/` is **generated — no diffs accepted**; `ui-wrappers/` wraps a `ui/` primitive;
`shared/` is the ceiling for hand-authored general-purpose components. A reusable block inlined in a page is a
review finding here.

### ▶ ALSO — migrate `scripts/seed.ts` to the 1440 arena series
**Recorded, not yet dispatched.** The e2e instance's auctions surface is empty because the seed publishes the
**retired** family: `scripts/seed.ts:447` hardcodes coordinates as ``30408:${pubkey}:${auctionId}`` and
`AUCTION_KIND = 30408` (`sdk/commerce/auctions/constants.ts:39`). The app's live auction surfaces read the
consolidated **1440** arena series (`ARENA_AUCTION_KINDS`), of which the relay holds **0**. Everything else the
seed writes (50 products, collections, shipping, orders, featured lists) is correct and present.

### HELD / DEFERRED — do not build without a fresh go-ahead
- **Increments 4, 6, 7** — the paid-lease half: `may()`/grants, the three-tier ACL, zap/nutzap route reservations,
  payment-proof persistence, verification. The owner approved stopping at admin-authored pages and routes.
- **Increment 9** — the widget/portability layer, deferred by the owner's ruling.
- **Tier 2** — modular sub-apps (deep sub-paths with their own sub-pages) and general list management. Ruled
  *later but committed*; no increments written. Do not preclude it: keep deep programmed prefixes legal, and keep
  the `list` reference parsed-and-refused in the union rather than removing it.

## 4. House rules that will otherwise cost you a day

- **NEVER push to `origin`.** Its token belongs to a different account. The working remote is `fork`
  (`https://github.com/maxime-tt/market.git`); there is also `nostr` (ngit). The integration branch is
  **`unite/1420-all`** — never `master` for feature work. `master` carries the design docs.
- **Commit locally, verify, then push.** If you delegate to sub-agents, tell them to commit and **never push**;
  the parent verifies each claimed artifact itself and pushes. A child's summary is a self-report, not proof.
- **Do NOT run project-wide `bunx tsc --noEmit` casually.** It takes ~400 s and OOMs a small runner. When you do
  run it, use `NODE_OPTIONS=--max-old-space-size=6144 bunx tsc --noEmit -p tsconfig.json` and compare the
  **sorted error SET** (`comm -13`), not the count — line-shifts move counts without a real change.
- **Tests: `bun test --isolate <path>`.** The repo's pinned `bun` differs from `$PATH`'s; trust the `bun test v…`
  banner. `mock.module` leaks across files without `--isolate`.
- **RED before GREEN.** A test never seen failing proves nothing here. Prove the fix by reverting only the
  implementation and re-running the new test.
- **Never present a mechanism you have not measured.** Typings, doc comments and plausible reasoning have each
  been wrong in this repo. Settle library semantics with a small probe, and say what you measured.
- **A targeted edit can silently delete a neighbouring line.** One happened twice in the prior session: a
  `patch` whose `new_string` was a truncation of `old_string` dropped an import (`arenaBidBinding` from
  `monitor.ts`). Read the returned diff after every structural edit on a large file.
- **Worktree discipline.** One worktree per parallel stream, and never two agents in one worktree — that
  produced a destroyed uncommitted tree earlier in this programme. A fresh worktree needs a real
  `bun install --frozen-lockfile`; a **symlinked** `node_modules` breaks here (`@cashu/cashu-ts` .d.ts relative
  imports), so never symlink it.
- **`data/routes.json` is runtime state and gitignored** — do not commit it.

## 5. Measured baselines — do not regress these

Taken on `unite/1420-all` after slice 0 merged (`7b253ec88`):

| what | command | expected |
| --- | --- | --- |
| typecheck | `NODE_OPTIONS=--max-old-space-size=6144 bunx tsc --noEmit -p tsconfig.json` | **189** `error TS` at `0c481e5d8` (the commit slice 0 was based on), and **zero new signatures** vs the pre-wave baseline. The run **after** slice 0 merged was still in flight when this was written — expect **≤189 with no new signature**; treat anything above as a regression and check it before proceeding. |

| storefront + server routes | `bun test --isolate platform/web/storefront/ platform/server/routes/` | **152 pass, 0 fail** |
| the wide slice suite | `bun test --isolate platform/web/config/ platform/web/curation/ platform/web/featured/ platform/web/notifications/ sdk/` | **≈2096 tests, 3 fail, 1 error** — the 3+1 are Cashu-mint integration suites needing a real mint; **environmental, not yours** |
| guards | `bash scripts/check-{ndk-footprint,ndk-direction,src-boundary,auctions-ndk-surface}.sh` | all **EXIT=0**. NDK footprint 27 files (baseline file says 59); auctions surface scans 77 production files |

The pre-wave baseline log the typecheck comparison is made against is `/tmp/before.txt` (200 errors, sorted with
positions stripped). Reproduce the comparison as:

```bash
NODE_OPTIONS=--max-old-space-size=6144 bunx tsc --noEmit -p tsconfig.json 2>&1 | tee /tmp/now.log
grep "error TS" /tmp/now.log | sed -E 's/\([0-9]+,[0-9]+\)/():/' | sort -u > /tmp/after.txt
comm -13 /tmp/before.txt /tmp/after.txt   # must print nothing
```

The live e2e instance is `https://market-e2e.playday.it` → Caddy → `:8797` (`kami serve`, cwd `wt-e2e`) → the app
on `:3460`, unit `market-e2e.service`, `APP_STAGE=staging`, reading `wss://relay.playday.it` (the local
`market-relay.service` on `127.0.0.1:7777`). **`wt-e2e` is checked out at `1154be66a`**, which is *behind*
`unite/1420-all`; redeploying it to the merged head is a sensible first step if you want the e2e instance to
exercise your work. Environment/credentials: `~/.market-v4v-env` (contains `APP_PRIVATE_KEY`, `CVM_SERVER_KEY` —
never print or commit these). To reseed: `set -a; . ~/.market-v4v-env; set +a; export APP_STAGE=staging;
bun run seed` from `wt-e2e`.

## 6. Open decisions the owner still owes an answer on

1. Whether to keep or retire the now-unrendered `fetchAuctions` (it reads the retired 30408 family and has no
   importer; its three red tests were removed on his call, and the working tree still contains the function).
2. Nutzaps and the `profilePublish` merge base.
3. The `contextvm` arena validator: retired, and reinstating it is a fresh build rather than a revert.

## 7. Suggested first three actions

1. `git -C /home/admin_maxime/work/market worktree add ../wt-inc2 -b d7s2/inc2-page-paths unite/1420-all`, then
   `bun install --frozen-lockfile`, and implement **increment 2** from the reconciled plan.
2. Land it, then implement **increment 3**.
3. Then the **authoring UI** from its plan, coordinating the `StorefrontBuilder` address seam with what increment 2
   landed.

Keep the increments in that order: increment 2 and the UI both edit
`platform/web/storefront/storefrontPublish.ts`, so they must not run in parallel.
