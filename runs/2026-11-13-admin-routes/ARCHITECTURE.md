# ARCHITECTURE — admin-managed routes, consolidated from the accepted rulings

**Run:** `runs/2026-11-13-admin-routes` (run A) · **Role:** consolidator, one implementation plan out of four
candidate designs plus six owner rulings · **Base:** `/home/admin_maxime/work/market`, `master`, HEAD
`3a07e7067` · **State:** read-only. No source change, no branch, no build, no deploy. This file and
`IMPLEMENTATION-PLAN.md` (plus `report-consolidation.md`) are the only things written.

**What this document is.** The owner accepted a set of architecture rulings. They supersede parts of the four
candidate designs (`designs/A-one-writer-per-event.md`, `designs/B-server-authoritative.md`,
`designs/C-ownership-domain.md`, and `proposal-v2.md`), and they supersede the adjudicator's recommendation in
`designs/COMPARISON.md` §5. This document says what the accepted architecture **is**, in enough detail to build
from, and — in §9 — what it **supersedes** in each candidate, with `file:line` of the design being superseded.

**Authority order used throughout.** Rulings > this document > designs. Where a design and a ruling disagree,
the ruling wins and the design is marked SUPERSEDED. Where two rulings disagree with each other, §10 says so and
does not silently pick one.

**Labels.** **[M]** measured by me at `3a07e7067`, command shown · **[S]** read from source at `file:line` ·
**[J]** judgement, arguable · **[U]** UNVERIFIED — I could not establish it, and nothing downstream rests on it
being true.

**What I could not measure.** The typecheck baseline **on a clean tree**. On this **dirty** checkout the command

```
NODE_OPTIONS=--max-old-space-size=12288 /home/admin_maxime/.bun/bin/bun bunx tsc --noEmit   # typescript 5.9.3
```

reports **401** errors, and **241 of them are in files that are not the app** — 94 under `runs/`, 72 in
`notes/pr-1226-orderdetail-descriptor-view.tsx`, 72 in `node_modules/*.d.ts`, 30 under `src/`, plus
`deploy-simple/` and `e2e/` **[M]**. So **401 is a dirty-checkout artifact, not a baseline** — exactly the trap
`order.md:132-134` warns about, and the reason `proposal-v2.md:619-621` refuses to carry a number between branches.
**205 is therefore `[U]` for me**; the plan requires a per-branch re-baseline and asserts on the sorted error
**list**, not the count. I did not run the test suites (read-only base, no branch). I did not reach a live relay,
so every claim about relay indexing (`#t` on kind 30024, an `ids`-only read) is `[U]`, and the plan phrases its
evidence commands so that a relay-dependent rung is **never** on the site's critical path.

---

## 1. The one-sentence architecture

**The instance is its own authority: it holds a single server-side routing file, resolves every request against
that file with no network call, serves the resulting page or a 404, and may additionally publish signed
confirmations to Nostr as a bonus that nothing in the route path depends on.**

That sentence is the whole thing. Everything below is its consequence, and everything in the four designs that
contradicts it is superseded.

---

## 2. The anti-pattern to avoid, measured

The owner named the failure precisely; here it is in code.

```ts
// platform/server/startup.ts:41-51
const settings = await fetchAppSettings(RELAY_URL as string, publicKey, handlerIds)   // :41
setAppSettings(settings)
...
} catch (error) {
    console.error('Failed to initialize app settings:', error)
    process.exit(1)                                                                   // :50
}
```

`initializeAppSettings()` is awaited before the HTTP server is built (`platform/web/app/entry.tsx:23`
`await initializeAppSettings()` → `:27` `resolvedServer = buildServer({ indexHtml: index })` **[S]**). So the
process fetches its **own settings** from a relay at boot and **exits** if it cannot. A server that starts before
its relay cannot start at all.

Second instance of the same class, the one the review found and the owner's ruling generalises from:

- `platform/web/routes/$vanityName.tsx:25-27` renders `LoadingState` while `isLoaded` is false, and `isLoaded`
  is only ever flipped by a relay read (`platform/web/app/useVanitySync.ts:12-19`). A relay outage on a cold load
  is a permanent spinner **[S]**.

**The rule this establishes, and it is architectural, not stylistic:**

1. No route resolution, and no path-authorized decision, may perform a network call **to decide what this
   instance serves**.
2. The routing table is the server's own state, loaded from disk, and served by the server.
3. Nostr is a **publication target and an audit mirror**, never an input to routing.

The consequence the owner accepted with his eyes open (`ruling-simple-routing-file.md:12-16`): **an unreadable
table means the site is broken.** There is no degraded mode, no snapshot fallback, no stale cache story. The
operational answer is a backup and an alarm — not an architectural layer. That is settled; §9 records it as
superseding everything that proposed otherwise.

---

## 3. The model

### 3.1 Three nouns, and nothing else

```
BINDING     a path resolves to a target. Two kinds, never one row with an optional term (§3.2).
PAGE        a kind-30024 addressable event, authored by the page's author, `d` = the page's identity.
REFERENCE   what a page block points at: a coordinate, or a list name (reserved, not built — §6).
```

There is no separate "route table event", no "claim event", no "default event", no "manifest", no sharded
projection, no event-store, no database. A binding lives in the routing file (§4). A page lives on relays,
authored by its author, because the page is the author's speech and the app does not own it. The routing file
holds **no page content** — only what the instance has decided a path means.

### 3.2 Two binding kinds — never one row with an optional expiry

This is `ruling-resolution-and-signed-ledger.md:41-46` and it is the single most load-bearing modelling
constraint in the design.

| | **ADMIN binding** | **LEASE binding** |
|---|---|---|
| term | none | has a term (`expiresAt`, unix seconds) |
| replaced by | another admin action | renewal, or admin action |
| on lapse | never lapses | **404** — the space is gone (`ruling-resolution-and-signed-ledger.md:39-40`) |
| on termination by the provider | n/a | **404** (`:53-54`) |
| holder | `null` (the instance) | the paying pubkey |
| subpaths | an admin may bind any free path, including a subpath | **top-level paths only** (§3.4) |

They are **two variants of a discriminated union in one discriminated-union tag**. They are not "a row with
`expiresAt: number | null`", because that encoding loses the 404-on-lapse rule in the default — a null expiry
silently means "permanent" to the wrong reader. The wire form encodes the kind explicitly (§4.2).

Two behaviours that must **not** share a code path, per `ruling-resolution-and-signed-ledger.md:76-78`:

- **lease expired / lease terminated → 404.** Not the admin's previous binding, not the app-key page, not a
  fallback page. The space is gone.
- **binding resolved, page not renderable → the page's own honest state** ("item unavailable"), **still HTTP
  200** for the route. Routing succeeded; the content is missing. Different failure, different error.

### 3.3 The resolution ladder — exactly three rungs

`ruling-simple-routing-file.md:20-35`, binding.

```
request path → normalise (lowercase, strip trailing slash, reject '..' and encoded separators)
  RUNG 1  exact path is a programmed binding in the routing file, and it is live
            ADMIN  binding → its target, resolved server-side. NO network call.
            LEASE  binding → its target if in term; expired/terminated → 404 (STOP: no rung 2)
  RUNG 2  a programmed PREFIX matches: /item/:eventId, /p/:npub, /<series>:  (§5)
            the pattern is programmed, the id is in the URL → routing needs no indexer.
            the PAGE then looks its object up. That lookup's failure is
            "item unavailable" (200, page-level), NOT "route not found".
  RUNG 3  404. The honest default.
```

**Longest programmed prefix wins.** With prefixes, precedence is trivial: match the longest programmed pattern
that fits. **No bare top-level catch-all (`/:id`)**: it competes with every programmed route, and a mistyped
`/auctons` would attempt a lookup instead of 404ing (`ruling-simple-routing-file.md:32-34`).

**Why this ladder survives the thing that killed every candidate's version of it.** Every design made a *page
read* a rung. `proposal-v2.md:269-275` makes "oldest page at this `d` wins" a resolution rule, which needs the
relay to answer "what is at this path" — the anti-pattern. Under this ladder, the relay is only ever consulted
*after* routing has already decided **which page** answers, i.e. given an `(author, d)` the server already knew.
A relay outage therefore degrades a **page**, never a **route**. That is the difference between this ladder and
`proposal-v2.md:235-257`.

