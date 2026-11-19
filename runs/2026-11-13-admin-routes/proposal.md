# Proposal — managed routes, and a page you can publish to a name

**Run:** 2026-11-13-admin-routes · **Base:** `master` @ `1ed3d676a` (pinned `2326938b3`; `git diff --name-only 2326938b3 HEAD` returns only paths under `runs/` — measured, no source drift).

**How to answer:** one word.

- **ACCEPT** — every lean below stands; increment 1 starts on its own branch immediately.
- **REFUSE** — nothing is built. Say which decision number you object to and I re-draft that one.

Three decisions are marked **↑ ESCALATED** — they change what the product *is*, not how it is built. If you
read nothing else, read D1, D3 and D8.

---

## 1. The decisions

Each decision states the question, **the lean** (what I will build if you say ACCEPT), what it costs, and what
you get if you push back. The seven open items from your ACL ruling are D1–D7, in the ruling's order.

### D1 — Who signs a self-service reservation ↑ ESCALATED

**Question** (ruling §1): a paying user is not the app key, and the registry is app-key authored.

**Lean: the app key signs, after the server has checked the receipt itself.** One table, one author, one
reader. The user never holds signing authority over the registry; the server takes a verified Lightning
receipt and writes the entry.

**Why:** measured, the reader is hard-pinned to the app key — `sdk/core/curation/vanityRead.ts:24`
(`authors: [appPubkey]`) is the only filter (`buildVanityRegistryFilter`, `:21-28`). A user-signed
reservation event is therefore **invisible** to every existing consumer until a second read and a join are
built.

**Cost, stated plainly:** the reservation is not independently verifiable by a third party. It is the
operator's statement that you paid, not a credential you carry. The app key can rewrite any entry, so a
reservation's only protection is policy plus the code that honours it. That is a real loss — it is exactly
the property `docs/adr/ADR-0006-cms-and-nostr-native-page-builder.md:211-213` wanted (a signed proof event),
and that ADR's premise is itself stale (see §11, C8).

**If you push back:** the alternative (user-signed reservation + app acknowledgement, ruling §1 option b)
costs a second read, a merge between two reads, and a new event kind — which `AGENTS.md:63-64` requires to
carry code, tests and documentation. And precedence stops being a rule over one table and becomes a merge
that can disagree with itself for a few seconds at a time.

---

### D2 — Self-service or admin-approved

**Lean: self-service, with admin veto and reclaim always available.** A user with a valid receipt gets the
name; no human approves it. An admin can remove or reassign any route at any time (ruling §1, tier 1).

**Why:** the reservation product already works exactly this way — `platform/server/VanityManager.ts:83-95`
(`validateRegistration`) checks format, reserved words and collision, and never a person.

**Cost:** no review step, so the rails have to be code. A bad name is refused by a rule, not by a colleague.

---

### D3 — What proves entitlement, and which way it fails ↑ ESCALATED

**Question** (ruling §3): what decides "this user has paid for this path", and what happens when that
evidence is unavailable.

**Lean, split by case — because the two cases are not the same failure:**

| case | behaviour | fail direction |
| --- | --- | --- |
| **new** reservation, no usable receipt | refuse, with the reason shown | **closed** |
| **existing, unexpired** reservation, relay/read unavailable | keep honouring the last known-good entry | **stale-while-error** |

**Why the third option:** the ruling offers "closed or open", but the app already has a third behaviour in
production — relay failures are allowed to reject and the last cached value keeps being served
(`platform/web/storefront/storefrontQuery.ts:70-73`). Pretending it is a binary would lose the behaviour
users already have.

**Cost:** a relay outage cannot mint a reservation (good) and cannot silently kill one (good), but it also
cannot *renew* one — renewal needs a live receipt, and a user whose renewal fails during an outage loses the
name at its term. That is the honest trade and it is worth knowing before you accept.

**The evidence itself is unchanged from today:** kind 9735 receipt carrying a signed kind-9734 request with
label `vanity-register` (`platform/server/ZapPurchaseManager.ts:113-207`; pricing `VanityManager.ts:47-55`).

---

### D4 — Conflict precedence

**Lean: admin > editor grant > reservation, enforced at write time by single occupancy.**

The important consequence, and it is a simplification rather than a ranking: **one name has exactly one
entry**. The table is a single replaceable event (`sdk/core/curation/vanityRead.ts:5`, kind 30000), rewritten
wholesale on every change. So precedence is not "which of three records wins when they coexist" — they never
coexist. Precedence is **who is allowed to write this name**, and the loser is the person who finds the name
taken.

- a reservation cannot be created on a path held by an admin route or an editor grant → **refused, reason
  states which tier holds it**;
- an editor cannot be granted a path held by an admin route → refused;
- an admin may take any path. The displaced holder keeps a visible record that it was reassigned, on their
  own dashboard, and the route is not silently deleted from their view.

