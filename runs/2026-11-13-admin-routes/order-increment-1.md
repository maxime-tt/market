# Increment 1 — the route table as a pure data model

**Goal:** land the typed route table as a framework-free module with tests, so every later increment has one
parser and one wire format. **No behaviour changes.** No consumer is re-pointed, no UI is added, no server code
is touched, nothing is deployed.

**Bound:** `proposal.md` §2 (the model) and §3 (the resolution rule). This document specifies only enough of
both to be implemented and tested in isolation.

**Files this increment creates (exactly two):**

```
sdk/config/routeTable.ts
sdk/config/routeTable.test.ts
```

**Files this increment modifies: none.** In particular: not `sdk/config/index.ts`, not
`sdk/core/curation/vanityRead.ts`, not `sdk/config/vanity.ts`, not `platform/`. If a step seems to require
touching one of those, stop — the design is wrong, not the file.

---

## Step 0 — a clean worktree, and the real baseline

Do not work in `/home/admin_maxime/work/market` itself. It is dirty (untracked `notes/`, `.hermes/`, `bin/`,
`infra/` — measured), and that dirt is exactly what produced the false 522-error baseline.

```bash
cd /home/admin_maxime/work/market
git worktree add ../wt-admin-routes-inc1 1ed3d676a
cd ../wt-admin-routes-inc1
git switch -c admin-routes/inc1-route-table
/home/admin_maxime/.bun/bin/bun install --frozen-lockfile
```

`bun install` is not optional. Measured traps, all previously hit:

| without a proper install | reports |
| --- | --- |
| fresh worktree, `bunx` fetches `typescript@latest` | **15215** errors |
| `node_modules` symlinked from the main checkout | **334** errors (breaks `@cashu/cashu-ts`'s `.d.ts` relative imports) |

Now take the baseline, **twice** — the count and the list:

```bash
NODE_OPTIONS=--max-old-space-size=12288 /home/admin_maxime/.bun/bin/bun bunx tsc --noEmit > "$HOME/.cache/tsc-before.raw" ; echo "exit=$?"
grep -c "error TS" "$HOME/.cache/tsc-before.raw"
grep "error TS" "$HOME/.cache/tsc-before.raw" | sed -E 's/\([0-9]+,[0-9]+\)//' | sort > "$HOME/.cache/tsc-before.txt"
```

**Expected: exactly `205`.** tsc exits **2** while printing errors, so the exit code is not the assertion — the
count is, and so is the sorted list. If you measure anything other than 205 here, **stop and report**: the
tree is not the base this plan was written against.

Record, in the same file you will hand back:

```
typecheck before: <n>   (command above)
list sha256:       <sha256sum "$HOME/.cache/tsc-before.txt">
```

`node_modules/.bin/tsc` is blocked by a command guard. Use `bunx`.

Also take the **test** baseline now, before writing anything — this is the "before" half of step 3.2:

```bash
/home/admin_maxime/.bun/bin/bun test --isolate sdk/config/ sdk/core/curation/ 2>&1 | tail -5
```

Record the pass/fail totals verbatim. Do not substitute a number from another checkout: research 03's focused
run reported 45 pass / 2 fail, and both failures were a missing `applesauce-indexeddb` install, not behaviour.

---

## Step 1 — `sdk/config/routeTable.ts`

New file. Pure: no React, no `@tanstack/*`, no store, no `fetch`, no `platform/*` import. One value import:

```ts
import { VANITY_REGISTRY } from '../core/curation/vanityRead'
```

That import is deliberate — the coordinate must have one definition, and the research measured a hand-copied
duplicate of it already (`platform/server/VanityManager.ts:69` vs `sdk/core/curation/vanityRead.ts:5`). Do not
re-declare the kind or the d-tag locally.

`sdk/config` → `sdk/core` is an allowed direction (`sdk/config/vanity.ts:15` already imports
`../core/state`). Confirm with `bun test --isolate sdk/boundary.test.ts` in step 3.

### 1.1 Constants and types — write these verbatim

```ts
export const ROUTE_TAG = 'route'
export const ROUTE_DEFAULT_TAG = 'route-default'
export const LEGACY_VANITY_TAG = 'vanity'
/** Term value meaning "no term". Only `route` tags use it; legacy `vanity` tags keep absolute-expiry semantics. */
export const PERMANENT_TERM = 0

/** The 37 reserved names — mirrored from `sdk/config/vanity.ts:51-89` and `platform/server/VanityManager.ts:6-44`.
 *  Neither exports its copy; test 6 asserts all three sets are equal. */
export const ROUTE_RESERVED_NAMES: readonly string[] = [/* the 37 literals, verbatim from sdk/config/vanity.ts:51-89 */]

export const ROUTE_AUTHORITIES = ['admin', 'editor', 'reservation'] as const
export type RouteAuthority = (typeof ROUTE_AUTHORITIES)[number]

export type RouteTarget =
	| { type: 'profile'; pubkey: string }
	| { type: 'page'; author: string; dTag: string }
	| { type: 'listing'; pubkey: string; dTag: string }

export interface RouteEntry {
	name: string
	target: RouteTarget
	authority: RouteAuthority
	/** pubkey the authority belongs to; null for an admin route. */
	holder: string | null
	/** unix seconds; 0 = permanent. */
	term: number
	isDefault: boolean
	/** which tag family produced this entry — two families for one name is a drift site. */
	source: 'route' | 'vanity'
}

export type RouteConflictKind = 'duplicate-name' | 'duplicate-default' | 'dangling-default' | 'non-page-default' | 'legacy-shadowed'
export interface RouteConflict {
	kind: RouteConflictKind
	name: string
	detail: string
}

export type RouteDropReason = 'bad-name' | 'reserved-name' | 'unknown-type' | 'bad-target' | 'bad-authority' | 'bad-term' | 'short-tag'
export interface DroppedRoute {
	reason: RouteDropReason
	raw: string[]
}

export interface RouteTable {
	entries: RouteEntry[]
	defaultName: string | null
	conflicts: RouteConflict[]
	dropped: DroppedRoute[]
}

export class RouteTableError extends Error {}
```

### 1.2 Functions — exact signatures

```ts
export function isValidRouteName(name: string): boolean
export function isReservedRouteName(name: string): boolean
export function encodeTarget(target: RouteTarget): string
export function decodeTarget(type: string, raw: string): RouteTarget | null
export function parseRouteTable(tags: string[][], now?: number): RouteTable
export function serializeRouteTable(entries: readonly RouteEntry[], defaultName: string | null): string[][]
export function routeIsLapsed(entry: RouteEntry, now?: number): boolean
export function resolveRoute(table: RouteTable, name: string, now?: number): RouteEntry | null
export function resolveDefaultRoute(table: RouteTable, now?: number): RouteEntry | null
```

`now` defaults to `Math.floor(Date.now() / 1000)`. Everything that reads the clock takes it as a parameter so
tests never depend on wall time.

### 1.3 Behaviour — the rules the tests will pin

**Parsing, per tag, in document order.**

1. A tag is an array of strings. A `route` tag with fewer than 7 elements → dropped, reason `short-tag`.
2. `name` is lowercased, then must match `/^[a-z0-9][a-z0-9_-]{1,28}[a-z0-9]$/` → else dropped, `bad-name`.
3. `name` in the 37 reserved names → dropped, `reserved-name`. The list must be copied, because it is a
   module-local `const` in both places that has it and neither exports it (`sdk/config/vanity.ts:51`,
   `platform/server/VanityManager.ts:6`). Declare `ROUTE_RESERVED_NAMES` in `routeTable.ts` with a comment
   pointing at those two ranges, and **do not** export the list from either of them — both files are out of
   bounds for this increment. The guard against a fourth copy drifting is a test: read both files, extract the
   quoted literals with one regex, compare the three sets (test 6).
4. `type` must be `profile`, `page` or `listing` → else dropped, `unknown-type`. **Dropping is not an error**:
   the rest of the table parses. This mirrors `sdk/commerce/storefront/storefrontPage.ts:616-625`.
5. `target` decoding:
   - `profile` → exactly 64 lowercase hex chars; store as-is.
   - `page` → first 64 chars must be hex, char 65 must be `:`, remainder is `dTag` of length 1–64.
   - `listing` → literal `30402`, then `:`, then 64 hex, then `:`, then `dTag` of length 1–64.
   - anything else → dropped, `bad-target`.
6. `authority` ∈ `ROUTE_AUTHORITIES` → else dropped, `bad-authority`.
7. `term` matches `/^\d+$/` and is ≤ `2 ** 40` → else dropped, `bad-term`. `0` is valid and means permanent.
8. `holder`: `-` (or absent) → `null`; otherwise 64 hex → else dropped, `bad-target`.
9. **Legacy `vanity` tags** (`["vanity", name, pubkey, validUntil]`) parse to
   `{ target: {type:'profile', pubkey}, authority: 'reservation', holder: pubkey, term: validUntil, source: 'vanity' }`.
   Their term keeps **absolute-expiry** semantics: `validUntil === 0` is **lapsed**, not permanent. This is the
   one deliberate asymmetry in the module and the test must say so in its name.
10. **One entry per name.** If a `route` tag and a `vanity` tag name the same thing, the `route` tag wins and a
    `legacy-shadowed` conflict is recorded. If two `route` tags share a name, the **first** wins and a
    `duplicate-name` conflict is recorded. Never silently take the last.

**Defaults.**

11. At most one `route-default` tag is honoured: the **first** one in document order sets `defaultName`; each
    further one records a `duplicate-default` conflict. Deterministic in both directions.
12. If `defaultName` does not name a parsed entry → `dangling-default` conflict, and `resolveDefaultRoute`
    returns `null`.
13. If the default entry's target is not a `page` → `non-page-default` conflict, and `resolveDefaultRoute`
    returns `null`. (`proposal.md` D11: a non-page default is refused.)

**Resolution.**

14. `routeIsLapsed`: `entry.term !== 0 && entry.term < now`.
15. `resolveRoute(table, name)`: lowercase, exact match, `null` if absent or lapsed. **No prefix matching, no
    fuzzy matching, no fallback to a page address** — the fallback chain lives in the route component
    (`proposal.md` §3.1), not here.
16. `resolveDefaultRoute(table)`: `null` when there is no default, a dangling default, a non-page default, or a
    lapsed default entry. **It never throws and never returns a partially valid route.**

**Serialisation.**

17. `serializeRouteTable` emits `route` tags sorted by `name` ascending, then at most one `route-default` tag.
    Sort order is part of the contract: a stable byte-for-byte output is what makes the "did the table change
    under me?" check in the management UI possible.
18. It **throws `RouteTableError`** on: duplicate names; `defaultName` not among `entries`; `defaultName` whose
    target is not a `page`; a name that fails the grammar or is reserved. Writing an invalid table is a
    programming error, not user input — user input is validated before it reaches here.
19. It emits a **legacy `vanity` mirror only for entries where the legacy meaning is identical**: a
    `profile` target with `authority === 'reservation'` and `term > 0`. It never emits a mirror for an admin
    route, an editor grant, or a permanent entry — those have no faithful legacy encoding, and a lie in the
    mirror is worse than an old client seeing nothing.
20. No function mutates its arguments. `parseRouteTable` returns fresh objects every call.

### 1.4 Tag examples the tests use

```
['route', 'home', 'page', '<64-hex author>:home', 'admin', '0', '-']
['route', 'sale', 'page', '<64-hex editor>:storefront-page', 'editor', '0', '<64-hex editor>']
['route', 'bobs-shop', 'profile', '<64-hex bob>', 'reservation', '1900000000', '<64-hex bob>']
['route', 'bobs-item', 'listing', '30402:<64-hex bob>:chair-01', 'reservation', '1900000000', '<64-hex bob>']
['route-default', 'home']
['vanity', 'alice-shop', '<64-hex alice>', '1900000000']      legacy
```

Write the hex literals in tests as `'a'.repeat(64)` style constants, as `sdk/core/curation/curationRead.test.ts:28-31`
already does. **Never commit a real key-shaped literal**, public or not — the pre-commit secret scanner cannot
tell the difference and blocked an earlier evidence file for exactly this.

Import style in the test:

```ts
import { describe, expect, test } from 'bun:test'
import {
	PERMANENT_TERM, RouteTableError, decodeTarget, encodeTarget, isReservedRouteName,
	isValidRouteName, parseRouteTable, resolveDefaultRoute, resolveRoute, routeIsLapsed,
	serializeRouteTable,
} from '@sdk/config/routeTable'
```

---

## Step 2 — `sdk/config/routeTable.test.ts`

One `describe` per rule group, named so a failure says what broke. The set below is the minimum; add nothing
that needs a clock, a relay, or a component.

**Names (rules 2–3)**
1. `accepts 'home'` — `isValidRouteName('home') === true`.
2. `rejects 'h'` (too short) and `'a'.repeat(31)` (too long).
3. `rejects a leading hyphen and a trailing underscore`.
4. `'home' is not reserved` — `isReservedRouteName('home') === false`.
5. `'products' is reserved`.
6. `the reserved list matches sdk/config/vanity.ts and platform/server/VanityManager.ts` — read both files with
   `Bun.file(...).text()`, extract the quoted literals with one regex, and assert the three sets are equal.
   This is the copy-drift guard; it must fail if anyone edits one list.

**Targets (rule 5, 17)**
7. `encode/decode round-trips all three types`.
8. `decodeTarget rejects a 63-char author`.
9. `decodeTarget rejects a page target with an empty d-tag`.
10. `decodeTarget rejects a listing target whose kind is not 30402`.
11. `decodeTarget keeps a d-tag containing colons` — `'<hex>:a:b'` → `dTag === 'a:b'`.

**Parsing (rules 1, 4, 6–10)**
12. `an unknown type drops that tag and keeps the rest` — assert `entries.length === 1` and
    `dropped[0].reason === 'unknown-type'`.
13. `a short tag is dropped, not thrown`.
14. `a bad term is dropped`.
15. `a missing holder is null, not a crash`.
16. `route wins over a legacy vanity tag of the same name` — assert `source === 'route'` and one
    `legacy-shadowed` conflict.
17. `two route tags with one name: first wins, duplicate-name recorded`.
18. `legacy vanity tags parse as profile reservations` and `a legacy validUntil of 0 is lapsed, not permanent`
    (rule 9 — this is the asymmetry test, name it that way).
19. `parse does not mutate the input array` — `expect(tags).toEqual(structuredClone(tags))` after the call.

**Defaults (rules 11–13, 16)**
20. `one default is read`.
21. `a second default tag is a duplicate-default conflict and the first wins`.
22. `a default naming a missing entry is dangling and resolves to null`.
23. `a default naming a profile route is non-page-default and resolves to null`.
24. `a lapsed default resolves to null` — `resolveDefaultRoute(table, entry.term + 1) === null`.

**Resolution (rules 14–16)**
25. `resolveRoute is exact-match` — `'HOME'` resolves, `'hom'` does not.
26. `resolveRoute returns null one second after a term, and the entry one second before`.
27. `a permanent (term 0) route never lapses`.

**Serialisation (rules 17–20)**
28. `round-trips: parse(serialize(t)) deep-equals the entries`.
29. `output is sorted by name` and `is byte-stable across two calls`.
30. `throws on duplicate names`.
31. `throws when the default is not in the table`.
32. `throws when the default target is not a page`.
33. `emits a legacy vanity mirror for a paid profile reservation`.
34. `emits no legacy mirror for an admin route, an editor grant, or a permanent entry`.

That is 34 assertions minimum. If a test needs a new exported helper to be expressible, add the helper to the
module — but do not add a helper that reads the clock, the store or the network.

---

## Step 3 — evidence

Run each command and append its **verbatim** output to your report. Mask any key-shaped literal (a run of 64
hex characters) as `<64-hex>` before pasting; keep the surrounding text.

```bash
# 3.1 the new tests
/home/admin_maxime/.bun/bin/bun test --isolate sdk/config/routeTable.test.ts
# expect: N pass, 0 fail — record N. There is no prior number for a new file.

# 3.2 the neighbours this module sits between, before and after (must be identical)
/home/admin_maxime/.bun/bin/bun test --isolate sdk/config/ sdk/core/curation/
# Run this once in step 0, on the clean tree, before writing anything — that is the "before" number.
# Run it again here for the "after". Both go in the report.

# 3.3 the boundary guards (the new module must not violate an import direction)
/home/admin_maxime/.bun/bin/bun test --isolate sdk/boundary.test.ts platform/boundary.test.ts ui/boundary.test.ts

# 3.4 typecheck after
NODE_OPTIONS=--max-old-space-size=12288 /home/admin_maxime/.bun/bin/bun bunx tsc --noEmit > "$HOME/.cache/tsc-after.raw" ; echo "exit=$?"
grep -c "error TS" "$HOME/.cache/tsc-after.raw"
grep "error TS" "$HOME/.cache/tsc-after.raw" | sed -E 's/\([0-9]+,[0-9]+\)//' | sort > "$HOME/.cache/tsc-after.txt"
diff "$HOME/.cache/tsc-before.txt" "$HOME/.cache/tsc-after.txt" && echo "IDENTICAL"
# expect: 205, and diff prints nothing.

# 3.5 formatting (the repo is prettier-with-tabs; a wrong style fails CI)
/home/admin_maxime/.bun/bin/bun run format:check

# 3.6 the change is exactly two files
git status --porcelain
# expect exactly:  ?? sdk/config/routeTable.test.ts
#                  ?? sdk/config/routeTable.ts
```

**If the typecheck count is 205 but `diff` is non-empty**, that is a regression: two errors swapped. Fix it —
do not report "205, unchanged". The count alone can mask a swap, which is why the list is the assertion.

**If the count moves at all**, the module has a type error. 205 is a ceiling, not a target: the correct
outcome is `205` with an identical list, because this increment adds no consumer.

**Browse suite — only if you touch `platform/web/browse/`.** You must not, in this increment. If a later
change does, quote **both** numbers: `bun test --isolate platform/web/browse/` → **168 pass / 0 fail**, and
without `--isolate` → **153 pass / 15 fail** in `BrowseIndexHost` and `useBrowseIndexFeed`. The unisolated
failures are **pre-existing cross-file state bleed**, not this run's regression. A report that quotes only one
of the two is misleading either way.

---

## Step 4 — exit criteria

Increment 1 is done when **all** of these hold, each with its command's output pasted into the report:

1. `sdk/config/routeTable.ts` exists and imports exactly **one** symbol — `VANITY_REGISTRY` from
   `../core/curation/vanityRead` — and nothing else. No React, no store, no `platform/`, no `fetch`.
2. `sdk/config/routeTable.test.ts` exists and `bun test --isolate sdk/config/routeTable.test.ts` reports
   **0 fail** and ≥ 34 pass.
3. `sdk/config/` + `sdk/core/curation/` test counts are **identical** before and after (same pass, same fail,
   and the same failing test names if any).
4. `sdk/boundary.test.ts`, `platform/boundary.test.ts`, `ui/boundary.test.ts` all pass.
5. Typecheck is **205** and the sorted error list `diff` is **empty**.
6. `bun run format:check` passes.
7. `git status --porcelain` lists exactly the two new files. Nothing else is modified, staged or deleted.
8. `git diff --stat 1ed3d676a` shows **no** modified tracked file.
9. No new route file was added, so `bun run generate-routes` was **not** run and `routeTree.gen.ts` is
   untouched. (Check: `git status` does not list it.)
10. The branch is `admin-routes/inc1-route-table`, one commit, message:
    `feat(sdk): typed route table — parse, serialise, resolve (proposal §2)`

---

## Step 5 — what the report back must contain

- `typecheck before / after` with both counts **and** the `diff` result.
- `sdk/config/ + sdk/core/curation/` counts before and after.
- the new test file's pass count.
- one paragraph on any place where this specification was ambiguous enough that you had to choose — that is a
  defect in the spec, not in your work, and I want to know about it.
- **nothing else**. No summary of the proposal, no opinions about D1.

---

## What increment 1 deliberately does not do

- It does not read or write a relay. `parseRouteTable` takes tags; who fetched them is increment 3's problem.
- It does not touch `VanityEntry`, `readVanityEntries`, `resolveVanity`, `vanityActions` or `vanityStore`. Two
  resolvers already exist and drift is the risk (`sdk/core/curation/vanityRead.ts:56-65` vs
  `sdk/config/vanity.ts:133-145`); adding a third *interpretation* is what this increment is for, and it is
  kept out of both of them until the route component is rewired.
- It does not add the module to the `sdk/config/index.ts` barrel. The barrel's own header explains that
  colliding `export *` chains make TypeScript silently drop names (`sdk/config/index.ts:8-12`); `RouteEntry`
  and `RouteTarget` are generic enough to collide with something. Consumers import `@sdk/config/routeTable`
  explicitly, as `blacklist` already does.
- It does not enforce anything. **Enforcement is the server's, and the server has no route validator yet**
  (`platform/server/EventValidator.ts:85-93` checks only *who* signed). That is increment 2, and until it lands
  the app must not expose a way to write a `route` tag — which is why no writer is built here.