### 3.4 Leases are top-level paths only, and subpaths die with the parent

`ruling-simple-routing-file.md:37-54`, binding.

- A lease may be granted **only on a top-level path** (`/shop`), never on a subpath (`/shop/featured`).
- A lease **carries all subpaths beneath it**. The leaseholder controls what lives there.
- **Parent expires → every binding beneath it dies with it.** No orphaned bindings, no "the child was granted
  to someone else" case — it cannot arise, because nobody can hold `/shop/featured` without holding `/shop`.

**Therefore there is no subpath precedence rule.** There is a **validation** rule instead, and it is the whole
of the lease write path's path-shaped logic:

```
can this lease be granted?
  name is a valid top-level path name (grammar §8.2)
  AND name is not in the reserved set (§8.3)
  AND name is not a real compiled-in segment (§8.3)
  AND no live binding exists at `name` (admin or in-term lease)
  AND no live lease exists at any ANCESTOR of `name`   ← because the ancestor's lease carries `name`
```

The ancestor clause is what makes "nobody can hold a subpath without holding its parent" true rather than
hoped-for. It is one string-prefix test over the bindings in the table at write time, not a resolution rule at
read time.

**Pages remain addressable by event id even under an expired lease** — the owner's aside, explicitly **not part
of this build** (`ruling-simple-routing-file.md:52-54`). Recorded here so a future increment does not have to
re-derive it; nothing in the plan depends on it.

### 3.5 R1–R4 — many pages, many paths, one series rule

`ruling-d8-multipage-and-lists.md:37-44`, binding, and it is a hard requirement, not a nice-to-have.

| | requirement | how this architecture meets it |
|---|---|---|
| **R1** | many pages per author, **hundreds**, each at a unique custom path | pages are kind-30024 events at `d = <path>`; kind 30024 is addressable (`sdk/core/event-store/mergeRules.ts:9-11` `isAddressableKind`, `:19` keyed `kind:pubkey:d`) and the reader is already `(author, d)`-generic (`platform/web/storefront/storefrontQuery.ts:75`). The **only** thing making it one-page-per-author is the fixed `d` constant at `platform/web/storefront/storefrontPublish.ts:60` `const tags: string[][] = [['d', STOREFRONT_PAGE_D_TAG]]` |
| **R2** | a unique path per page | the page's own `d` **is** its path; a second page cannot take a path because the routing file holds one binding per path and the page coordinate `(author, d)` is unique by NIP-01 |
| **R3** | `/featured` resolves to the **newest** page of that kind, dynamically | a **series binding**: the routing file holds one *programmed* series path (`/featured`) whose target is "the newest member of series `featured`"; membership is declared by the author on the page as a `t` tag, and the resolver picks the newest member **after** routing has decided this is a series path. See §5.3 for the ordering rule and its honest limit |
| **R4** | the home is just one more path (the default route), nothing privileged | `/` is the **default binding**: a routing-file flag naming one path (or a target). `/` runs the identical ladder; the only thing "default" does is say *which path `/` means* |

**R4's remaining asymmetry, stated rather than hidden.** `proposal-v2.md:307-322` is right that an absent `/`
("this site has no home") and an absent `/featured-13-11-2026` ("that page does not exist") are different facts.
R4 is satisfied at the **mechanism** level — one ladder, no branch that tests `path === '/'` — and this
architecture keeps today's inline composition (`platform/web/routes/index.tsx:81-101`) as `/`'s render-when-empty
state. That is a renderer decision, not a resolution branch. **SPECIFIED for resolution, OUR CHOICE for the empty
state**, and flagged so nobody later reads it as an accident.

---

## 4. The routing table: a file

`ruling-simple-routing-file.md:5-18`, binding. "a database is maybe overkill and a single file can do the trick."

### 4.1 Where it lives, who reads it, who writes it

| | |
|---|---|
| path | `process.env.ROUTES_FILE`, default `./data/routes.json` (a path outside the build artefact; the repo has no `data/` today **[M]** `ls data` → absent) |
| format | **JSON**, pretty-printed, line-stable, keys sorted — so a `git diff`, a `sha256sum` and a human can all read a change |
| loaded | **once, synchronously, before `buildServer(...)` runs** — the same position `initializeAppSettings` occupies (`platform/web/app/entry.tsx:23-26`) but with no network call |
| read on every request | from memory; the file is re-read only by an admin write, which rewrites it atomically (§4.4) |
| written by | **only** the server, **only** through one function (§4.5) |
| readers | the server's resolver (§3.3). **Nothing on the client reads it.** The client receives a *decision*, not a table |
| the code | `platform/server/routes/routeFile.ts` — one module owning `load`, `validate`, `serialize`, `writeAtomic`, `lookup`, `prefixMatch`, `resolve` |

**No database, no HTTP API over a store, no read-through cache, no event-store, no outbox.** A cache layer is
the same thing a database would be here, and it is superseded by the same ruling.

### 4.2 The file format

```json
{
  "version": 1,
  "instance": { "pubkey": null },
  "seq": 7,
  "default": "home",
  "grants": { "<64-hex editor pubkey>": ["featured-*", "about"] },
  "bindings": [
    { "kind": "admin", "path": "home",
      "target": { "type": "page", "author": "<64-hex>", "d": "home" },
      "updatedAt": 1763000000, "updatedBy": "<64-hex actor or instance>" },

    { "kind": "admin", "path": "shop",
      "meaning": "lease", "holder": "<64-hex>", "leaseId": "…",
      "target": { "type": "page", "author": "<64-hex>", "d": "shop" },
      "expiresAt": 1794536000, "updatedAt": 1763000000, "updatedBy": "<64-hex>" },

    { "kind": "admin", "path": "featured",
      "target": { "type": "series", "series": "featured" },
      "updatedAt": 1763000000, "updatedBy": "<64-hex>" }
  ],
  "prefixes": [
    { "pattern": "item/:eventId", "target": { "type": "pageByParam", "param": "eventId", "render": "item" } },
    { "pattern": "p/:npub",       "target": { "type": "profile",    "param": "npub" } }
  ]
}
```

**Why `kind` is always `"admin"` and the lease is `"meaning": "lease"` on an admin-written row** — and why that
is *not* the forbidden "one row with an optional expiry":

A lease is a **top-level path** (§3.4) and a leaseholder also holds every subpath beneath it. Expressing the
lease as a **top-level admin binding that carries a lease `meaning`, a `holder`, a `leaseId` and an `expiresAt`**
is exactly right, because the binding and the lease have the same lifetime and the same extent: when the lease
expires, the binding goes too (§3.4). A **subpath** admin binding re-pointing `/shop/featured` therefore lives
*under* the lease and is destroyed with it.

The forbidden shape is different and stays forbidden: **a lease binding must never be represented by an admin
binding with `expiresAt: null`**, and a subpath binding must never carry a lease `meaning`. The plan enforces
both as validator rules (`IMPLEMENTATION-PLAN.md` increment 2, exit criterion V4), not as conventions:

- `meaning === "lease"` ⟹ `expiresAt` is a positive integer **and** `path` has no `/`.
- `kind === "admin"` without `meaning` ⟹ `expiresAt` is **absent** (not `null`).
- `expiresAt` present ⟹ `meaning === "lease"`.

The file's **on-disk shape is the union**; the parser maps it to a TypeScript discriminated union
`Binding = AdminBinding | LeaseBinding | SubpathBinding` where `AdminBinding.expiresAt` does not exist as a
property. One encoder/decoder pair, exhaustively switched.

### 4.3 What the file deliberately cannot express

- **Page content.** No page bodies. Pages stay on relays, authored by their author.
- **A binding on a reserved or compiled-in name** (§8.2–§8.3) — the validator refuses the whole file.
- **Two bindings on one path.** Refused by the validator.
- **A lease on a subpath.** Refused by the validator.

### 4.4 Failure semantics — an unreadable table means the site is broken

`ruling-simple-routing-file.md:12-16`.

| state | what the server does |
|---|---|
| file missing | **refuses to boot**, with a message naming the path and the command that restores it. No empty default, no auto-create |
| file present, JSON invalid | **refuses to boot**, printing the parse error's line/column |
| file valid, a binding invalid (§4.2 invariants, §8) | **refuses to boot**, printing every violation. A refused file is never partially loaded |
| file valid | loads |

