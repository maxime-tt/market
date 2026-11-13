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
path may consult a relay or an indexer to decide which path matched (`ARCHITECTURE.md` §2). An increment that
adds such a call fails its own exit criteria regardless of test results.

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

### 0.3 A note on the two pre-existing facts that shape the order

1. **The purchase path is unverified** (`ARCHITECTURE.md` §10 O-5): `platform/server/ZapPurchaseManager.ts:175-180`
   prices from the requester's own `amount` tag; `grep -rn 'verifyEvent' platform/server/*.ts platform/server/http/*.ts`
   → only `ogMeta.ts:219` and `websocket.ts:30` **[M]**. No increment that onboards a **paying** lease may ship
   before increment 6.
2. **Nothing in `platform/server/` reads or writes a file today** **[M]**
   `grep -rnE 'bun:sqlite|node:fs|writeFile|readFile|Bun\.file' platform/server/ --include=*.ts | grep -v '\.test\.'`
   → 0. So the file writer in increment 1 is genuinely new machinery — small, but new. That is what makes
   increment 1 the honest proof of the architecture rather than a refactor.

---

## 1. Increment 1 — the routing file, resolved server-side, end to end

**Goal:** one page and one path prove the accepted architecture with no relay, no database and no cache: the
server holds a routing file, resolves `/x` to a binding, serves that page's HTML, and 404s everything else.

This is the smallest thing that proves the architecture **end to end**, deliberately "boring, not cute". It
proves four architectural claims at once, each of which the current code fails:

| claim | what increment 1 demonstrates |
|---|---|
| the app is its own authority | a page is served with `APP_RELAY_URL` pointed at a **dead** address and the instance boots and serves |
| routing needs no network | the binding's page is found by **event id in the URL**, not by an indexer (§1.4) |
| an unreadable table is a broken site | the process refuses to boot on a corrupt file, with a named message |
| rung 3 is honest | anything unmatched is a real HTTP **404** |

### 1.1 Files

**New (7):**

```
platform/server/routes/routeFile.ts             the file: load / validate / serialize / writeAtomic / lookup / prefixMatch
platform/server/routes/resolve.ts               the three-rung ladder + the two binding kinds (pure, no I/O)
platform/server/routes/pageHtml.ts              fetch a signed kind-30024 event by id + build the HTML shell response
platform/server/routes/routeFile.test.ts
platform/server/routes/resolve.test.ts
platform/server/routes/pageHtml.test.ts
sdk/config/routeNames.ts                        RESERVED_NAMES (37) + NAME_PATTERN, one definition, imported by both today's copies
```

**New (data / fixture):**

```
data/routes.example.json                        a committed example file, NOT loaded by default
```

**Modified (3):**

```
platform/web/app/entry.tsx                      load the routing file before buildServer(...)   (beside :23)
platform/server/buildServer.ts                  mount the resolver in front of the SPA catch-all (:52-54)
platform/server/http/config.ts                  no change required; listed only because /api/config already
                                                runs before the table — verified, not modified
```

**Nothing else.** Not `platform/server/VanityManager.ts`, not `platform/server/ZapPurchaseManager.ts`, not
`$vanityName.tsx`, not `index.tsx`, not `src/`, not `routeTree.gen.ts`.

### 1.2 The file, in this increment

`./data/routes.json`, schema `version: 1`, exactly as `ARCHITECTURE.md` §4.2. Increment 1 implements the
**minimum subset** and the validator **refuses** the rest with a stated message, so nothing silently degrades:

```
{ "version": 1, "seq": 1, "default": null,
  "bindings": [ { "kind": "admin", "path": "<name>", "target": { "type": "page", "author": "<64-hex>", "d": "<d>" },
                  "updatedAt": <int>, "updatedBy": "<64-hex|instance>" } ],
  "prefixes": [ { "pattern": "item/:eventId", "target": { "type": "pageById", "param": "eventId" } } ] }
```

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
   - `prefixes` are distinct and none shadows a compiled-in dynamic route.
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

### 1.4 `pageHtml.ts` — how one page is served

**Two reads exist and they are ordered deliberately:**

