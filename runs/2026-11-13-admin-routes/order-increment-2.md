# Increment 2 — the page-path layer (and the claim table's new shape)

**Goal:** make R1, R2 and R3 *reachable* in code without changing a single rendered page. A page becomes
publishable at an arbitrary `d`; a path resolves to a page; a series resolves to the newest page; the claim table
gains one target type and a byte budget. **No route change, no UI, no `/` change, nothing deployed.**

**Bound:** `proposal-v2.md` §3 (the model) and §4 D13/D14/D15/D17/D20. This document specifies only what is
implementable and testable in isolation. Where it disagrees with `order-increment-1.md`, this document wins —
increment 1's wire format is *extended*, never rewritten (every existing `route` tag stays valid).

**Base:** branch `d7s2/route-table` @ `1cc31cb37` (`git log --oneline -1 d7s2/route-table`) — increment 1 is
already built there, including `sdk/config/routeTable.ts` and its test. Do **not** re-derive the wire format.

**Files this increment touches (exactly six):**

```
sdk/config/routeTable.ts                                  modified   (+ series type, budget, default-is-a-path)
sdk/config/routeTable.test.ts                             modified
sdk/commerce/storefront/pagePaths.ts                      NEW        (pure: path grammar, candidate selection)
sdk/commerce/storefront/pagePaths.test.ts                 NEW
platform/web/storefront/storefrontPublish.ts              modified   (address argument, defaulted)
platform/web/storefront/storefrontQuery.ts                modified   (two new reads) + its test
```

That is seven if `storefrontQuery.test.ts` is counted separately; it is modified in the same step as its source.
**Nothing else.** In particular: not `platform/web/routes/`, not `StorefrontAddressPage.tsx`, not
`StorefrontBuilder.tsx`, not `sdk/core/curation/vanityRead.ts`, not `sdk/config/index.ts`, not `platform/server/`.
If a step seems to require one of those, stop — the design is wrong, not the file.

---

## Step 0 — a clean worktree on the right base, and the real baseline

```bash
cd /home/admin_maxime/work/market
git worktree add ../wt-admin-routes-inc2 d7s2/route-table
cd ../wt-admin-routes-inc2
git switch -c admin-routes/inc2-page-paths
/home/admin_maxime/.bun/bin/bun install --frozen-lockfile
```