**No degraded mode.** The plan's operational deliverable is therefore: a **backup** (copy-on-write next to the
file with a timestamped suffix, kept by the write function itself) and an **alarm** (`/api/healthz` reports
`routes: "ok" | "unreadable"`, for an external monitor). That is the whole failure story, and it is deliberately
not a subsystem.

### 4.5 The write path — one writer, one serialiser, for the whole file

The clobber this run exists to kill is a **whole-document rewrite from a partial in-memory view**:

- `platform/server/ZapPurchaseManager.ts:393-406` `publishRegistry()` builds `[['d', dTag], ...this.buildRegistryTags(this.registry)]` from `this.registry`;
- `platform/server/VanityManager.ts:110-112` `buildRegistryTags` emits **only** `['vanity', name, pubkey, validUntil]`;
- `platform/server/ZapPurchaseManager.ts:202` calls `publishRegistry()` **on every receipt**.

So every purchase rebuilds the whole document from a map that knows only one entry class, destroying everything
else. It is not a race; it is every write. **[S]** and confirmed by the review's F2 (`review-adversarial.json`).

**The structural answer here is one function, not five fixes:**

```
apply(mutation):                                     // platform/server/routes/routeFile.ts
  next = mutate(structuredClone(current))            // current = the WHOLE parsed file, every entry class
  validate(next)                                     // §4.2 invariants + §8 rules
  writeAtomic(file, serialize(next))                 // tmp file + fsync + rename + keep previous as .bak
  current = next
  return { ok: true, seq: next.seq }
```

- **One serialiser**: `serialize` reads the whole in-memory `next`, which is a clone of the whole file. There is
  no partial view to forget an entry class, because there is no second view.
- **Read-modify-write, not rebuild**: `mutation` receives the current file and returns a modified copy. The
  previous contents are available by construction.
- **Atomic on disk**: write to `routes.json.tmp`, `fsync`, `rename`. A crash mid-write leaves the previous file
  intact; the write path is the only writer, so there is no concurrent-writer question within the process.
- **`seq` increments** on each committed write; it is the "did the table change under me?" token the management
  surface compares, replacing the byte-stable-output trick `order-increment-1.md:214-216` proposed for the event.

`apply` is synchronous (`node:fs` sync calls around a rename). One process, one event loop, no lock file, no
`BEGIN IMMEDIATE`, no transaction table. That is the whole concurrency story, and it is complete because there is
exactly one writer: the server.

---

## 5. Resolution in detail

### 5.1 What "programmed" means

Three kinds of programmed route exist, and names must be distinguishable:

1. **Compiled-in pages** — the routes the React router already owns (`/dashboard`, `/auctions`, `/checkout`, …).
   §8.1 lists them. The ladder does not apply to them: they are rungs *above* the ladder, matched by the router.
2. **Compiled-in parameterised prefixes** — `/profile/:profileId`, `/products/:productId`, `/posts/:postId`,
   `/auctions/:auctionId`, `/collection/:collectionId` (`platform/web/routeTree.gen.ts` **[M]**, §8.1). These
   are already rung 2 and stay exactly as they are.
3. **Table-programmed bindings** — what the routing file holds: exact paths and declared prefixes (§4.2).

### 5.2 The owner's own example: `/dashboard`

*"if I type in a dashboard, I end up on a new dashboard page instead of on the default one"*
(`ruling-app-authority-and-portable-leases.md:59-60`).

**Measured, what "rerouting `/dashboard`" would actually have to touch today:**

| fact | evidence |
|---|---|
| `/dashboard` is a **real compiled-in route**, not a dynamic one | `platform/web/routeTree.gen.ts:725` `path: '/dashboard'`, parent `DashboardLayoutRoute` (pathless `/_dashboard-layout`, `:70-72`) **[M]** |
| it is also a **reserved name** | `sdk/config/vanity.ts:51-89` and `platform/server/VanityManager.ts:6-44` both hold 37 names including `'dashboard'`; sets equal **[M]** |
| `dashboard` is one of the **8 real top-level segments** | §8.1 **[M]** |
| the dashboard tree is **31 files** under `platform/web/routes/_dashboard-layout/` **[M]** `find platform/web/routes/_dashboard-layout -type f \| wc -l` → 31 (30 under `dashboard/` plus `_dashboard-layout.tsx`) |
| `/dashboard` also carries a **client-side admin gate** | `platform/web/app/useRootRedirects.ts:28` `isAdminRoute = pathname.startsWith('/dashboard/app-settings')` and `:40-42` navigates to `/dashboard` |
| the layout owns its own **chrome and nav** | `platform/web/routes/_dashboard-layout.tsx:31` `createFileRoute('/_dashboard-layout')`, `:5` `DASHBOARD_NAV`, `:232` `<SidebarNav`; `ui/nav/model.ts:142` registers the vanity page in that nav |

So rerouting `/dashboard` to "a new dashboard page" means one of two things, and **the ruling decides which**:

- **Not** "delete or shadow the compiled-in dashboard". The dashboard is an application surface (30 routes, a
  layout, a sidebar, a nav model, an admin gate). No routing file can carry it, and the routing file does not
  try.
- **Yes**: a page at a path the admin chooses, with `/dashboard` still the application surface. **Is that
  satisfying the owner?** It is what the ruling *can* mean without a rebuild: what the owner is asking for is
  that the front-of-site surface stops being privileged and becomes a path. `/dashboard` is behind a login, so it
  is the example, not the target.

**The one part of the example that is buildable exactly as asked, and the plan builds it: `/`.** `/` is a
compiled-in route today (`platform/web/routes/index.tsx:29-40` `createFileRoute('/')`) that renders
`useStorefrontAddressPage(APP_PUBKEY, 'home')` at `:57` and falls back to a hardcoded inline page at `:81-101`.
After increment 3, `/` renders **the default binding's** page — authored by anyone, resolved from the file. The
owner's `/dashboard` example becomes "any path including `/` renders what the table says", which is R4.

**`/dashboard` specifically, after this architecture**: it stays the application surface. **A binding on
`dashboard` is refused by the validator**, because `dashboard` is a compiled-in segment (§8.3). That is a
deliberate refusal, not an oversight, and the management surface must say so — "this name is the app's own page;
it cannot be reassigned by the routing table" — rather than failing silently. **If the owner wants the dashboard
itself reassignable, that is a different, larger change**: the 30 dashboard files would have to move behind a
binding, the layout re-mounted, and the nav model re-derived. **It is not in this plan, and nothing in this plan
depends on it.**

### 5.3 R3 — the series path, and its honest limit

`/featured` is a **programmed** path whose target is `{ type: 'series', series: 'featured' }`. Routing therefore
resolves `/featured` with no network call; the **series membership** is a page-level fact.

- **Membership is declared on the page**: `["t", "featured"]` (single-letter tag; the repo's filter type already
  supports `#t`, `sdk/core/event-store/filter.ts:10-11` **[S]**).
- **Ordering**: newest by `created_at`, ties broken by lexicographically lowest `id` — the repo's existing,
  already-tested rule (`sdk/core/event-store/mergeRules.ts:24` **[S]**, `selectReplaceable` at
  `platform/web/storefront/storefrontQuery.ts:44`, applied at `:97`).
- **Author-scoped**: the query is `{ kinds: [30024], '#t': ['featured'], authors: [<series owner>] }`. Without
  the `authors` filter, any user publishing a page tagged `t=featured` becomes `/featured` — a name takeover by
  hashtag. **Who the series owner is** is part of the series binding (`target.author`), not inferred.
- **When the newest member is unusable** (switched off, unparseable, zero blocks): walk the window to the next
  newest usable member. `shouldRenderStorefrontPage`
  (`platform/web/storefront/storefrontQuery.ts:150-154`) already states the predicate.

**The honest limit** (`designs/C-ownership-domain.md:676-680` is right about this and the ruling does not
overturn it): "newest" is an author-asserted timestamp, so a backdated page could win a series. Mitigation is
**not** a clock the operator controls — it is that the series query is author-scoped to the series owner, so
backdating is a self-attack by the only person who can publish into the series. Recorded as **accept**, not
solved.

**`[U]`**: whether this deployment's relay indexes `#t` on kind 30024. `#t` is used in production for other kinds
(`sdk/commerce/discovery/productRead.ts:28`) but I could not reach a relay. The plan's increment for R3 is
therefore gated on **one live measurement against the instance's own relay**, and if it fails the fallback is the
server-side series index the routing file could grow — **deliberately not designed here**, since designing it now
would be designing for an unmeasured failure.

