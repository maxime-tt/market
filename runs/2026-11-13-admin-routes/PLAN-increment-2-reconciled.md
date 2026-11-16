# Increment 2 (RECONCILED) — the page-path layer: per-page identity, path → page, series → newest page

**Status:** planning document. Nothing implemented. Nothing committed.
**Branch:** `unite/1420-all` @ `1154be66a` (worktree `/home/admin_maxime/work/wt-union-1420`).
**Supersedes for this increment:** `order-increment-2.md` in the parts named in §1. Everything not named there
still stands.
**Governing:** `ARCHITECTURE.md` (§3.3, §4.2, §5.3, §5.5.1, §13), `ruling-d8-multipage-and-lists.md` (R1–R4),
`order-increment-2.md`, `report-increment-1.md`, `IMPLEMENTATION-PLAN.md` §2 (increment 5).

> The owner's standing rule is that a mechanism you have not measured must never be presented. Every claim below
> carries the command that produced it. Where a number in `order-increment-2.md` did **not** reproduce, this plan
> says so and re-derives it rather than repeating it.

---

## 0. What is actually on the branch — measured, not assumed

### 0.1 The baseline

```
$ export PATH="$HOME/.bun/bin:$PATH"
$ bun test --isolate platform/server/routes/ platform/server/http/appEvents.test.ts
 94 pass
 0 fail
 236 expect() calls
Ran 94 tests across 8 files. [1469.00ms]
```

**94 / 0 / 8 files** is the "before" column for every count in §6.

### 0.2 The three claimed gaps — all three confirmed

**(a) `routeFile.ts` knows two target types, and `series` is not merely absent — it is *refused by name*.**

```
$ grep -n "series" platform/server/routes/routeFile.ts
18: *   - refused: `grants` (§4/ACL, increment 4), `series` targets (increment 5),
252: } else if (target.type === 'series') {
253:     violations.push(`${base}/target/type: series targets are not supported until increment 5`)
```

`RouteTarget = PageTarget | RenderTarget` (`routeFile.ts:46`). There is no series arm, and `resolve.ts:56-60`
routes every non-`page` target to the `render` outcome. **R3 has no code path.**

The refusal is *pinned by a test* that this increment must change, and that is a real, named edit — not a silent one:

```
$ grep -n "increment 5" platform/server/routes/routeFile.test.ts
151: test('grants and series targets are refused, naming their later increment', () => {
156:     expect(series).toContain('increment 5')
```

**(b) The series index is written and never read for resolution.**

```
$ grep -rn "seriesMembers" --include=*.ts . | grep -v node_modules
platform/server/routes/pageStore.test.ts:82: ... store.seriesMembers('featured', AUTHOR).map(...)
platform/server/routes/pageStore.test.ts:89: expect(store.seriesMembers('featured', AUTHOR)).toHaveLength(1)
platform/server/routes/pageStore.test.ts:90: expect(store.seriesMembers('featured', AUTHOR)[0].d).toBe('a')
platform/server/routes/pageStore.ts:49: seriesMembers(series: string, author: string): SeriesMember[]
platform/server/routes/pageStore.ts:127: seriesMembers(series: string, author: string): SeriesMember[] {
```

Every non-definition caller is `pageStore.test.ts`. Confirmed.

**(c) The kind-30000 sdk claim table never merged.**

```
$ ls sdk/config/ | grep -i route
routeNames.ts
$ git ls-tree --name-only d7s2/route-table -- sdk/config/   # routeTable.ts exists only there
sdk/config/routeTable.test.ts
sdk/config/routeTable.ts
```

Confirmed. `order-increment-2.md`'s **"Base: branch `d7s2/route-table` @ `1cc31cb37`"** is not the tree this
increment edits.

### 0.3 One structural fact the old order did not have to face

`resolve()` is **pure over the routes file** — no I/O, no store, no network (`resolve.ts:44`, and the test
`resolve.test.ts:100-110` asserts resolution works while `fetch` throws). The page bytes are supplied *downstream*,
by the caller:

```
$ grep -n "resolve(routing.current()\|pageStore.get" platform/server/buildServer.ts
82:  const resolution = resolve(routing.current(), url.pathname, now())
105: const page = pageStore.get(resolution.target.author, resolution.target.d)
```

`resolve()` has exactly one production consumer (`buildServer.ts:82`); `defaultPath()` has none outside its own
test.