`bun install` is not optional — the measured traps are in `order-increment-1.md` §Step 0 (fresh worktree →
**15215** errors because `bunx` fetches `typescript@latest`; symlinked `node_modules` → **334** because
`@cashu/cashu-ts`'s `.d.ts` relative imports break through the symlink).

**Measure the baseline on THIS branch before touching anything.** Do not carry `205` from `master`: that figure
was measured on a tree without increment 1's two files.

```bash
cd ../wt-admin-routes-inc2
NODE_OPTIONS=--max-old-space-size=12288 bunx tsc --noEmit 2>&1 | grep -c "error TS" | tee /tmp/inc2-baseline-typecheck.txt
bun test --isolate sdk/config/routeTable.test.ts
bun test --isolate platform/web/storefront/
```

Record all three numbers. They are the "before" column of every count you report.

---

## Step 1 — `sdk/config/routeTable.ts`: one new target type, one budget, one conflict removed

### 1.1 `RouteTarget` gains `series`

```ts
export type RouteTarget =
	| { type: 'profile'; pubkey: string }
	| { type: 'page'; author: string; dTag: string }
	| { type: 'listing'; pubkey: string; dTag: string }
	| { type: 'series'; tag: string }        // NEW — "the newest page in this series"
```

`encodeTarget` gains, and `decodeTarget` gains the matching branch:

| type | encoded | decode rule |
| --- | --- | --- |
| `series` | `t:<tag>` | must start with the literal `t:`; the tag after it must satisfy `isValidSeriesTag` (below); length 1–32 |

`decodeTarget` keeps its contract: **never throws, returns `null`** on anything malformed. `t:` is an
unambiguous prefix — no existing target encoding starts with `t:` (a profile target is 64 hex; `page` is
`<64-hex>:<d>`; `listing` starts with `30402:`).

### 1.2 `parseRouteTable` accepts `series`

Change the type guard at the tag-parsing site from

```ts
if (type !== 'profile' && type !== 'page' && type !== 'listing') {
```

to include `'series'`. A `series` tag whose target fails `decodeTarget` drops with the existing `'bad-target'`
reason — **no new drop reason**, so the existing `DroppedRoute` union and its tests are untouched.

### 1.3 The default names a path, not a target (proposal-v2 D18)

Three concrete edits:

1. **Delete** the `non-page-default` branch in the post-parse conflict pass and remove `'non-page-default'`
   from `RouteConflictKind`. A default may name a `series`, a `profile` or an unclaimed page path.
2. **Rename** `'dangling-default'` → `'unclaimed-default'`, and stop emitting it as a *conflict*: a default that
   names no claim is legal (it names a bare page path). Keep the information — emit it in a new field:

```ts
export interface RouteTable {
	entries: RouteEntry[]
	defaultName: string | null
	/** NEW: true when the default names no claim — legal, because a default may name a bare page path. */
	defaultIsUnclaimed: boolean
	conflicts: RouteConflict[]
	dropped: DroppedRoute[]
}
```

3. `assertSerializable` no longer requires the default to be a page target. It requires: the default name is a
   valid route name, is not reserved, and — if a claim exists for it — that claim is serialisable. A default
   naming an unclaimed path emits only `["route-default", <path>]`.

**Why this is not a loosening:** the old check existed because v1's `/` rendered through `StorefrontRenderer`
and a profile at `/` would have needed a second renderer branch. In v2 `/` runs the same ladder as every other
path (proposal-v2 §3.3), so the constraint belongs to the *route module*, not the data model.

### 1.4 The claim budget (D13)

```ts
/** Our choice, not a spec value: no relay event cap is configured in this repo, so the table must not assume one. */
export const ROUTE_CLAIM_BUDGET_BYTES = 32 * 1024

/** Bytes of JSON the tag list occupies, using the same encoding a relay receives. */
export function claimTableBytes(tags: readonly string[][]): number {
	return new TextEncoder().encode(JSON.stringify(tags)).length
}
```

`serializeRouteTable` gains a final check, after the existing `assertSerializable`:

```ts
const bytes = claimTableBytes(tags)
if (bytes > ROUTE_CLAIM_BUDGET_BYTES) {
	throw new RouteTableError(
		`claim-budget-exceeded: ${bytes} bytes for ${entries.length} claims; the budget is ${ROUTE_CLAIM_BUDGET_BYTES}`,
	)
}
```

**Refuse, never truncate.** A truncated table silently deletes someone's claim, which `AGENTS.md:111-115` calls
unacceptable. The error names both numbers so the dashboard can say "remove N claims" rather than "too big".

**Do not** convert this to a byte estimate per entry; measure the serialised list. An estimate that drifts from
the encoder is worse than no budget.

---

## Step 2 — `sdk/commerce/storefront/pagePaths.ts` (new, pure)

No React, no `fetch`, no store, no `platform/` import. It may import from `./storefrontPage`. Its inputs are
event-shaped objects (`{ kind, pubkey, created_at, tags, content, id }`) and its outputs are plain objects.

### 2.1 Constants and grammars — write these verbatim

```ts
/** The tag a page uses to declare series membership. Single-letter = relay-indexable. */
export const PAGE_SERIES_TAG = 't'

/** A page's `d` is its path segment, so it obeys the route-name grammar (sdk/config/vanity.ts:171-175). */
const PAGE_PATH_PATTERN = /^[a-z0-9][a-z0-9_-]{1,28}[a-z0-9]$/
const SERIES_TAG_PATTERN = /^[a-z0-9][a-z0-9_-]{1,30}$/

/** `featured-13-11-2026` → `{ series: 'featured', unique: 'featured-13-11-2026' }`; anything else → null. */
const SERIES_PAGE_PATTERN = /^(featured)-(\d{2}-\d{2}-\d{4})$/

/** Series resolution reads newest-first in windows; 20 × 5 = 100 candidates, then the floor. */
export const SERIES_WINDOW = 20
export const SERIES_MAX_WINDOWS = 5
```

`SERIES_PAGE_PATTERN` is deliberately **not** a general `^(.+)-(\d{4}-\d{2}-\d{2})$`: a free-form prefix would
make every dated page a series member and make `/x` collide with `/x-2026-01-01` by accident. One series is
declared in code here; adding a second means adding it to a list, not loosening the pattern.

### 2.2 Functions — exact signatures and rules

```ts
export function isValidPagePath(value: string): boolean
export function isValidSeriesTag(value: string): boolean

/** Opt-in derivation: the series a dated page belongs to, or null. Never applied silently — see the publish step. */
export function seriesForPath(dTag: string): string | null

/** `['t','featured'],['t','sale']` → `['featured','sale']`, deduped, invalid tags dropped. */
export function readSeriesTags(tags: readonly string[][]): string[]

/** Same predicate as platform's shouldRenderStorefrontPage (storefrontQuery.ts:150-154), for sdk callers. */
export function isRenderablePage(parsed: StorefrontParseResult): boolean   // page !== null && page.enabled && page.content.length > 0

export type PathPickReason = 'chosen' | 'none' | 'all-unusable'

export interface PathPick {
	reason: PathPickReason
	event: PageEvent | null
	/** Events considered at the winning coordinate, and how many were unusable (disabled/empty/unparseable). */
	considered: number
	unusable: number
}

/** Step 2 of the ladder: one path, many candidate authors → the deterministic winner. */
export function pickPathCandidate(events: readonly PageEvent[], path: string): PathPick

/** Step 3 of the ladder: series membership → the newest usable page. */
export function pickSeriesCandidate(events: readonly PageEvent[], series: string): PathPick
```

**`pickPathCandidate` rules, in order:**

1. keep events where `kind === 30024` **and** `d === path` (re-check; a relay may answer a filter with events
   that do not match it — same defence as `storefrontQuery.ts:89-94`);
2. merge replaceable duplicates: for one `pubkey`, the newest `created_at` wins (ties → lexically lowest `id`,
   matching `mergeRules.ts:24-30`) — this is *within* an author, not across;
3. parse each surviving event's `content` with `parseStorefrontPage`; keep only `isRenderablePage`;
4. order the survivors by `created_at` **ascending**, tie → lexically lowest `id`;
5. return the **first** (oldest) — proposal-v2 §3.3's anti-squatting rule;
6. `considered` = step-1 count, `unusable` = step-1 count − survivors, `reason` = `'chosen'` or
   (`considered > 0` ? `'all-unusable'` : `'none'`).

**`pickSeriesCandidate` rules:**

1. keep events where `kind === 30024` and `readSeriesTags(tags).includes(series)`;
2. merge within author as above;
3. parse, keep `isRenderablePage`;
4. order **descending** by `created_at`, tie → lexically lowest `id`;
5. return the **first** (newest);
6. the caller is responsible for the window (`SERIES_WINDOW`); this function never re-queries. If the caller
   supplies a window's worth and gets `'all-unusable'`, it asks for the next window.

**Purity is the point:** this function decides *which event*; it never decides *what to render*.

---

## Step 3 — the tests these two modules need

`sdk/config/routeTable.test.ts` (extend, keep every existing case):

| # | case |
| --- | --- |
| 1 | `["route","featured","series","t:featured","admin","0","-"]` parses to `{ type:'series', tag:'featured' }` |
| 2 | `t:` with an empty or oversized tag drops `'bad-target'`, not `'unknown-type'` |
| 3 | `decodeTarget('series', 'x:y')` returns `null` (no throw) |
| 4 | a default naming a `series` claim produces **no** conflict (the `non-page-default` case is gone) |
| 5 | a default naming an unclaimed path produces `defaultIsUnclaimed: true` and **no** conflict |
| 6 | `serializeRouteTable` round-trips a `series` entry byte-identically twice (stability) |
| 7 | 230 claims serialise under the 32 KB budget (32,681 B) and 231 throw `claim-budget-exceeded` naming both numbers (32,823 B); **nothing is truncated** |
| 8 | the existing 37-reserved-name and name-grammar tests still pass unchanged |

`sdk/commerce/storefront/pagePaths.test.ts` (new):

| # | case |
| --- | --- |
| 9 | `isValidPagePath('featured-13-11-2026')` true; `'Featured'` false; `'ab'` false; `'a_b'` true |
| 10 | `seriesForPath('featured-13-11-2026') === 'featured'`; `seriesForPath('featured')` null; `seriesForPath('sale-13-11-2026')` null |
| 11 | `readSeriesTags` dedupes and drops `['t']` (empty) and `['t','BAD']` |
| 12 | `pickPathCandidate`, two authors same path: older `created_at` wins (`'chosen'`) |
| 13 | same, older is **disabled** → newer wins |
| 14 | same, older is **unparseable** (`'not json'`) → newer wins |
| 15 | same, older has **zero blocks** → newer wins |
| 16 | same `created_at` from two authors → lexically lowest `id` wins (deterministic across runs) |
| 17 | one author publishes twice at one `d` → only the newer event is considered (`considered === 1`) |
| 18 | no candidates → `{ reason:'none', event:null }`; all disabled → `{ reason:'all-unusable' }` |
| 19 | `pickSeriesCandidate`: three pages tagged `featured`, newest disabled → the middle one wins |
| 20 | `isRenderablePage` agrees with `platform/web/storefront/storefrontQuery.ts:150-154` on a 6-fixture matrix (null / disabled / zero-block / unparseable / one-block / enabled) — **a cross-boundary guard**, because the predicate is necessarily duplicated (`sdk/` cannot import `platform/`) |

Test 20 lives in `pagePaths.test.ts` and imports `shouldRenderStorefrontPage` from `@platform/web/storefront/storefrontQuery`. If the boundary guard (`platform/web/app/routeComposition.test.ts` and the import-direction tests) forbids that import in an sdk test, put test 20 in `platform/web/storefront/storefrontQuery.test.ts` instead and say so in the report — **do not weaken the assertion**, it is the only thing keeping the two predicates honest.

---

## Step 4 — `storefrontPublish.ts`: an address, defaulted

```ts
export interface PageAddress {
	/** The path segment. Defaults to STOREFRONT_PAGE_D_TAG for the profile page. */
	dTag?: string
	/** Series membership. Never derived silently — the caller passes what the author confirmed. */
	series?: readonly string[]
}

export function buildStorefrontPageEvent(page: StorefrontPage, address: PageAddress = {}): EventTemplate
export async function publishStorefrontPage(page: StorefrontPage, address: PageAddress = {}): Promise<PublishStorefrontPageResult>
export async function unpublishStorefrontPage(page: StorefrontPage, address: PageAddress = {}): Promise<PublishStorefrontPageResult>
```

Body changes, exactly:

1. `const dTag = address.dTag ?? STOREFRONT_PAGE_D_TAG`; if `address.dTag` is provided it must satisfy
   `isValidPagePath`, else **throw** with `Page path '${dTag}' is not a valid path segment` (fail closed: a bad
   path is a page nobody can reach).
2. `tags[0] = ['d', dTag]`; then the existing title tag; then for each series in `address.series ?? []`:
   validate `isValidSeriesTag` (throw if not) and push `[PAGE_SERIES_TAG, series]`, deduped.
3. Nothing else changes — content, validation, the signer check at `:91-93`, the zero-ACK check at `:96-98`.

**`unpublishStorefrontPage` must forward the address** (`:115-117`). If it does not, switching a path page off
would write `enabled:false` to the *profile* coordinate — a data-loss bug that is easy to write and hard to see.
Pin it with a test.

**The author must be able to unpublish without losing `t`**: forward `series` too, or the disabled event loses
membership and `/featured` cannot tell "switched off" from "never existed". §3.5 of the proposal needs the
former.

---

## Step 5 — `storefrontQuery.ts`: two reads

```ts
/** One path segment → the winning page among a set of authors. Empty result when nothing is usable. */
export async function fetchPageByPath(path: string, authors: readonly string[]): Promise<StorefrontPageResult>

/** One series → the newest usable page, walking windows until one is found or the cap is hit. */
export async function fetchSeriesPage(series: string, authors: readonly string[]): Promise<StorefrontPageResult>
```

**Read-seam justification comments are mandatory** (`sdk/AGENTS.md:48-55`) and must say which class this is:

- `fetchPageByPath` is a **bounded fetch**: one coordinate per author, a handful of events, a single answer.
- `fetchSeriesPage` is a **bounded fetch that may repeat**: up to `SERIES_MAX_WINDOWS` windows of
  `SERIES_WINDOW`, each `{ kinds:[30024], authors, '#t':[series], limit: SERIES_WINDOW, until }` with `until`
  walked back from the previous window's oldest `created_at`. Say in the comment why it is not a `stream` (the
  answer is a single page, and a live subscription would re-render a page mid-read).

