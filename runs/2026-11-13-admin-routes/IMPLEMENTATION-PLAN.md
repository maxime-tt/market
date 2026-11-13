# IMPLEMENTATION PLAN — admin-managed routes, increments in dependency order

**Run:** `runs/2026-11-13-admin-routes` (run A) · **Base:** `/home/admin_maxime/work/market`, `master`, HEAD
`3a07e7067` · **Implements:** `ARCHITECTURE.md` in this directory, whose rulings are binding · **State:**
read-only. This plan specifies work; it does not start it. No source change, no branch, no build, no deploy was
made in producing it.

**How to read this.** Each increment states: its **goal in one line**, the **exact files** it creates/modifies,
the **evidence commands** with the number each must produce, its **exit criteria**, and what it **does NOT do**.
A "rule" cited as `ruling-…md:line` is in `runs/2026-11-13-admin-routes/`. A `file:line` is in the source tree at
`3a07e7067`.

**The governing constraint, repeated because every increment must be checked against it:** nothing in the route
path may consult a relay or an indexer to decide which path matched (`ARCHITECTURE.md` §2) — **and, since
REVISION 2, nothing in the serve path may consult a relay to render a bound page either.** An increment that adds
such a call fails its own exit criteria regardless of test results.

---

## REVISION 4 — what changed and why (a SCOPE CUT)

**Authority:** `ruling-react-components-and-deferred-widgets.md` (owner, 2026-11-13). It **removes a layer** from this
plan — the web-component/widget-bundle work of REVISION 3 — and restores the page-composition model the CMS already
has: **React components, the existing block types**. Increments keep their positions; **increment 9 is deferred, not
deleted**; the **render mechanism at ingest is named and priced** because REVISION 3 left it implied.

### R4.1 Every passage this scope cut changed

| # | passage as written in REVISION 3 | changed by | now reads as |
|---|---|---|---|
| 1 | §1.1 file list, **15 new files**, including `widgetRegistry.ts` + `widgetRegistry.test.ts` | the scope cut | **13 new files** — the registry module and its test are removed. `pageRender.ts` is described as *static blocks → HTML; data-bound blocks → a placeholder* (§1.1) |
| 2 | §1.4.2 table, dynamic row: "a **widget mount point** — `<ar-product-grid data-widget=\"product-grid\">` with the SSR'd empty state as its children" | same | a **placeholder region** carrying the block's `type`, with the block's own "no data yet" view as its content; the existing React slot map fills it **after hydration** (§1.4.2) |
| 3 | §1.4.2, "REVISION 3: in increment 1 every registry entry has `bundle: null` … the existing `StorefrontBlockSlots.tsx` hydration still fills those regions" | same | **deleted**: there is no registry and no bundle. `StorefrontBlockSlots.tsx` is the mechanism, not an interim state (§1.4.2) |
| 4 | §1.4.3 `pageHtml.compose` emits "one `<script type=\"module\" src=\"/widgets/<id>-<hash>.js\">` per **referenced** widget" | same | **no script tag is emitted for any block.** Composition is `<head>` meta + fragment + SPA bootstrap + `#__AR_PAGE__` (§1.4.3) |
| 5 | §1.5 ingest step `4c widget ids resolve in the registry → 400 'unknown-widget'`, and the bullet "An unknown widget id refuses the write" | same | **removed**; steps renumber (`4d → 4c`, `4e → 4d`). One refusal discipline remains: a page that cannot render is not stored (§1.5) |
| 6 | §1.7 **E8** grep includes `widgetRegistry.ts`; **E9** asserts `unknown widget id → 400` | same | E8's file list drops the registry; E9's unknown-widget row is removed. **E10b is added**: hydration parity for the five data-bound regions (§1.7) |
| 7 | §1.8 bullet "**No widget bundle is built or served.** The registry exists and holds the five built-ins…" | same | "**No widget layer at all** — no custom element, no bundle, no registry, no script import. The page's dynamic regions are the app's own React components, filled after hydration" (§1.8) |
| 8 | §2 graph box **9 (the widget layer)**, §2.1 row 9, §2.2 "3, 5 and 9 can start as soon as 1 lands" | same | the box and the row are removed from the dependency graph; §2.2's Track II is **3 → 5**, and §2 states that **nothing in this plan emits a bundle** (§2, §2.1, §2.2) |
| 9 | §9b "Increment 9 — the widget layer" | same | **DEFERRED** banner; kept in full as the design of record, with its exit criteria W1–W13 marked as *not run in this build* (§9b) |
| 10 | §11 **R-4** "the widget layer is new machinery …" as a live risk | same | relabelled **R-4 (DEFERRED)** — a risk of the deferred layer, not of this build; `R-1` absorbs what is actually at risk now, which is the renderer's mechanism and the boundary guard (§11) |
| 11 | §12 rows "who admits a widget to the registry" and "a generic `Widget` block" | same | both marked **deferred with the layer**, and §12 gains the **scope list** (§12) |

### R4.2 Scope — three tiers, and two of them are not this plan

The owner corrected a two-way reading of the scope in the same sitting: **modular sub-apps and list management are IN,
sequenced after the current work** — *"modular subapps, and list management I would both like in - but perhaps after we
can get our current todo list done."* So:

| tier | what | in this plan? |
|---|---|---|
| **1 · NOW** | increments 1–8: the routing file, the page store, serving, the one ingest endpoint, the ACL, leases, the series index, the management surface | **yes — these are the plan** |
| **2 · LATER, committed** | **modular sub-apps** (modular pages with their own sub-paths: browse, seller dashboard, buyer/orders) and **list management** (generalise lists beyond blacklist/featured; a CMS reference meaning "the members of the named list") | **no increments are added**; the architecture must **leave room**, and `ARCHITECTURE.md` §R4.6 checks that it does rather than asserting it |
| **3 · DEFERRED** | the widget/portability layer (custom elements, script binding, widget compiling, git-repo delivery) and the signed ledger | **no** — and §9b / §11 are the deferred record |

**Nothing in tier 2 appears in an increment.** The only obligation this plan carries for it is that no increment
*precludes* it: deep programmed prefixes stay legal (only leases are top-level, `ARCHITECTURE.md` §3.4/§5.2), and the
`list` reference stays in the union as parsed-and-refused (`ARCHITECTURE.md` §6, checked in §R4.6(b)).

### R4.3 What this plan did **not** change

- **The serve path.** Render once at ingest, store the fragment, hydrate the SAME DOM, data-bound blocks fetch their
  own data after hydration. Unchanged, and now *shorter*: one less client mechanism (§1.4.2).
- **The write path, the ACL, leases, the routing file, the page store, the series index, the management surface.**
  Increments 1–8 keep their positions, files and exit criteria except the rows tabled above.
- **Increment 1 is still the proof increment**, and it is still the only increment that builds a renderer.

### R4.4 What renders the fragment at ingest, and what it costs

`pageRender.ts` calls **`renderToStaticMarkup` from `react-dom/server`** over `ui/storefront`'s components, **once, at
ingest, inside the Bun server process**. Measured at `fee719957`, commands in `report-revision-4.md` §2:
`react-dom` is already a dependency (`package.json:92`, installed 19.2.6); `renderToStaticMarkup` appears in **102
files and 0 non-test files**; `platform/server/` has **0** React imports, so the server's only HTML today is string
building (`sdk/commerce/products/ogTags.ts:301-306`); and the real block components **do** render to a string under Bun
with no `window`/`document` (probe: 1054 chars). Costs, all four:

1. **one module** — no dependency, no build step (Bun transpiles the TSX at import);
2. **one boundary-guard entry** — `platform/boundary.test.ts:83-88` forbids `react`, `react-dom*` and `@ui/*` inside
   `platform/server/`, so either the module is allowlisted **by name** or it lives outside that directory. **OUR
   CHOICE**: allowlist it, reason written at the guard;
3. **one hydration obligation** — the five data-bound regions are server-rendered slot-less, so the client must apply
   its slot map **after** hydration or React 19 hydrates them as mismatches (E10b);
4. **nothing else** — no streaming, no SSR tier, no per-request rendering, no style extraction.

---

## REVISION 3 — what changed and why

> **READ THIS FIRST (added by REVISION 4).** The **widget layer** rows of this revision — 1, 2, 10, 11, 12 below, and
> §9b — are **DEFERRED**. The **relay/one-endpoint** rows (4, 5, 6, 7, 8, 9) stand. The tables are kept as history.

**Authority:** `ruling-pages-widgets-and-app-relay.md` (owner, 2026-11-13). It corrects **one layer** of this plan —
the page's **dynamic** layer becomes widgets delivered as script-imported bundles, and the **write path** becomes the
app's internal relay's POST endpoint instead of a bespoke `/api/pages/publish` — and it **confirms** three items
(§R3.2). Increments keep their positions and their dependency order; **one increment is added (9)** and none is
re-litigated. `ARCHITECTURE.md` §REVISION 3 carries the reasoning; this table carries the edits.

| # | passage as written in REVISION 2 | invalidated by | now reads as |
|---|---|---|---|
| 1 | §1.1 file list, **13 new files**, with `pageHtml.ts` "compose `<head>` + fragment + SPA bootstrap + `#__AR_PAGE__` payload" | ruling §3 | **15 new files**: `pageHtml.ts` also emits the widget mount points and their script imports, and `widgetRegistry.ts` (+ its test) is added (§1.1) |
| 2 | §1.4.2, dynamic row: "an empty, named slot `<div data-ar-block="ProductGrid" …>` — hydrated client-side from the existing query path" | ruling §§1–3 | a **widget mount point**: `<ar-product-grid data-widget="product-grid">` with the SSR'd empty state as fallback. In increment 1 every entry's `bundle` is `null`, so **no script import is emitted yet** and hydration is unchanged (§1.4.2) |
| 3 | §1.4.2 closing: "the serve path does not invent a second renderer for data blocks, and it does not freeze prices into HTML" | ruling §§1–2 | kept **as a statement about the server** (it still never renders dynamic content), and now says **why** in the ruling's own terms (§1.4.2) |
| 4 | §1.5 heading and body: "`POST /api/pages/publish` — the write-restricted ingest … deliberately the **only** way a page enters the store" | ruling §5 | **one kind-dispatched endpoint**, `POST /api/app-events`, which *is* the app relay's POST surface. `POST /api/pages/publish` **does not exist** — two names would be two write paths (§1.5) |
| 5 | §1.5 "Publication to a relay is not part of this endpoint. Under option (i) the app *is* the destination" | ruling §5 | the destination is the **app relay's** ingest surface, which is not a public relay; publication to a public relay is still not part of it (§1.5, `ARCHITECTURE.md` §5.6) |
| 6 | §1.8 "**No Nostr publication, and no relay ingest.** The relay is not asked anything, ever, in this increment" | ruling §5 | **no public-relay publication**, and **no relay *read***, ever. The ingest endpoint *is* the app relay's surface, so "no relay ingest" is retracted (§1.8) |
| 7 | §5/increment 4 files: `new platform/server/http/routes.ts — POST /api/routes/<op>`, i.e. a **second** write surface | ruling §5 (one ingest path for signed app events) | the route-intent **branch of the same handler**; no `/api/routes/<op>` route is created (§5) |
| 8 | §5 exit A2/A3: `curl` against `/api/routes/…` | same | `curl` posts a signed intent event to the one endpoint; the refusal body is unchanged (§5) |
| 9 | §9/increment 8 files: `routesApi.ts — fetch/commands against /api/routes/*` | same | the same single endpoint; the surface posts intents, it does not call a per-op API (§9) |
| 10 | §2 graph and §2.1/§2.2: eight increments, with nothing that builds or serves a widget bundle | ruling §§2–3 | **increment 9 (the widget layer)** is added, dependent on 1 and 3, parallel with 2/4/5. It builds the bundles, the client loader and the registry's first real entries (§9b) |
| 11 | §11 risk list: R-1 (renderer), R-2 (replay window), R-3 (stale compiled-in set) — no widget risk | ruling §§2–3 | **R-4** is added: the widget layer is new machinery with zero precedent, and it collides with `storefrontPage.ts`'s no-remote-script invariant (§11) |
| 12 | §12 "what this plan does not reach" — no row for widget admission policy | ruling §3 ("can link a git repo") | a row is added pointing at `ARCHITECTURE.md` §10 **O-8**: who admits a widget to the registry is a process question, unanswered, and unneeded until the second widget exists (§12) |

### R3.2 What this plan did **not** change

- **Increments 1–8 keep their positions, files (except the ones tabled above) and exit criteria.** The widget work
  is increment **9**, so it cannot destabilise the proof increment.
- **The render-at-ingest decision stands**, including its cost note: increment 1 still builds `pageRender.ts`.
  REVISION 3 only narrows what that renderer must render — static blocks and mount points, never a live surface.
- **The three confirmations are recorded, not re-opened**: modular means **basic replaceable slots** (§4 "NOT",
  §12); sub-app sub-paths **do not** conflict with top-level-only leases (§3.4 / §2.1); **one binding per path and
  the binding wins** (S4/S4b, M2). No increment gains a slot system.
- **No increment writes to a public relay or to the auctions relay**, and none reads either.

---

## REVISION 2 — what changed and why