1. **Routing needs nothing.** A `prefixes` entry `item/:eventId` turns `/item/<id>` into
   `{ type: 'pageById', param: 'eventId' }`. The socket's `params.eventId` **is** the fact the router needed; there
   is no indexer.
2. **Then the page.** `pageHtml.ts` fetches the event by id over the existing NDK connection, verifies `sig`,
   parses it with `parseStorefrontPage` (`sdk/commerce/storefront/storefrontPage.ts` **[S]**), and returns the
   SPA shell with the page's `og:`/`title` and a `#__AR_PAGE__` script payload. A fetch failure is **HTTP 200**
   with an "item unavailable" payload — **never** 404 (`ARCHITECTURE.md` §3.3 rung 2).
3. **Why by id and not by `d`:** fetching by `(author, d)` needs the author, which for a *page* binding comes from
   the file and is fine — but for the **prefix** rung there is no author, and "which author's page is at `d`" is
   exactly the indexer dependency the ruling removes. Event id is self-describing, so the prefix rung needs no
   index. Exact-path bindings may use `(author, d)`; **increment 1 implements only `pageById` and `page`**, and
   that asymmetry is intentional and pinned by a test.
4. **`[U]`, and the first thing to measure:** whether a single NIP-01 `{"ids":[<id>]}` read returns the event on
   this deployment's relay. The repo's own read seam supports explicit id reads
   (`sdk/core/event-store/filter.ts:4` `ids?: string[]` **[S]**) but the relay's behaviour is not verified here.
   If it does not, the fallback is a **server-side page cache**: the app already receives every page the CMS
   publishes in production (`platform/web/storefront/storefrontPublish.ts:81-99` publishes as the author), so a
   server-side subscription to kind 30024 is available — **but that is a design decision, not a fallback, and it
   is deliberately NOT designed here**; the increment stops and reports instead.

**Rendering.** Increment 1 serves the **shell plus the page payload**; the client renders it through the existing
`StorefrontRenderer` with the page's own `pubkey`. That keeps the change to one route file on the client
(increment 3) and avoids inventing a second renderer.

### 1.5 `sdk/config/routeNames.ts`

The 37 reserved names exist **twice**, identically, and neither exports its copy: `sdk/config/vanity.ts:51-89`
and `platform/server/VanityManager.ts:6-44` **[M]** (37 each, sets equal).

- New module exports `RESERVED_NAMES: readonly string[]` and `NAME_PATTERN`.
- Both existing files **import** it and delete their local literals. This is the de-duplication
  `designs/B-server-authoritative.md:654-658` proposes, and it is cheap: it changes no value.
- The existing equality is then enforced by a test rather than by luck: **assert the union of names read out of
  both files' call sites equals 37**, so a fourth copy cannot appear.

**Boundary check**: `sdk/config/routeNames.ts` must import nothing. `platform/server/` importing `@sdk/config/*`
is already allowed and used (`platform/server/http/config.ts:17` imports `@sdk/config/schemas/app` **[S]**).

### 1.6 Evidence and exit criteria