**Consequence, and it decides the whole wiring question:** a series path cannot be resolved *inside* `resolve()`
without either giving it I/O (violating its contract and its test) or handing it the series index as an argument.
The first is forbidden by invariant 1; the second is the correct shape and is adopted in §3.

### 0.4 R2 has no code path either — every page publishes at one `d`

```
$ grep -n "STOREFRONT_PAGE_D_TAG" platform/web/storefront/storefrontPublish.ts
60: const tags: string[][] = [['d', STOREFRONT_PAGE_D_TAG]]
```

`buildStorefrontPageEvent(page)` takes no address; every page lands at `d='storefront-page'` on the author's
coordinate. R1/R2 (hundreds of pages, a unique path each) are unreachable from the publish side. That is the
`storefrontPublish.ts` half of this increment.

---

## 1. Reconciliation of `order-increment-2.md` against the shipped stack

The order was written against a **kind-30000 sdk claim table rewritten wholesale**. `ruling-d8` §2 rejects exactly
that shape, on three independent grounds it states: (1) one event has one size ceiling and hundreds of entries reach
it; (2) rewriting the whole table loses updates when two authors publish at once; (3) pages should be each author's
**own signed event**, not a line in an app-key-signed blob. What shipped instead is the local-file stack:
`routeFile.ts` (validate/serialize/writeAtomic/lookup/prefixMatch) + `pageStore.ts` (per-page file + series index) +
`routeTable.ts` (one writer over the file). `IMPLEMENTATION-PLAN.md:623` states the boundary: routing writes the
routing file; the series increment touches the store.

Verdict, item by item. **"Survives" = usable as written. "Refuted" = the premise is gone. "Re-derived" = the
intent is kept, the mechanism changes.**

### 1.1 Survivors (carried over unchanged in intent)