**Authority:** `ruling-local-pages-acl-and-legacy-routes.md` (owner, 2026-11-13). Three clauses change this plan;
one deletes its riskiest item.

| # | passage as written in revision 1 | invalidated by | now reads as |
|---|---|---|---|
| 1 | §1 **the whole increment** — "the routing file, resolved server-side, end to end", whose proof is *"the binding's page is found by **event id in the URL**, not by an indexer"* | ruling 1 | increment 1 is **the page store plus the resolver**: a signed page is ingested to local storage and served from it. The relay fetch is gone, and with it the whole `pageById` mechanism |
| 2 | §1.1 `pageHtml.ts` — *"fetch a signed kind-30024 event by id + build the HTML shell response"* | ruling 1 | `pageStore.ts` (local read/write) + `pageRender.ts` (document → HTML + meta) + `pageHtml.ts` (compose the response) |
| 3 | §1.4 in full — **"Two reads exist and they are ordered deliberately"**, ending in *"whether a single NIP-01 `{"ids":[<id>]}` read returns the event … is `[U]`, and the first thing to measure"* | ruling 1 | there is **one read and it is local**. `{"ids":[…]}` is no longer on any path, so the increment is no longer gated on a relay property |
| 4 | §1.4 (4) — the fallback *"a server-side page cache … deliberately NOT designed here; the increment stops and reports instead"* | ruling 1 | the "fallback" is now **the design**: the server holds the page it serves. Nothing stops and reports |
| 5 | §1.7 (now §1.8) "does NOT do" — *"No Nostr publication of any kind"* | ruling 1 | still true, but the increment now has a **write** path (`POST /api/pages/publish`), which revision 1 did not have. The allowlist is new and mandatory |
| 6 | §1.6 (now §1.7) E2/E3 — prove the ladder without a relay; boot with a dead `APP_RELAY_URL` | ruling 1 | kept **and strengthened**: the page must also *render* with the relay dead, not merely resolve |
| 7 | §2 dependency graph — increment 1 is a resolver; increment 5 depends on a relay `#t` measurement | rulings 1 + 3 | increment 1 carries the store; increment 5 reads a **local** series index and is no longer relay-gated |
| 8 | §2.1 table row for **5** — "R3 series resolution … needs a resolved path before a series can answer it" | ruling 1 | same dependency, minus the measurement gate |
| 9 | §4 increment 3, exit **S4** — *"the app's own routes are untouched … `/dashboard`, `/auctions`, `/products` → unchanged from before the increment"* | ruling 3 | **REVERSED.** A bound compiled-in path must **serve the binding**. S4 becomes "unchanged **when unbound**", plus a new criterion that a bound `/dashboard` serves the page |
| 10 | §5 increment 4 — **"Blocked on O-1 … The increment does not start until that is settled"** | ruling 2 | **unblocked**. The actor is `event.pubkey`; the function has four levels, `app` at the top |
| 11 | §5 increment 4 — `may()` described for "three tiers", and `app-owned-name` for compiled-in paths | rulings 2 + 3 | four levels; `compiled-in-path` is a **warning**, not a refusal |
| 12 | §6 increment 5 — **"Gated on one measurement … does the this deployment's relay index `#t` on kind 30024"**, with *"the increment stops and reports"* | ruling 1 | **gate removed**. The series index is local, built at ingest; R8 (the relay measurement) is deleted |
| 13 | §6 increment 5 files — `series.ts` issuing `{kinds:[30024], '#t':[…]}` | ruling 1 | `series.ts` reads the local index; the query shape above no longer exists |
| 14 | §9 increment 8, exit **M2** — *"rerouting `/dashboard` is **refused with an explanation** … 'app-owned: `dashboard` is the app's own page'"* | ruling 3 | **REVERSED.** M2 asserts the **opposite**: the binding is accepted, carries `warning: 'compiled-in-path'`, and `/dashboard` serves the bound page |
| 15 | §11 **R-1 (the riskiest)** in full — *"increment 1's page fetch is the one network call that remains, and it is the one I could not measure"* | ruling 1 | **deleted.** The riskiest item is a non-question. R-1 is replaced by the render-at-ingest decision (§11) |
| 16 | §11 **R-2** — *"the actor (O-1) is unspecified, and increment 4 cannot start without it"* | ruling 2 | **closed**; R-2 is now "the replay window is unspecified and we pick one" |
| 17 | §12 table row — *"making `/dashboard` itself reassignable … no ruling requires it and no increment depends on it"* | ruling 3 | **it is the ruling's example**, and increment 4 builds it |
| 18 | §0.3 fact 2 — *"Nothing in `platform/server/` reads or writes a file today → 0, so the file writer in increment 1 is new machinery"* | ruling 1 | still true and now **doubly** true: increment 1 writes a routing file *and* a page store |
| 19 | §3 increment 2, exit **V2** — *"`auctions` is refused as app-owned … closes the live hole"* | ruling 3 | becomes "`auctions` is **accepted with a warning**"; the "hole" is now intended behaviour (`ARCHITECTURE.md` §8.3) |

**What this plan did not change.** Increments 2–4 and 6–8 keep their positions and their dependency edges; the
routing file is still a file with no fallback; leases are still top-level-only and still 404 on expiry; nothing
publishes to Nostr. **The increments stay in dependency order** — 1 → 2 → 4 → 8 is still the sequential track,
and the parallel sets are recomputed in §2.2.

**One new sequencing fact.** Increment 1 now needs a **renderer**, and a renderer needs the page document to be
stable. It is: `sdk/commerce/storefront/storefrontPage.ts` is a closed union with hard bounds, so increment 1
renders *today's* block union rather than inventing one. What it does **not** need is the series tag (increment 5)
or the CMS write path (increment 3).

---

## 0. Ground rules for every increment

### 0.1 Branch, worktree, and the baseline — re-measured per increment

```bash
cd /home/admin_maxime/work/market
git worktree add ../wt-ar-<inc> unite/1420-all          # NOT master: order.md:37-46
cd ../wt-ar-<inc> && git switch -c admin-routes/<inc>
/home/admin_maxime/.bun/bin/bun install --frozen-lockfile
```

- **The integration target is `unite/1420-all`, never `master`** (`order.md:37-46`). `order-increment-1.md:30`
  cut from `1ed3d676a` (a `master` commit) — that is a defect the review recorded (`review-adversarial.json`
  F9, "Step 0 violates the frozen order's integration bound"), and it is not repeated here. `[U]`: I did not
  verify that `unite/1420-all` is still the right tip for this work — the plan's first act is
  `git log --oneline -1 unite/1420-all` and a report if it has moved past what `order.md` describes.
- **`bun install --frozen-lockfile` is not optional.** Two measured traps (`order.md:135-142`): a fresh
  worktree makes `bunx` fetch `typescript@latest` and report **15215** errors; symlinking the main checkout's
  `node_modules` reports **334**. Both are wrong-baseline artifacts, not regressions.