| # | criterion | command | expected |
|---|---|---|---|
| E1 | the new suite passes | `bun test --isolate platform/server/routes/` | record N pass, 0 fail (no prior count) |
| E2 | the ladder is proven without a relay | `bun test --isolate platform/server/routes/resolve.test.ts` | includes: exact admin binding → target; unmatched path → `{ status: 404 }`; **no `fetch`/NDK call is reachable** — asserted with a module mock that throws if touched (the `restart.test.ts` device `designs/B-server-authoritative.md:699-701` uses) |
| E3 | **boots with a dead relay** | `APP_RELAY_URL=wss://127.0.0.1:9 APP_PRIVATE_KEY=<test key> PORT=3100 bun platform/web/app/entry.tsx` then `curl -s -o /dev/null -w '%{http_code}' localhost:3100/x` | boots, and `/x` → **200** when bound, **404** when not. This is the whole architecture claim in one command, and it is the criterion that fails on `master` today (`platform/server/startup.ts:41-51`) |
| E4 | a corrupt file refuses to boot | `printf '{"version":1,' > data/routes.json` then start | process exits non-zero, stderr names the file and the parse position. **No partial load** |
| E5 | a reserved name in the file refuses to boot | fixture with `"path":"dashboard"` | exit non-zero, message names `dashboard` as app-owned |
| E6 | a lease on a subpath refuses to boot | fixture with `"meaning":"lease","path":"shop/x"` | exit non-zero |
| E7 | atomic write leaves a backup | `bun test --isolate platform/server/routes/routeFile.test.ts` | after `writeAtomic`, `routes.json.bak` holds the previous bytes; a simulated failure mid-write leaves the original intact |
| E8 | nothing reads the network in the route path | `grep -nE "fetch\(|ndk|Relay" platform/server/routes/routeFile.ts platform/server/routes/resolve.ts` | **0 hits** |
| E9 | typecheck list identical | the §0.1 command, before and after | `diff` of the sorted lists **empty**; count recorded from the branch, never carried |
| E10 | boundaries | `bun test --isolate sdk/boundary.test.ts platform/boundary.test.ts ui/boundary.test.ts` | pass |
| E11 | format | `bun run format:check` | pass |
| E12 | the diff is the diff | `git status --porcelain` | exactly the files in §1.1. `routeTree.gen.ts` untouched |

**The number to watch**: `curl -s -o /dev/null -w '%{http_code}' localhost:3100/no-such-path` must print **404**.
On `master` today the SPA catch-all returns the shell with **200** for any unknown path (`platform/server/buildServer.ts:54`
`'/*': indexHtml`) **[S]** — so 404 is a visible behaviour change and it is the point of rung 3.

### 1.7 What increment 1 explicitly does NOT do

- No lease write path, no payment, no ACL beyond admin-only (`may()` is not built — every write is out of scope
  because **no write path exists yet**; the file is edited by hand or by the test fixtures).
- No `series` target, no `grants`, no management UI, no `list` reference.
- No client routing change: `/` and `/$vanityName` behave exactly as today (`platform/web/routes/index.tsx:57`,
  `platform/web/routes/$vanityName.tsx:19-41`). **No user-visible change except a 404 where a shell used to be.**
- No Nostr publication of any kind.
- No removal of `VanityManager`/`ZapPurchaseManager` — they keep running unchanged.
- Nothing deployed; no live unit restarted.

---

## 2. Dependency graph, and what can run in parallel