### 5.4 Where the routing decision crosses the boundary

This is the piece every candidate fumbled, and it is worth stating plainly because it decides the thing they
fought over.

- **Compiled-in route matches first.** `/dashboard` → the app's dashboard. `/auctions` → the app's auctions.
  These never consult the routing file. **This is settled and non-negotiable**: the router owns its own paths
  (making it the source of truth for a server that cannot see it is exactly the "server cannot derive the router
  table" hole `review-adversarial.json` F7 case 1 records).
- **`/$vanityName` is rung 1.** With `proposal-v2.md:235-257`'s "trusted authors, oldest wins" replaced by the
  routing file: `/x` consults the file for `x`. A binding → its target. **No binding → 404** (rung 3), *not* "an
  app-key page at `d=x`" and *not* "the oldest page anybody published at `d=x`".
- **The server URL space stays fixed.** `/api/*`, `/images/*`, `/manifest.json`, `/sw.js`, `/favicon.ico`
  (`platform/server/http/static.ts:43-48`, `platform/server/http/config.ts:31-32`) are matched by the Bun server
  before the SPA catch-all (`platform/server/buildServer.ts:37-54`). A table binding on `api` or `images` would
  be dead — and the reserved list already refuses them (`'api'`, `'images'`, `'assets'`, `'static'`, `'public'`
  **[M]**), which is what §8.3 makes a checked invariant rather than a hope.

**Why the client cannot be the enforcer.** `ruling-resolution-and-signed-ledger.md:8-20`: the server resolves
and serves; the only "client-side" choice is *which instance you use at all* (self-hosting). A client-side
allowlist, a client-side oldest-wins rule, or a per-user preference are all superseded.

---

## 6. The CMS reference model, and the `list` follow-up

`ruling-d8-multipage-and-lists.md:70-80`: a way to link to **any product**, "by list"; today list management is
only a blacklist and a featured list; **explicitly a follow-up**, but the reference model must leave room.

- **Built now, unchanged behaviour**: the reference union has two variants.

  ```ts
  type ProductReference =
    | { kind: 'items'; coordinates: string[] }   // 30402:<pubkey>:<d> — COORDINATES, not bare d-tags
    | { kind: 'list'; list: string }             // "the members of the named list" — PARSED, NOT RESOLVED
  ```

  `list` parses, round-trips, and is **refused by the resolver with a counted `unsupported-reference` reason**,
  rendering the block's existing empty state.

- **Why coordinates and not `d` tags**: measured, `ProductRow` today queries `{ kinds: [30402], '#d': props.productDTags }`
  with **no author filter** (`platform/web/storefront/StorefrontBlockSlots.tsx:90-98` **[S]**), so two sellers
  can publish the same listing `d` and the block cannot tell them apart. Lists store full
  `30402:<pubkey>:<d>` coordinates (`sdk/core/curation/curationLists.ts:28-38` **[S]**). Adopting the union
  **tightens** the reference rather than merely extending it (`proposal-v2.md:150-156`).

- **Not built**: user-authored lists, a single general list kind, the product-picker UI. Those are the follow-up,
  and they are marked as such wherever the plan touches the model.

---

## 7. The ACL — three tiers, enforced server-side

`ruling-acl.md:5-24`, binding, and re-stated by `ruling-app-authority-and-portable-leases.md:55-70`.

| tier | what the ruling grants | what that means operationally |
|---|---|---|
| **admin** | full control of the app and its pages | any operation on any binding, any target, including one held by an editor or a paying user. **Also the tier that authors the default route** (`ruling-acl.md:15-16`) |
| **editor** | may create and publish pages to new places, **and** holds per-path grants | creation is **broad**: publish a page to any *free* top-level path, self-service. **Access is per-path and explicitly granted**: retargeting or touching an *existing* binding requires a grant naming that path. Not a role, not a blanket right |
| **premium / paid** | may reserve a path as part of their store | a **lease**: paid, time-bounded, top-level only, self-service, attached to a pubkey |

### 7.1 Enforcement and the decision function

**The server is the enforcement point** (`ruling-resolution-and-signed-ledger.md:48-54`). The write path is
`apply()` (§4.5); authorization is a pure function evaluated **inside** the mutation, against the **current
file**, never against anything the caller sent:

```
may(actor, op, path, file) → Allowed | Denied(reason)
  reserved(path) or compiledIn(path)        → Denied('app-owned-name')          for every tier
  role(actor) === 'admin'                   → Allowed                          (any op)
  role(actor) === 'editor'
     op ∈ {create, publishPageToPath} and path is FREE
        and granted(actor, path)             → Allowed
     op ∈ {retarget, release} and granted(actor, path)
        and target.author === actor          → Allowed
     otherwise                               → Denied('no-grant')              ← a VISIBLE refusal
  op ∈ {reserve, renew} and path is FREE and path is top-level
     and payment settled for (actor, path)   → Allowed
  otherwise                                  → Denied(<reason naming the holder's tier>)
```

- **`grants` live in the file.** The ruling makes grants data, not a role: `"grants": { "<editor>": ["featured-*", "about"] }`.
  A `*` is a **suffix wildcard on a literal prefix**, matched in code — never as a regex or SQL pattern, so a
  name containing `%` cannot become a wildcard.
- **Roles are read from the existing managers**, which is where they already are: `AdminManagerImpl`/`EditorManagerImpl`
  are `Set`s rebuilt from kind-30000 `d='admins'`/`d='editors'` (`platform/server/AdminManager.ts`, `EditorManager.ts`
  **[S]**; seeded from `adminPubkeys: []` at boot, `platform/server/startup.ts:71`). They are consulted at
  decision time as "an admin *now*", never copied into the routing file.
- **A refusal is a visible state**, not a silent no-op (`ruling-acl.md:59-64`): the API returns
  `Denied(reason)`, and the management surface renders it with the reason *and* the holding tier.
- **An editor cannot point a path at someone else's page.** The grant is authority over a path; the target must
  be theirs. Only admin binds a third party's page to a name — which is what "full control over the app and its
  pages" means operationally.

### 7.2 The surviving precedence question, and how this plan treats it

`ruling-simple-routing-file.md:61-64` names one question it did **not** settle: **an admin binding under a leased
path** — the lease is bought and time-bounded, the admin binding unbounded, and both can want the same subpath.

This document does **not** rule on it (that would be presenting our choice as a ruling) and the plan does not
need it, because:

- **Lease write creates no subpath bindings.** A lease carries its subpaths *by right*, not by enumeration; the
  binding for the subpath stays whatever it is until the leaseholder (or an admin) writes one.
- Consequently the conflict **cannot be created in this build**: only admin and leaseholder can write, and the
  first increment in which a leaseholder can write a subpath is the increment that must come with the ruling.

§10 restates it as an open item with a lean and what each choice costs, so the owner can settle it before that
increment is specified.

### 7.3 Negative paths this architecture must own

Derived from `ruling-acl.md:59-66`, extended by the two new binding kinds:

| # | case | expected |
|---|---|---|
| N1 | editor touches a path not in their grant | `Denied('no-grant')`, rendered as a visible refusal naming the missing grant |
| N2 | lease requested on a path held by an admin binding or an in-term lease | `Denied` naming the holding tier — and **no invoice is issued** |
| N3 | a lease past its term is requested | **404** from the router. The holder was warned before the term (§7.4) |
| N4 | a lease is terminated by the provider | **404**, immediately, server-enforced |
| N5 | admin reassigns a route held by an editor or a paying user | takes effect, and the displaced holder sees the revocation with actor and reason on their own list |
| N6 | the default binding's page is unrenderable | `/` renders the inline composition; the state is reported, never blanked |
| N7 | a binding's target page is absent / switched off / zero blocks / unparseable | the ladder resolved; the page surface says **"item unavailable"** — never "route not found" |
| N8 | the routing file is unreadable | the server refuses to boot (§4.4); `/api/healthz` reports it |
| N9 | two admin bindings on one path in the file | refused at load, every violation printed |
| N10 | a lease on a subpath | refused by the validator |
| N11 | a lease on a free top-level path while an ancestor is leased | refused (`'held-by-ancestor'`) |

### 7.4 Lapse, renewal, and the holder being told *before* it lapses

`ruling-acl.md:63-64`: "a reservation used after its `validUntil` → no longer resolves, and the holder is told
*before* it lapses."

- **Expiry is derived at read time** from `expiresAt` and the clock. There is **no sweeper and no cron needed for
  correctness** — a lapsed lease fails the `live` predicate and the path 404s. A background rewrite that prunes
  lapsed rows is a *hygiene* task, never a correctness one.
- **Renewal extends from `max(now, expiresAt)`** — the existing and correct behaviour
  (`platform/server/ZapPurchaseManager.ts:187-193` **[S]**), so renewing early does not burn paid time.
- **Warnings** reuse the existing display hook (`platform/web/routes/_dashboard-layout/dashboard/account/vanity-url.tsx`
  `formatExpiration` / `daysLeft` / `isExpiringSoon` **[S]**) at 14 and 3 days.
- **No grace window.** The ruling says expiry → 404, and this document does not invent a grace period: a grace
  window is the "revert to a default" story the ruling rejected, one step removed. **OUR CHOICE**, flagged:
  `designs/B-server-authoritative.md:203-212` proposes 14 days of grace, and this architecture does **not**
  adopt it. If the owner wants one, it is one comparison and one field, and the plan says where.

---

## 8. Names: grammar, the reserved set, and the compiled-in set

### 8.1 The compiled-in surface, measured

```bash
# top-level static segments, from the generated route tree
$ grep -oE "path: '/[^']*'" platform/web/routeTree.gen.ts \
  | sed "s/path: '//;s/'$//" | awk -F/ 'NF==2 && $2!="" && $2 !~ /\$/' | sort -u
/auctions /checkout /community /dashboard /new /nostr /posts /products /setup          → 9 lines
```

**[M]**. Of those 9, `/new` is **nested**, not top-level — it is declared under
`DashboardLayoutDashboardProductsProductsRoute` and again under `…CollectionsRoute` **[M]** (`sed -n
'/path: .\/new./,+3p' platform/web/routeTree.gen.ts` shows the non-root parent), so the real top-level set is
**8**: `auctions, checkout, community, dashboard, nostr, posts, products, setup`. The **9 vs 8** discrepancy that
`designs/COMPARISON.md:87-102` settles is settled correctly there (C right, B's count reproducible but misread),
and this document adopts **8** with the parent-check command recorded.

```bash
# top-level dynamic segments (rung 2, already programmed) — the whole path is ONE segment
$ grep -oE "path: '/[^']*'" platform/web/routeTree.gen.ts | grep '\$' | sort -u
```

yields `/$auctionId /$collectionId /$productId /$pubkey /$vanityName /auctions/$auctionId /collection/$collectionId
/dashboard/orders/$orderId /posts/$postId /products/$productId /profile/$profileId` **[M]**. Only
`/profile/:profileId`, `/products/:productId`, `/posts/:postId`, `/auctions/:auctionId` and
`/collection/:collectionId` are **prefixes**; `/`+one segment is the catch-all `/$vanityName`
(`platform/web/routeTree.gen.ts:74-78`), and the `/$pubkey` entries are nested under `dashboard/sales/messages`.
**Precedence between a compiled-in prefix and a table-declared one is therefore a real question** and is settled in
§5.4: a compiled-in route always wins, which is why the validator refuses a declared prefix that would shadow one.

**Source of truth**: the set must be **derived from `routeTree.gen.ts` at build time**, not typed by hand
(`designs/B-server-authoritative.md:489-493` is right about this: "a name the router owns is a fact about the
*deployed build*, so it must be a build artifact"). A hand-kept copy drifts; a generated copy is checkable by
one `comm`.

### 8.2 The path grammar

`/^[a-z0-9][a-z0-9_-]{1,28}[a-z0-9]$/` — 3–30 chars, lowercase alnum plus `-`/`_`, alnum at both ends. The same
grammar the app already uses, in two places that agree: `sdk/config/vanity.ts:171-175` and
`platform/server/VanityManager.ts:182-186` **[S]**. The value is lowercased before the check.

### 8.3 The reserved list stops being a shield and becomes the set of un-handed-out routes

`ruling-app-authority-and-portable-leases.md:66-68`, binding: *"the reserved-name list stops being a way to
protect compiled-in routes and becomes the set of routes that have not yet been handed to someone."*

**Measured state of the list today:**

```
$ sed -n '51,89p' sdk/config/vanity.ts | grep -oE "'[a-z0-9_-]+'" | sort -u | wc -l          → 37
$ awk 'NR>=6&&NR<=44' platform/server/VanityManager.ts | grep -oE "'[a-z0-9_-]+'" | wc -l  → 37
  sets equal → True            [M]
```

and, measured against the 8 real top-level segments:

```
static − reserved → {auctions, new}        [M]
```

`dashboard`, `products`, `checkout`, `setup`, `community`, `posts`, `nostr` are reserved; **`auctions` is a real
top-level route and is not reserved** — the live hole `review-adversarial.json` F7 case 1 records.
`home`, `featured` and `blog` are **not** reserved either **[M]**.

**What the reserved list becomes, under the ruling:**

| set | meaning | enforced where |
|---|---|---|
| **RESERVED** (the 37) | names not yet handed out; a binding on one is refused | file validator, at load and at write |
| **COMPILED_IN** (the 8, derived) | names the app's own router serves; a binding on one is refused **and the refusal is explained as "app-owned"** | file validator + generated artefact + a drift test |
| everything else | handable to an editor or a leaseholder | — |

Two consequences the plan builds:

1. **The union `RESERVED ∪ COMPILED_IN` is the refusal set, and it is checked as a set, not as prose.** The
   current gap (`auctions`) is closed by construction: `COMPILED_IN` is derived from the route tree, so
   `auctions` is refused for every tier without anyone remembering to add it to a list.
2. **Refusing a *new* name is not the same as invalidating an *existing* binding.** If a future release
   compiles a new top-level route whose name a binding already holds, the file becomes invalid on load and the
   site refuses to boot — which is the correct failure (loud, not silent), and the plan requires the management
   surface to report it before deploying. **Grandfather-and-warn vs refuse** is **OUR CHOICE: refuse**, because
   the ruling makes the compiled-in surface un-reassignable and a silent grandfather would produce two meanings
   for one URL. `designs/C-ownership-domain.md:674` leans grandfather-and-warn; this architecture does not adopt
   it, and says so.

---

## 9. What this supersedes, per candidate, with the reason

Everything in this table is **SUPERSEDED** — do not implement it. Where a candidate is right, the right part is
carried forward and named in §9.5.

### 9.1 Candidate A — `designs/A-one-writer-per-event.md`

| design location | what it proposes | why superseded |
|---|---|---|
| `:18-21` §0 bets 2–3, `:119-125` §3.1 | new event kinds **30025** (path claim) and **30026** (site default) on relays are the record of a name; the DB is a "materialised view — fold over the events, delete it and nothing is lost" | **Superseded by `ruling-simple-routing-file.md:5-18`** (a file, not a relay record) and `ruling-app-authority-and-portable-leases.md:39-53` (the app owns its routes and serves them). Routing must not depend on a relay being up, and a kind-30025 record is exactly that dependency |
| `:366-370` §6.1–6.2, `:354-364` | `bun:sqlite` event store at `data/events.sqlite`, `events`/`event_history`, "every projection is rebuildable" | **Superseded**: no database, no event store, no projection (`ruling-simple-routing-file.md:12-13`). The rebuildable-view idea was solving a problem the file does not have |
| `:192-205` §3.5 ladder steps 1–3 | rung after the claim: **legacy vanity entry → profile**, then **app-key page at `d=path`**, then empty state | **Superseded by `ruling-simple-routing-file.md:20-35`**: rung 2 is a *parameterised prefix*, not "whatever page happens to sit at that `d`". A fall-through to an app-key page is the un-vouched serving the 404 rung exists to prevent |
| `:199-200` §3.5(b) | "claim present but lapsed → an honest message, NOT the app-key page" | **partly superseded**: the ruling is **404** (`ruling-resolution-and-signed-ledger.md:39-40`), not "an honest message". A lapsed lease is not a rendered page |
| `:193-194`, `:538` | the claim read is "cached 30s" | **superseded**: there is no cache layer (`ruling-simple-routing-file.md:12-13`); the file is in memory, which is not a cache |
| `:416-419` §8 R3 | series resolution is a client relay query `#t` restricted to the claim holder | **reconciled, not superseded**: series membership remains a page-level fact. What changes is only *who* resolves the path (`/featured` is programmed, §5.3) |
| `:603` §13 "strongest objection" | "a relational table … would have delivered (a) and (b) with less ceremony" | **overtaken by events**: the owner's ruling took the table's side, insisting only that it be a **file**, not a database |
| `:497-509` §12.1 | increment 1 edits `platform/web/routes/$vanityName.tsx` to prefer a claim | **superseded in shape**: the client no longer resolves. The server decides and the route renders the decision |

**A's parts that survive, and are in this architecture**: the page is one author-signed kind-30024 event and
that is what makes R1 natural (`:35-47`); "a write for one path cannot name another path" as the property that
kills the clobber (`:127-140`); "no fall-through from a broken claim" (`:209`, applied to leases as 404);
`seq`-style monotone ordering assigned server-side (`:211-220`, applied to the file's `seq`).

### 9.2 Candidate B — `designs/B-server-authoritative.md`

| design location | what it proposes | why superseded |
|---|---|---|
| `:17-32` §0, `:220-255` §3.1 | SQLite is the authority: `routes`, `leases`, `grants`, `payments`, `commands`, `projections`, `documents` tables, WAL, `BEGIN IMMEDIATE` | **Superseded by `ruling-simple-routing-file.md:5-18`**, explicitly: "a database is maybe overkill and a single file can do the trick". Every table goes; the file (§4) carries routing and grants only |
| `:257-275` §3.2, `:276-291` §3.3 | a **Nostr projection** with `["seq"]`/`["root"]` hash commitments, **sharded** `d='routes-<xx>'` events, a shards size budget | **Superseded**: a publication projection with roots and shards is a protocol layer for a problem the file does not have (`ruling-simple-routing-file.md:12-16`: unreadable table = broken site, not a shard budget). The signed ledger is a **separate, later bonus** (§11), and it is a per-lease confirmation, not a sharded table |
| `:298-313` §4, `:304` | `GET /api/routes/resolve?path=…` returns `{status, route, document, seq}` with `status ∈ resolved\|lapsed\|none\|broken\|unreadable` | **superseded in substance**: `unreadable` no longer exists (the server will not boot, §4.4); `none` is 404, not "today's app-key page"; and the **server serves the page**, it does not hand the client a route to assemble (`ruling-resolution-and-signed-ledger.md:8-12`) |
| `:311` case 4 | "no route → today's behaviour, unchanged: the app-key page at `d=<segment>`" | **Superseded by `ruling-simple-routing-file.md:35`**: the honest default is 404. The bridge was defensible while the table was new; the ruling makes the table the foundation |
| `:312` case 5 | "the database cannot be read → the client uses its last cached table and says so" | **Superseded**: no local-snapshot fallback, no degraded mode (`ruling-simple-routing-file.md:14-16`) |
| `:325-328` §4.2 | `/` fallback ladder ending in "the existing inline composition … + an admin banner" on unreadable | **partly superseded**: the banner for an unreadable table is gone (the process is not serving). The inline composition as `/`'s empty state survives (§3.5) |
| `:163-174` §2.3, `:203-212` | `leases(id, name, …, state ∈ active\|grace\|lapsed\|revoked)`, `ends_at = 0` means perpetual, **14-day grace** | **Superseded on all three counts**: (a) `ends_at=0`-means-perpetual is exactly the "one row with an optional expiry" the ruling forbids (`ruling-resolution-and-signed-ledger.md:43-46`); (b) a `state` column with `lapsed` is a stored verdict where this architecture derives liveness from the clock (§7.4); (c) **grace is not adopted** (§7.4) |
| `:466-478` §6.2 | `may(actor, op, name, target)` with `name ∈ RESERVED ∪ STATIC_SEGMENTS → NO` | **survives in spirit, superseded in encoding**: the refusal set is `RESERVED ∪ COMPILED_IN` derived at build (§8.3); the op table is kept, the SQL is gone |
| `:357-382` §5.1 | purchase via **NIP-98 (kind 27235)** for `quote`/`settle`/`mine` | **NOT ADOPTED, and not superseded by a ruling** — it is a plausible mechanism with **zero precedent in the repo** (`git grep -n '27235\|NIP-98' -- platform/ sdk/ docs/ | wc -l` → 0 **[M]**). The ruling requires the **server** to be the enforcement point, which NIP-98 satisfies; but the ACL needs an actor for *three* tiers including anonymous paying users, and the cheapest actor the repo already has is the app's own signed-event submitter. **§10 flags this as an open decision with a lean**, not a settled choice |
| `:352-455` §5 | zap/nutzap verification, `payments` table, swap, custody | **reserved** (`ruling-acl.md:36-42` leaves signing open; `ruling-d3-persistence-and-redesign.md:20-31` settles D3) — **not this architecture's subject**. The two facts B established (no `verifyEvent` on the receipt; `nostrPubkey` declared and never read) are carried into §10 as the reason the payment work must precede any *paid* lease |
| `:537-555` §8 migration | "rollback: delete the DB file and set `ROUTES_AUTHORITY=relay`" | **superseded**: there is no `ROUTES_AUTHORITY` flag and no relay authority. Rollback is `git revert` of the increment, or restoring `routes.json` from its `.bak` |

**B's parts that survive**: the **write discipline** (`ruling-resolution-and-signed-ledger.md:18-20` says it is
now *required*): the server builds the record from a parsed intent and never from a submitted tag list — §4.5's
`apply(mutation)`; the derived-liveness idea (`:206-212`, without grace); "one writer, one serialiser"
(`:511-534`) as the structural answer to the clobber — §4.5; and the finding that the read seam has one choke
point (`:68-71`), which is what makes it possible for the client to stop reading the table at all.

### 9.3 Candidate C — `designs/C-ownership-domain.md`

| design location | what it proposes | why superseded |
|---|---|---|
| `:322-366` §3.1 | SQLite `lease` history table + `occupancy` table with a partial unique index, a 60 s background reap | **Superseded by `ruling-simple-routing-file.md:5-18`**. The *insight* survives: uniqueness is enforced by the store, not by code — here by the file validator refusing a second binding on a path |
| `:396-419` §4.2 | a per-name **`kind 30078` relay mirror** with `d="route:<name>"`, plus a `routes-manifest` **sharded at 1500 names** for discovery | **Superseded**: publishing to Nostr is "relatively unimportant" and never the read path (`ruling-app-authority-and-portable-leases.md:23-24`, `:50-53`); a manifest with shard rules is the storage debate wearing a publication hat. What survives is the *concept* of a signed per-lease confirmation — as the **deferred bonus**, §11 |
| `:380-394` §4.1 | the authoritative surface is an **HTTP API** `GET /api/routes/resolve`, `POST /api/routes/grant|retarget|renew|revoke|release|reassign|default` | **partly superseded**: the *server* is the surface (right), but the **read** is not an API the client assembles a page from — the server resolves and serves (`ruling-resolution-and-signed-ledger.md:8-12`). The **write** ops survive as the server's management commands behind `apply()` |
| `:248-265` §2.4 | `can(actor, op, subject, ctx)` with **no statement of how the server learns the actor** (`review-adversarial.json` records 0 hits for `NIP-98\|27235\|authent\|session\|cookie`) | **NOT ACCEPTED AS SPECIFIED**: an authority function whose actor is never established is not an authority function. The actor is settled in §10 as an open decision, with the lean from the repo's one existing authenticated write path (`platform/server/websocket.ts:30-33` verifies the client's own signature before `platform/server/EventHandler.ts:238` re-signs) |
| `:138` §2.1, `:161` | "Sub-paths (`/name/sub`) do not exist and are not designed here" | **Superseded by `ruling-resolution-and-signed-ledger.md:31-33`** ("Subpaths are in scope") and `ruling-simple-routing-file.md:37-54` (a lease carries its subpaths) |
| `:359-366` §3.1 | occupancy materialised + a **bounded background reap every 60 s** | **superseded**: liveness is derived; nothing needs a reap for correctness (§7.4). Hygiene, if ever needed, is not part of this architecture |
| `:623-629` §9 | increment 1 = domain + store, "wired to nothing", with a read-only `reconcile` | **superseded in content**: it is a good *shape* for a first increment and the minimality is preserved — but the smallest thing that proves **this** architecture end to end is different (§IMPLEMENTATION-PLAN §1) |
| `:674` §11.2 | a new top-level route may **retroactively invalidate** a live lease; rule should be **"grandfather, and warn"** | **OUR CHOICE, not adopted**: this architecture **refuses** the file and refuses to boot (§8.3), because a silent grandfather gives one URL two meanings |
| `:686-690` §11.4 | "no candidate should ship a routes ledger while the purchase path prices leases from a client-asserted amount" | **ADOPTED as a constraint on the plan**: any *paid* lease waits for the verification fix (§10, risk R-1) |
| `:676-680` §11.3 | R3 cannot be separated from the transport: "newest" is an author-asserted timestamp | **ADOPTED and recorded** in §5.3 as an accepted limit |

**C's parts that survive**: the three tiers as **entitlements over a resource**, not classes of writer over an
event kind (`:128`, `:248-265`) — that is §7; `Delegation` as a *separate* aggregate from ownership (`:185-195`),
which is §7's `grants` map; `Assurance` as a type that does not collapse payment states into a boolean (`:163`,
matching `AGENTS.md:41-46`); and the name/target/term vocabulary, which is why §3.1 reads the way it does.

### 9.4 `proposal-v2.md` — the conservative candidate

| design location | what it proposes | why superseded |
|---|---|---|
| `:235-257` §3.3 the **four-rung ladder** | rung 0 trusted-authors set; rung 1 claim; **rung 2 "page by exact `d`, among trusted authors, OLDEST `created_at` wins"**; rung 3 series by `#t` **among trusted authors**; rung 4 floor | **FULLY SUPERSEDED by `ruling-simple-routing-file.md:20-35`**. This is the single most important supersession in the document. A page read is **not** a routing rung: it makes "what path is this" a relay question (the anti-pattern), it needs a read-time tie-break rule ("oldest wins"/"lowest id") which the ruling replaces with "longest programmed prefix", and it produces the **two-clients-show-different-sites** defect v2 itself concedes (`:437-440`). Routing is decided by the file alone; the relay is only consulted *after* routing, to fetch a page the router already named |
| `:256` rung 4, `:307-312` §3.6 floor | a per-path **empty state** ("nothing is published at this path") under every rung | **superseded by `ruling-simple-routing-file.md:35`**: an unmatched path is **404**. An empty state at an arbitrary path is "nothing served that cannot be vouched for" |
| `:265-269` §3.3 "why oldest wins at step 2" | oldest-enabled wins, "squatting by recency" | **superseded**: no read-time arbitration exists once the file owns the path (§3.4). This rule is what the candidate had to invent because the table was not authoritative |
| `:98-104`, `:338-348` D4 (restated) | claims in `d='vanity-urls'`, tiers of a single replaceable event, with a **32 KB tag budget / 230 claims** | **superseded on both counts**: the routing file is not a replaceable event, so the relay's 64 KB ceiling (`:110-113`) is not a constraint; and a **230-claim budget would break R1's "hundreds"** — the budget is retired, and its refusal code (`claim-budget-exceeded`) with it |
| `:183-201` the three-layer diagram (L1 pages / L2 claims / L3 resolution) | claims live in the registry event | **superseded in storage, kept in spirit**: L1 (pages) and L3 (resolution) are this architecture's model; L2 is the **file**, not an event |
| `:268-275` | "if you push back: the only way to keep one-entry-per-path is to put every path in the table, i.e. to refuse R1" | **resolved, not superseded**: this is exactly what the owner ruled — the table holds **every programmed path**, in a file with no size ceiling, so R1 and one-occupancy-per-path are both satisfied |
| `:368` D13 budget paragraph, `:611` N20 | `claim-budget-exceeded` | **superseded** with the budget |
| `:420-445` D16 trusted-author allowlist on rungs 2–3 | read-side allowlist so only app key ∪ admins ∪ editors can own a top-level path | **superseded by `ruling-acl.md:5-24`**: the tiers are defined, premium users *do* get a top-level path, and the boundary is the **server's write validation** (`:443` "an open namespace is one deleted `authors` filter" — no longer true; it is a validator, not a filter) |
| `:466-483` D18 | the `route-default` tag names a **path**; any target type admissible at `/` | **ADOPTED**: this is R4 and it is exactly this architecture's default binding (§3.5) |
| `:172-177`, `:345-348` | a second source of truth is created if pages and claims disagree | **resolved**: the file is the only source of truth for routing; the page is the only source of truth for content. They cannot disagree about *what a path means* |

**v2's parts that survive**: R1–R4 as a hard requirement (`:529-545`, §3.5 here); `d` is the path
(`:189-206`); the corrected reading of `ProductRow`'s author-less `#d` query (`:136`, `:144-156`) → §6; the
"floor is never blank" constraint applied to `/` only (§3.5, R4); the `ProductReference` union with `list`
reserved (`:505-509`) → §6; and D18 → the default binding.

### 9.5 `designs/COMPARISON.md` — the adjudication

The adjudication was commissioned **before** the owner's later rulings, and three of its recommendations are
now SUPERSEDED:

| location | recommendation | status |
|---|---|---|
| `:254-262` §5 | "**C's ownership domain, recorded per name as an app-key-signed event in A's shape, written through B's discipline**" | **SUPERSEDED by `ruling-simple-routing-file.md:5-18`**: the owner explicitly declined the DB-vs-relay fork and chose **a single file**. The "per-name signed event as the write-ahead record" is dropped; the signed ledger survives only as the **deferred bonus** (§11) |
| `:195-196` §3 door 1 | "write a self-sufficient, app-key-signed event per name inside the same transaction **from day one**" | **SUPERSEDED**: the door is now closed differently — a **backup file** (§4.4). The concern (payments accepted with history only in one file) is real and is carried as an operational task, not an architectural layer |
| `:282-286` §6 Q1, `:283` | "ship the first visible slice now … a path can resolve to a page … governed by a simple first-published-wins rule" | **SUPERSEDED**: first-published-wins is a read-time rule and there is no read-time arbitration (§9.4). The slice survives, the rule does not |
| `:286` §6 Q2 | "if our server's database is lost, must the site's names still work? **My lean: yes**" | **SUPERSEDED by `ruling-simple-routing-file.md:14-16`**, explicitly: "your site is broken. You don't have a fallback website after engine X is broken" |
| `:161` X3, `:165` | adopt **NIP-98** from B to close C's missing actor | **not settled by any ruling** — carried to §10 as an open decision with a lean |
| `:104-123` C8, ADR-0006 | ADR-0006:211-215 asks for a signing proof "any client can verify" and this makes B's bet untenable | **reconciled, and its weight changes**: the owner's ruling (`ruling-app-authority-and-portable-leases.md:23-24,50-53`) makes publishing "relatively unimportant" for routing. So ADR-0006's requirement now binds the **deferred ledger** (§11), not the read path. The adjudication was not wrong about the doctrine; the doctrine was narrowed by the owner |
| `:7` what it could not do | "the typecheck baseline 205 is `[U]` for me" | **still `[U]`, and now quantified**: the same command on this **dirty** checkout reports **401**, of which **241 are in non-app files** (94 `runs/`, 72 `notes/`, 72 `node_modules/*.d.ts`, 30 `src/` **[M]**). Neither number is a baseline; the plan re-derives it per branch |

The adjudication's **measured findings** (C1–C7) all stand and are cited in this document where they matter:
C1 (no server-side storage), C5 (30024 addressable), C6 (the clobber's mechanism), C7 (the namespace overlaps and
`auctions` is unprotected).

---

## 10. What is NOT settled, with a lean and its cost

Nothing below is a ruling; nothing below is presented as one. The plan is shaped so that **only R-1 blocks a
release**, and only increments 6+ depend on the rest.

### O-1 · Who does the server think you are? (the ACL's actor)

The ruling makes the server the enforcement point (`ruling-resolution-and-signed-ledger.md:48-54`) and defines
three tiers (`ruling-acl.md:5-24`) — but never says how an incoming write proves *which tier* the caller holds.
Without that, §7.1's `may(actor, …)` has no `actor`, which is C's largest omission (`review-adversarial.json`,
C §"unsupported claims").

The repo has exactly one authenticated write path today, and it is measured:

- the client signs its own event and sends it over a WebSocket (`platform/server/websocket.ts:20-33`, `verifyEvent` at `:30`);
- the server validates *who* that pubkey is (`platform/server/EventValidator.ts:74-93`) and then **re-signs it as
  the app key** (`platform/server/EventHandler.ts:238` → `platform/server/EventSigner.ts:16-26`, which copies
  `tags` and `created_at` verbatim **[S]**).

That path works for admin and editor (both are pubkeys the server already holds in `AdminManager`/`EditorManager`)
and is **wrong as an enforcement point for paths**, because the client composes the tags the server then
rubber-stamps (`designs/COMPARISON.md:161`, F5).

**Lean**: keep the WebSocket submit channel as the **transport**, but make it carry an *intent*, not tags — the
same discipline `ruling-resolution-and-signed-ledger.md:18-20` requires (the server builds the record). The
client's signature establishes `actor`; the server decides every field. **This satisfies the ruling without
introducing anything new.** B's NIP-98 (`designs/B-server-authoritative.md:370-382`) does the same job with a
standardised proof, at the cost of new machinery with zero precedent (`git grep '27235\|NIP-98' -- platform/ sdk/ docs/ | wc -l`
→ 0 **[M]**).

**Cost of the lean**: it reuses a channel whose *current* semantics are "re-sign what you send", so the change is
a **removal** of the generic `general` branch for route intents (`platform/server/EventValidator.ts:85-93`) —
behaviour-changing for anything else that uses it. **Cost if NIP-98 is preferred instead**: a new auth
mechanism, a new replay-window check, and an ADR under `AGENTS.md:63-64`. **Settle before increment 4.**

### O-2 · Admin binding vs a leased path's subpath (the one surviving precedence question)

`ruling-simple-routing-file.md:61-64` names it and does not settle it.

**Lean**: **the leaseholder wins inside their term**, for subpaths it has bound; the admin wins after the term
(the lease's bindings die anyway, §3.4) and wins **reassignment of the top-level path at any time** (that is
"full control", `ruling-acl.md:13-16`, and `ruling-d3-persistence-and-redesign.md:28-29` — "the admin can always
reassign any specific route").

**Cost of the lean**: an admin who binds `/shop/featured` and then sells `/shop` discovers their binding is
invisible for the term — a surprise, so the sale must be confirmed against a preview of what dies. **Cost of the
opposite** (admin always wins): a paid leaseholder can lose the subpaths they bought, and "what the lease
carries" becomes advisory. **Not needed before a leaseholder can write a subpath — which is not in this plan.**

### O-3 · A lapsed lease's bindings vs `Pages remain addressable by event id`

`ruling-simple-routing-file.md:52-54` records the owner's aside that a page is still reachable by event id under
an expired lease, and marks it **not part of this build**. This architecture therefore 404s the path and offers
nothing else at it, which is exactly what the ruling says. Recorded so a later increment does not treat the 404
as a regression.

### O-4 · What "the instance" is, for the signed ledger

`ruling-simple-routing-file.md:56-59`: operator key, domain, or both — "the one real open question". The file's
`"instance": { "pubkey": null }` field (§4.2) exists so that adding it later is a field, not a migration.
**Not needed by any increment in this plan** (§11).

### O-5 · Whether the payment path is fixed before *paid* leases

`ruling-acl.md:36-42` leaves "who signs a self-service reservation" open; `ruling-d3-persistence-and-redesign.md:20-31`
settles D3 (fail closed on a new purchase; grant maintained for its term). **The measured state is unsafe for paid
leases**: `platform/server/ZapPurchaseManager.ts:175-180` prices a lease from the **requester's own** `amount` tag,
the `bolt115` amount is never decoded, and the receipt's author is never compared to the provider
(`nostrPubkey`, declared at `:40`, **never read** **[M]** `grep -rn nostrPubkey platform/server --include=*.ts` → `:40` only).

**Lean (adopted from `designs/C-ownership-domain.md:686-690` and `designs/COMPARISON.md:274`)**: **an
admin-granted or editor-created binding can ship first; a lease that takes payment must not, until the receipt is
verified.** The plan therefore orders the verification increment **before** the lease write path (increment 6
before 7) and does not put a payable surface on any earlier increment.

---

## 11. The signed lease-confirmation ledger — BUILD LATER, explicitly out of scope

`ruling-resolution-and-signed-ledger.md:56-68` and `ruling-app-authority-and-portable-leases.md:72-98`.

What is ruled, so the file does not have to be reshaped later:

- the **instance signs a confirmation** of each valid lease;
- that confirmation is **published to Nostr** as a public, verifiable ledger;
- the **same signed event is queryable from the server** — "the server is the authority; Nostr is the shareable
  mirror";
- honouring **another** instance's leases is an **opt-in list of whose signatures you accept**, never an
  automatic import.

What this architecture leaves in place for it, at zero cost now:

1. `"instance": { "pubkey": null }` in the file (§4.2), so the signer is a field.
2. every lease carries a `leaseId` and `updatedAt`, so a confirmation has a stable subject.
3. `apply()` is the single mutation point, so "sign and append a confirmation" is one hook, not a search.

**Nothing in increments 1–8 publishes to Nostr**, and the plan says so in each increment's "does NOT do" list.

---

## 12. Open questions this consolidation could not close

| # | question | why it is open | whether the plan depends on it |
|---|---|---|---|
| Q1 | Is `auctions` supposed to be reassignable? | it is a real top-level route and is **not** reserved **[M]**; §8.3 makes it un-reassignable like the other seven | no — the plan refuses it and says so; if the owner wants it assignable, the route must stop being compiled-in |
| Q2 | Does the owner want `/dashboard` itself reroutable, or a path of his choosing that renders a dashboard page? | `ruling-app-authority-and-portable-leases.md:59-60`'s example reads as the former but is only the latter under this architecture (§5.2) | no for increments 1–5; increment 4's management surface must state the refusal |
| Q3 | Does `#t` work on kind 30024 on this deployment's relay? | **[U]** — no relay reached | **yes, for R3**: the R3 increment (5) is gated on one live measurement and has a stated fallback (server-side series index, not designed) |
| Q4 | The typecheck baseline | **`[U]`** — 205 cannot be reproduced on a clean tree in this run; the dirty checkout reports **401** with **241** of them in non-app files, which is why a per-branch re-baseline is mandatory (`proposal-v2.md:619-621`) | yes, as a gate — the plan requires per-branch numbers and asserts on the sorted error list |
| Q5 | Who signs a self-service reservation (a paid lease)? | `ruling-acl.md:36-42` open; §10 O-5 | yes, for increment 7 only |

---

## 13. The whole architecture on one page

```
                        ┌───────────────────────────────────────────────┐
  request /x  ─────────▶│  URL space: /api/*, /images/* (fixed)         │
                        │  then compiled-in routes (the app's own)      │──▶ /dashboard, /auctions, …
                        │  then the ROUTING FILE                        │
                        └──────────────────────┬────────────────────────┘
                                               │  in memory, loaded once, boot-refuses-if-bad
                        ┌──────────────────────▼────────────────────────┐
                        │  RUNG 1  exact path, live                     │  admin binding → target
                        │          expired/terminated lease → 404       │  no network call
                        │  RUNG 2  programmed prefix (item/:eventId,    │  no network call to ROUTE
                        │          p/:npub, series)                     │
                        │  RUNG 3  404                                  │
                        └──────────────────────┬────────────────────────┘
                                               │ routing decided: (author, d) or prefix+param
                        ┌──────────────────────▼────────────────────────┐
                        │  PAGE  kind 30024 at (author, d) — the author's│  relay may be down:
                        │  own signed event, fetched AFTER routing      │  "item unavailable", not 404
                        └───────────────────────────────────────────────┘

  writes:  admin │ editor(grant) │ leaseholder  ──▶ may(actor, op, path, file)
                                                     └─▶ apply(mutation) ──▶ validate ──▶ write tmp+rename (.bak kept)

  NOTHING in the route path touches: a database · a cache · an event store · a relay · an indexer.
```

Three sentences that are the test of any future change:

1. **If it makes a request consult the network to decide which path matched, it is wrong.**
2. **If it makes a lapsed lease render something other than 404, it is wrong.**
3. **If it writes the routing file from anything but a full copy of the routing file, it is wrong.**