Both must:

- return the existing `EMPTY_RESULT` shape rather than throwing on "nothing found";
- let transport errors **reject**, so React Query reports `isError` and keeps the cached page — the same
  posture as `fetchStorefrontPage` (`:70-73`), which is v1's accepted D3 behaviour;
- re-check kind, `d`/`t`, and author after the read (defence in depth, `:89-94`);
- never fetch without a non-empty `authors` list — an empty allowlist must short-circuit to `EMPTY_RESULT`, not
  become a filter-less query. **This is the one line that keeps D16's allowlist from silently becoming "open
  namespace" if a role read fails.**

Add query options (`storefrontPathPageQueryOptions(path, authors)`, `storefrontSeriesPageQueryOptions(series,
authors)`) with the same `staleTime: 2 * 60 * 1000` as the address read, and a key that includes the path and
the author set — a key that omits the authors would serve a stale allowlist.

**Do not** wire these into `$vanityName.tsx` or `index.tsx`. That is increment 3.

---

## Step 6 — evidence

Run all of these from `../wt-admin-routes-inc2`, in this order, and paste the raw output into the report.

```bash
# 6.1 the two touched sdk files
bun test --isolate sdk/config/routeTable.test.ts sdk/commerce/storefront/pagePaths.test.ts
# expect: 0 fail; record the pass count. Baseline for routeTable.test.ts was recorded in Step 0.

# 6.2 the storefront neighbours (must not regress)
bun test --isolate platform/web/storefront/
# compare to the Step-0 count, both numbers quoted

# 6.3 typecheck
NODE_OPTIONS=--max-old-space-size=12288 bunx tsc --noEmit 2>&1 | grep -c "error TS"
# compare to the Step-0 baseline. A delta of 0 is required; compare the SORTED LIST, not just the count:
NODE_OPTIONS=--max-old-space-size=12288 bunx tsc --noEmit 2>&1 | grep "error TS" | sort > /tmp/inc2-after.txt
diff /tmp/inc2-baseline-sorted.txt /tmp/inc2-after.txt

# 6.4 the boundary guards (import direction: sdk/ must not import platform/)
bun test --isolate platform/web/app/routeComposition.test.ts

# 6.5 the change is exactly the files named
git status --porcelain
# expect two modified, two new, plus the query test
```