```
        ┌──────────────────────────────────────────────────────────────┐
        │ 1  routing file + resolver, end to end        (the proof)     │
        └───────────────┬──────────────────────────┬───────────────────┘
                        │                          │
        ┌───────────────▼───────────┐   ┌──────────▼────────────────────────┐
        │ 2  validator completeness: │   │ 3  `/` + rung-1 dynamic path are   │
        │    leases, subpaths,      │   │    served from the table           │
        │    compiled-in set        │   │    (R1/R2/R4 visible)              │
        └───────────────┬───────────┘   └──────────┬────────────────────────┘
                        │                          │
        ┌───────────────▼───────────┐   ┌──────────▼────────────────────────┐
        │ 4  ACL: may() + grants +  │   │ 5  R3 series (relay-gated)         │
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

### 2.1 The order, with each increment's real dependency

| # | increment | depends on | why that dependency exists |
|---|---|---|---|
| **1** | routing file + ladder, end to end | — | nothing |
| **2** | validator completeness: lease meaning, subpath rules, `COMPILED_IN` derived | 1 | needs the file writer to exist before it can refuse more shapes of it |
| **3** | `/` and `/$vanityName` served from the table | 1 | needs `lookup`; **deliberately not 2** — it only needs exact admin bindings |
| **4** | ACL: `may()`, `grants`, actor, the write API | 1 (and 2 for the fields it validates) | `may()` reads the whole file, including `grants`, which 2's validator must already accept |
| **5** | R3 series resolution | 1 (and 3 for the path to be reachable) | needs a resolved path before a series can answer it |
| **6** | zap receipt verification | — (independent of 1–5) | it is a *payment* change on the existing vanity path |
| **7** | lease purchase (paid) | 2, 4, **6** | a lease needs the validator's lease shape, the ACL's actor, and a verified receipt |
| **8** | management surface | 4, 7, 5 | it reads and writes through all three |

### 2.2 What the owner asked for — parallel tracks

**Named explicitly, so nobody serialises them by accident:**

- **Track I (routing core):** 1 → 2 → 4 → 8. Sequential **because of one file**: 1, 2 and 4 all modify
  `platform/server/routes/routeFile.ts`, and `apply(mutation)` is the single writer. Parallelising inside this
  track means two agents editing one function — that is the lost-update problem this run exists to delete.
- **Track II (surface):** 3 → 5 → 8. **3 and 5 can start as soon as 1 lands**, in parallel with 2 and 4, because
  they touch **different files**: 3 touches `platform/web/routes/index.tsx`, `platform/web/routes/$vanityName.tsx`
  and reads `routeFile.lookup`; 5 touches a new `platform/server/routes/series.ts` and a client query. Neither
  writes the file.
- **Track III (payments):** 6, then 7. **6 is fully independent of everything else** and can run from day one —
  it is the increment that closes the free-lease hole (`ARCHITECTURE.md` §10 O-5), it touches only
  `platform/server/ZapPurchaseManager.ts`, and it is the longest-lead item, so starting it first is the cheapest
  risk reduction available.
- **Genuinely parallel pairs, safe to dispatch simultaneously:**
  `(2 ∥ 3)`, `(2 ∥ 5)`, `(4 ∥ 5)`, `(6 ∥ anything)`.
  **Unsafe pairs:** `(1 ∥ anything)`, `(2 ∥ 4)` and `(4 ∥ 7)` — all write `routeFile.ts` or depend on its shape.
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
| V2 | `auctions` is refused as app-owned | `bun test --isolate platform/server/routes/` (fixture with `"path":"auctions"`) | boot-refusal naming `auctions` — this closes the live hole `review-adversarial.json` F7 case 1 records |
| V3 | a lease on a free top-level path is accepted | fixture | loads |
| V4 | a lease with no `expiresAt`, or an admin binding with `expiresAt`, is refused | 2 fixtures | both refused, distinct messages |
| V5 | a lease on a subpath is refused | fixture `"meaning":"lease","path":"shop/x"` | refused (`lease-must-be-top-level`) |
| V6 | a lease under a leased ancestor is refused **at write time** | unit test calling the write path | `Denied('held-by-ancestor')` — the ancestor clause of `ARCHITECTURE.md` §3.4 |
| V7 | a subpath binding under a live lease **is** accepted | fixture | loads |
| V8 | when the parent lease expires, the subpath binding stops resolving | unit test at `expiresAt + 1` | the subpath returns `{ status: 404 }` — "every subpath dies with it" (`ruling-simple-routing-file.md:45-48`) |
| V9 | `grants` accepts literal paths and `prefix*` only | unit | a `%` or a bare `*` is refused, so no name can become a wildcard |

**NOT:** no write API (still hand-edited / fixtures), no UI, no client change, no payment, no Nostr.

---

## 4. Increment 3 — `/` and the dynamic top-level path become the table's

**Goal:** the owner's own example, made real: `/` renders whatever the default binding names, and `/<name>` renders
a bound page — or **404**. The client stops resolving routes; the server decides.

**Files:**
```
modified   platform/server/routes/resolve.ts          + default binding + `/<name>` rung 1 + rung 3
modified   platform/server/routes/pageHtml.ts         + render the default and the exact-path bindings
new        platform/server/routes/defaultBinding.ts   the default target → the page payload (or the inline composition)
modified   platform/web/routes/index.tsx              :57,:81-101 fallback shell only; `/` renders the server's decision
modified   platform/web/routes/$vanityName.tsx        becomes a 404 surface for unmatched segments
modified   platform/web/storefront/StorefrontAddressPage.tsx   gains an `author` prop (defaulted to appPublicKey)
modified   platform/web/storefront/storefrontQuery.ts  + a hook that reads the page payload for (author, d)
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

**Exit criteria:**