**Cost:** an editor's grant and a user's reservation can never share a name, so a grant must be an explicit
choice of path, not a blanket permission. That is what the ruling says anyway ("granted specific access to
specific paths").

**Why write-time and not read-time:** a read-time rank over two reads can disagree transiently (the merge
problem in D1). One name, one record, one writer removes the class.

---

### D5 — Lapse and renewal

**Lean: immediate stop, 14-day holder-only grace, warnings at 14 and 3 days.**

- at `validUntil` the name **stops resolving** for everyone — this is already what the code does
  (`sdk/config/vanity.ts:140-142`, `sdk/core/curation/vanityRead.ts:63`);
- for **14 days after**, nobody else may claim it; only the holder may renew (renewal adds to the old expiry,
  which the existing code already does — `platform/server/ZapPurchaseManager.ts:190-193`);
- the holder is warned at 14 and 3 days on the dashboard, using the existing display hook
  (`platform/web/routes/_dashboard-layout/dashboard/account/vanity-url.tsx:113-150`, `formatExpiration` →
  `daysLeft` / `isExpiringSoon`) — today the only "warn before it lapses" surface in the app;
- after the grace window the name is free for anyone, in any tier.

**Cost:** a squatted name is unavailable for 14 days after its holder stops paying. That is 14 days of a
dead path rather than 14 days of a stranger's page. If you prefer the name to free immediately, that is a
one-line change to the availability predicate and I'll do it — but then a lapsed storefront can be taken by
someone else while its owner is on holiday.

**Not decided here:** `docs/vanity-urls.md` describes a 404 on expiry (`:88-93`). There is no 404 anywhere in
this path. See §11, C6.

---

### D6 — What "path/domain" means

**Lean: a single URL path segment in this app — `/name`. No DNS.**

The ruling itself says not to take the wider reading (`ruling-acl.md:52-53`), and the code agrees: a measured
search for custom-domain machinery across `platform/`, `sdk/`, `ui/` finds nothing. A name resolves at
`platform/web/routes/$vanityName.tsx` and the segment is the `d` tag.

**Flagged, as the ruling asks:** "domain" is not implemented and is not in this run. A real custom domain
needs DNS, TLS and a host-level router — a different project.

---

### D7 — Naming rules and collisions

**Lean: reuse the existing grammar and the existing reserved list, for all three tiers.**

- lowercased on read (`sdk/core/curation/vanityRead.ts:34`), matched case-insensitively;
- `/^[a-z0-9][a-z0-9_-]{1,28}[a-z0-9]$/` — 3–30 chars, alnum plus `-`/`_`, must start and end alnum
  (`sdk/config/vanity.ts:171-175`; server copy `platform/server/VanityManager.ts:182-186`);
- the **37** reserved names (`sdk/config/vanity.ts:51-89`; identical set at
  `platform/server/VanityManager.ts:6-44` — counted: 37 quoted literals, sets equal, measured);
- `home` is **not** reserved (measured) — which is why your example is legal;
- **new rule:** a name that collides with a real top-level route is refused for every tier, including admin,
  because the router wins and the route would be dead on arrival (static segments take priority over
  `/$vanityName` — `platform/web/routeTree.gen.ts:74-76`, pinned by
  `platform/web/routes/sellerRoute.test.tsx:52-64`).

**Cost:** you cannot create a route at `/products` or `/profile`. That is not a limitation, it is the router
telling the truth.

---

### D8 — Does the home become a page an admin can author? ↑ ESCALATED

**Question** (order §Bound): should `/` render a page authored by an admin's key (indirection), or stay bound
to the app key's own document?

**Lean: the default route's target names its author, so an admin's page can be the home — and the app key's
own `home` page keeps working as today.** The default route is just a route; its target carries
`(author, d)`. Nothing privileges an admin's key over the app's; the app key simply remains the default
author until someone points the default elsewhere.

**Why it is not free:** `platform/web/storefront/StorefrontAddressPage.tsx:31` hard-pins the author to
`config?.appPublicKey` and takes only a `dTag` prop (`:29`). Reading an admin-authored page therefore needs a
real prop on a shared renderer, not a config change. And there is a consequence you should see before
accepting: **a page can only reference its own author's listings** (`StorefrontBlockSlots.tsx:30-46` — every
slot takes the pubkey from the page event's author, never from the document). An admin-authored home can
feature the admin's own listings, not sellers'. That constraint is almost certainly why today's home carries
a single hardcoded d-tag (`notes/DECISION-home-composition.md:164`), and it does not go away when routes
exist.

**What I will NOT do without you saying so:** reassign the home to an admin key by default. The lean keeps the
app key as the default author and makes an admin-authored home *possible*, not mandatory.

---

### D9 — Which target types are admissible now

**Lean: three types in this increment — `profile`, `page`, `listing`. External URL refused at write time,
with a stated reason.**

Measured feasibility (research 02 §2):

| target | state | cost |
| --- | --- | --- |
| **profile** (a pubkey) | fully wired; it is the only production-complete target (`sdk/core/curation/vanityRead.ts:7-11`, `$vanityName.tsx:30-32`) | zero |
| **page** `(author, d)` | half-wired: `StorefrontAddressPage` exists but the author is hard-pinned (`StorefrontAddressPage.tsx:29-33`) | one prop |
| **listing** `30402:<pubkey>:<d>` | no route-target path; the data accessor exists (`platform/web/products/productQuery.ts:239`) but nothing maps a name to a listing | a new branch |
| **external URL** | no render path at all; the repo has an explicit policy against egress (`storefrontPage.ts:59-69` `isSafeHref`; `AGENTS.md:63`) | a security decision, not a wiring task |

**Cost of refusing external URLs:** you cannot point `/shop` at your Etsy. Pointing at an external URL from
the app's own origin is an open-redirect surface, and the repo already refuses protocol-relative egress on
principle. If you want it, it is a separate increment with its own threat model.

**Unknown target type at read time:** dropped and counted, never fatal — the same posture the storefront
parser already takes for unknown blocks (`sdk/commerce/storefront/storefrontPage.ts:616-625`), and the same
posture version mismatch takes, but reversed (`:595-597` fails closed on the page).

---

### D10 — The default flag: exactly one, and what a second one does

**Lean: the write path refuses a second default; the read path is deterministic regardless.**

Because the table is one replaceable event rewritten wholesale, "refuse" can only be enforced where the write
is composed (the dashboard and the server validator). At the data layer a hostile or buggy writer can always
publish two markers, so the reader also needs a rule: **the first `route-default` tag wins**, and the parser
reports `duplicateDefault` so the dashboard can show a conflict instead of silently picking one.

**Cost:** two admins editing at once still last-write-wins at the event level (the table has no merge). The
loser's routes vanish silently — which `AGENTS.md:111-115` explicitly calls unacceptable. Mitigation is in
the management surface, not the data model: the page re-reads before write, shows a diff, and refuses to save
if the table changed under it.

---

### D11 — Default removal, recoverability, and non-page defaults

- **Removal:** removing the marker does not delete the route. It becomes an ordinary route; `/` falls back to
  the inline composition. Removal is a normal table rewrite.
- **Recoverability:** **not recoverable from the relay.** Kind 30000 is addressable, and NIP-01 says relays
  need store only the latest version — so the previous table is gone unless someone kept it. Lean: the
  dashboard offers **export table (JSON)** and the server keeps the last-known-good table in memory for the
  session as an undo. Anything stronger is a backup story, not a routing story, and I will not pretend
  otherwise.
- **Non-page default:** **refused.** The default must be a `page` target. `/` renders through
  `StorefrontRenderer` (`platform/web/routes/index.tsx:111`); a profile or listing default would need a second
  renderer branch at `/`, and the front page would then have two different shapes depending on data. Refusal
  carries the reason.

---

### D12 — Where the management surface lives

**Lean: a new dashboard page under `/dashboard/app-settings/routes`, visible to admins and editors, using the
existing role gate.**

**Why that path:** `platform/web/app/useRootRedirects.ts:26` gates on the literal prefix
`pathname.startsWith('/dashboard/app-settings')` and redirects non-admins (`:40-41`). Mounting under that
prefix is the cheapest correct gate — but it is **admin-only by construction**, which does not match the
editor tier. So the prefix gate stays for entry, and the editor's narrower power is enforced inside the page
and on the server (D4). Editors see the page and only the paths they are granted; admins see everything.

**Cost:** an editor reaching the page via a direct URL passes the router gate. That is fine only because the
page is not the enforcement point (§6) — the server refuses the write.

---

## 2. The target model

### 2.1 What the registry carries today

| field | carried as-is? | where |
| --- | --- | --- |
| name | **yes** — `tag[1]`, lowercased on read | `sdk/core/curation/vanityRead.ts:31-35` |
| profile target (pubkey) | **yes** — `tag[2]` | same |
| term (`validUntil`) | **yes** — `tag[3]`, decimal unix seconds | same |
| target **type** | **no** — `VanityEntry` is exactly three fields | `sdk/core/curation/vanityRead.ts:7-11` |
| page target (`d`, author) | **no** | same |
| listing coordinate | **no** | same |
| authority / holder | **no** | same |
| default marker | **no** | same |

The order's line "the existing registry maps `name → pubkey` only" is correct as measured. There is no union
to extend — the type has to be introduced.

### 2.2 The entry (wire format)

One event, unchanged coordinate: **kind 30000, `d='vanity-urls'`, author = app key** — the existing
`VANITY_REGISTRY` (`sdk/core/curation/vanityRead.ts:5`). No new event kind, so `AGENTS.md:63-64` is satisfied
by construction.

Three tag families inside it:

```
["vanity", <name>, <pubkey>, <validUntil>]                      legacy, unchanged, profile target
["route", <name>, <type>, <target>, <authority>, <term>, <holder>]
["route-default", <name>]
```

`["vanity", …]` is **not** removed. Old clients keep reading it (their filter is `tag[0]==='vanity'`,
`vanityRead.ts:33`), which is what makes this a bridge rather than a flag day. New readers read `route` tags
first and fall back to `vanity` tags; a `route` tag for a name **replaces** the legacy entry for that name,
and the writer emits both for profile targets so the two never disagree in content.

| element | encoding | rule |
| --- | --- | --- |
| `name` | lowercase | `/^[a-z0-9][a-z0-9_-]{1,28}[a-z0-9]$/`, not in the 37 reserved names, not a real route segment (D7) |
| `type` | `profile` \| `page` \| `listing` | anything else: entry dropped, counted, never fatal (D9) |
| `target` (profile) | 64-hex pubkey | must be valid hex |
| `target` (page) | `<64-hex author>:<d>` | first 64 chars are the author, char 65 must be `:`, remainder is `d` (1–64 chars). Hex never contains `:`, so the split is unambiguous |
| `target` (listing) | `30402:<pubkey>:<d>` | kind prefix is literal `30402` |
| `authority` | `admin` \| `editor` \| `reservation` | tier that may write this name (D4) |
| `term` | decimal unix seconds, or `0` | `0` = permanent. **This is new**: the existing field treats `0` as "expired since 1970" (`vanityRead.ts:63`), but these are `route` tags, read only by the new parser, so permanent is expressible without changing any existing reader |
| `holder` | 64-hex pubkey, or `-` | who the authority belongs to; `-` for admin routes |
| default | separate `["route-default", <name>]` tag | at most one; a second is a reported conflict, first wins on read (D10) |

**Why `0` works here and why that matters:** research 02 §4 measured that `validUntil: 0` is *dead* under the
current readers, and that a 3-element tag is dropped entirely (`:33` requires `tag[3]`). Both are true — of
`vanity` tags. A separate tag family sidesteps the whole problem instead of picking a far-future sentinel that
every reader must then learn to special-case. The legacy tags keep the old semantics exactly.

### 2.3 The in-memory entry

```ts
type RouteTarget =
  | { type: 'profile'; pubkey: string }
  | { type: 'page'; author: string; dTag: string }
  | { type: 'listing'; pubkey: string; dTag: string }

interface RouteEntry {
  name: string
  target: RouteTarget
  authority: 'admin' | 'editor' | 'reservation'
  holder: string | null      // null for admin
  term: number               // 0 = permanent
  isDefault: boolean
  source: 'route' | 'vanity' // which tag family it came from — for drift reporting
}
```

`source` is not decoration: two tag families for one name is a drift site, and the parser must be able to say
which one won.

---

## 3. The resolution rule

### 3.1 `/name`

```
1. entry = table lookup(name)                    # route tags first, then legacy vanity
   a. entry exists AND not lapsed →
        profile  → <StorefrontOrProfilePage profileId={pubkey}/>        ($vanityName.tsx:30-32)
        page     → <StorefrontAddressPage dTag={d} author={author}/>    (needs the prop, D8)
        listing  → new branch, renders the listing
      target fails its own predicate → honest failure state naming the route; DO NOT fall through
   b. entry exists AND lapsed →
        honest failure state ("this address was reserved and has lapsed"), NOT the app-key page
   c. no entry at all →
2. app-key page at d = <segment>                  # today's behaviour, preserved
   <StorefrontAddressPage dTag={name}/>           ($vanityName.tsx:34-41)
3. nothing → the existing deliberate empty state  (StorefrontAddressPage.tsx:58-67)
```

**The one behaviour change to existing addresses, stated:** today a *lapsed* name silently becomes a request
for the app key's page at that `d` (`$vanityName.tsx:41`), so the URL changes meaning without saying so. Under
this rule it says what happened. Unregistered segments keep exactly today's behaviour — that is
`/featured`'s path and it must not change.

**Why no fall-through from a broken route (1a→2):** falling through would render a different page under the
same URL and hide the failure. `AGENTS.md:110-115` is explicit that a direct navigation must state which
constraint failed. A route that exists is a promise; a broken promise is reported, not quietly swapped.

### 3.2 `/`

| state | what `/` does |
| --- | --- |
| default marked, target resolves and renders | renders it through `StorefrontRenderer` with the **target author** as `pubkey` (`index.tsx:111` changes from `APP_PUBKEY` to the target's author) |
| default marked, target lapsed / disabled / zero blocks / unparseable | **inline composition** — the existing fallback at `platform/web/routes/index.tsx:102` (`publishedHome ?? parseStorefrontPage(...)`) |
| no default marked | **inline composition**, same line |
| default marked but dangling (names a table entry that no longer exists) | **inline composition** + an admin-only banner on the dashboard: "the default route points at a name that is not in the table" |
| table unreadable (relay error, bad signature, no app key) | **inline composition** — never a spinner forever, never a blank |

**`/` is never blank and never a 404**, in every row above. That is the floor `order.md:84-85` sets and
`ruling-acl.md:66` repeats for the lapsed-default case; the inline composition is a real page
(`index.tsx:74-113`: a `Search` block, one `ProductRow`, three category links), so this costs nothing to
honour.

**Known pre-existing edge, not fixed by this run:** `/$vanityName` renders `LoadingState` forever when no app
key is configured, because `isLoaded` is only set by `setVanity` and the query is disabled without an app
pubkey (`sdk/config/vanity.ts:116`, `platform/web/config/vanityBinding.ts:123`, `$vanityName.tsx:25-27`). The
new `/` read must not inherit it — it uses a bounded `fetch`, not the store (see §4.2).

---

## 4. The default flag, in full

- **Exactly one.** Encoded as one `["route-default", name]` tag in the same event.
- **A second one:** the write path refuses (dashboard and server validator); the reader takes the **first**
  and reports `duplicateDefault`. Deterministic in both directions — no last-wins surprise.
- **Removal:** the marker is removed by rewriting the table; the route survives as an ordinary route; `/`
  falls back to the inline composition immediately.
- **Recoverability:** not from the relay (kind 30000 keeps only the latest version per NIP-01). Recoverable
  from the dashboard's JSON export, or from the server's last-known-good table during the same session. Stated
  as a limit, not papered over.
- **Non-page target:** refused, with a stated reason (D11).
- **A default held by a reservation that lapses:** falls back to the inline composition, and the holder sees
  the lapse warning before it happens (D5). This is `ruling-acl.md:65-66`'s case exactly, and it is the one
  place where two rules meet — the lapse rule and the default rule — so it is asserted directly (§8, N5).
- **What replaces today's hardwiring:** `platform/web/routes/index.tsx:57`
  (`useStorefrontAddressPage(APP_PUBKEY, 'home')`) stops being a constant and becomes "the default route,
  resolved". Note `APP_PUBKEY` there is a **hardcoded 64-hex literal at `index.tsx:48`**, not read from
  `/api/config` — a second, disagreeing source of app identity (`StorefrontAddressPage.tsx:31` reads
  `config?.appPublicKey`). The route table keys on "the app", so the read path must pick one; lean: read
  `/api/config`, keep the literal only as the pre-config fallback, and note the drift.

---

## 5. The target model's open consequence: a route named `home` is not a new name

Measured, and worth stating because it changes what "add a route" means: **`/home` already renders something
today** — not a 404, not an empty state, but the app key's kind-30024 page at `d='home'`
(`$vanityName.tsx:34-41` → `StorefrontAddressPage.tsx:30-33`). Creating a route named `home` **changes what
`/home` renders**; it does not merely add a name. The same is true of any name an admin has already published
an app-key page under.

This is why `route` tags take precedence over the address fallback (§3.1 step 1 before step 2), and why the
management page must warn on create: "an address page is already published at this name; the route will take
precedence."

---

## 6. Trust and permissions

### 6.1 The measured mechanism

- The app key is a **server-side secret**. `EventSigner` is constructed from `APP_PRIVATE_KEY`
  (`platform/server/EventSigner.ts:10-14`), created once at `platform/server/EventHandler.ts:72`. It never
  reaches the browser. **Read from source.**
- A client write goes over the WebSocket proxy: the server verifies the submitted event's own signature
  (`platform/server/websocket.ts:30-33`), validates it, **re-signs it as the app key**
  (`EventHandler.ts:238` → `EventSigner.ts:17-25`), and publishes it (`websocket.ts:44-46`). **Read from
  source.**
- The registry reader is pinned to the app key as author (`sdk/core/curation/vanityRead.ts:24`). **Read from
  source.**

So: **the client never signs a route. It asks the server to sign one.** That is the whole trust story, and it
is why the server is the enforcement point.

### 6.2 The finding that makes this section non-trivial

**The proxy is not an enforcement point today. It is a signing service for admins.** `EventValidator` decides
only *who is asking* — `validateGeneralEvent` checks `adminManager.isAdmin(event.pubkey)` and nothing else
(`platform/server/EventValidator.ts:85-93`). It never inspects tags or content. `EventSigner.signEvent`
copies the client's `created_at` and `tags` verbatim and only swaps the pubkey
(`platform/server/EventSigner.ts:17-25`).

Two consequences a reviewer will find immediately:

1. Any admin can write **any** tag payload into the registry through this path today, including names that
   break the grammar and `validUntil` values of their choosing — the name grammar lives in the *purchase*
   validator (`platform/server/VanityManager.ts:182-186`, called from `validateRegistration` `:83-95`), not in
   the reader or the proxy.
2. Because kind 30000 is replaceable and the winner is the newest `created_at`, a client that controls
   `created_at` can publish a table dated in the future and win every subsequent replace until the clock
   catches up.

Therefore this proposal **adds a content validator to the server** (`validateRouteTableEvent`) as increment 2,
before any management UI exists. Without it, the "server enforces" claim would be false: the server would be
notarising whatever the admin's browser computed.

### 6.3 What only the server may decide

1. Whether the requester holds the tier they claim — from the server's own admin/editor sets
   (`platform/server/AdminManager.ts:26-39`, `EditorManager.ts:26-39`), never from the submitted event.
2. Whether this requester may write **this name** — the per-path grant check, which does not exist in any form
   today (measured: no `editorGrant|grantedPath|allowedPaths` anywhere).
3. Whether the name is valid, reserved, or colliding with a real route.
4. Whether the **target** is well-formed **and admissible** — not just "is this a 64-hex string" but "is this
   target type allowed, and is this author allowed to be the target of this name".
5. That there is **at most one default**, and which one.
6. The **term**: computed from the receipt, never accepted from the client. The existing purchase path already
   does exactly this — the client sends sats and a signed request, the server derives `validUntil`
   (`platform/server/ZapPurchaseManager.ts:187-202`).
7. `created_at`, clamped to now. Not the client's.
8. The final tag list, rebuilt server-side from the parsed table — not passed through.

### 6.4 What the client may decide

- What to display, which fields to show, optimistic UI, sorting, filtering.
- Which changes to *propose*.
- Nothing that survives a server refusal. Client-side gating (`useRootRedirects.ts:26-41`, the nav filter) is
  **user experience, not enforcement** — an editor who opens devtools and posts a forbidden event gets a
  refusal from the server, not a success.

### 6.5 What a compromised client can still do

Stated plainly, because "the server is the enforcement point" is not "the client is harmless":

- **Within its own tier, it can choose any admissible target for a name it holds.** An editor granted `sale`
  can point `sale` at any page they author, including a page that says something the operator would not have
  chosen. The grant is authority over a path, not editorial control of its content.
- **It can attempt anything and be refused** — refusals are cheap and visible; that is the design.
- **It cannot mint a reservation** without a receipt the server verifies independently.
- **It cannot escalate a tier, grant itself a path, create a second default, choose its own term, or
  backdate/forward-date the table** — all six are server decisions (§6.3).
- **It can still lie in its own UI**, showing itself a success the server refused. The mitigation is that the
  page re-reads the table after write and shows the server's answer, not its own optimism.

**The residual trust assumption, stated so it can be argued with:** the server trusts its own admin list. That
list is itself an event (`d='admins'`, kind 30000, app-key authored on write —
`EventHandler.ts:236-238`, `NDKService.ts:110-117`), seeded at boot from the kind-31990 `ownerPk`
(`NDKService.ts:41-68`) with an empty config default (`startup.ts:71`). If an attacker can rewrite the admin
list, they can rewrite anything. That is out of this run's scope and is not made worse by it.

---

## 7. Requirement status, graded

Carried over from research 02 without upgrading our choices into obligations. Convention: **SPECIFIED** = an
accepted document or your verbatim ruling prints it; **SUGGESTED** = a *proposed* document or a code comment
describes it, not binding; **OUR CHOICE** = nothing anywhere states it.

Note on why so much is SUGGESTED: **both ADRs bearing on this area are `Proposed`, not `Accepted`** —
`docs/adr/ADR-0006-cms-and-nostr-native-page-builder.md:5` and
`docs/adr/ADR-019-unified-storefront-identity-and-page-builder.md:5` (measured: of 21 ADRs, 7 Accepted).

| # | requirement | grade | evidence |
| --- | --- | --- | --- |
| R1 | one route table; extend the existing registry, no parallel one | **SPECIFIED** | `order.md:50-51` "the route mechanism **already exists**. This run extends it; it does not invent a parallel one." |
| R2 | the table is one addressable event; a write rewrites it whole | **SPECIFIED** by NIP-01, implemented | `vanityRead.ts:38-42`; measured: a newer event omitting `home` stops `home` resolving |
| R3 | name lowercased, `/^[a-z0-9][a-z0-9_-]{1,28}[a-z0-9]$/` | **SPECIFIED by code**, purchase path only | `VanityManager.ts:182-186`; `vanityRead.ts:34` |
| R4 | reserved names cannot be registered | **SPECIFIED** | `VanityManager.ts:6-44`; 37 names; `home` not among them (measured) |
| R5 | an entry carries a target **type** | **SUGGESTED** | `ADR-0006:214`: "the registry event should be extended (or a companion event introduced) to record the **routing target type**" — but the ADR is Proposed and the kind is literally `<TBD>` |
| R6 | which target types exist | **OUR CHOICE** | no document enumerates them; `order.md:63-64` asks the question |
| R7 | unknown target type fails defined, without blanking the site | **OUR CHOICE** for the rule; **SPECIFIED** as a constraint | `order.md:65-66` asks; `order.md:84-85` requires non-blanking |
| R8 | a route can be marked the site default | **SPECIFIED** | `order.md:67-69` (your words); `ruling-acl.md:15-16` |
| R9 | exactly one default; a second refuses or moves | **OUR CHOICE** | `order.md:70-71` explicitly refuses to decide |
| R10 | what `/` does when the default is removed / off / unresolvable | **SPECIFIED as constraint, OUR CHOICE as answer** | `order.md:71-74`; floor at `order.md:84-85`; `ruling-acl.md:66` |
| R11 | may the default point at a non-page target | **OUR CHOICE** | `order.md:74` poses it |
| R12 | the default flag replaces `useStorefrontAddressPage(APP_PUBKEY,'home')` | **SPECIFIED** | `order.md:78-79`; line `index.tsx:57` |
| R13 | admin: full control, may reassign anything, authors the default | **SPECIFIED** | `ruling-acl.md:6-9`, `:13-16`; code backs the role (`curationRead.ts:148-151`) and the write (`EventValidator.ts:85-93`), but **not** the reassign power — no holder field exists |
| R14 | editor: create/publish to new places **and** per-path grants | **SPECIFIED as grant, mechanism OUR CHOICE** | `ruling-acl.md:7-8`; the editor's entire server write authority is the blacklist (`EventValidator.ts:74-83`); no per-path schema exists (measured negative search) |
| R15 | premium: reserve a path for themselves, time-bounded by payment | **SPECIFIED as tier**; "or domain" **OUR CHOICE, flagged** | `ruling-acl.md:8-9`, `:22-24`, `:52-53`; machinery exists — `VanityManager.ts:47-55`, `:83-95` |
| R16 | a named route resolves to its target; the home becomes a route | **SPECIFIED** | `order.md:75-79`; measured: `/` never reads the registry today (only `:109`, `:132` mention vanity-adjacent calls) |
| R17 | negative paths must not blank the site | **SPECIFIED** | `order.md:84-85`; five cases `ruling-acl.md:57-66` |
| R18 | the management surface mounts somewhere, gated to admins/editors | **SPECIFIED as requirement, OUR CHOICE as to where** | `order.md:80-83` |
| R19 | expiry = reservation term; admin/editor routes permanent | **SPECIFIED** | `ruling-acl.md:28-31` — this closed the expiry question; research 02 §4 enumerates no options because the ruling superseded the instruction |
| R20 | the five ACL negative paths (refusals are visible states) | **SPECIFIED** | `ruling-acl.md:57-66` |

**Not an obligation, and I will not present it as one:** the specific tag encoding in §2.2, the `0`-means-permanent
sentinel, the 14-day grace window, and the `route`-before-`vanity` precedence are all **OUR CHOICE**. They are
shaped by the measured facts, but no document required them.

---

## 8. The management surface

**Where:** `/dashboard/app-settings/routes` — new file
`platform/web/routes/_dashboard-layout/dashboard/app-settings/routes.tsx`.

**How it is gated:**
- router level: `useRootRedirects.ts:26,40-41` sends non-admins away from anything under
  `/dashboard/app-settings`. Editors would be redirected too, so this run **widens that predicate** to
  "admin or editor" for this one path (a one-line change, and the guard itself must then still refuse editors
  at the *route* level for names they do not hold).
- nav: add one item to the `APP SETTINGS` section (`ui/nav/model.ts:163-177`), `adminOnly` today — the entry
  needs an editor-visible flag, and `ui/nav/model.test.ts:22-60`'s expectation table must change in the same
  commit or the suite fails (that is the guard working).
- **the real gate is the server** (§6.3). The page-level gate is convenience.

**Add / remove / modify map onto:**

| action | mechanism | notes |
| --- | --- | --- |
| read the table | `EventReadContext.fetch` — one coordinate (app key, 30000, `vanity-urls`), single-entity read, **with** the one-line justification comment `sdk/AGENTS.md:48-55` requires | `fetch` is correct here; the *dashboard list* view is list-shaped and uses `stream` |
| add / modify / remove | compose the **full** new tag list, submit as one kind-30000 event over the existing WS proxy (`platform/web/app-settings/appSettingsSubmit.ts:22-46`) | the proxy re-signs it as the app key; no new write path, no new event kind |
| set default | same write, with the `route-default` tag moved | the UI must refuse to emit two markers |
| reservation | the existing purchase flow (`vanity-url.tsx:184-187` → `/api/zapPurchase`), which gains a `route` tag writer alongside its `vanity` writer | server-side, on receipt (§6.3 item 6) |

**No third reader of the temporary vanity store.** `platform/web/config/vanityStore.ts:12-14` marks itself
TEMPORARY and to be deleted; the management page reads through `useVanitySettings`
(`platform/web/config/vanityBinding.ts:95-128`) or a new query, never through `vanityStore`.

**Boundary rules the code must respect:** the table's rows and forms are `ui/` views taking props
(`ui/AGENTS.md:20-41`, `:120` — no fetching, no stores); resolution, validation and saving stay in
`platform/web/`; route modules are composition only (`platform/web/routes/AGENTS.md:26-32`, enforced by
`platform/web/app/routeComposition.test.ts:73-104`), so no route module imports another.

---

## 9. Acceptance plan

### 9.1 The five negative paths from the ruling, and the five from the order

| # | path | what it must prove | assertable today? |
| --- | --- | --- | --- |
| **N1** | editor touches a path not in their grant | refused, and the refusal is a **rendered state** | **no** — nothing decides it; needs `SettingsAccessDenied` (`ui/settings/operator-settings-views.tsx:59`, already used at `team.tsx:211`) wired to a new predicate. New: `sdk/core/curation/routeAcl.test.ts`, `managedRoutes.test.tsx` |
| **N2** | premium requests a path held by an admin or editor route | refused, **reason names the tier** | **partly** — the owner-vs-owner check exists (`VanityManager.ts:86-94`) but is tier-blind, and has **no test** today. Extend `sdk/core/curation/curationRead.test.ts:265-276`; new `platform/server/VanityManager.test.ts` |
| **N3** | reservation used after `validUntil` | stops resolving **and** the holder was warned before | **half** — lapse is decided (`sdk/config/vanity.ts:140-142`, `curationRead.test.ts:273` pins `'old'`); the warning is display-only (`vanity-url.tsx:113-150`), no notification. New e2e case |
| **N4** | admin removes another tier's route | takes effect, holder informed | **no** — no removal path exists at all. New: `routeAcl.test.ts`, `managedRoutes.test.tsx`, e2e |
| **N5** | default route held by a lapsed reservation | `/` does not blank; it falls back | **no** — not representable today (the default is a constant). New: `platform/web/routes/homeDefault.test.tsx` (there is **no** test for `routes/index.tsx` today), plus `storefrontQuery.test.ts:256-290` for the predicate |
| **N6** | route names an unparseable document | no blank | **yes, at the address page** — `StorefrontAddressPage.test.tsx:117-123` asserts `content: 'not json'` |
| **N7** | route names a switched-off page | no blank | **yes** — `StorefrontAddressPage.test.tsx:108-115`; `storefrontQuery.test.ts:285` |
| **N8** | route names a zero-block page | no blank | **yes** — `storefrontQuery.test.ts:271,289` |
| **N9** | unknown target type | dropped and counted, site intact | **no** — new file, mirrors `storefrontPage.ts:560-568` |
| **N10** | a second default | refused at write, deterministic at read | **no** — new |

**Caveat on N6–N8:** they are assertable today, but today's behaviour is *too* forgiving — absent, lapsed,
off, empty and unparseable all render one indistinguishable sentence (`StorefrontAddressPage.tsx:58-67`, one
predicate `storefrontQuery.ts:150-154`). Accepting those as-is would ratify the ambiguity on a *named* route,
where a visitor has a name to complain about. The named-route failure state (D9 / §3.1) exists to fix that; the
existing tests stay valid for unregistered segments.

### 9.2 Existing files that must change

`sdk/core/curation/curationRead.test.ts:265-276` · `sdk/core/curation/vanityReadWorkflows.test.ts` ·
`platform/web/storefront/storefrontQuery.test.ts:256-290` · `platform/web/storefront/StorefrontAddressPage.test.tsx` ·
`platform/web/routes/sellerRoute.test.tsx:40-74` (precedence) · `platform/web/app/routeComposition.test.ts` ·
`ui/nav/model.test.ts:22-60` · the three boundary tests · `e2e/tests/storefront-page-builder.spec.ts`,
`navigation.spec.ts:6-9`, `app-settings.spec.ts:17-30,107-197`.

### 9.3 New files

`sdk/core/curation/routeTable.test.ts` (or `routeAcl.test.ts`) · `platform/web/routes/homeDefault.test.tsx` ·
`platform/web/.../managedRoutes.test.tsx` · `platform/server/VanityManager.test.ts` ·
`e2e/tests/managed-routes.spec.ts` (required by `AGENTS.md:172-189`, video on).

### 9.4 Gates

| gate | command | baseline |
| --- | --- | --- |
| typecheck | `NODE_OPTIONS=--max-old-space-size=12288 bunx tsc --noEmit \| grep -c "error TS"` | **205** on a clean tree — measured by the orchestrator. Compare the **sorted error list**, not just the count |
| unit (focused) | `bun test --isolate sdk/config/routeTable.test.ts` and the affected set | counts recorded per step; do not carry a number from another checkout |
| full unit | `bun run test:unit` | includes `--isolate` already |
| browse suite | `bun test --isolate platform/web/browse/` | **168 pass / 0 fail**. Unisolated: **153 pass / 15 fail**, all in `BrowseIndexHost` and `useBrowseIndexFeed` — pre-existing cross-file state bleed. Quote **both**; neither number is this run's regression |
| e2e | `bun run test:e2e -- e2e/tests/managed-routes.spec.ts` | needs a local stack; specified, not run in this run |

**Prerequisite, measured and easy to trip over:** a fresh worktree has no `node_modules`; `bunx` then fetches
`typescript@latest` and reports **15215** errors; symlinking the main checkout's `node_modules` reports **334**
because `@cashu/cashu-ts`'s `.d.ts` relative imports break through the symlink. Run
`bun install --frozen-lockfile` first. `node_modules/.bin/tsc` is blocked by a command guard — use `bunx`.

---

## 10. Build order beyond increment 1

1. **Server content validator** for the route table (`validateRouteTableEvent`), admin-only at first: rebuild
   tags server-side, clamp `created_at`, enforce one default and the name grammar. *The enforcement point must
   exist before anything can use it.* Note the existing registry ingest clears and rebuilds its in-memory
   table from the event's `vanity` tags and drops anything already expired
   (`platform/server/ZapPurchaseManager.ts:91-107`, `:100-104`) — so the writer's legacy mirror (increment 1,
   rule 19) is what keeps server state coherent during the transition.
2. **Reader**: `routeTable` parse/merge lands in the SDK (increment 1) and the server validator reuses it —
   one parser, not two.
3. **`/` reads the table**: the default route replaces `index.tsx:57`; the inline fallback at `:102` is kept
   and asserted (`homeDefault.test.tsx`).
4. **`StorefrontAddressPage` gains an `author` prop**, and `$vanityName` renders typed targets (page → address
   host, profile → unchanged, listing → new branch). Unregistered segments keep today's behaviour.
5. **Management page** under `app-settings/routes`, admin-only, add/remove/modify + the default marker + export.
6. **Editor grants**: per-path grant in the table, the editor write branch in the validator, the visible refusal
   (`SettingsAccessDenied`), and the nav/redirect widening.
7. **Reservations** through the existing purchase flow: `route` tags with `authority=reservation`, term from the
   receipt, the 14-day grace, the warnings.
8. **Producer surfaces**: `StorefrontBuilder`'s live href and the vanity page's printed URL read the table
   (`StorefrontBuilder.tsx:97-101`, `vanity-url.tsx:234-244`).
9. **Docs and e2e**: correct `docs/vanity-urls.md` (it documents a 404 and an endpoint that do not exist — see
   §11), add `e2e/tests/managed-routes.spec.ts`, and record the decision in an ADR.

Each step ships behind the previous one and is independently revertible. Step 1 has no user-visible effect and
is therefore the safest possible starting point after the data model.

---

## 11. Where the research contradicts the order, or itself

Stated here rather than smoothed over, because the order asks for it (`order.md:7-10`).

**C1 — The typecheck baseline.** Research 03 measured **522** `error TS` lines and reported it as confirming
the order "exactly" (`03:524-525`, evidence `03:575-577`). It is **205** on a clean tree; 522 is an artifact of
the dirty main checkout, which typechecks untracked scratch files and stale packages. The order now carries
the correction at `order.md:122-132`. Research 01 got this right by declining to answer — it lists the baseline
as **UNVERIFIED** (`01:268`). Use 205.

**C2 — The reserved-name count.** Research 01 says **37** (`01:53`); research 02 says **39** and its evidence
prints `39` (`02:178-181`, evidence `02:460`). Measured now: **37 quoted literals in each of the two lists, and
the sets are identical**. The 39 is a *line* count — `VanityManager.ts:6-44` is 39 lines including
`new Set([` and `])`. Use 37.

**C3 — Where the read-seam doctrine lives.** `order.md:57` says root `AGENTS.md` holds "the read-seam and
boundary doctrine". It does not — measured, `grep -i 'read.seam\|stream-first\|boundary' AGENTS.md` returns
nothing. The doctrine is in `sdk/AGENTS.md:38-61` and `notes/ADR-READ-SEAM-STREAMS.md`, `ui/AGENTS.md:18-41`,
and `platform/web/routes/AGENTS.md:26-32` (`03:503-514`). An executor reading only the root file misses both
rules.

**C4 — "Nothing in the UI can author the home".** True of the kind-30024 page document; false of the kind-30000
registry, which **is** UI-writable by an admin today through the WS re-sign path (`websocket.ts:30-46` →
`EventHandler.ts:238`). The order's conclusion survives; its sentence is too wide (`02:483-489`).

**C5 — "`/` renders the app key's `d='home'` page".** Correct but incomplete in a way that matters: **`/` never
reads the registry at all** (`02:491-494`). The default flag is not a key swap; there is no lookup at `/` to
change.

**C6 — The tree's own doc is wrong about resolution.** `docs/vanity-urls.md:88-93` promises a 404 with a link
home; the code falls through to an app-key page address (`$vanityName.tsx:41`). The same file documents
`POST /api/vanity/invoice` (`:81`, `:220`), which does not exist — the live endpoint is `/api/zapPurchase`
(`platform/server/http/zapPurchase.ts:14`). Anything citing that file inherits two false statements.

**C7 — "extends the existing mechanism" understates the ground.** The single-segment route already resolves
**any** segment to an app-key page address (`$vanityName.tsx:41`), so a route table and the page-address
namespace are **the same URL space**, and `home` and `featured` are not reserved (`03:516-522`). A route named
`home` changes what `/home` renders today (§5).

**C8 — ADR-0006 is stale on the premise that motivates the alternative design.** It says the registry "is
currently server-side only" (`ADR-0006:211`); it is published to relays (`ZapPurchaseManager.ts:392-416`) and
read from them (`vanityRead.ts:96`). The ADR's argument for a separately signed proof event rests on a premise
that is no longer true — worth knowing before choosing D1's alternative.

**C9 — "maps onto the existing app-settings and curation write paths".** True for the admin/editor lists; false
for the vanity registry, which has no curation-list entry and no SDK publisher at all
(`sdk/core/curation/curationPublish.ts` contains zero `vanity` references — measured). The mapping is new, not
reused (`01:263`).

**C10 — "how it is gated to admins/editors" presumes a role gate to reuse.** No vanity surface is role-gated
at all; the one that exists is per-user and paid (`vanity-url.tsx:201-208`), and the server validator gives
editors almost no write authority (`EventValidator.ts:74-93`). The permission model is an open decision, not
an existing convention (`01:264`).

**C11 — Research 02's own §6 assumes three records can coexist on one name** and asks which wins at read time.
They cannot: the table is one replaceable event and this proposal makes occupancy single. Precedence is
therefore a write-time question (D4). This is the one place where this proposal deliberately departs from a
research suggestion rather than implementing it.

**C12 — An install drift, not a code fact.** Research 03's focused suite reports **45 pass / 2 fail**, and the
failures are `Cannot find package 'applesauce-indexeddb'` — declared at `package.json:71`, absent from
`node_modules` (`03:22-33`). Any gate run must `bun install` first or it reports a pre-existing failure as a
regression. No such count is quoted as a baseline in this proposal.

**C13 — The four pinned facts all hold.** No drift at `2326938b3` or at `1ed3d676a`:
`vanityRead.ts:5`, `vanityRead.ts:7-11`, `index.tsx:57`, `storefrontPublish.ts:60`. Measured by me and by all
three axes.

**C14 — The ADR that describes this feature contemplates sub-path spaces, and this proposal does not build
them.** `ADR-0006:209` describes a seller owning "the entire sub-path space underneath" a name —
`/alice-store/featured`, `/alice-store/clearance`. A name here is **one** segment
(`platform/web/routeTree.gen.ts:74-76`), so a two-segment URL under a reserved name matches no route and falls
to the router's not-found handling (there is no `notFoundComponent` — measured). Sub-paths are a coherent
extension of this model (the name is the namespace) but they are a separate increment with their own
resolution rule, and nothing in the order asks for them. Flagged because the ADR will be read as saying they
are in scope.

---

## 12. What this proposal does not do

- It does not deploy anything, restart a live unit, or touch another session's trees.
- It does not decide the auctions work, the auction block, or the intro animation.
- It does not decide DNS or custom domains (D6).
- It does not build sub-path spaces under a name (`/alice-store/featured`) even though `ADR-0006:209` describes
  them — a name here is one URL segment (see §11, C14).
- It does not fix the `isLoaded`-forever edge (§3.2) — it routes around it and says so.
- It does not resolve the admin-list trust recursion (§6.5) — it names it.
- It does not make a reservation independently verifiable (D1) — it trades that away deliberately, and says
  what is lost.

**This is not a stop.** The trust question is answerable without a ruling: the app key signs, the server
checks the admin/editor sets it already keeps (`platform/server/AdminManager.ts:26-39`,
`EditorManager.ts:26-39`), and the reader is already pinned to the app key. What would force a stop is a
requirement that a reservation be *independently verifiable* **and** *self-service* **and** *enforceable by
the app* — those three conflict at the signing step, and D1 is where the conflict lands. That is why D1 is
escalated with its cost stated rather than settled quietly: if you want all three, the shape changes, not the
details.

---

## Appendix — evidence discipline

Every code claim above carries `file:line`; every number carries its command. Labels follow the research:
**measured** (a command produced it), **read from source** (the line states it), **judged** (inference),
**UNVERIFIED** (not established). Claims in §6 marked "read from source" were re-read by me at
`1ed3d676a` — `websocket.ts:30-46`, `EventSigner.ts:10-25`, `EventValidator.ts:19-95`,
`EventHandler.ts:205-245`. The three lines I quote in §3 and §4 (`index.tsx:57`, `index.tsx:102`,
`StorefrontAddressPage.tsx:29-33`, `$vanityName.tsx:30-41`) were re-read at the same commit.

The public key literal at `platform/web/routes/index.tsx:48` is deliberately not reproduced here; it is a
public value, but it is key-shaped and the secret scanner cannot tell the difference.