- **The typecheck baseline is re-measured on the branch, never carried.** `proposal-v2.md:619-621` is right to
  refuse to carry `205` across branches. Measured on the **dirty main checkout** at `3a07e7067` the same command
  reports **401**, of which **241 are in non-app files** (94 `runs/`, 72 `notes/`, 72 `node_modules/*.d.ts`,
  30 `src/` **[M]**, breakdown in `ARCHITECTURE.md`'s header) — so **every number measured outside a clean
  worktree is an artifact** — including 401, and including any 205 carried in. For increment 1 on
  `unite/1420-all` the expected count is **`[U]`** until step 0 runs. Take it twice, record both, and treat
  **the sorted error list**, not the count, as the assertion:

  ```bash
  NODE_OPTIONS=--max-old-space-size=12288 /home/admin_maxime/.bun/bin/bun bunx tsc --noEmit > "$HOME/.cache/tsc-before.raw"; echo "exit=$?"
  grep -c "error TS" "$HOME/.cache/tsc-before.raw"
  grep "error TS" "$HOME/.cache/tsc-before.raw" | sed -E 's/\([0-9]+,[0-9]+\)//' | sort > "$HOME/.cache/tsc-before.txt"
  ```

  `tsc` exits 2 while printing errors, so the exit code is not the assertion. `node_modules/.bin/tsc` is blocked
  by a command guard — use `bunx` (`order-increment-1.md:62`).

### 0.2 The evidence commands, common to several increments

```bash
# formatting (the repo is prettier-with-tabs; a wrong style fails CI)
/home/admin_maxime/.bun/bin/bun run format:check

# import-direction guards
/home/admin_maxime/.bun/bin/bun test --isolate sdk/boundary.test.ts platform/boundary.test.ts ui/boundary.test.ts

# the server suite (18 test files today — [M] `find platform/server -name '*.test.ts' | wc -l`)
/home/admin_maxime/.bun/bin/bun test --isolate platform/server/
```

**`--isolate` is mandatory for the browse suite and for anything that touches it.** Measured and recorded in
`order.md:143-147`: `bun test --isolate platform/web/browse/` → **168 pass, 0 fail**; without `--isolate` →
**153 pass, 15 fail** in `BrowseIndexHost` and `useBrowseIndexFeed`. That is pre-existing cross-file state bleed.
A report that quotes only one of the two numbers is misleading either way — **quote both**.

### 0.3 A note on the three pre-existing facts that shape the order

1. **The purchase path is unverified** (`ARCHITECTURE.md` §10 O-5): `platform/server/ZapPurchaseManager.ts:175-180`
   prices from the requester's own `amount` tag; `grep -rn 'verifyEvent' platform/server/*.ts platform/server/http/*.ts`
   → only `ogMeta.ts:219` and `websocket.ts:30` **[M]**. No increment that onboards a **paying** lease may ship
   before increment 6.
2. **Nothing in `platform/server/` reads or writes a file today** **[M]**
   `grep -rnE 'bun:sqlite|node:fs|writeFile|readFile|Bun\.file' platform/server/ --include=*.ts | grep -v '\.test\.'`
   → 0, and there is no `data/` directory (`ls data` → absent) **[M]**. So the file writer in increment 1 is
   genuinely new machinery — small, but new. **REVISION 2 makes this doubly true**: increment 1 now writes two
   durable things (the routing table and the page store) and reads one of them on every request. That is what
   makes increment 1 the honest proof of the architecture rather than a refactor.
3. **There is exactly one relay pointer in the app, and it must not be reused** *(REVISION 3)*.
   `export const RELAY_URL = process.env.APP_RELAY_URL` (`platform/server/runtime.ts:19`), pointing at the local
   placeholder in dev (`.env.dev.example:2`, `ws://localhost:10547`) and at the real public relay in production
   (`deploy-simple/env/.env.production.example:14`). The app's own internal relay — the ingest surface of §1.5 — is
   a **different** thing and needs a **different** setting. Any increment that reuses `APP_RELAY_URL` for it has
   conflated the two relays `ARCHITECTURE.md` §5.6 forbids, and that is a fail regardless of test results.

---

## 1. Increment 1 — the page store, served from local storage, end to end

**Goal:** one page and one path prove the accepted architecture with **no relay on the read path** and no
database: a signed page is ingested into local storage, the server holds a routing file, resolves `/x` to a
binding, serves that page's HTML *from the store*, and 404s everything else.

This is REVISION 2's core, and it is deliberately "boring, not cute". It proves **six** architectural claims at
once, each of which the current code fails:

| claim | what increment 1 demonstrates |
|---|---|
| the app is its own authority | a page is served with `APP_RELAY_URL` pointed at a **dead** address: the instance boots, resolves, and renders |
| no relay round-trip for served data | `/x` is answered from `data/pages/…`; the route and serve path open **zero** sockets (§1.4) |
| the ingest path is write-restricted | a page event from a pubkey outside `{app, admin, editor}`, or of the wrong kind, is refused — nothing is written (§1.5) |
| SEO-grade output | `curl /x` shows the page's **body** (headings, text, links) and `og:`/`twitter:` meta **without executing JavaScript** |
| an unreadable table is a broken site | the process refuses to boot on a corrupt `routes.json`, with a named message |
| rung 3 is honest | anything unmatched is a real HTTP **404** |

### 1.1 Files

**New (13):**

```
platform/server/routes/routeFile.ts             the file: load / validate / serialize / writeAtomic / lookup / prefixMatch
platform/server/routes/resolve.ts               the three-rung ladder + the two binding kinds (pure, no I/O)
platform/server/routes/pageStore.ts             the local page store: put / get / series index / writeAtomic
platform/server/routes/pageRender.ts            static blocks → HTML fragment + head meta; data-bound blocks → a
                                                placeholder (renderToStaticMarkup, §R4.4)
platform/server/routes/pageHtml.ts              compose <head> + fragment + SPA bootstrap + `#__AR_PAGE__`
platform/server/http/appEvents.ts               POST /api/app-events — the ONE ingest surface: verify → level → kind
                                                dispatch → (page: parse/render/store | intent: may/apply)
platform/server/routes/routeFile.test.ts
platform/server/routes/resolve.test.ts
platform/server/routes/pageStore.test.ts
platform/server/routes/pageRender.test.ts
platform/server/routes/pageHtml.test.ts         (merge into pageStore.test.ts if it earns nothing alone)
platform/server/routes/pagesHttp.test.ts        the write restriction, end to end
sdk/config/routeNames.ts                        RESERVED_NAMES (37) + NAME_PATTERN + the RESERVED\COMPILED_IN split
```

That is **13 new files**: 6 production modules, 6 test modules, 1 shared config module. Counted from the list, not
estimated. If a test file collapses into another, say which and why — do not silently drop a criterion. **REVISION 3
took this to 15 by adding `widgetRegistry.ts` and its test; REVISION 4 returns it to 13** because the widget layer is
deferred (§R4.2), and keeps the REVISION 3 rename `http/pages.ts` → `http/appEvents.ts` (§1.5).

**New (data / fixture):**

```
data/routes.example.json                        a committed example file, NOT loaded by default
data/pages.example/<d>.json                      one committed example page, NOT loaded by default
```

**Modified (3):**

```
platform/web/app/entry.tsx                      load the routing file before buildServer(...)   (beside :23)
platform/server/buildServer.ts                  mount the resolver + pages routes in front of the SPA catch-all (:52-54)
platform/server/http/config.ts                  no change required; listed only because /api/config already
                                                runs before the table — verified, not modified
```

**Nothing else.** Not `platform/server/VanityManager.ts`, not `platform/server/ZapPurchaseManager.ts`, not
`$vanityName.tsx`, not `index.tsx`, not `src/`, not `routeTree.gen.ts`, **not `ui/storefront/`** (the renderer is
consumed, not edited — if a block needs a server-safe variant, that is a new file under `platform/server/routes/`,
and the reason is stated in the increment's report).

**One measured constraint on the renderer.** `ui/storefront/` imports no NDK, no `localStorage` and no `window`
outside a comment (`grep -nE 'localStorage|ndk|window\.' ui/storefront/*.tsx` → 1 hit, a comment **[M]**), and the
block slots that *do* read live data sit in `platform/web/storefront/StorefrontBlockSlots.tsx`, which the renderer
does not import. So the renderer can run under Bun; the slot map is exactly what the serve path leaves empty
(§1.4).

### 1.2 The file, in this increment

`./data/routes.json`, schema `version: 1`, exactly as `ARCHITECTURE.md` §4.2. Increment 1 implements the
**minimum subset** and the validator **refuses** the rest with a stated message, so nothing silently degrades:

```
{ "version": 1, "seq": 1, "default": null,
  "bindings": [ { "kind": "admin", "path": "<name>", "target": { "type": "page", "author": "<64-hex>", "d": "<d>" },
                  "updatedAt": <int>, "updatedBy": "<64-hex|instance>" } ],
  "prefixes": [ { "pattern": "item/:eventId", "target": { "type": "render", "render": "item", "param": "eventId" } } ] }
```

Note the prefix target is `render`, not "a page fetched by id": a prefix route serves a *rendered surface* whose
data lookup is the page's own concern (`ARCHITECTURE.md` §3.3 rung 2). REVISION 2 deleted `pageById` as a target
type, because a page is now always found through the store at `(author, d)`.

Refused in increment 1 (with the reason naming the later increment): `meaning: "lease"`, `grants`, `series`
targets, any `prefixes` pattern other than the declared ones.

### 1.3 `routeFile.ts` — what it must do

1. **`loadRoutesFile(path)`** — read + `JSON.parse` + `validate`. Throws `RoutesFileError` whose message contains
   the file path and every violation with its JSON pointer. **Never** auto-creates, never defaults to empty.
2. **`validate(file)`** — the invariants from `ARCHITECTURE.md` §4.2 and §8.3:
   - one binding per `path`;
   - `path` matches `/^[a-z0-9][a-z0-9_-]{1,28}[a-z0-9]$/` (`sdk/config/vanity.ts:171-175` **[S]**);
   - `path ∉ RESERVED ∪ COMPILED_IN` (`sdk/config/routeNames.ts` + the generated segment list, §8.1);
   - `kind === 'admin'` ⟹ `expiresAt` **absent** (not `null`);
   - `meaning === 'lease'` ⟹ `expiresAt` is a positive integer **and** `path` contains no `/`;
   - every `target` type in the increment-1 subset (`page`), every hex field 64 lowercase hex;
   - `prefixes` are distinct; a pattern that shadows a compiled-in dynamic route is **accepted with a
     `compiled-in-path` warning**, not refused (REVISION 2, ruling 3).
3. **`serialize(file)`** — stable JSON: keys sorted, 2-space indent, trailing newline, so a `git diff` is a
   review artefact and a `sha256sum` is an assertion.
4. **`writeAtomic(path, text)`** — write `path.tmp`, `fsync`, copy the current file to `path.bak`, `rename`. On any
   failure the previous file is untouched.
5. **`lookup(file, path)`** — exact match; returns a `Binding | null`, **never throws**. A lapsed lease returns
   `{ kind: 'lease-expired' }`, which the ladder maps to 404 and **must not** fall through to a prefix match
   (`ARCHITECTURE.md` §3.2, `ruling-resolution-and-signed-ledger.md:76-78`).
6. **`prefixMatch(file, segments)`** — longest declared pattern first; returns `{ binding, params } | null`.
7. **`defaultPath(file)`** — the `default` field, or `null`.

**No timers, no watchers, no caching layer, no re-read per request.** The loaded object is the whole state.

### 1.4 The page store — how a page is stored and how a request is answered

REVISION 2 replaced "fetch the event by id" with "read the stored page". The whole subsection is new in substance,
so it is stated as the design the increment must implement.

**1.4.1 What is stored.** One directory per page, keyed by the coordinate the routing file already names:

```
data/pages/<author-hex>/<d>.json      { document, html, meta, eventId, createdAt, author, d, series[] }
data/pages/series/<key>/<author>.json [{ d, createdAt, eventId }]  newest-first, rebuilt on each store
```

- `document` is the **validated** `StorefrontPage` (what `parseStorefrontPage` accepts), not the raw event content.
- `html` is the **rendered fragment** produced at ingest (§1.4.2).
- `meta` is `{ title, description, ogImage, canonical }`, derived once so a request does no derivation.
- Writes are `tmp + fsync + rename`, the same `writeAtomic` device as `routeFile.ts`, and the `.bak` is kept.
- **No index service, no scan for `get`**: the path is derived from `(author, d)`, which the binding supplies.
- **`data/pages/` is created on first successful ingest** and never auto-created empty at boot — an empty store
  is a valid state, a missing store is not an error.

**1.4.2 What is rendered at ingest, and what is not.** `pageRender.ts` calls **`renderToStaticMarkup` from
`react-dom/server`** (measured: `react-dom` 19.2.6 is already a dependency, `package.json:92` **[M]**) over
`ui/storefront`'s components with **no slot map**, and returns an HTML fragment. The split is by block type, and it is
now **the binding shape**, not an implementation convenience:

| block types | at ingest | at request |
|---|---|---|
| `ProfileHeader`, `Hero`, `Text`, `LinkList`, `Image`, `Divider`, `Spacer` | rendered to HTML | served as-is |
| `ProductGrid`, `FeaturedProduct`, `ProductRow`, `Search`, `Categories` | a **placeholder region** carrying the block's `type`, with the block's own "no data yet" view as its content | served as-is; the **existing React slot map** fills it in the browser **after hydration** and fetches its own data |

**Why the split exists, recorded beside the design so nobody "fixes" it later** (`ARCHITECTURE.md` §5.5.2, ruling
§§1–2): a fully server-rendered page is a **snapshot**, and the only way to keep a snapshot live is to re-render and
re-send the whole page continuously — which fails exactly on dynamic content. And the efficient shape is **built JS
served as static assets**, so the cost of rendering moves to build/ingest time. Both reasons are the owner's; an
increment that prerenders a data-bound block is failing the ruling, not optimising.

**REVISION 4 replaced REVISION 3's registry paragraph here.** There is **no registry, no `bundle`, no script import**:
`pageRender` renders the five data-bound blocks with no slot map, which is a supported path rather than a special case
— `ui/storefront/StorefrontRenderer.tsx:103-166` falls back to each block's props-only view when its slot is absent
(`:105-136`) **[S]** — and the fragment is filled by `StorefrontBlockSlots.tsx`'s map
(`platform/web/storefront/StorefrontBlockSlots.tsx:192`), which is what the published page already uses today
(`platform/web/storefront/StorefrontAddressPage.tsx:55`) **[S]**. **Increment 1 therefore changes no client
behaviour**; it only starts *emitting* the HTML those components hydrate.

**The hydration obligation, stated as an exit criterion because it is the one place this can silently go wrong.**
The server renders the five data-bound regions **slot-less** (the empty state), while the client's slot passes
`isLoading` from its query (`StorefrontBlockSlots.tsx:50,56` → `ui/storefront/blocks/ProductGridBlock.tsx:90`). If the
client's **first** commit renders the slot map, React 19 sees a mismatch there and re-renders those subtrees — the DOM a
person sees then differs from the DOM the crawler got, which is this run's rule 2 failing one level down. So the
`#__AR_PAGE__` seam must apply the live slot map **after** hydration, and **E10b** asserts the DOM is unchanged across
it.

**What the renderer costs, and the one guard it trips.** One module, no dependency, no build step (Bun transpiles the
TSX at import). But `platform/boundary.test.ts:83-88` asserts that no module under `platform/server/` imports `react`,
`react-dom*` or `@ui/*` — exactly what `pageRender.ts` needs. **OUR CHOICE:** keep the module at
`platform/server/routes/pageRender.ts` and add **one named allowlist entry** to that guard with the reason written at
it (the module renders React **to a string with no DOM**, which is what 102 test files already do). The alternative —
moving it outside `platform/server/` — is one file in a new directory. Either way the guard is amended or satisfied
**in the same commit**; an increment that fails `bun test --isolate platform/boundary.test.ts` fails E12, loudly.

The block `type` the placeholder carries is the same `type` the document already uses (`storefrontPage.ts:293-306`), so
**the page document does not change** in this increment. The serve path does not invent a second renderer for data
blocks and does not freeze prices into HTML — and it never renders their live content at all. **The 7/5 split is OUR
CHOICE**, recorded because a reader will ask why the page is not "fully static": because a storefront with stale prices
is worse than one that mounts five live regions, and because the ruling makes the alternative a failure rather than a
preference.

**1.4.3 How a request is answered.**

```
GET /x  →  routeFile.lookup('x') → binding{ target: { type:'page', author, d } }
        →  pageStore.get(author, d)          ← ONE file read, no network
        →  pageHtml.compose({ meta, html, payload })
        →  200 text/html
```

`pageHtml.compose` emits a complete document: `<head>` with `title`, `description`, `og:*`, `twitter:*`,
`<link rel="canonical">`; then the rendered fragment with its placeholder regions; then the SPA bootstrap and a
`#__AR_PAGE__` JSON payload naming `(author, d)` so the client can hydrate the same page rather than re-resolving the
route. **REVISION 4: no block emits a `<script>`** — there is no per-block asset, and the SPA bundle is the only
script (§R4.2). **A crawler that runs no JavaScript sees the page's static content and its meta; a browser sees the same
page, then becomes the app.** This is the SEO/instant requirement satisfied structurally, not by an optimisation — and
**the boundary is honest**: the crawler does not see the five data-bound blocks' live content, because that is fetched
in the browser by design, so it sees their empty state (`ARCHITECTURE.md` §5.5.2).

**1.4.4 What a missing page does.** In increment 1 a binding is hand-edited, so a binding to a page that was never
stored is possible: it answers **500 with a named error** (`binding-target-missing`), **not** 404 and **not** "item
unavailable". From increment 4 the write path refuses such a binding up front, so the state becomes unreachable
except by deleting a stored page — the same 500, which is honest. **404 stays reserved for "no binding matched"**
(`ARCHITECTURE.md` §3.3 rung 3), and that distinction is the one this run keeps losing when it is not asserted.

### 1.5 `POST /api/app-events` — the one write-restricted ingest (REVISION 3 rename)

This is the piece ruling 1 makes non-negotiable and the piece no relay has today (measured, `ARCHITECTURE.md`
§R2.3, §5.6.1). It is deliberately the **only** way anything enters the app's stores — and since ruling §5 it is
**the app relay's POST surface**, kind-generic and **dispatched by kind** (`ARCHITECTURE.md` §5.5.3, §5.6.3).
**The path name is OUR CHOICE**; that there is exactly one such endpoint is the ruling. `POST /api/pages/publish`
**does not exist in this plan** — a second name for the same write is exactly the defect reasoning this run is
removing, and E14 asserts there is only one.

```
POST /api/app-events        body: { event: <signed NIP-01 event> }
  1  verifyEvent(event)                       → 400 'bad-signature'
  2  level(event.pubkey) ∈ {app, admin, editor}
       app   = getAppPublicKey()              → 403 'no-acl'
       admin = AdminManager.isAdmin
       editor= EditorManager.isEditor
  3  kind allowlist { 30024 } in increment 1   → 400 'kind-not-allowed'
       (increment 4 adds the route-intent kind to this same set — §5)
  4  dispatch on kind
       30024 page:
         4a size caps, from STOREFRONT_LIMITS  → 400 'too-large'   (checked BEFORE parse)
         4b parseStorefrontPage(content)       → 400 'invalid-page: <pointer>'
         4c pageRender(document)               → 400 'render-failed: <message>'
         4d pageStore.put({ document, html, meta, author, d, eventId, createdAt, series })
  5  200 { stored: true, kind: 30024, author, d, eventId }
```

- **The author allowlist is the level lookup.** There is no second list to keep in sync, and no "role" the caller
  can assert — the server reads the level from its own managers (`ARCHITECTURE.md` §7.1). This is ruling 2's actor
  model applied to the one endpoint, and it is why the increment still has **no `may()`**: `may()` is about *paths*,
  and the page store does not own paths.
- **A failed render refuses the write, and it is the only structural refusal on a page.** This is what lets
  `ARCHITECTURE.md` §3.2 narrow "item unavailable" to non-page targets: a page in the store is, by construction, a page
  that renders. **REVISION 4 removed REVISION 3's second check** ("every registry id resolves"), because with the widget
  layer deferred there is nothing to resolve against — the block union the parser enforces is the whole vocabulary
  (§R4.2).
- **Replay**: the event's `created_at` must be within a freshness window (**OUR CHOICE**, see §11 R-2). A stale
  signed event is refused rather than stored twice.
- **`d` comes from the event's `d` tag**, never from the request body — the same "the server builds the record,
  never the submitted tag list" discipline the route writes use (`ARCHITECTURE.md` §4.5).
- **Publication to a public relay is not part of this endpoint** — and neither is writing to the auctions relay.
  The destination is the app's internal ingest surface (`ARCHITECTURE.md` §5.6); mirroring to a public relay is a
  later, optional feature that no read path waits for.

**What this costs, and it is the honest part:** `publishStorefrontPage` currently publishes **only** to relays and
fails closed on zero ACKs (`platform/web/storefront/storefrontPublish.ts:81-99` **[S]**). After this increment a
page can be published to a relay and never served, until increment 3 adds the second call. The increment must ship
with that stated in its operator note — **it is a real, temporary divergence between "published" and "served"**,
and it is one `fetch` to fix. **REVISION 3 adds a second operator note beside it:** the endpoint is a *different
setting* from `APP_RELAY_URL` (`platform/server/runtime.ts:19`). Pointing that variable at the app relay, or reusing
it for both roles, is the conflation `ARCHITECTURE.md` §5.6.2 forbids — and it would move the marketplace's public
data onto an internal ACL'd surface.

### 1.6 `sdk/config/routeNames.ts`

The 37 reserved names exist **twice**, identically, and neither exports its copy: `sdk/config/vanity.ts:51-89`
and `platform/server/VanityManager.ts:6-44` **[M]** (37 each, sets equal).

- New module exports `RESERVED_NAMES: readonly string[]` and `NAME_PATTERN`.
- Both existing files **import** it and delete their local literals. This is the de-duplication
  `designs/B-server-authoritative.md:654-658` proposes, and it is cheap: it changes no value.
- The existing equality is then enforced by a test rather than by luck: **assert the union of names read out of
  both files' call sites equals 37**, so a fourth copy cannot appear.

**Boundary check**: `sdk/config/routeNames.ts` must import nothing. `platform/server/` importing `@sdk/config/*`
is already allowed and used (`platform/server/http/config.ts:17` imports `@sdk/config/schemas/app` **[S]**).

### 1.7 Evidence and exit criteria

| # | criterion | command | expected |
|---|---|---|---|
| E1 | the new suites pass | `bun test --isolate platform/server/routes/` | record N pass, 0 fail (no prior count; the ingest suite is `routes/pagesHttp.test.ts` and is included by the directory glob) |
| E2 | the ladder is proven without a relay | `bun test --isolate platform/server/routes/resolve.test.ts` | exact admin binding → target; unmatched path → `{ status: 404 }`; **no `fetch`/NDK call is reachable** — asserted with a module mock that throws if touched (the `restart.test.ts` device `designs/B-server-authoritative.md:699-701` uses) |
| E3 | **boots and renders with a dead relay** | `APP_RELAY_URL=wss://127.0.0.1:9 APP_PRIVATE_KEY=<test key> PORT=3100 bun platform/web/app/entry.tsx`, then `curl -s localhost:3100/x \| grep -c '<h1'` and `curl -s localhost:3100/x \| grep -c 'og:title'` | boots; `/x` → **200** with the page **body** and the meta, `/nothing` → **404**. This is the whole claim in one command, and it fails on `master` today (`platform/server/startup.ts:41-51`) |
| E4 | a corrupt file refuses to boot | `printf '{"version":1,' > data/routes.json` then start | exits non-zero, stderr names the file and the parse position. **No partial load** |
| E5 | a reserved name in the file refuses to boot | fixture with `"path":"api"` (in `RESERVED \ COMPILED_IN`) | exit non-zero, message names `api` |
| E5b | **a compiled-in name in the file loads with a warning** | fixture with `"path":"dashboard"` | exit **0**, stderr/log carries `compiled-in-path`, and `dashboard` serves the bound page. **REVISION 2: this replaced the old E5 refusal** |
| E6 | a lease on a subpath refuses to boot | fixture with `"meaning":"lease","path":"shop/x"` | exit non-zero |
| E7 | atomic write leaves a backup | `bun test --isolate platform/server/routes/routeFile.test.ts platform/server/routes/pageStore.test.ts` | after `writeAtomic`, `.bak` holds the previous bytes; a simulated failure mid-write leaves the original intact |
| E8 | nothing reads the network in the route or serve path | `grep -nE "fetch\(|ndk|Relay" platform/server/routes/routeFile.ts platform/server/routes/resolve.ts platform/server/routes/pageStore.ts platform/server/routes/pageRender.ts platform/server/routes/pageHtml.ts platform/server/http/appEvents.ts` | **0 hits** — REVISION 4 dropped `widgetRegistry.ts` from this list (the module no longer exists) and keeps the ingest handler in it, because the ingest must not read a relay either |
| E9 | the ingest refuses what it must | `bun test --isolate platform/server/routes/pagesHttp.test.ts` | bad signature → 400; `none`-level pubkey → 403; kind ≠ 30024 → 400; over-cap → 400 and **no file written**; invalid block → 400 and **no file written**; **a document that fails to render → 400 `render-failed` and no file written**. REVISION 4 removed the `unknown-widget` row — there is no registry |
| E10 | a stored page is served byte-identically twice | `curl localhost:3100/x \| sha256sum` twice | identical, and the second request opens no socket (assert with the E2 mock) |
| E10b | **hydration does not rewrite the served DOM** *(REVISION 4)* | Playwright over a served page with one `ProductGrid`: capture `document.querySelector('[data-ar-block="ProductGrid"]')`'s `innerHTML` before and after hydration | the placeholder's **identity and position are unchanged** and no hydration-mismatch error is logged. REVISION 4's renderer emits the blocks slot-less, so this is the criterion that proves the client's slot map is applied **after** hydration rather than during it (§1.4.2) |
| E11 | typecheck list identical | the §0.1 command, before and after | `diff` of the sorted lists **empty**; count recorded from the branch, never carried |
| E12 | boundaries and format | `bun test --isolate sdk/boundary.test.ts platform/boundary.test.ts ui/boundary.test.ts`; `bun run format:check` | pass |
| E13 | the diff is the diff | `git status --porcelain` | exactly the files in §1.1. `routeTree.gen.ts` and `ui/storefront/` untouched |
| E14 | **there is exactly one write surface** (REVISION 3) | `grep -rn "pages/publish" platform/ sdk/ ui/` and `grep -rn "app-events" platform/` | **0 hits** for the retired name; **one** registered route for the ingest, mounted in `buildServer.ts` |

**The number to watch**: `curl -s -o /dev/null -w '%{http_code}' localhost:3100/no-such-path` must print **404**.
On `master` today the SPA catch-all returns the shell with **200** for any unknown path (`platform/server/buildServer.ts:54`
`'/*': indexHtml`) **[S]** — so 404 is a visible behaviour change and it is the point of rung 3.

**The number that is new in REVISION 2 and matters most**: `curl -s localhost:3100/x | grep -c '<h1'` must be
**≥ 1** with JavaScript never executed. If the body is not in the HTML, the increment has served a shell with a
payload again, which is exactly what the ruling rejected.

### 1.8 What increment 1 explicitly does NOT do

- No lease write path, no payment, no `may()`, no `grants`, no editor/lease distinction beyond the ingest
  allowlist (which is the actor lookup only).
- No `series` target, no `list` reference, no management UI.
- No client routing change **except the hydration seam**: `/` and `/$vanityName` still resolve as today
  (`platform/web/routes/index.tsx:29`, `platform/web/routes/$vanityName.tsx:19-41`); the `#__AR_PAGE__` payload is
  consumed in increment 3.
- **No public relay is written to, and no relay is read from, ever, in this increment.** REVISION 3 retracts the
  old "no relay ingest": the ingest endpoint *is* the app relay's POST surface (`ARCHITECTURE.md` §5.6), running
  in-process. What the increment still never does is **ask a relay anything** — no read, no subscription, no
  mirroring — and it never touches the **auctions** relay, which is a placeholder for the public ones and not the
  app's relay.
- **No widget layer at all** — no custom element, no per-block bundle, no registry, no script import, no widget
  compiling. The page's dynamic regions are the app's **own React components**, filled by the existing slot map after
  hydration. The whole layer is deferred with its consequence recorded (`ARCHITECTURE.md` §5.7, §R4.5).
- No removal of `VanityManager`/`ZapPurchaseManager` — they keep running unchanged, and the CMS still publishes
  to relays as before (so "published" and "served" diverge until increment 3 — stated in §1.5).
- Nothing deployed; no live unit restarted.

---

## 2. Dependency graph, and what can run in parallel

```
        ┌──────────────────────────────────────────────────────────────┐
        │ 1  routing file + PAGE STORE + resolver, end to end  (proof)  │
        └───────────────┬──────────────────────────┬───────────────────┘
                        │                          │
        ┌───────────────▼───────────┐   ┌──────────▼────────────────────────┐
        │ 2  validator completeness: │   │ 3  `/` + rung-1 dynamic path are   │
        │    leases, subpaths,      │   │    served from the table           │
        │    compiled-in set        │   │    (R1/R2/R4 visible)              │
        └───────────────┬───────────┘   └──────────┬────────────────────────┘
                        │                          │
        ┌───────────────▼───────────┐   ┌──────────▼────────────────────────┐
        │ 4  ACL: may() + grants +  │   │ 5  R3 series (local index)         │
        │    write API + actor      │   │    PARALLEL with 4                 │
        └───────────────┬───────────┘   └──────────┬────────────────────────┘
                        │                          │
        ┌───────────────▼───────────┐              │
        │ 6  zap receipt verification│             │
        └───────────────┬───────────┘              │
                        │                          │
        ┌───────────────▼───────────┐              │
        │ 7  lease purchase (paid)  │              │
        └───────────────┬───────────┘              │
                        │                          │
        ┌───────────────▼───────────┐   ┌──────────▼────────────────────────┐
        │ 8  management surface     │◀──│   (needs 4 and 7)                 │
        └───────────────────────────┘   └───────────────────────────────────┘
```

**REVISION 4 removes the ninth box entirely, and the graph above is the whole plan.** REVISION 3 added a leaf box for
the widget layer; that layer is deferred (`ARCHITECTURE.md` §R4.5), so **nothing in this plan emits a bundle, builds a
custom element, or serves a per-block asset**. Tier 2 (modular sub-apps, list management) is not drawn either, because
it adds no increment here — it is later work that this ladder already admits (`ARCHITECTURE.md` §R4.4, §R4.6).

### 2.1 The order, with each increment's real dependency

| # | increment | depends on | why that dependency exists |
|---|---|---|---|
| **1** | routing file + page store + ladder, end to end | — | nothing |
| **2** | validator completeness: lease meaning, subpath rules, `COMPILED_IN` derived, reserved/compiled-in split | 1 | needs the file writer to exist before it can accept/refuse more shapes of it |
| **3** | `/` and `/<name>` served from the table (R1/R2/R4 visible); client hydration seam; CMS also posts to `/api/app-events` | 1 | needs `lookup` and a stored page; **deliberately not 2** — it only needs exact admin bindings |
| **4** | ACL: `may()`, `grants`, four levels, the write API | 1 (and 2 for the fields it validates) | `may()` reads the whole file, including `grants`, which 2's validator must already accept |
| **5** | R3 series resolution, from the local series index | 1 (and 3 for the path to be reachable) | needs a stored page before a series can answer |
| **6** | zap receipt verification | — (independent of 1–5) | it is a *payment* change on the existing vanity path |
| **7** | lease purchase (paid) | 2, 4, **6** | a lease needs the validator's lease shape, the ACL's actor, and a verified receipt |
| **8** | management surface | 4, 7, 5 | it reads and writes through all three |
| ~~9~~ | ~~widget layer: bundles, mount points, registry entries~~ | — | **DEFERRED** (`ARCHITECTURE.md` §R4.5). No increment here depends on it and it depends on nothing. Kept as a struck row so a reader who saw REVISION 3 knows it moved rather than vanished |

### 2.2 What the owner asked for — parallel tracks

**Named explicitly, so nobody serialises them by accident:**

- **Track I (routing core):** 1 → 2 → 4 → 8. Sequential **because of one file**: 1, 2 and 4 all modify
  `platform/server/routes/routeFile.ts`, and `apply(mutation)` is the single writer. Parallelising inside this
  track means two agents editing one function — that is the lost-update problem this run exists to delete.
- **Track II (surface):** 3 → 5 → 8. **3 and 5 can start as soon as 1 lands**, in parallel with 2 and 4, because they
  touch **different files**: 3 touches `platform/web/routes/index.tsx`, `platform/web/routes/$vanityName.tsx` and reads
  `routeFile.lookup`; 5 touches a new `platform/server/routes/series.ts` and a client query. Neither writes the routing
  file. **REVISION 4 removed increment 9 from this track** — the widget layer is deferred, so `public/widgets/`,
  `scripts/build-widgets.ts` and `platform/web/widgets/` are not touched by anything here.
- **Track III (payments):** 6, then 7. **6 is fully independent of everything else** and can run from day one —
  it is the increment that closes the free-lease hole (`ARCHITECTURE.md` §10 O-5), it touches only
  `platform/server/ZapPurchaseManager.ts`, and it is the longest-lead item, so starting it first is the cheapest
  risk reduction available.
- **Genuinely parallel pairs, safe to dispatch simultaneously:**
  `(2 ∥ 3)`, `(2 ∥ 5)`, `(4 ∥ 5)`, `(6 ∥ anything)`.
  **Unsafe pairs:** `(1 ∥ anything)`, `(2 ∥ 4)` and `(4 ∥ 7)` — all write `routeFile.ts` or depend on its shape.
- **Inside increment 1 there is exactly one safe split**, and it is worth naming because the increment grew
  (REVISION 2): `routeFile.ts` + `resolve.ts` on one side, `pageStore.ts` + `pageRender.ts` + `pageHtml.ts` +
  `http/pages.ts` on the other. They share **no file** and communicate through one interface (`get(author, d) →
  {document, html, meta}`). They are **not** parallel-safe as commits — `buildServer.ts` is touched by both — but
  they are safe as two agents on one branch if the mount order is agreed first.
- **One merge hazard, stated**: 3 and 4 both make the client stop reading the vanity registry
  (`platform/web/config/vanityBinding.ts:90-129`). They must agree on **one** replacement read, or the app ends up
  with two. The plan assigns that replacement to **3** and forbids 4 from touching client files.

---

## 3. Increment 2 — the file's full shape: two binding kinds, subpaths, and the compiled-in set

**Goal:** the routing file accepts exactly the shapes `ARCHITECTURE.md` §3–§4 define and refuses every shape it
forbids, with the refusal named — and the compiled-in segment set becomes a **derived** artefact instead of a
hand-kept list.

**Files:**
```
modified   platform/server/routes/routeFile.ts        + lease meaning, + subpath binding, + ancestor rule, + grants
modified   platform/server/routes/routeFile.test.ts
new        scripts/gen-route-segments.ts              derives COMPILED_IN from platform/web/routeTree.gen.ts
new        sdk/config/compiledInSegments.ts           GENERATED (committed), the 8 top-level static segments
new        sdk/config/compiledInSegments.test.ts      drift guard: regenerates and diffs
modified   package.json                               a `generate-segments` script beside `generate-routes`
```

**The derivation, measured and pinned.** The set today, and its one trap:

```bash
$ grep -oE "path: '/[^']*'" platform/web/routeTree.gen.ts | sed "s/path: '//;s/'$//" \
  | awk -F/ 'NF==2 && $2!="" && $2 !~ /\$/' | sort -u
/auctions /checkout /community /dashboard /new /nostr /posts /products /setup
```

→ 9 lines, **8 real top-level segments**: `/new` is declared under
`DashboardLayoutDashboardProductsProductsRoute` and again under `…CollectionsRoute` **[M]**. The generator must
therefore check the parent, not just the shape — a naive awk produces 9 and the drift test would bless the bug.
Stated so it is not rediscovered.

**Exit criteria:**

| # | criterion | command | expected |
|---|---|---|---|
| V1 | the generated set is exactly 8 | `bun test --isolate sdk/config/compiledInSegments.test.ts` | regenerating from a clean `routeTree.gen.ts` produces an identical file |
| V2 | **`auctions` loads with a warning** | `bun test --isolate platform/server/routes/` (fixture with `"path":"auctions"`) | exit 0, `compiled-in-path` warning, and `/auctions` serves the bound page. **REVISION 2 reversed this row**: it used to assert a boot refusal closing the "live hole" `review-adversarial.json` F7 case 1 records. Under ruling 3 that hole is intended behaviour, and what remains to assert is that an **editor** cannot take it (`compiled-in-needs-admin`, asserted in increment 4's A-set) |
| V3 | a lease on a free top-level path is accepted | fixture | loads |
| V4 | a lease with no `expiresAt`, or an admin binding with `expiresAt`, is refused | 2 fixtures | both refused, distinct messages |
| V5 | a lease on a subpath is refused | fixture `"meaning":"lease","path":"shop/x"` | refused (`lease-must-be-top-level`) |
| V6 | a lease under a leased ancestor is refused **at write time** | unit test calling the write path | `Denied('held-by-ancestor')` — the ancestor clause of `ARCHITECTURE.md` §3.4 |
| V7 | a subpath binding under a live lease **is** accepted | fixture | loads |
| V8 | when the parent lease expires, the subpath binding stops resolving | unit test at `expiresAt + 1` | the subpath returns `{ status: 404 }` — "every subpath dies with it" (`ruling-simple-routing-file.md:45-48`) |
| V9 | `grants` accepts literal paths and `prefix*` only | unit | a `%` or a bare `*` is refused, so no name can become a wildcard |
| V10 | **`api` (reserved, not compiled-in) is still refused for every level** | fixture with `"path":"api"` | exit non-zero, `app-owned-name` — the URL space is not re-pointable |
| V11 | **the split is derived, not hand-typed** | `bun test --isolate sdk/config/compiledInSegments.test.ts` | `RESERVED \ COMPILED_IN` and `COMPILED_IN` are computed from the 37-name list and the generated 8; a name in both lands only in `COMPILED_IN` |
| V12 | a **new** compiled-in segment appearing later does **not** break boot | fixture: add a segment to the generated set whose name a binding already holds | exit 0, `compiled-in-path` warning, binding still wins |

**NOT:** no write API (still hand-edited / fixtures), no UI, no client change, no payment, no Nostr.

---

## 4. Increment 3 — `/` and the dynamic top-level path become the table's

**Goal:** the owner's own example, made real: `/` renders whatever the default binding names, and `/<name>` renders
a bound page — or **404**. **And, since REVISION 2, `/dashboard` and the other compiled-in paths are re-pointable
by a binding rather than refused.** The client stops resolving routes; the server decides, and the client renders
the decision it was served.

**Files:**
```
modified   platform/server/routes/resolve.ts          + default binding + `/<name>` rung 1 + rung 3 + compiled-in fallback
modified   platform/server/routes/pageHtml.ts         + render the default and the exact-path bindings
new        platform/server/routes/defaultBinding.ts   the default target → the page payload (or the inline composition)
modified   platform/web/routes/index.tsx              `/` renders the server's decision; inline composition only as the empty state
modified   platform/web/routes/$vanityName.tsx        becomes a 404 surface for unmatched segments
modified   platform/web/routes/__root.tsx             the hydration seam: if `#__AR_PAGE__` is present, render it
                                                      instead of <Outlet/> (REVISION 2 — this is what lets a
                                                      compiled-in path be re-pointed without touching its files)
modified   platform/web/storefront/StorefrontAddressPage.tsx   gains an `author` prop (defaulted to appPublicKey)
modified   platform/web/storefront/storefrontQuery.ts  + a hook that reads the page payload for (author, d)
modified   platform/web/storefront/storefrontPublish.ts        ALSO post the signed event to /api/app-events
                                                      (REVISION 2 — without this, nothing new is ever served)
new        platform/server/routes/surface.test.ts
```

**The one behaviour change that must be stated loudly:** `platform/web/routes/$vanityName.tsx:34-41` currently
falls through to `<StorefrontAddressPage dTag={vanityName} />`, i.e. **any** segment renders the app key's page at
that `d` if one exists. After increment 3 an unbound segment is **404** (`ruling-simple-routing-file.md:35`).
Existing deployments that rely on the fall-through will see pages 404 until a binding is written — that is the
migration, and it is a one-line-per-name admin action, not a code path. The increment must ship with an
**operator note** listing the currently live app-key `d`s (read from the relay, once, by hand) so the operator can
bind them before deploying. This is the only part of the plan that needs a live relay read, and it is a **migration
step**, not a route path.

**The second behaviour change, and it is REVISION 2's reversal:** a bound **compiled-in** path now serves the
binding. `/dashboard` with a binding is the bound page, not the dashboard. The compiled dashboard still exists and
is still compiled in — it simply is not what that URL answers while a binding is live. The one piece of work that
makes this true without touching `platform/web/routes/_dashboard-layout/` is `__root.tsx`'s seam: the served HTML
carries `#__AR_PAGE__`, and the root renders that payload in place of `<Outlet/>`. **Assert it, because it is the
only place two routing systems can disagree**: with a binding, `/dashboard` must not mount the dashboard; without
one, it must.

**Exit criteria:**

| # | criterion | command | expected |
|---|---|---|---|
| S1 | `/` renders the default binding's page | fixture + `curl -s localhost:3100/ \| grep <marker>` | the bound page's marker; with no default, the inline composition's marker |
| S2 | a bound `/<name>` renders | `curl -o /dev/null -w '%{http_code}' localhost:3100/shop` | 200 |
| S3 | an unbound `/<name>` is 404 | same, `/nothing-here` | **404** |
| S4 | **unbound** compiled-in routes are unchanged | `curl -o /dev/null -w '%{http_code}' localhost:3100/dashboard`, `/auctions`, `/products` **with no binding** | unchanged from before the increment (quoted before/after). **REVISION 2: the old S4 asserted this unconditionally, which contradicted ruling 3** |
| S4b | **a bound compiled-in route serves the binding** | fixture binding `dashboard` → a stored page, then `curl -s localhost:3100/dashboard \| grep -c '<marker>'` | the page's marker, and **not** the dashboard's nav (`grep -c 'SidebarNav'`-equivalent selector returns 0). The write response carried `warning: 'compiled-in-path'` |
| S5 | a binding's page that is unrenderable is 200 + "item unavailable" | fixture pointing at an absent page | **500 with a named error**, not 404 and not 200 — REVISION 2: an absent *page* is now a broken binding (`ARCHITECTURE.md` §1.4.4), and "item unavailable" belongs to non-page targets |
| S6 | the client no longer calls `resolveVanity` on a path | `grep -n 'resolveVanity' platform/web/routes/` | 0 hits (the registry read stays for the dashboard/account page until increment 8) |
| S7 | existing storefront tests unchanged | `bun test --isolate sdk/commerce/storefront/ platform/web/storefront/` | same pass/fail before and after, quoted |
| S8 | browse suite unchanged | `bun test --isolate platform/web/browse/` **and** without `--isolate` | **168/0** and **153/15** — quote both, same as before the change |
| S9 | typecheck list identical, format, boundaries | §0.1, §0.2 | as before |
| S10 | **a page published through the CMS is served** | publish from the CMS, then `curl -s localhost:3100/<its path> \| grep -c '<marker>'` | the marker, **and** the relay ACK still happened (both destinations). REVISION 2: without the second call in `storefrontPublish.ts`, this returns 404 and the increment ships a page that nobody can see |

**NOT:** no series (increment 5), no grants or ACL (increment 4), no management UI, no lease, no removal of
`VanityManager`, **no modularisation of any compiled-in page** — re-pointing is routing, and modular contents are
**tier 2: later and committed** (`ARCHITECTURE.md` §R4.4), not part of this increment. Nothing here precludes them:
programmed prefixes may be arbitrarily deep, only leases are top-level (§R4.6(a)). **The registry keeps running and
keeps being read by the dashboard/account surface**
(`platform/web/routes/_dashboard-layout/dashboard/account/vanity-url.tsx`) — deleting it is increment 8, and only
after the routing file is the only thing that resolves.

---

## 5. Increment 4 — the ACL: `may()`, grants, four levels, one write path

**Goal:** **four levels** (`app` → `admin` → `editor` → none) enforced server-side at one function, keyed on the
signing pubkey, with a visible refusal carrying a reason — and **admin, editor and lease-write calls all go
through `apply()`**, never through composed tags.

**No longer blocked.** REVISION 2 closes the actor question: `actor = event.pubkey` after `verifyEvent`, and the
level is a lookup in the existing managers (`ARCHITECTURE.md` §7.1). Increment 4 **starts** here — what it owes is
a decision on the **replay window**, which the ruling does not name and this plan picks (§11 R-2).

**Files:**
```
new        platform/server/routes/authority.ts         may(actor, op, path, file) — pure, exhaustive switch
new        platform/server/routes/authority.test.ts
new        platform/server/routes/commands.ts          the ops: bindAdmin, assignLease, retarget, release, setDefault, grantEditor
new        platform/server/routes/commands.test.ts
modified   platform/server/http/appEvents.ts           REVISION 3: the route-intent BRANCH of the one ingest
                                                      endpoint — adds the intent kind to the allowlist and
                                                      dispatches to may() + apply(). No `/api/routes/<op>`
                                                      route is created: that would be a second write surface
modified   platform/server/EventValidator.ts           the `general` branch stops accepting routing events (:85-93)
modified   platform/server/EventHandler.ts             routing intents leave the re-sign path
```

**The write discipline (`ruling-resolution-and-signed-ledger.md:18-20`)**: the posted event's **content is an
intent** — `{ op, path, target?, … }` — and the server builds the record from that intent and its own state, while
the caller's signature identifies `actor`. **No submitted tag list is ever applied.** The existing proxy copies
`tags` and `created_at` verbatim and swaps the pubkey (`platform/server/EventSigner.ts:16-26` **[S]**) — which is
why it cannot be the enforcement point. **REVISION 3 puts this branch behind the same door as a page publish**
(`ARCHITECTURE.md` §5.5.3), so there is one actor lookup and one kind allowlist for both.

**Exit criteria:**

**Where the `curl`s point (REVISION 3).** A2, A3 and A5x post a **signed intent event** to `POST /api/app-events`
(§1.5). There is no `/api/routes/<op>` and no per-op route to curl; only the endpoint's path differs from
REVISION 2's wording — every expected status and refusal reason is unchanged.

| # | criterion | command | expected |
|---|---|---|---|
| A1 | admin may do anything | unit, table-driven over the op set | `Allowed` |
| A2 | editor without a grant is refused, visibly | unit + `curl` | `Denied('no-grant')` with HTTP 403 and a body naming the missing grant |
| A3 | editor with `prefix*` may create, not retarget, another's page | unit | allowed for `create`; `Denied('not-their-page')` for `retarget` |
| A4 | a second binding on one path is refused | unit | `Denied('held-by:<tier>')`, naming the holding tier |
| A5 | a binding on a name in `RESERVED \ COMPILED_IN` is refused | unit | `Denied('app-owned-name')` |
| A5b | **a binding on a compiled-in name is allowed with a warning** | unit, `dashboard` | `Allowed` with `warnings: ['compiled-in-path']` — REVISION 2 reversed A5's old blanket refusal |
| A5c | **an editor cannot take a compiled-in path** | unit, editor actor with a grant on `dashboard` | `Denied('compiled-in-needs-admin')` — the split §8.3 makes, and the reason `auctions` is still protected |
| A5d | the `app` level outranks admin and cannot be claimed | unit: a non-app key naming `app` in the body | the level comes from the pubkey; the submitted claim is ignored (`Allowed` never, `Denied('no-acl')` for an outsider) |
| A6 | every accepted write goes through `apply` | `grep -n "writeAtomic" platform/server/` | one call site, inside `apply()` |
| A7 | the file's `seq` increments and the previous bytes are kept | unit | `seq: n → n+1`; `routes.json.bak` holds `n` |
| A8 | a write cannot smuggle a field | unit: post a `updatedAt`, an `updatedBy`, an `expiresAt` in the body | the server's own values win; the smuggled field is ignored, and a test asserts it |
| A9 | a refusal changes nothing on disk | unit | file bytes and `seq` unchanged |
| A10 | typecheck/boundaries/format | §0.1, §0.2 | as before |

**NOT:** no UI, no payment, no lease purchase (the lease *shape* is writable by an admin — `assignLease` — but
nothing charges for it; that is 7), no Nostr, no `list`.

---

## 6. Increment 5 — R3: the series path, resolved from the local series index

**Goal:** `/featured` resolves to the **newest** page of series `featured`, dynamically, with no network read and no
second write when a member is published.

**REVISION 2 removed the gate.** The increment used to be blocked on a live measurement of whether the relay
indexes `#t` on kind 30024, with "stop and report" as the outcome if it did not. Ruling 1 makes that measurement
irrelevant to serving: the series index is **local state maintained at ingest** (`ARCHITECTURE.md` §5.3, §5.5.1),
so the comparator runs over `data/pages/series/<key>/<author>.json`. The measurement still exists as a **backfill**
question for pages published before this increment, and a backfill is a one-off script, not a gate.

**Files:**
```
new        platform/server/routes/series.ts            seriesTarget → read the local index, apply the newest-first rule
                                                      (REVISION 2: the `{kinds:[30024],'#t':…}` query is gone)
new        platform/server/routes/series.test.ts
modified   platform/server/routes/pageStore.ts         the series index is written here, on put()
modified   platform/server/routes/routeFile.ts         accept `{ "type":"series", "series": "<key>", "author": "<64-hex>" }`
modified   platform/web/storefront/storefrontPublish.ts  the series tag travels with the publish (already read from the
                                                      event's `t` tags at ingest; the publish side must actually set it)
modified   platform/web/storefront/storefrontPublish.test.ts
new        scripts/backfill-series-index.ts            one-off, reads stored pages, writes the indexes (optional,
                                                      and only if pages were stored before this increment)
```

**The address argument is R1's whole mechanism**: `platform/web/storefront/storefrontPublish.ts:60`
`const tags: string[][] = [['d', STOREFRONT_PAGE_D_TAG]]` becomes `['d', dTag ?? STOREFRONT_PAGE_D_TAG]`, so every
existing caller compiles and behaves identically. **[S]** and it is the one-parameter change
`designs/A-one-writer-per-event.md:40` and `proposal-v2.md:377-394` both measured.

**Exit criteria:**

| # | criterion | command | expected |
|---|---|---|---|
| R1 | hundreds of pages per author | fixture: publish 200 pages with distinct `d` under one author, then resolve the 137th | resolves; **no truncation**; the count is recorded |
| R2 | a unique path per page | unit: two bindings claiming one path | refused (already covered by A4; re-asserted at this layer) |
| R3 | the series path resolves to the newest member | unit with three members out of order by `created_at` | the newest wins |
| R4 | publishing a new member changes the series answer with **no other write** | unit: publish, re-resolve | new member wins; `routes.json` bytes **unchanged** (this is what "dynamic" means) |
| R5 | the newest member switched off / unparseable / zero blocks → the next newest | unit | next usable member; if none, `/`'s inline composition (for `/featured`, a 200 page-level "nothing to show", not 404) |
| R6 | a page published by someone else with `t=featured` is ignored | unit | 🡒 the series is `authors:[owner]`-scoped; the outsider's page never wins |
| R7 | the existing publish path is byte-identical for existing callers | `bun test --isolate platform/web/storefront/` | same counts as before; plus one test asserting `d='storefront-page'` when no address is passed |
| R8 | **the series answer needs no network** | `grep -nE "fetch\(|Relay|ndk" platform/server/routes/series.ts`; plus the E2 throwing mock around a `/featured` resolve | **0 hits**, and the resolve succeeds with the network forbidden. **REVISION 2 deleted R8's old "measure `#t` on the deployment relay"** |
| R9 | the index is rebuilt from stored pages, not from the request path | `bun test --isolate platform/server/routes/series.test.ts` | after `scripts/backfill-series-index.ts`, `/featured` answers without any store write |

**NOT:** no series *management* UI (increment 8 may add a picker), **no `list` reference resolution** — that is tier 2,
later and committed (`ARCHITECTURE.md` §6, §R4.4), and nothing here narrows it — **no inventing
series tags** — the backfill script only indexes pages that already carry a `t` tag in their stored document — and
no auto-derivation of a series from a `d` prefix: the membership tag is declared explicitly by the author, because
a `featured-<date>` naming convention that silently joins a series would let any dated page become `/featured`
(`proposal-v2.md:409-415` considers it and this plan refuses it).

---

## 7. Increment 6 — verify the zap receipt before it can buy anything

**Goal:** a lease can only be granted for a payment this server can vouch for. **Independent of increments 1–5**
and **must land before any increment that charges for a path** (`ARCHITECTURE.md` §10 O-5).

**The measured hole, restated so the increment's tests are the statement of the fix:**

| what the code does today | where | what is missing |
|---|---|---|
| dedupe by receipt id, then **skip receipts older than 300 s** "to prevent re-processing on restart" | `platform/server/ZapPurchaseManager.ts:116-131` | nothing is persisted, so it re-derives from relays every boot |
| takes the amount from `description`'s **zap request `amount` tag** | `:175-180` | the **bolt11 amount is never decoded** |
| checks the `bolt11` tag **exists** | `:167-172` | never compares it to an invoice this server issued |
| never verifies the receipt's signature | `grep -rn 'verifyEvent' platform/server/*.ts platform/server/http/*.ts` → `ogMeta.ts:219`, `websocket.ts:30` **[M]** | `verifyEvent` is not called on the 9735 |
| `nostrPubkey` declared and **never read** | `:40` **[M]** | the receipt's author is never compared to the provider |

**Files:**
```
new        platform/server/routes/verifyReceipt.ts      pure: the checks, no I/O
new        platform/server/routes/verifyReceipt.test.ts
modified   platform/server/ZapPurchaseManager.ts        :113-207 — call the verifier; fail closed
```
**Reuse, do not re-invent** (`designs/COMPARISON.md:67-73` C4 measured it): `sdk/commerce/payments/zapRead.ts`
already ships `parseProviderZapReceipt` (`:96`) which decodes the bolt11 and takes the amount from **it**, and
`buildProviderZapReceiptFilter` (`:67-82`) which pins `authors:[providerPubkey]`.

**Exit criteria:**

| # | criterion | command | expected |
|---|---|---|---|
| P1 | a receipt **not signed by the provider** is refused | unit: 9735 by another key | refused, no grant, no publish |
| P2 | a receipt whose bolt11 amount ≠ the priced tier is refused | unit | refused — this is the underpayment path |
| P3 | a replayed receipt (same id, or same payment hash) is refused | unit | refused |
| P4 | a valid receipt is accepted exactly once | unit | granted; second delivery refused |
| P5 | **fail closed**: a provider lookup that fails refuses the purchase | unit with a throwing port | refused, **no binding written** — `ruling-d3-persistence-and-redesign.md:22-23` |
| P6 | no new network egress appears in the route path | `grep -n "fetch\|Relay" platform/server/routes/verifyReceipt.ts` | 0 hits (the verifier is pure; the LNURL provider port is injected) |
| P7 | existing vanity behaviour unchanged for the non-route path | `bun test --isolate platform/server/` | same counts, quoted; and NIP-05 purchases untouched (`Nip05Manager` shares the base class: `platform/server/Nip05Manager.ts:48-50` **[S]**) |

**NOT:** no nutzap rail (custody, egress, a separate ADR — `ruling-d3-persistence-and-redesign.md:81-99` does not
ask for it in this run), no persistence of proofs (the file is the routes table; proof persistence is a different
question and `ruling-d3-persistence-and-redesign.md:32-44`'s direction was already superseded *as a storage
design* — but nothing here needs it, because D3 requires the grant to be maintained for its term, not re-verified
on read), no refund flow.

---

## 8. Increment 7 — the lease purchase: a paid top-level path

**Goal:** a paying user reserves a free top-level path self-service, for a term, and nothing else can take it
during that term; at expiry the path 404s.

**Files:**
```
new        platform/server/routes/lease.ts              quote → settle → assignLease, over the verified receipt
new        platform/server/routes/lease.test.ts
modified   platform/server/routes/commands.ts           + `reserve` / `renew` ops through the same apply()
modified   platform/server/http/appEvents.ts            + the `reserve` / `renew` intent kinds on the same endpoint
                                                      (REVISION 3 — no separate POST /api/routes/reserve)
```

**Exit criteria:**

| # | criterion | command | expected |
|---|---|---|---|
| L1 | a lease is granted only on a free top-level path | unit | `Denied('held-by-admin')` / `'held-by-lease'` / `'held-by-ancestor'` |
| L2 | a reserved name or compiled-in segment is refused **before an invoice is issued** | unit | no invoice row, no charge |
| L3 | the term is `max(now, existing) + purchased`, renewal extends | unit | existing behaviour preserved (`platform/server/ZapPurchaseManager.ts:187-193` **[S]**) |
| L4 | at `expiresAt + 1` the path is **404**, and it is the lease's 404, not a fallback | unit | `{ status: 404 }` with `reason: 'lease-expired'` |
| L5 | termination by the provider is 404 immediately | unit | same |
| L6 | the holder is warned before expiry | unit on the existing display hook | `isExpiringSoon` true at 14 and 3 days |
| L7 | a lease's expiry cannot be turned into a fallback | `grep -n 'expiresAt' platform/server/routes/*.ts` | every read of `expiresAt` is in the liveness predicate; **none** in a resolution branch that returns a target |
| L8 | the payment path is verified | depends on 6 | increment 6 must be merged |

**NOT:** no grace window (stated as OUR CHOICE in `ARCHITECTURE.md` §7.4 — if the owner adds one it is one
comparison and one field), no refunds, no subscriptions, no nutzap, no per-lease Nostr confirmation (deferred).

---

## 9. Increment 8 — the management surface, and the legacy registry's retirement

**Goal:** the dashboard page the owner asked for: add / remove / modify routes, see refusals with reasons, see
grants, see lease holders and renewal dates — and the old registry stops being a route store.

**Files:**
```
new        platform/web/routes/_dashboard-layout/dashboard/app-settings/routes.tsx
new        platform/web/routes/_dashboard-layout/dashboard/app-settings/routes.test.tsx
modified   ui/nav/model.ts                              register the page in DASHBOARD_NAV (:142 area)
new        platform/web/routes/routesApi.ts             posts signed intent events to POST /api/app-events
                                                      (REVISION 3: one endpoint, not a per-op /api/routes/*)
modified   platform/web/routes/_dashboard-layout/dashboard/account/vanity-url.tsx   reads the routing table, not the registry
DELETED/DEMOTED (see below)
```

**What is deleted, demoted, or kept — stated plainly, because "what happens to the vanity path" is a real question:**

| file | disposition | why |
|---|---|---|
| `platform/server/VanityManager.ts` (187 lines) | **kept** until the last commit of this increment, then **deleted** | its only remaining job is the kind-30000 registry, which the file replaces. Deleting it also removes the `buildRegistryTags` partial-serialiser (`:110-112`) that is one half of the clobber |
| `platform/server/ZapPurchaseManager.ts` (419 lines) | **kept, narrowed** | it is the base class **NIP-05 also uses** (`platform/server/Nip05Manager.ts:48-50` **[S]**). The vanity subclass goes; the invoice/receipt machinery stays, with the verifier from increment 6 |
| `sdk/core/curation/vanityRead.ts` | **kept** for the legacy read path until this increment, then reduced to the kind/d-tag coordinate plus the reader the migration needs | its `authors:[appPubkey]` pin (`:21-28`) is exactly what the app stops needing |
| `platform/web/config/vanityBinding.ts` + `vanityStore.ts` | **reduced** to the dashboard's own view | increment 3 stopped the routes reading them; this increment stops everything else |
| `platform/server/ZapPurchaseManager.ts:202` `publishRegistry()` | **removed from the write path** | this is the clobber's other half: every receipt rebuilds the whole event (`:393-406`). Removing it is a requirement of this increment, not a cleanup |
| `data/routes.json` | **backed up, monitored, and not version-control'd by default** | `ARCHITECTURE.md` §4.4: an unreadable table means the site is broken. The backup is `writeAtomic`'s `.bak`; the alarm is `/api/healthz` |

**Exit criteria:**

| # | criterion | command | expected |
|---|---|---|---|
| M1 | the page lists bindings, grants, leases, and the default | component test | renders; a refusal shows the reason and the holding tier |
| M2 | **rerouting `/dashboard` succeeds, with an explanation** | component test | the dialog accepts the binding and shows `compiled-in-path`: "this path is a compiled-in route; your binding supersedes it". **REVISION 2 reversed this row** — it used to assert a refusal, which ruling 3 forbids |
| M2b | the surface lists every compiled-in name it may supersede | component test | the 8 derived segments appear, with the ones already bound marked; the list is read from the generated artefact, not typed |
| M3 | the clobber cannot recur | regression test: write an admin binding + the default + an editor grant, then **take a payment**, then assert all three still resolve and the file's `seq` moved by exactly 1 | passes. **This test cannot pass on the current code** — `platform/server/ZapPurchaseManager.ts:202` republishes from a map that knows only `vanity` entries (`platform/server/VanityManager.ts:110-112` **[S]**). It is the test `ruling-d3-persistence-and-redesign.md:78-79` asks for, and its absence is why the bug went unnoticed |
| M4 | no route resolution reads a relay | `grep -rnE "fetch\(|Relay\.connect|ndk\." platform/server/routes/` | 0 hits in `routeFile.ts`, `resolve.ts`, `authority.ts`, `lease.ts` |
| M5 | `/api/healthz` reports the table's state and `seq` | `curl localhost:3100/api/healthz` | `{"routes":"ok","seq":n}` |
| M6 | nothing still publishes the routing table to Nostr | `grep -n "publishRegistry" platform/server/` | 0 call sites |
| M7 | full suites | §0.2, plus the browse pair quoted both ways | no regressions |

**NOT:** no Nostr ledger, no remote-instance leases, no `list`, no DNS domains (paths only —
`ruling-acl.md:52-53`: "Do not assume the wider reading").

---

## 9b. Increment 9 — the widget layer — **DEFERRED (REVISION 4); not built by this plan**

> **STATUS: DEFERRED.** `ruling-react-components-and-deferred-widgets.md` rules page composition stays on **React
> components and the CMS's existing block types**, *"to avoid script binding and widget compiling"*. **No increment in
> this plan builds any part of §9b**, its exit criteria **W1–W13 are not run**, and increment 1 no longer creates a
> registry or seeds it. The section is kept in full as the **design of record** — what the layer would take, what it
> would emit, and the invariant it would have to respect — so that if it is ever required it is a build, not a
> re-derivation. The consequence of deferring is `ARCHITECTURE.md` §R4.5: *a third party cannot ship a page into the
> instance without the instance building their block.*

**Goal:** a page's **dynamic** regions stop being a React slot map inside the SPA bundle and become what the ruling
says they are — **custom elements delivered as script-imported bundles** that fetch their own live data in the
browser. After this increment a served page carries `<ar-product-grid data-widget="product-grid">`, one
`<script type="module" src="/widgets/product-grid-<hash>.js">` for it, and the page store carries **no code at all**.

**Depends on 1 (the serve path and the registry) and 3 (a real page being served at a real path).** It touches no
file that increments 2, 4, 5 or 7 touch, so it is parallel-safe inside Track II. It is deliberately **after** 3, not
before: the value is only observable once a published page is served from the store.

**The three things this increment is, and the one thing it is not.** It **is**: a build (bundles), a loader (the
element's definition), and the registry's first non-null `bundle` values. It **is not** a plugin system: no runtime
registration, no URL in a page document, no third-party admission path (`ARCHITECTURE.md` §5.7.2, §10 O-8).

**Files:**
```
new        platform/web/widgets/upgrade.ts             define-once registry, props from data-*/`#__AR_PAGE__`,
                                                      mount-inside-self; imports nothing from `routes/`
new        platform/web/widgets/productGrid.tsx        customElements.define('ar-product-grid', …)
new        platform/web/widgets/featuredProduct.tsx
new        platform/web/widgets/productRow.tsx
new        platform/web/widgets/search.tsx
new        platform/web/widgets/categories.tsx
new        platform/web/widgets/index.ts               the five entries: { id, tag, mount }
new        platform/web/widgets/widgets.test.tsx       define-once, props decoding, no network before mount
new        scripts/build-widgets.ts                    one ESM bundle + shared chunks per entry, content-hashed → public/widgets/
modified   package.json                               `build:widgets`, called from `build` beside `generate-routes`
modified   platform/server/routes/widgetRegistry.ts    `bundle` filled from the emitted manifest; hash is the filename
modified   platform/server/routes/pageHtml.ts          one <script type="module"> per REFERENCED widget, same-origin
modified   platform/server/http/static.ts              serve `/widgets/:file` from `public/widgets/` (the
                                                      `staticRoutes` record at `:43-48`)
modified   platform/server/buildServer.ts              mount the widget static route with `...staticRoutes` (:41)
                                                      so it precedes the `'/*'` catch-all (:54)
```

**A measured constraint on the build, so it is not discovered late.** `build.ts:138-140` derives its entrypoints
from `src/**.html` and there are **0** such files (`find src -name '*.html' | wc -l` → 0 **[M]**), so the existing
`bun run build` produces no bundle and `deploy-staging.sh:19-27` copies an effectively empty `dist/`. Production
serving is Bun's HTMLBundle from `platform/web/app/index.html` (`platform/web/app/entry.tsx:10`, `:27`). So
`scripts/build-widgets.ts` must be a **new, explicit** entrypoint list — it cannot piggy-back on the existing build
script, and it must run before the server is started. The toolchain supports what it needs: `build.ts`'s own help
text lists `--splitting`, so shared chunks are available rather than bundling React five times.

**What the element does, in one paragraph, because the upgrade semantics are the whole trick.**
`upgrade.ts` reads its props from the element's `data-*` attributes (written server-side from the page document) and
the author context from `#__AR_PAGE__`, then mounts the **existing** `ui/storefront` component inside itself with
`createRoot`. Because `customElements.define` upgrades elements already in the DOM, the page's static HTML is never
re-created and the mount element is never replaced; the widget replaces **its own children** only when it mounts, so
a bundle that fails to load leaves the server-rendered empty state in place (`ARCHITECTURE.md` §5.7.3). Reusing the
`ui/` component inside the element is **OUR CHOICE**: it keeps one implementation of each block rather than two, and
it is why this increment does not rewrite `ProductGrid` in vanilla DOM code.

**Exit criteria:**

| # | criterion | command | expected |
|---|---|---|---|
| W1 | bundles are emitted, one per registry entry, content-hashed | `bun run build:widgets && ls public/widgets/` | one `*.js` per entry plus shared chunk(s); every name carries a hash; **two builds with no source change produce identical names** |
| W2 | each bundle defines its element | `grep -c "customElements.define" public/widgets/product-grid-*.js` | **≥ 1**, and the tag matches the registry's `element` |
| W3 | the bundle is served, same-origin, correct type | `curl -sI localhost:3100/widgets/<file>` | **200**, `content-type: application/javascript` |
| W4 | a served page imports **exactly** the widgets it references | fixture A (one `ProductGrid`), fixture B (none); `curl -s localhost:3100/<path> \| grep -c '/widgets/'` | A → **1**, B → **0** |
| W5 | no script src is remote, ever | `curl -s localhost:3100/x \| grep -oE 'src="[^"]*"' \| grep -cE '^src="https?://'` | **0** — the invariant of `storefrontPage.ts:10-22` asserted on output, not intent |
| W6 | the fallback is in the HTML without JavaScript | `curl -s localhost:3100/x \| grep -c '<ar-product-grid'` and a grep for the empty-state marker inside it | both **≥ 1** |
| W7 | the element upgrades and reads live data in the browser | Playwright (the `e2e/` harness): assert `customElements.get('ar-product-grid')` is defined **after** load, and that a relay read happened **after** the page's HTML arrived | defined; request count increases post-load (the page's *static* HTML does no data reads) |
| W8 | the page store holds no code | `grep -rl "customElements\|<script" data/pages/ \| wc -l` | **0** |
| W9 | the build reads no network | `grep -nE "fetch\(|https?://" scripts/build-widgets.ts` | **0** — a bundle is built from the tree, never fetched |
| W10 | an unknown widget id is still refused at ingest | `bun test --isolate platform/server/routes/widgetRegistry.test.ts platform/server/routes/pagesHttp.test.ts` | `400 'unknown-widget: <id>'`, no file written (E9's row, re-asserted now the registry has real entries) |
| W11 | the page document is unchanged | `git diff --stat sdk/commerce/storefront/` | **empty** — no schema change, no new block type |
| W12 | existing storefront behaviour is unchanged for non-widget paths | `bun test --isolate sdk/commerce/storefront/ platform/web/storefront/` **and** `bun test --isolate platform/web/browse/` (both ways) | same counts as before, quoted both ways (168/0 with `--isolate`, 153/15 without) |
| W13 | typecheck/boundaries/format | §0.1, §0.2 | as before; `platform/web/widgets/` must not import `@platform/web/routes/*` |

**NOT:** no generic `Widget` block type (the extension point, deferred — `ARCHITECTURE.md` §5.7.3); no widget
admission UI or runtime registration; no loading of a script named by a page document; no shadow DOM (light DOM, so
the app's stylesheets keep applying — **OUR CHOICE**, flagged because shadow DOM is the "correct" encapsulation and
would break `check:ui-styles`); no change to the page schema; no removal of `StorefrontBlockSlots.tsx` (it keeps
serving the non-page storefront surfaces until a later increment decides otherwise).

---

## 10. Increment 1's relationship to the existing `d7s2/route-table` branch

`d7s2/route-table` @ `1cc31cb37` holds `sdk/config/routeTable.ts` (408 lines) and `sdk/config/routeTable.test.ts`
(326 lines, **35 `test(` calls, 72 `expect(` calls**) **[M]** — built to `order-increment-1.md`.

**What SURVIVES from it — keep, do not rewrite:**

| survives | why, measured |
|---|---|
| the **name grammar** `/^[a-z0-9][a-z0-9_-]{1,28}[a-z0-9]$/` and `isValidRouteName` | identical to both live copies (`sdk/config/vanity.ts:171-175`, `platform/server/VanityManager.ts:182-186`) **[S]** — it is the app's grammar, not the branch's |
| the **37 reserved names** as data, with a copy-drift test | `ROUTE_RESERVED_NAMES` at `routeTable.ts:33-72`; the drift test is the right device for a list that exists three times **[M]** |
| the **"drop, record, never throw"** parse posture (`DroppedRoute` / `RouteConflict`) | matches `AGENTS.md:100-115` (direct navigation states which constraint failed) and is the right posture for a file an operator can hand-edit |
| **`term: 0` is not permanent** for the legacy family, pinned by name | the deliberate asymmetry between absolute-expiry and "no term" (`order-increment-1.md:186-189`) is the same distinction `ARCHITECTURE.md` §3.2 makes with two binding kinds |
| the **hex/dTag target codecs** and their edge cases (63-char author, empty d, colons in d) | pure, tested, reusable in `decodeTarget` |
| the **parse-does-not-mutate** and **byte-stable serialisation** tests | they are the discipline the file writer needs |

**What must be REDONE against the accepted architecture — do not carry:**

| must be redone | why |
|---|---|
| the **storage**: `d='vanity-urls'` kind-30000, `parseRouteTable(tags)` / `serializeRouteTable(tags)` over **event tags** | `ARCHITECTURE.md` §4 supersedes it: the table is a **file**, so the codec is JSON-object ↔ typed union, and there is no event |
| the **`source: 'route' \| 'vanity'` field and the legacy `vanity` mirror** (`routeTable.ts:92`, `:396-406`) | the file has no legacy family to mirror; the mirror existed to keep old relay clients working, and the routing table is no longer an event |
| **`legacy-shadowed`** as a conflict kind | it is a consequence of two families in one event; a file validator refuses a second binding on a path instead |
| **`resolveDefaultRoute` refusing a non-page default** (`routeTable.ts:401-410`, `non-page-default`) | **superseded by R4/D18** (`proposal-v2.md:466-483`): `/` is just a path, and the default may name any target |
| the **`RouteTableError`-throws-on-write** contract | the file validator refuses at **load** (boot-refusal) and at **write** (`Denied`), not by throwing from a serialiser |
| the **`ROUTE_AUTHORITIES = ['admin','editor','reservation']` naming** | the ruling's tier is **premium/paid** and the binding kind is **lease** (`ARCHITECTURE.md` §3.2, §7); carrying `reservation` into the file would carry the old model's vocabulary |
| the increment's **exit criterion 3** ("`sdk/config/ + sdk/core/curation/` identical before and after") | it is **unsatisfiable as written** — the new file lives in `sdk/config/` and adds tests to the very directory being compared (`review-adversarial.json` F9). Every "identical before and after" criterion in this plan compares the **set of failing tests**, not the directory's pass count |
| the branch's **wire-format decisions** for a `series` target | `order-increment-2.md:60-100` adds `t:<tag>` to a tag family that no longer exists; increment 5 specifies `{ "type":"series", "series":…, "author":… }` in the file |

**Practical instruction:** do not merge `d7s2/route-table` into the increment-1 branch. **Cherry-pick the two pure
helpers** (`isValidRouteName`, the reserved-list with its drift test, the target codecs) into the new modules,
carry their tests, and **delete the rest**. That preserves the 35 tests' *intent* without re-introducing a tag
codec for a storage layer the ruling removed. The count to quote is the **carried** test count, not 35 — say
which tests came across.

---

## 11. The riskiest single thing in this plan, and the next-riskiest

### R-1 (the riskiest) — increment 1 now builds a renderer, and rendering is the one thing no part of the system does today

**REVISION 2 deleted the old R-1 in full.** It said the riskiest item was increment 1's page fetch — "the one
network call that remains, and the one I could not measure" — and speculated about whether `{"ids":[…]}`
returns anything. Ruling 1 makes that a non-question: the page is stored, so there is no fetch to measure. **The
old R-1 is not mitigated, it is removed**, which is the best outcome a risk can have.

**The new riskiest thing is the replacement's own cost.** The plan now requires the server to turn a
`StorefrontPage` document into HTML, and **nothing in the server does that today**: `ogMeta.ts` injects meta into a
shell it fetches from itself (`platform/server/ogMeta.ts:198-215`), and `react-dom/server` appears only in test
files (`grep -rl renderToStaticMarkup --include=*.ts --include=*.tsx . --exclude-dir=node_modules | wc -l` → 102
files; with `| grep -v '\.test\.'` → 0 **[M]**). **REVISION 4 names the mechanism (that gap is not left implied):**
`renderToStaticMarkup` from `react-dom/server`, one new module, already a dependency, no build step — and it was
**measured working** on the real `ui/storefront` components in a Bun process with no `window` or `document` (§R4.4,
`report-revision-4.md` §2.3). What that leaves as genuine risk is narrower and it is item 0 below.

0. **The boundary guard forbids the import, by name.** `platform/boundary.test.ts:83-88` rejects any specifier matching
   `/^(?:@platform\/web|react(?:-dom)?(?:\/|$)|@ui\/)/` under `platform/server/` — i.e. `react-dom/server` and
   `@ui/storefront/*`, the two imports `pageRender.ts` exists to make. The plan's choice is **one allowlist entry with
   the reason at the guard** (§1.4.2); the failure if it is forgotten is E12 failing loudly, which is the good kind.
   The **bad** kind is the opposite: an allowlist entry written wide enough that a *browser-only* import could ride in
   with it. The entry names **one file**, not a directory.

Three ways this bites:

1. **A client-only import reaches the server.** Measured, the renderer's own directory is clean (`ui/storefront/`
   has no `localStorage`, NDK or `window` outside a comment **[M]**), but `StorefrontRenderer` renders *slots*
   supplied by the caller — and the caller that supplies live data, `StorefrontBlockSlots.tsx`, imports query
   hooks. The defence is structural and is why §1.4.2 passes an **empty** slot map: if a slot component is ever
   pulled in, the increment has failed its own design, and E8's grep plus the throwing-fetch mock will not catch
   it. **Add one test that imports `pageRender.ts` under Bun with no DOM globals** — that is the assertion.
2. **The rendered fragment and the hydrated app disagree.** Two renderers over one document is exactly the
   "two truths" class of bug this run exists to delete, one level down. The mitigation is that the client does not
   re-render the static blocks: it hydrates the same DOM the server emitted, with `#__AR_PAGE__` naming the page.
   If the client instead re-renders from the document, the SEO output and the human output can diverge, and no
   test that only checks one of them will show it. **E10's byte-identical double-fetch is the cheap canary; S4b is
   the real one.**
3. **The publish/serve divergence is real for one increment.** Until increment 3 adds the second call,
   `publishStorefrontPage` writes to relays and the app stores nothing, so a freshly published page is not served.
   That is a **temporary**, self-inflicted divergence and it must be in the operator note (`§1.5`).

**Why this is the riskiest rather than the biggest**: it is the only new subsystem in increment 1 that has no
precedent in the repo, and it sits on the path every served page takes. A bug there is a wrong page, not a wrong
route — which is harder to notice and worse to be wrong about.

### R-2 — the replay window is unspecified, and increment 4 picks one *(was: the actor)*

**The old R-2 is closed.** It said the ACL's actor was unspecified and increment 4 could not start; ruling 2
settles it (`ARCHITECTURE.md` §7.1). What survives is a smaller, genuinely open detail:

**A signed event with no session has no built-in expiry.** A captured route-write event can be replayed until its
effect is idempotent, and nothing in the ruling names a window. **The plan picks: `created_at` within 300 s of the
server's clock, and a refused event is refused loudly** (`Denied('stale-intent')`). Rationale: 300 s is the
window `ZapPurchaseManager.ts:116-131` already applies to receipts, so the repo has one convention rather than
two. **This is OUR CHOICE, not a ruling**, and the cost of being wrong is asymmetric — too tight breaks a slow
client, too loose widens a replay window — so it is a named constant in one module, not a literal scattered
through handlers.

### R-4 — the widget layer is new machinery with zero precedent in this tree, and it touches a security invariant — *(DEFERRED, kept as the risk of the deferred layer)*

> **REVISION 4: this risk is not live in this build.** The widget layer is deferred (§9b, `ARCHITECTURE.md` §R4.5), so
> nothing here builds it. It is kept because it is the risk that must be re-read **before** the layer is ever built, and
> because its core warning — *the registry must never become a runtime registration path* — is the rule that keeps a page
> document from becoming a code-loading channel.

**Added by REVISION 3, and it is a risk rather than a task because of *where* it lands.** Measured: **0** custom
elements, **0** remote script loads, and **0** per-widget bundles exist today (`ARCHITECTURE.md` §5.7.4's table). So
every line of it is new. Three ways it bites:

1. **The invariant it brushes against.** `storefrontPage.ts:10-22` says the document has "no raw-HTML path, **no
   remote script or stylesheet**", and calls relaxing it "an account-draining XSS rather than a defacement". A widget
   layer is, structurally, "the page causes a script to run". The defence is the **registry** — the page names an id,
   the instance resolves it to its own bundle (`ARCHITECTURE.md` §5.7.2) — and the cheap canary is **W5**, which greps
   the emitted HTML for a remote `src` and requires **0**. If anyone ever adds a `url` field to a page document, W5
   will not catch it (the URL would be data, not `src`), so the real assertion is that the registry module has no
   runtime registration path. **This is the one place in the plan where a small, convenient change would be a
   security regression.**
2. **Two implementations of one block.** The widget mounts the existing `ui/storefront` component, so there is one
   implementation — but only while it does. A future "optimise the widget" that reimplements `ProductGrid` in vanilla
   DOM creates the two-truths divergence §11 R-1 item 2 already describes, one level down, and no test that renders
   one of them will show it.
3. **A stale hash is a silent 404.** `pageHtml` emits `/widgets/<id>-<hash>.js` from the registry; if the build
   changed the hash and the served page was rendered before the deploy, the script 404s and the region falls back to
   the server-rendered empty state. That failure is **graceful by design** (§5.7.3), which is exactly why it will go
   unnoticed — so W1's "two builds, identical names" and a deploy step that re-renders nothing are both required,
   and the fallback must be asserted (W6) rather than assumed.

**Why it is not the riskiest**: it sits on no increment's critical path, a page is served correctly without it, and
its worst failure is a missing region rather than a wrong page. But it is the increment most likely to be
"simplified" into something unsafe, which is why §5.7.2's invariant is written as a rule and not a preference.

### R-3 — the compiled-in derivation is a **build artifact**, and a stale one mis-classifies a name

Measured: `static − reserved → {auctions, new}` **[M]**, and the naive parse yields 9 not 8 because `/new` is
nested. **REVISION 2 changed what a stale artefact causes.** It used to be "a name becomes bindable and the drift
test stays green" — under ruling 3 bindable is the point, so the failure moved: a stale set means a name that
*is* compiled-in is not classified as compiled-in, so an **editor** can take it without the
`compiled-in-needs-admin` refusal, and the management surface's "may supersede" list is wrong. That is a quieter
failure than the old one, which is why the drift test matters more, not less. Increment 2 checks the parent, and
its drift test regenerates rather than comparing to a hand-typed list (V1, V11).

---

## 12. What this plan does not reach, and where it is recorded

**Scope in three tiers** (§R4.2): **tier 1 NOW** is increments 1–8, i.e. everything above this section. **Tier 2 LATER,
committed** is modular sub-apps and list management — sequenced after this todo list, no increments here, architecture
must leave room and `ARCHITECTURE.md` §R4.6 checks that it does. **Tier 3 DEFERRED** is the widget/portability layer and
the signed ledger. The rows below are the record, with the tier named in each.

| item | where | why not in this plan |
|---|---|---|
| the signed lease-confirmation ledger; honouring another instance's leases | `ARCHITECTURE.md` §11 | **BUILD LATER** by ruling (`ruling-resolution-and-signed-ledger.md:56-68`); the file leaves `instance.pubkey: null` and per-lease `leaseId` so it is an addition, not a migration |
| the `list` reference resolved, user-authored lists, the product picker | `ARCHITECTURE.md` §6 | **TIER 2 — LATER and committed** (`ruling-d8-multipage-and-lists.md:70-80`, owner 2026-11-13: *"list management I would both like in"*). The union variant is parsed and refused, so the later work is a resolver branch plus a tag/key generalisation, not a schema change (`ARCHITECTURE.md` §R4.6(b)) |
| nutzap as a payment rail | this file §7 "NOT" | custody, mint egress, a separate ADR (`AGENTS.md:63-64`); not asked for in this run |
| **modularising** a compiled-in page (replaceable regions, sub-app sub-paths: browse, seller dashboard, buyer/orders) | `ARCHITECTURE.md` §5.2, O-7, §R4.6(a) | **TIER 2 — LATER and committed** (owner 2026-11-13: *"modular subapps … I would both like in"*). **Sequencing, not scope**: re-pointing is in this plan, modular contents come after it. The ladder already allows it — programmed prefixes may be arbitrarily deep, only leases are top-level (`ARCHITECTURE.md` §3.4, §5.2) — so no increment here has to change. **The old row here said `/dashboard` reassignment "is 30 files, a layout, a nav model and an admin gate … no ruling requires it" — that was wrong and is withdrawn**: reassignment needs one `__root.tsx` seam, and ruling 3 requires it |
| a grace window on lease expiry | `ARCHITECTURE.md` §7.4 | OUR CHOICE not to add one; one comparison if the owner says otherwise |
| subpaths published by a leaseholder | `ARCHITECTURE.md` §10 O-2 | needs the one surviving precedence ruling |
| custom DNS domains | `ruling-acl.md:52-53` | the example is a path; this plan does paths only |
| proof persistence in a server event store | this file §7 "NOT" | nothing here re-verifies on read (`ruling-d3-persistence-and-redesign.md:24-27`), so nothing needs it |
| **who admits a widget to the registry** — the review policy for a widget built from a linked repo | `ARCHITECTURE.md` §10 **O-8** | **REVISION 3**: the architecture gives it a place (a reviewed code change to the registry, at build time) and **no policy**. Not needed until a second widget exists, and deliberately not invented here |
| a generic `Widget` block for widgets that are **not** built in | `ARCHITECTURE.md` §5.7.3 | the extension point, deferred. The five built-in dynamic blocks need **no** schema change, and inventing a plugin protocol in this run would re-open a settled security invariant for no benefit |