| # | criterion | command | expected |
|---|---|---|---|
| S1 | `/` renders the default binding's page | fixture + `curl -s localhost:3100/ \| grep <marker>` | the bound page's marker; with no default, the inline composition's marker |
| S2 | a bound `/<name>` renders | `curl -o /dev/null -w '%{http_code}' localhost:3100/shop` | 200 |
| S3 | an unbound `/<name>` is 404 | same, `/nothing-here` | **404** |
| S4 | the app's own routes are untouched | `curl -o /dev/null -w '%{http_code}' localhost:3100/dashboard`, `/auctions`, `/products` | unchanged from before the increment (quoted before/after) |
| S5 | a binding's page that is unrenderable is 200 + "item unavailable" | fixture pointing at an absent `d` | **200**, and the payload says item unavailable — **never** 404 (`ARCHITECTURE.md` §3.3 rung 2) |
| S6 | the client no longer calls `resolveVanity` on a path | `grep -n 'resolveVanity' platform/web/routes/` | 0 hits (the registry read stays for the dashboard/account page until increment 8) |
| S7 | existing storefront tests unchanged | `bun test --isolate sdk/commerce/storefront/ platform/web/storefront/` | same pass/fail before and after, quoted |
| S8 | browse suite unchanged | `bun test --isolate platform/web/browse/` **and** without `--isolate` | **168/0** and **153/15** — quote both, same as before the change |
| S9 | typecheck list identical, format, boundaries | §0.1, §0.2 | as before |

**NOT:** no series (increment 5), no grants or ACL (increment 4), no management UI, no lease, no removal of
`VanityManager`. **The registry keeps running and keeps being read by the dashboard/account surface**
(`platform/web/routes/_dashboard-layout/dashboard/account/vanity-url.tsx`) — deleting it is increment 8, and only
after the routing file is the only thing that resolves.

---

## 5. Increment 4 — the ACL: `may()`, grants, the actor, one write path

**Goal:** three tiers enforced server-side at one function, with a visible refusal carrying a reason — and
**admin, editor and lease-write calls all go through `apply()`**, never through composed tags.

**Blocked on** O-1 in `ARCHITECTURE.md` §10 (who the server thinks you are). The increment does not start until
that is settled; the lean is recorded there and costs are stated.

**Files:**
```
new        platform/server/routes/authority.ts         may(actor, op, path, file) — pure, exhaustive switch
new        platform/server/routes/authority.test.ts
new        platform/server/routes/commands.ts          the ops: bindAdmin, assignLease, retarget, release, setDefault, grantEditor
new        platform/server/routes/commands.test.ts
new        platform/server/http/routes.ts              POST /api/routes/<op> — parses an INTENT, never tags
modified   platform/server/buildServer.ts              mount the write routes with the fixed ones (:37-51)
modified   platform/server/EventValidator.ts           the `general` branch stops accepting routing events (:85-93)
modified   platform/server/EventHandler.ts             routing intents leave the re-sign path
```

**The write discipline (`ruling-resolution-and-signed-ledger.md:18-20`)**: the request body is
`{ op, path, target?, … }`; the server builds the record from that intent and its own state, and the caller's
signature identifies `actor`. **No submitted tag list is ever applied.** The existing proxy copies `tags` and
`created_at` verbatim and swaps the pubkey (`platform/server/EventSigner.ts:16-26` **[S]**) — which is why it
cannot be the enforcement point.

**Exit criteria:**

| # | criterion | command | expected |
|---|---|---|---|
| A1 | admin may do anything | unit, table-driven over the op set | `Allowed` |
| A2 | editor without a grant is refused, visibly | unit + `curl` | `Denied('no-grant')` with HTTP 403 and a body naming the missing grant |
| A3 | editor with `prefix*` may create, not retarget, another's page | unit | allowed for `create`; `Denied('not-their-page')` for `retarget` |
| A4 | a second binding on one path is refused | unit | `Denied('held-by:<tier>')`, naming the holding tier |
| A5 | a binding on a reserved or compiled-in name is refused | unit | `Denied('app-owned-name')` |
| A6 | every accepted write goes through `apply` | `grep -n "writeAtomic" platform/server/` | one call site, inside `apply()` |
| A7 | the file's `seq` increments and the previous bytes are kept | unit | `seq: n → n+1`; `routes.json.bak` holds `n` |
| A8 | a write cannot smuggle a field | unit: post a `updatedAt`, an `updatedBy`, an `expiresAt` in the body | the server's own values win; the smuggled field is ignored, and a test asserts it |
| A9 | a refusal changes nothing on disk | unit | file bytes and `seq` unchanged |
| A10 | typecheck/boundaries/format | §0.1, §0.2 | as before |