| # | Order part | Why it survives |
| --- | --- | --- |
| S1 | **The goal** ("R1, R2, R3 reachable in code without changing a rendered page") | Unchanged. Still exactly the right scope for a path layer. |
| S2 | **`pickPathCandidate` / `pickSeriesCandidate` semantics** (Step 2.2): re-check the filter, merge within an author, drop unusable, **oldest wins on a shared path**, **newest wins in a series**, explicit `considered`/`unusable` counts | Pure selection logic over event-shaped input. It does not care whether the table is an sdk event or a server module. |
| S3 | **`isValidPagePath` / `isValidSeriesTag`, and the `PAGE_SERIES_TAG = 't'` constant** | The grammar is `routeNames.NAME_PATTERN` verbatim; `t` is relay-indexable and already read at ingest (`appEvents.ts:179-181`). |
| S4 | **Fail closed on a bad path at publish** ("a bad path is a page nobody can reach") | Correct and cheap. |
| S5 | **`unpublish` must forward the address** (Step 4's gap) | Still a live data-loss trap: `unpublishStorefrontPage` currently has no address argument. |
| S6 | **`seriesForPath` is opt-in, never silent** (Step 2.2 + "what it does not do") | D15's rule survives verbatim: never derive `t` from `d` on the write. |
| S7 | **"Refuse, never truncate"** | `AGENTS.md:111-115`; the principle outlives the budget it was attached to (§1.4). |
| S8 | **Test #6 — the defaulted signature is a byte-identical no-op** | The strongest test in the order; it costs nothing and proves the change is non-breaking. |
| S9 | **Test #19 — a switched-off newest member must not win** | `ARCHITECTURE.md` §5.3 states this as a rule; the order's test pins it. |
| S10 | **The "deliberately does not do" list** (no route change, no UI, no trusted-author set, no series derivation at publish, no lists, no deployment) | Holds. §7 keeps it, plus additions this stack forces. |

### 1.2 Refuted by `ruling-d8` and the shipped stack

| # | Order part | Why it is refuted |
| --- | --- | --- |
| R1 | **`sdk/config/routeTable.ts` as the file to modify** (Step 1, top file list) | Does not exist on this branch (§0.2c). Its reason for existing — a claim table inside one kind-30000 event — is the shape `ruling-d8` §2 rejects. |
| R2 | **`{ type:'series', tag }` encoded as `t:<tag>`** (Step 1.1) | That encoding existed to fit a *claim inside a tag list*. On a JSON file there is no tag budget to fit, and `t:` would be a second wire format for one concept. Also loses `author`, which §5.3 makes part of the binding. |
| R3 | **`ROUTE_CLAIM_BUDGET_BYTES = 32 * 1024` + `claimTableBytes(tags)`** (Step 1.4) | The budget's *unit* ("bytes of the JSON tag list a relay receives") is a property of the rejected storage. Re-derived in §1.4 — and the re-derivation shows the constant itself is wrong at the scale R1 names. |
| R4 | **Test #7's figures (32,681 B at 230 claims, 32,823 at 231)** | Not reproducible from the order's own wire format. My best reconstruction of `["route",name,type,target,authority,term,holder]` gives **25,651 B** at 230 and **25,763 B** at 231 (tight encoding), i.e. a 112 B/claim delta, not the order's 142. See §1.4 for the measurement and its implication. |
| R5 | **`defaultIsUnclaimed` on `RouteTable`; `non-page-default` conflict kind; `dangling-default` rename** (Step 1.3) | These fix v1's problem, where the kind-30000 default had to be a *page claim*. In the shipped file, `default` is already "a path string or null" (`routeFile.ts:156-166`, `routeFile.ts:328`) — the constraint the order deletes **already does not exist**. Nothing to delete. |
| R6 | **`DroppedRoute` / `'bad-target'` / `parseRouteTable` type-guard edit** (Step 1.2) | A dropped-row concept belongs to best-effort parsing of an untrusted tag list. The routing file **refuses the whole file** on any violation (`routeFile.ts:320-322`); there are no drops and no drop reasons. |
| R7 | **`sdk/commerce/storefront/pagePaths.ts` — a pure sdk path selector fed by relay queries** | The sdk module's purpose was to decide *which relay event* answers a path, and its companion reads (`fetchPageByPath`, `fetchSeriesPage`) are relay round-trips walked in windows. On this stack resolution is **local** (`ARCHITECTURE.md` §5.3: "the request never reaches a relay") and the store already returns the winner newest-first (`pageStore.ts:112`). The pure selectors survive (S2) but belong beside the store. |
| R8 | **`fetchSeriesPage` windowed relay reads (`SERIES_WINDOW`/`SERIES_MAX_WINDOWS`, `until` walk-back)** (Step 5) | Same reason. `ARCHITECTURE.md:341` and `:42-43` retire the relay-query membership path: "membership is resolved from the **local series index**". A window walk over a local array is a scan over something already in memory; no window constant is warranted. |
| R9 | **`.d.ts`/typecheck evidence steps requiring `bunx tsc --noEmit`** (Steps 0, 6.3) | Not used here: it takes 400 s+ and OOMs this runner by the task's own constraint. §6 uses per-file `bun test --isolate` counts plus conservation. The `typecheck` gate is deferred to CI, and said so. |

### 1.3 Re-derived (intent kept, mechanism changed)

| # | Order intent | Re-derived as |
| --- | --- | --- |
| D1 | "One new target type" | **Two** target types, `PageTarget` and `SeriesTarget`, because the shipped file distinguishes "a page" from "a released renderer" (`RenderTarget`) — a series is not a renderer and must not be dressed as one. `SeriesTarget = { type:'series', series, author }` (§3.1). |
| D2 | "A series path resolves to the newest page" | A **fourth rung function in `resolve.ts`'s ladder, fed the index as an argument** — not a predicate over events, not a relay read. The setter is in §3.2. |
| D3 | "The page-path grammar" | Reuse `NAME_PATTERN` from `sdk/config/routeNames.ts:18` by **import**, not a second literal (the order's own Step 2.1 wrote the identical regex out again; `routeNames.ts:1-11` exists precisely to stop that copy-paste). |
| D4 | "Author-scoped series" (order implied `authors: readonly string[]`) | `SeriesTarget.author` is **one** 64-hex pubkey, per `ARCHITECTURE.md:850-852` ("Who the series owner is is part of the series binding, not inferred"). A list would make it an allowlist, which is a different feature. |
| D5 | "A page per path, unique `d`" | `d` is validated against the route-name grammar **at publish** and **at ingest**, and the store already rejects an unusable coordinate (`pageStore.ts:101`). |
| D6 | "The budget" | Moved and re-derived in §1.4. |
| D7 | `pickPathCandidate` "oldest wins" (anti-squatting) | **Kept, but re-scoped and re-labelled** — see §1.5. On this stack there is no relay to squat on; the rule now decides between *two authors binding the same path*, and it must not silently disagree with the routing file, which allows exactly one binding per path (`routeFile.ts:204-206`). |

### 1.4 The budget: where it belongs now, and why the old constant is wrong

The old budget guarded a **relay event** — a file the operator does not control, with a ceiling nobody measured
(the order admits this: "no relay event cap is configured in this repo"). The routing table is now a **local JSON
file on the operator's own disk**. There is no relay ceiling, so the budget's *unit* is gone. Three things replace
it, and the plan adopts all three:

**(i) The budget moves to `routeFile.ts`, measured on the bytes `serializeRoutesFile` actually emits.** That is the
same "measure the serialised list, never estimate per entry" rule the order demanded, applied to the real encoder.

**(ii) The number 32 KiB is refuted, by measurement.** Using the shipped serializer:

```
$ bun /home/admin_maxime/.hermes/profiles/maxime/cache/scratch/find-crossing.ts
largest N under 32768 bytes = 97 (32563 B)
first N over               = 98 (32896 B)
200 bindings -> 67062 bytes; 500 -> 167562 bytes
```

At **~335 B per binding** (author hex 64 + d + attribution), a 32 KiB cap refuses the **98th** binding. R1 says
"a single admin/editor could have hundreds of custom browse pages". **A 32 KiB cap would break the owner's stated
requirement at the first hundred.** The order could not have seen this because its unit was a compact tag, not a
pretty-printed object.

**(iii) The replacement is a large, explicit ceiling whose job is to catch a runaway, not to ration.** Adopt
`ROUTES_FILE_BUDGET_BYTES = 4 * 1024 * 1024` (4 MiB). Justification, measured: 500 bindings = 167,562 B, so 4 MiB
is ~12,500 bindings — far past "hundreds", and small enough that a pathological loop is caught. It is checked in
`serializeRoutesFile` **before** `writeAtomic`, and it **refuses, never truncates** (S7). The error names the byte
count, the binding count, and the cap, so the message is actionable.

**A second budget, which is the one that matters more here, is per-page:** `pageStore.put()` already bounds the
coordinate (`pageStore.ts:61`) but the *page bytes* are bounded only by the ingest cap (`appEvents.ts:50`,
512 KiB). This plan adds **no** new page-store ceiling — it records that the ingest cap is the page budget and
that `put()` is reachable only through ingest (§4 step 5) — because a second cap on the same bytes is a place for
the two to disagree. Stated so the next reader does not add one.

### 1.5 The one semantic correction the order's own tests contain

Order test #12–#17 make `pickPathCandidate` return the **oldest usable** page across authors "to resist squatting".
On the shipped stack a path is bound by exactly one routing-file row (`routeFile.ts:204-206` rejects a duplicate),
so two authors cannot both answer one path through the file. The oldest-author rule therefore cannot apply to
binding resolution at all.

What *can* happen is two authors claiming the **same path's `d`** and an admin binding naming one of them. The
binding already names the author; the tie-break is the *binding*, not `created_at`. So:

- **Dropped:** `pickPathCandidate` as an ordering rule over authors. There is no reader for it.
- **Kept, re-homed:** the within-author replaceable merge — "one author, one `d`, newest event wins" — which the
  store already performs implicitly because `put()` overwrites one file. **This is asserted, not changed** (§5, T3).
- **Kept, unchanged:** `pickSeriesCandidate`'s newest-wins, because a series genuinely has many members from one
  author and ordering between them is the whole feature.

Recording this as a **finding against the order**, per the order's own Step 8 rule that a place where the code
disagrees with the design wins over the design.

---

## 2. Files this increment creates or modifies

Exactly these. No UI, no `platform/web/routes/`, no `StorefrontBuilder.tsx`, no `vanityRead.ts`.

| Path | Action | Why |
| --- | --- | --- |
| `platform/server/routes/pagePaths.ts` | **NEW** | `PAGE_SERIES_TAG`, `isValidPagePath`, `isValidSeriesTag`, `seriesForPath` (pure; imports `NAME_PATTERN` from `@sdk/config/routeNames`). |
| `platform/server/routes/pagePaths.test.ts` | **NEW** | T1–T4. |
| `platform/server/routes/routeFile.ts` | modified | `SeriesTarget`; `RouteTarget` union grows; validator accepts a well-formed series binding and keeps refusing a malformed one; `ROUTES_FILE_BUDGET_BYTES` + the check in `serializeRoutesFile`. |
| `platform/server/routes/routeFile.test.ts` | modified | **Retarget, do not delete, the test at `:151-156`**: `series` is now accepted and a *malformed* series is refused; the `grants` half stays. Plus T5–T7. |
| `platform/server/routes/resolve.ts` | modified | Fourth rung: `series` targets resolve through an injected index (§3). |
| `platform/server/routes/resolve.test.ts` | modified | T8–T12. |
| `platform/server/routes/series.ts` | **NEW** | `resolveSeries` — the **only** caller of `pageStore.seriesMembers()` for resolution (§3.2). |
| `platform/server/routes/series.test.ts` | **NEW** | T13–T16. |
| `platform/server/routes/pageStore.ts` | modified | One accessor: `has(author, d)` — exists/servable, so the series walker can skip a member whose page file is gone without reading it. No change to `put`, to the index format, or to the write path. |
| `platform/server/routes/pageStore.test.ts` | modified | T17 (`has`), plus an assertion that the index's newest-first order is still what `seriesMembers` returns after the change. |
| `platform/server/buildServer.ts` | modified | Pass the series resolver into `resolve()`; serve a series outcome by reading the chosen member from the store. |
| `platform/web/storefront/storefrontPublish.ts` | modified | `PageAddress` argument, defaulted (S5). |
| `platform/web/storefront/storefrontQuery.test.ts` | modified | T18–T20. **Measured correction:** there is no `storefrontPublish.test.ts`; this module's existing tests live here (`storefrontQuery.test.ts:54-111` import `buildStorefrontPageEvent`/`publishStorefrontPage` dynamically). The plan adds to that file rather than inventing a second home. Baseline for it: `bun test --isolate platform/web/storefront/` → **50 pass, 0 fail, 4 files**. |
| `sdk/commerce/storefront/routeIntent.ts` | modified | Accept `{ type:'series', series, author }` as an intent target so a series binding is authorable through the one ingest surface. Intents are how the live table is written; a target the validator accepts but no intent can express is dead on arrival. |
| `sdk/commerce/storefront/routeIntent.test.ts` | modified | T22. |
| `platform/server/routes/routeTable.ts` | modified | `apply()` carries a series target through instead of narrowing to `page`. |
| `platform/server/routes/routeTable.test.ts` | modified | T23. |
| `platform/server/http/appEvents.ts` | modified | Accept `t` tags on a stored page only when the **page arm** stores it (no change to gates), and pass `author`/`series` through unaltered. *Only if* T24 shows it is needed. |
| `platform/server/routes/pagesHttp.test.ts` | modified | T24–T26: end-to-end through HTTP. |

**Count: 4 new, 15 modified** (counted from the table above, and each path checked to exist or not exist on this branch). Anything else appearing in `git status` at the end means the increment drifted.

---

## 3. The series wiring — the exact answer

### 3.1 The target and its validator

```ts
// routeFile.ts
export interface SeriesTarget {
	type: 'series'
	/** The `t` value pages declare membership with. */
	series: string
	/** The series owner. 64-hex. Not inferred — `ARCHITECTURE.md` §5.3. */
	author: string
}
export type RouteTarget = PageTarget | RenderTarget | SeriesTarget
```

Validator (replacing the refusal at `routeFile.ts:252-253`):

- `target.series`: non-empty, `isValidSeriesTag` (i.e. satisfies `NAME_PATTERN`); else `/target/series: …`.
- `target.author`: 64 lowercase hex; else `/target/author: expected 64 lowercase hex`.
- A **malformed** series target still refuses the file, with a pointer naming which field — the failure mode the
  refusal had is preserved, only its trigger narrows. This is what `routeFile.test.ts:151-156` is rewritten to.

### 3.2 Which function calls `seriesMembers()`, and which rung

**The rung.** It is a **new RUNG 1b-series**, evaluated *at rung 1*, immediately after an exact-path hit is found
to be a `series` binding and **before** the compiled-in check (`resolve.ts:62-66`). Rationale: `/featured` is an
exact path in the routing file. It is rung 1. It is *not* rung 2 — rung 2 is for programmed prefixes where the id
is in the URL (`resolve.ts:68-73`), and a series has no id in the URL. It is emphatically **not** a new rung 3,
which is the honest 404.

**The function.** `platform/server/routes/series.ts`:

```ts
export interface SeriesIndex {
	seriesMembers(series: string, author: string): SeriesMember[]
}
export type SeriesResolution =
	| { outcome: 'found'; author: string; d: string }
	| { outcome: 'empty' }      // the series has no usable member at all
export function resolveSeries(target: SeriesTarget, index: SeriesIndex, store: { has(a: string, d: string): boolean }): SeriesResolution
```

`resolveSeries` is **the one and only caller of `pageStore.seriesMembers()` for resolution.** It walks the
newest-first array the store already maintains (`pageStore.ts:112` sorts `createdAt` desc, then `eventId` desc) and
returns the **first member whose page is still present**, via `store.has(author, d)`.

**How the pure `resolve()` stays pure.** `resolve()` gains an optional fourth argument:

```ts
export interface ResolveContext {
	series?: (target: SeriesTarget) => { author: string; d: string } | null
}
export function resolve(file: RoutesFile, pathname: string, nowSeconds: number, context: ResolveContext = {}): Resolution
```

and returns a new outcome:

```ts
| { status: 200; outcome: 'series'; target: SeriesTarget; author: string; d: string; path: string }
| { status: 404; outcome: 'not-found'; path: string; reason: 'series-empty' }
```

`buildServer.ts:82` supplies `context = { series: (t) => { const r = resolveSeries(t, pageStore, pageStore); return r.outcome === 'found' ? r : null } }`.
`resolve()` therefore still does **no** I/O, still never consults the network, and still passes
`resolve.test.ts:100-110` unchanged. Called with no context (every existing test), a series binding yields
`series-empty` → 404, which is honest: without an index a series cannot answer.

**The serve path.** `buildServer.ts` gains one branch beside the `page` branch, before the `pageStore.get` call:

```ts
const { author, d } = resolution.outcome === 'series' ? resolution : resolution.target
const page = pageStore.get(author, d)
```

A `series` outcome whose member file vanished between resolve and read is the existing `binding-target-missing`
500 (`buildServer.ts:106-113`) — already tested at `pagesHttp.test.ts:258`, reused, not duplicated.

**Why not resolve the series inside `pageStore`.** The store is keyed by `(author, d)` and deliberately knows
nothing about paths or targets (`pageStore.ts:6-19`). Putting path policy in the store would make the page store a
second router. `series.ts` sits between them, which is exactly the layering `IMPLEMENTATION-PLAN.md:623` describes.

**The honest limit, restated.** "Newest" is `createdAt` from the stored record (`pageStore.ts:111`). The author can
backdate. It is author-scoped, so this is a self-attack (`ARCHITECTURE.md` §5.3, recorded as **accept, not
solved**). This increment does not add a clock and does not pretend to.

---

## 4. Ordered steps

Each step leaves the suite runnable. Numbers are the expected `bun test --isolate` totals after the step, measured
from the §0.1 baseline of 94.

**Step 1 — `pagePaths.ts` + its test (pure, no wiring).**
`PAGE_SERIES_TAG='t'`; `isValidPagePath` = `isValidRouteName` (imported) for a single segment; `isValidSeriesTag` =
same; `seriesForPath(d)` returns the prefix of a `NAME-NN-NN-NNNN` shaped `d` **only when the prefix is itself a
valid series tag**, else `null`. Do **not** generalise the date pattern: a free-form prefix makes every dated page a
series member and lets `/x` collide with `/x-13-11-2026` by accident (the order's own reason; still right).
→ `bun test --isolate platform/server/routes/pagePaths.test.ts` → **4 pass**.

**Step 2 — `routeFile.ts`: the type, the validator, the budget.**
Add `SeriesTarget`; accept it; add `ROUTES_FILE_BUDGET_BYTES` and the check in `serializeRoutesFile` **before**
returning the string. Retarget `routeFile.test.ts:151-156`. Add T5–T7.
→ `bun test --isolate platform/server/routes/routeFile.test.ts` → baseline count **+3**, and the retargeted test
still present under a name that says what it now proves.

**Step 3 — `series.ts` + `pageStore.has`.**
`has(author, d)` = `get(author, d) !== null`, implemented without a third open (reuse `readJson` on `pagePath`).
`resolveSeries` walks `seriesMembers`, returns the newest present member, `{ outcome:'empty' }` when none.
→ `bun test --isolate platform/server/routes/series.test.ts platform/server/routes/pageStore.test.ts` → **+7**.

**Step 4 — `resolve.ts`: the fourth outcome, `ResolveContext`.**
No behaviour change when the context is absent — asserted, not hoped (T12).
→ `bun test --isolate platform/server/routes/resolve.test.ts` → **+5**.

**Step 5 — `buildServer.ts`: supply the context and serve a series outcome.**
Store-read for a series resolution goes through the same `pageStore.get`, so the ingest cap is the page's only
size budget (§1.4). Subpath series paths are **not** served: `buildContentRoutes` registers literal routes for
bindings that exist at boot (`buildServer.ts:128-130`), so a series binding authored at runtime is reachable only
on the `/:name` catch-all (`:143`). **A series binding is therefore top-level-only in this increment** — enforced in
the intent validator (`validateIntentPath` already refuses `/`), and recorded in §7 as a limit rather than a bug.

**Step 6 — the write side: `storefrontPublish.ts` + `routeIntent.ts` + `routeTable.ts`.**
`PageAddress { dTag?, series? }`, defaulted to `STOREFRONT_PAGE_D_TAG`; validate `dTag` with `isValidPagePath` and
each series with `isValidSeriesTag`, throwing on a bad one (fail closed, S4); push `['t', s]` deduped;
`unpublish` forwards the address **including `series`** so a switched-off page keeps membership and `/featured`
reports "empty" rather than "never existed" (the order's Step 4 point, still correct).
`routeIntent.ts` grows a `RouteIntentSeriesTarget`; `routeTable.apply` carries it through unchanged into the
binding.
→ `bun test --isolate platform/web/storefront/ sdk/commerce/storefront/routeIntent.test.ts platform/server/routes/routeTable.test.ts` → **+6** past the measured baseline (`platform/web/storefront/` alone: 50 pass, 4 files).

**Step 7 — end-to-end through HTTP in `pagesHttp.test.ts`.**
Publish two pages tagged `featured` at two `d`s, bind `/featured` to the series, read `/featured`, publish a third,
read again **without touching `routes.json`** (T25 — that is what "dynamic" means). Plus the anti-takeover case
(T26).
→ +3.

**Step 8 — conservation sweep.** Full routes suite + the publication diff gate (§6, E7/E8). Nothing written outside
§2's file list. No commit.

---

## 5. Test cases (names as they will appear)

`pagePaths.test.ts` — new
- T1 `a valid path segment is a route name and an invalid one is not` (`featured-13-11-2026` ✓, `Featured` ✗, `ab` ✗, `a_b` ✓)
- T2 `seriesForPath reads a dated suffix only when the prefix is a valid series tag` (`featured-13-11-2026`→`featured`; `featured`→null; `sale-13-11-2026`→null)
- T3 `readSeriesTags dedupes and drops an empty or invalid tag`

`routeFile.test.ts` — modified
- T4 `a well-formed series binding loads with its series key and author`
- T5 `[RETARGETED :151] grants are still refused; a MALFORMED series target is refused by field pointer` (the old `expect(series).toContain('increment 5')` is replaced by two assertions: the well-formed case **loads**, the malformed case names `/target/series` or `/target/author`)
- T6 `the file budget refuses a table over the cap, naming bytes, bindings and the cap, and writes nothing`
- T7 `serializeRoutesFile round-trips a series binding byte-identically twice`

`resolve.test.ts` — modified
- T8 `rung 1: a series binding with a resolver yields the resolver's member`
- T9 `rung 1: a series binding with no resolver is 404 series-empty, never a render`
- T10 `rung 1: a series binding never falls through to a compiled-in name of the same path`
- T11 `an expired lease on a series path is still 404 lease-expired and does not consult the resolver` (invariant 3)
- T12 `[GUARD] every existing resolve test passes with resolve(file, path, now) and no context` — the purity contract

`series.test.ts` — new
- T13 `the newest member wins`
- T14 `a newest member whose page file is gone is skipped for the next present member`
- T15 `an empty index is empty, not an error, and not a scan of the author directory`
- T16 `[GUARD] an outsider's membership never wins: the walk reads only (series, target.author)`

`pageStore.test.ts` — modified
- T17 `has is true for a stored page and false for an absent one, and the index is still newest-first`

`storefrontQuery.test.ts` — modified (this module's existing tests live here; see the §2 note)
- T18 `buildStorefrontPageEvent(page) with no address is byte-identical to today` (`[['d','storefront-page'], …title]`) — S8
- T19 `an address publishes to its d and carries its t tags, deduped`
- T20 `a bad path or bad series tag throws and nothing is signed`

`routeIntent.test.ts` / `routeTable.test.ts` — modified
- T21 `a series target round-trips through the intent content`
- T22 `apply carries a series target into the binding instead of narrowing it to page`

`pagesHttp.test.ts` — modified
- T23 `a page published at a custom d is served at its bound path` (R2)
- T24 `[R3] /featured answers the newest member, and a later publish changes the answer with routes.json bytes unchanged`
- T25 `a page tagged featured by a non-owner is stored but never wins /featured`

---

## 6. Exit criteria — each with the command that proves it, and the number

| # | Criterion | Command | Expected |
| --- | --- | --- | --- |
| E1 | `pagePaths` is pure and correct | `bun test --isolate platform/server/routes/pagePaths.test.ts` | `3 pass, 0 fail` |
| E2 | The routing file accepts a series binding and still refuses a malformed one | `bun test --isolate platform/server/routes/routeFile.test.ts` | baseline +3, **0 fail**, and `grep -c "increment 5" platform/server/routes/routeFile.test.ts` → **0** |
| E3 | The budget refuses, never truncates, and the number is measured not estimated | `bun test --isolate platform/server/routes/routeFile.test.ts` incl. T6 | T6 passes; T6's assertion quotes the byte count it observed |
| E4 | `seriesMembers()` now has a production caller | `grep -rn "seriesMembers" --include=*.ts platform/ \| grep -v test` | exactly **2** lines: `pageStore.ts:49` (interface), `pageStore.ts:127` (impl) **plus** `series.ts` — i.e. the grep must now show a `series.ts` hit that §0.2b did not |
| E5 | A series path resolves to the newest member and skips an absent one | `bun test --isolate platform/server/routes/series.test.ts` | `4 pass, 0 fail` |
| E6 | `resolve()` is still pure — no context, no behaviour change | `bun test --isolate platform/server/routes/resolve.test.ts` | baseline +5, `0 fail`; the `no network` describe block still passes |
| E7 | **Conservation** — no existing test lost | `bun test --isolate platform/server/routes/ platform/server/http/appEvents.test.ts` | **≥94 pass** (the "before" column, §0.1) and `0 fail`; the delta is exactly the tests added |
| E8 | The change is exactly the files named | `git status --porcelain` | **4 new, 15 modified**, no other path |
| E9 | The defaulted publish signature is a no-op | `bun test --isolate platform/web/storefront/storefrontQuery.test.ts -t "byte-identical"` | 1 pass |
| E10 | R3 is dynamic: no routing-file write on a new publish | T24 asserts `routes.json` bytes before/after are equal | 1 pass |

> **Deliberately absent from this table:** a typecheck count. `bunx tsc --noEmit` takes 400 s+ and OOMs this
> runner; the task forbids it. **That gap is not hidden — it is carried as an open item in §7** and must be closed
> by CI or by a larger runner before merge. Reporting "green" without it would be the exact overclaim the house
> rule forbids.

---

## 7. What this increment deliberately does NOT do

- **No route change.** `/` and `/$vanityName` resolve exactly as today. R1 is reachable, not visible. (R4 — home as
  just another path — is *not* done here; `defaultPath()` still has no production consumer, and wiring `/` is
  increment 3.)
- **No UI, no page list, no per-page builder.** An author cannot yet browse their hundreds of pages.
- **No trusted-author set / role read.** The series owner comes from the binding; reading role lists and deciding an
  allowlist is increment 3 (D16, escalated).
- **No series derivation at publish.** `seriesForPath` exists and is tested; the publish form does not call it.
  Deriving `t` from a `d` silently is the "convention on the write" failure D15 names.
- **No lists.** The `list` reference stays unimplemented; `ruling-d8` §3 marks it a follow-up.
- **No subpath series.** A series binding is top-level-only this increment (Step 5's reason, measured: subpath
  bindings are registered at boot from `buildServer.ts:128-130`).
- **No backdating defence.** Author-scoped, recorded as accept (`ARCHITECTURE.md` §5.3).
- **No lease interaction beyond the refused case.** A lapsed lease on a series path is 404 and does not consult the
  resolver (T11) — invariant 3 is preserved, not extended.
- **No typecheck gate** (§6's note). Open.
- **No second page-size cap.** The ingest cap is the page budget; §1.4 says why adding another is a defect.
- **Nothing committed, nothing pushed, no remote touched.**

---

## 8. Open items this plan carries forward

1. **The typecheck gate is unmeasured here.** Must be run before merge on a machine that can hold it.
2. **`order-increment-2.md`'s byte figures did not reproduce** (25,651 vs 32,681 at 230 claims). The report back
   should say so rather than inherit the number.
3. **`pickPathCandidate`'s cross-author oldest-wins rule has no reader on this stack** (§1.5). Recorded as a finding
   against the order; if a future increment makes a path answerable by more than one author, this is the rule it
   revives, and it must be revived deliberately.