**Conservation, not green.** If a count moves, report the movement with the test names. Do not report "all
passing" without the number.

---

## Step 7 — exit criteria

The increment is done when **all** of these hold, each with the command that proves it:

1. `parseRouteTable` accepts a `series` target and rejects a malformed one without dropping the whole table
   (Step 3 #1–#3).
2. A default naming a `series` claim or an unclaimed path is **not** a conflict, and
   `serializeRouteTable` round-trips it (Step 3 #4–#6).
3. The claim budget permits 230 claims and refuses the 231st, with no truncation (Step 3 #7).
4. `pickPathCandidate` returns the oldest **usable** page and never the same answer twice for the same input
   (Step 3 #12–#17).
5. `pickSeriesCandidate` skips a switched-off newest page (Step 3 #19).
6. `buildStorefrontPageEvent(page)` with no address produces byte-identical tags to today
   (`[['d','storefront-page'], …title]`) — **the defaulted signature is a no-op**, proven by a test, not by
   inspection.
7. `unpublishStorefrontPage(page, address)` writes `enabled:false` to `address.dTag`, not to
   `storefront-page` (Step 4's gap).
8. `fetchPageByPath(path, [])` short-circuits without a relay request (a spy on the read context asserts zero
   calls).
9. typecheck delta 0 against the branch's own baseline; storefront test count unchanged apart from tests added.
10. `git status --porcelain` shows exactly the files named at the top.

---

## Step 8 — what the report back must contain

- every count from Step 6, before and after, with the command;
- the pass count for each new test file;
- **test 20's placement** (sdk or platform) and why, if the boundary guard forced it;
- any place where the code disagreed with `proposal-v2.md` §3 — that is a finding about the design, and it wins
  over the design;
- the byte count of the claim table at 232 entries as actually measured (`claimTableBytes`), not as estimated
  here;
- confirmation that no route module, no `StorefrontAddressPage`, and no `platform/server/` file was touched.

---

## What increment 2 deliberately does not do

- **No route change.** `/` and `/$vanityName` still resolve exactly as today. R1 is *available* after this
  increment; it is not *visible*.
- **No page list, no per-page builder.** An admin cannot yet reach their own hundreds of pages through the UI.
- **No trusted-author set.** The step-2/step-3 resolver takes `authors` as a parameter; reading the role lists
  and deciding the allowlist is increment 3 (`proposal-v2.md` D16, which is **escalated** and needs the owner's
  word before it is wired).
- **No series derivation at publish.** `seriesForPath` exists and is tested; the publish form does not call it
  yet. Deriving `t` silently from a `d` would be the exact "convention on the write" failure D15 warns about.
- **No lists.** `list` stays unimplemented; D20's union is a schema decision for the increment that changes
  `ProductRow`'s prop, not this one.
- **No server validator, no claim UI, no deployment.**