**NOT:** no UI, no payment, no lease purchase (the lease *shape* is writable by an admin — `assignLease` — but
nothing charges for it; that is 7), no Nostr, no `list`.

---

## 6. Increment 5 — R3: the series path, resolved from a bound series target

**Goal:** `/featured` resolves to the **newest** page of series `featured`, dynamically, with no routing-time
network call and no second write when a member is published.

**Gated on one measurement, and it is the only `[U]` that blocks an increment:**

```bash
# does this deployment's relay index `#t` on kind 30024?
# run against the instance's own relay, then re-run against a page known to carry ["t","featured"]
```

**If it does not**, the increment **stops and reports**; the stated fallback (a server-side series index in the
routing file) is **not designed**, because designing it before measuring would be designing for an unmeasured
failure.

**Files:**
```
new        platform/server/routes/series.ts            seriesTarget → { kinds:[30024], '#t':[key], authors:[owner] } query
new        platform/server/routes/series.test.ts
modified   platform/server/routes/routeFile.ts         accept `{ "type":"series", "series": "<key>", "author": "<64-hex>" }`
modified   platform/web/storefront/storefrontPublish.ts  address argument (`d` + optional series tag), DEFAULTED
modified   platform/web/storefront/storefrontPublish.test.ts
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
| R8 | `#t` on 30024 measured on the deployment relay | the command above, pasted | **the gate** |

**NOT:** no series *management* UI (increment 8 may add a picker), no `list` reference (follow-up), no backfill
of series tags onto existing pages, no auto-derivation of a series from a `d` prefix — the membership tag is
declared explicitly by the author, because a `featured-<date>` naming convention that silently joins a series
would let any dated page become `/featured` (`proposal-v2.md:409-415` considers it and this plan refuses it).

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
modified   platform/server/http/routes.ts               + POST /api/routes/reserve, /renew
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
new        platform/web/routes/routesApi.ts             fetch/commands against /api/routes/*
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
| M2 | rerouting `/dashboard` is refused **with an explanation** | component test | "app-owned: `dashboard` is the app's own page" — the owner's example answer (`ARCHITECTURE.md` §5.2) |
| M3 | the clobber cannot recur | regression test: write an admin binding + the default + an editor grant, then **take a payment**, then assert all three still resolve and the file's `seq` moved by exactly 1 | passes. **This test cannot pass on the current code** — `platform/server/ZapPurchaseManager.ts:202` republishes from a map that knows only `vanity` entries (`platform/server/VanityManager.ts:110-112` **[S]**). It is the test `ruling-d3-persistence-and-redesign.md:78-79` asks for, and its absence is why the bug went unnoticed |
| M4 | no route resolution reads a relay | `grep -rnE "fetch\(|Relay\.connect|ndk\." platform/server/routes/` | 0 hits in `routeFile.ts`, `resolve.ts`, `authority.ts`, `lease.ts` |
| M5 | `/api/healthz` reports the table's state and `seq` | `curl localhost:3100/api/healthz` | `{"routes":"ok","seq":n}` |
| M6 | nothing still publishes the routing table to Nostr | `grep -n "publishRegistry" platform/server/` | 0 call sites |
| M7 | full suites | §0.2, plus the browse pair quoted both ways | no regressions |

**NOT:** no Nostr ledger, no remote-instance leases, no `list`, no DNS domains (paths only —
`ruling-acl.md:52-53`: "Do not assume the wider reading").

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

## 11. The riskiest single thing in this plan, and the two next-riskiest

### R-1 (the riskiest) — increment 1's page fetch is the one network call that remains, and it is the one I could not measure

The architecture forbids the network in **routing**. It cannot forbid the network in **serving a page**: the page
lives on a relay, authored by its author, and serving content the instance does not hold is the entire point of
keeping pages where they are. So increment 1 makes exactly **one** network read — the kind-30024 event — and it
does so **after** routing has already decided which page answers.

Two things follow, and both are honest risks rather than defects:

1. **`[U]`: does `{"ids":[<64-hex>]}` return the event on this deployment's relay?** The repo's filter type
   supports it (`sdk/core/event-store/filter.ts:4` **[S]**) but I could not reach a relay. If it does not,
   increment 1's "page by id" mechanism does not work, and the honest alternatives are (a) bind by `(author, d)`
   only, which means the prefix rung cannot render a page it was not told the author of, or (b) a server-side
   kind-30024 subscription, which is a real architectural addition and must then be argued, not slipped in.
   **The plan stops and reports rather than choosing (b) silently.**
2. **The 404 becomes the failure mode of a relay outage for a *bound* path**, because the server cannot render a
   page it cannot fetch. That is *not* the anti-pattern — routing still succeeded and the table was still read
   from disk — but it is the failure a reader will *see* and it will look like a routing failure. Which is why
   the plan pins the distinction with a test: **an unrenderable page is 200 + "item unavailable"; only an
   unmatched path is 404** (exit S5, E2). If those two collapse into one, the architecture's central distinction
   has been lost in code, and no amount of green tests will show it.

**Why this is the riskiest thing rather than the biggest**: it is the one place where the plan's proof and the
architecture's own boundary touch, so a mistake there reads as an architectural failure rather than an
implementation bug.

### R-2 — the actor (O-1) is unspecified, and increment 4 cannot start without it

`may(actor, …)` with no established `actor` is C's actual omission (`ARCHITECTURE.md` §10 O-1). The plan
sequences 1→2→3 so that everything before the ACL is **admin-only by hand-edited file**, which keeps the
unresolved question from blocking the proof. Increment 4 must not begin on a guess.

### R-3 — the `auctions` / `/new` / compiled-in derivation is a **build artifact**, and a stale one silently
un-protects a name

Measured: `static − reserved → {auctions, new}` **[M]**, and the naive parse yields 9 not 8. A generator that
blesses the bug would make `auctions` bindable *and* its drift test green. Increment 2 checks the parent, and its
drift test regenerates rather than compares to a hand-typed list.

---

## 12. What this plan does not reach, and where it is recorded

| item | where | why out |
|---|---|---|
| the signed lease-confirmation ledger; honouring another instance's leases | `ARCHITECTURE.md` §11 | **BUILD LATER** by ruling (`ruling-resolution-and-signed-ledger.md:56-68`); the file leaves `instance.pubkey: null` and per-lease `leaseId` so it is an addition, not a migration |
| the `list` reference | `ARCHITECTURE.md` §6 | **marked follow-up** (`ruling-d8-multipage-and-lists.md:70-80`); the union variant is parsed and refused so the follow-up is a resolver branch |
| nutzap as a payment rail | this file §7 "NOT" | custody, mint egress, a separate ADR (`AGENTS.md:63-64`); not asked for in this run |
| making `/dashboard` itself reassignable | `ARCHITECTURE.md` §5.2, Q2 | it is 30 files, a layout, a nav model and an admin gate (`platform/web/app/useRootRedirects.ts:28,40-42`); no ruling requires it and no increment depends on it |
| a grace window on lease expiry | `ARCHITECTURE.md` §7.4 | OUR CHOICE not to add one; one comparison if the owner says otherwise |
| subpaths published by a leaseholder | `ARCHITECTURE.md` §10 O-2 | needs the one surviving precedence ruling |
| custom DNS domains | `ruling-acl.md:52-53` | the example is a path; this plan does paths only |
| proof persistence in a server event store | this file §7 "NOT" | nothing here re-verifies on read (`ruling-d3-persistence-and-redesign.md:24-27`), so nothing needs it |