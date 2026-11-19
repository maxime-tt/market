# Proposal v2 — many pages, many paths, one resolution rule

**Run:** 2026-11-13-admin-routes · **Revision of:** `proposal.md` (v1, kept on disk unchanged) · **Binding new
requirement:** `ruling-d8-multipage-and-lists.md` · **Base:** `master` @ `1ed3d676a`; increment 1 is built on
`d7s2/route-table` @ `1cc31cb37` (`git log --oneline -1 d7s2/route-table`), which this document amends.

**What this is.** v1 answered "who authors the home" and designed a route *table* that owns every name. The
owner's ruling says that was the wrong question: pages are plural, paths are plural, and a general path points
at the *newest* page of its kind. This document keeps v1's trust answers (D1–D3, accepted), discards the part
of v1 that cannot scale, and rebuilds the target and resolution model on top of what the code actually is.

**One sentence.** A page is already its own signed, addressable event (kind 30024, one per `(author, d)`); the
only thing making it "one page per author" is a single constant in the publish path. Pages therefore *are* the
storage, `d` *is* the path, and the registry stops being a route table and becomes a small, app-key-signed
**claim** layer over contested names — plus the default marker.

---

## 1. The four measurements, before any design

Everything in §3 follows from these. Labels: **M** = measured (a command produced it), **S** = read from
source (the line states it), **J** = judged, **U** = UNVERIFIED.

### M1 — Is kind 30024 addressable? **Yes. This is the load-bearing fact.**

| claim | evidence | label |
| --- | --- | --- |
| the page kind is 30024 | `sdk/commerce/storefront/storefrontPage.ts:31` — `export const STOREFRONT_PAGE_KIND = 30024` | S |
| 30024 is in the addressable range | `sdk/core/event-store/mergeRules.ts:9-11` — `kind >= 30000 && kind < 40000`; `30024` satisfies it (arithmetic) | S/M |
| an addressable event's identity is `(kind, pubkey, d)` | `mergeRules.ts:19` — `` `${kind}:${event.pubkey}:${getDTag(event)}` `` | S |
| **the publish path hardcodes one `d` for everybody** | `platform/web/storefront/storefrontPublish.ts:60` — `const tags: string[][] = [['d', STOREFRONT_PAGE_D_TAG]]`; `storefrontPage.ts:34` — `'storefront-page'` | S |
| the read path defaults to the same single `d` | `platform/web/storefront/storefrontQuery.ts:75` — `fetchStorefrontPage(pubkey, dTag = STOREFRONT_PAGE_D_TAG)` | S |
| the file's own doctrine says "one per pubkey" | `storefrontPage.ts:6-8` — "kind 30024, `d=storefront-page`, one per pubkey" | S |
| the read is `(author, kind, #d)` and re-checks all three | `storefrontQuery.ts:83-94` | S |
| every path segment is already an arbitrary `d` on *some* author | `platform/web/routes/$vanityName.tsx:41` → `StorefrontAddressPage dTag={vanityName}`; the component's own comment at `StorefrontAddressPage.tsx:14-20` says `/featured` and `/featured-2026-11-03` take "this identical path" | S |

**Verdict.** The protocol is addressable; **"one page per author" is 149 characters of writer code**, not a
storage property. `(author, d)` has no count ceiling — NIP-01 keeps the newest event per coordinate and nothing
else, so one author may hold one event per `d` for any number of `d`.

**What that implies, precisely:**

- **R1 (hundreds per author)** is *natural*: a parameter on the publish call, not a re-architecture. No new
  kind, no new storage, no server involvement.
- **R2 (unique path per page)** is *free*: `d` is the path segment, resolved by an exact `#d` relay filter. The
  address space is already `path → (author, d)`; v2 only stops pinning `author` to the app key.
- **R3 (newest in a series) is NOT free**, and this is why: relays match `#d` **exactly**. There is no prefix
  filter, so `/featured` cannot ask "give me the newest `d` starting with `featured-`". A series needs its own
  key. §3.4 decides which.
- **R4** becomes possible at all only because of this: if pages were a single blob, `/` would be privileged by
  construction.

### M2 — Today's list mechanism, and whether a `list` reference is an addition

| claim | evidence | label |
| --- | --- | --- |
| blacklist is the NIP-51 mute list, kind **10000**, no `d` | `sdk/core/curation/curationLists.ts:5` — `MUTE_LIST_KIND = 10000`; `:57-67` builds `p`/`a` tags with no header | S |
| featured lists are four **addressable** kinds with fixed `d` | `curationLists.ts:7-14` — `featuredProducts 30405/featured_products`, `featuredCollections 30003`, `featuredAuctions 30409`, `featuredUsers 30000/featured_users` | S |
| the item encoding is repeated `a` (coordinates) or `p` (pubkeys) | `curationLists.ts:52`; `readCurationListItems` `:41-44` reads every tag whose name is `itemTag` | S |
| every list is **app-key authored** | `curationRead.ts:65-68` — `buildCurationListFilter` returns `authors: [appPubkey]` | S |
| reading is "newest event for that `(kind, d)`" | `curationRead.ts:193-201` | S |
| a featured list's items are validated as full coordinates | `curationLists.ts:28-38` — `isCoordinateOfKind` parses `kind:pubkey:d` | S |

**Judgement.** The *event shape* already generalises perfectly: `d` = the list's name, repeated `a` tags = its
members. What pins lists to the app is three lines, not a design: the `authors: [appPubkey]` filter
(`curationRead.ts:67`), the fixed `dTag`s (`curationLists.ts:7-14`), and one kind per list type. Generalising to
all users touches exactly those. Two structural notes for the follow-up:

1. the blacklist (kind 10000) is **not** the model to generalise — it has no `d`, so it cannot be named per
   user; the *featured* lists are the generalisable shape;
2. four different kinds for four list types means a user's ad-hoc list needs *one* kind, not four.

**Therefore a `list` reference is an addition, not a re-architecture** — and M4 shows the read path for one
already exists in production.

### M3 — The registry's real ceiling, and what the write path does

| claim | evidence | label |
| --- | --- | --- |
| one replaceable event, `d='vanity-urls'`, app-key authored | `sdk/core/curation/vanityRead.ts:5`, `:21-28` (`authors: [appPubkey]`) | S |
| the reader takes the newest event and parses the **whole** tag list | `vanityRead.ts:38-42` | S |
| the server rebuilds its in-memory table from that event, **dropping already-expired rows** | `platform/server/ZapPurchaseManager.ts:92-108` (`registry.clear()` at `:97`, `if (entry.validUntil >= now)` at `:101`) | S |
| a purchase mutates the in-memory map, then republishes **the entire table** | `:190-202` → `publishRegistry()` | S |
| the republish serialises every entry and signs as the app key | `:399-413` — `tags.push(...this.buildRegistryTags(this.registry))` at `:405`, `this.eventSigner.signEvent(...)` at `:409` | S |

**Concurrency, today.** There is exactly **one writer**: the server process, a single `Map`, mutated on a
single-threaded event loop (`ZapPurchaseManager.ts:199` then `:202`). Two simultaneous purchases are serialised
by the runtime, each republishing from the same in-memory state. **No lost update exists in the current code.**
(S, and the strongest form of the claim the code supports without a live relay to race.)

**Concurrency under v1's plan.** v1 moved composition into the browser: the dashboard composes the full tag
list and the WS proxy re-signs it verbatim (`platform/server/EventSigner.ts:17-25` copies `tags` unchanged;
`EventHandler.ts:236-238`). That *introduces* the lost update v1's own D10 then had to mitigate ("the loser's
routes vanish silently"). So the collision the ruling calls "certain by scale" is certain **by design choice**,
not by the existing data model.

**Size ceiling, counted.** One legacy entry serialises to **112 bytes**, one v1 `route` entry to **141 bytes**
(`python3 -c 'import json;print(len(json.dumps(["route","featured-13-11-2026","a"*64+":featured-13-11-2026","admin","0","-"],separators=(",",":"))))'`).
In a list the marginal cost is **142 B** per entry (the joining comma); a list of `n` entries serialises to
`142n + 1` bytes for `route` and `113n + 1` for `vanity`, both measured with `json.dumps([...n...],
separators=(',',':'))`:

| entries | legacy (113 B marginal) | v1 route (142 B marginal) |
| --- | --- | --- |
| 100 | 11,301 B | 14,201 B |
| 300 | 33,901 B | 42,601 B |
| 500 | 56,501 B | 71,001 B |
| 1,000 | 113,001 B | 142,001 B |

A 64 KB per-event ceiling — a common relay default, **not configured anywhere in this repo**
(`grep -rn "maxEventSize\|max_event_size" platform infra docs` → no hits; U for this deployment) — is crossed at
**461 v1 entries** (measured: 461 entries = 65,483 B; 462 = 65,625 B). At the 1,000 the ruling's "hundreds per
author" implies for two admins, the table is 142 KB of tag before any content.

**And the write amplification is total:** every single publish republishes 100% of entries
(`ZapPurchaseManager.ts:405`). At 500 pages, one page edit pushes 71 KB and rewrites 499 untouched rows.

**D4's verdict, stated without hedging.** "One name, one entry" is a true property of a single-writer,
single-event table. It **cannot** extend to pages:
(a) it hits a byte ceiling at a few hundred rows; (b) each publisher must rewrite everyone's rows, and the only
writer who can sign that rewrite is the app key, which makes every admin's page an app-key artifact — the exact
thing the ruling forbids; (c) the ingest is *lossy by design* (`:100-104` drops expired rows on rebuild), so the
event is not a durable record either.

**R1 wins. D4 is scoped down, not deleted:** it still holds, exactly and usefully, over the small set of names
that are genuinely contested (paid reservations, editor grants, admin assignments, series names, the default).
Those number in the tens, not the hundreds. §4 D17 restates it.

### M4 — A page's own author-pinning, and the correction v1 got wrong

| claim | evidence | label |
| --- | --- | --- |
| the address page pins the author to the app key and takes **only** a `dTag` prop | `platform/web/storefront/StorefrontAddressPage.tsx:29-33` — `const author = config?.appPublicKey ?? ''` | S |
| every block slot takes its pubkey from the **page event's author**, never the document | `StorefrontBlockSlots.tsx:35-42` (comment), `:49`, `:66`, `:112` — `useStorefrontContext()` | S |
| `ProductGrid` / `FeaturedProduct` read `authors: [pubkey]` | `:50`, `:67` → `productsByPubkeyQueryOptions(pubkey)`; filter at `platform/web/products/productQuery.ts:276-281` | S |
| **`ProductRow` does NOT filter by author** — it queries the explicit `d` tags | `StorefrontBlockSlots.tsx:90-98` — `context.fetch([{ kinds: [30402], '#d': props.productDTags }])` | S |
| that shape has precedent elsewhere | `platform/web/browse/browseQuery.ts:510` — `{ kinds: [30402], '#d': [id] }` | S |

**Consequences.**

1. **With many pages per author, nothing about the pinning changes** — the pin is per *event*, and every page is
   its own event with its own author. A hundred pages by one admin each resolve their slots against that admin.
   There is no cross-page leaking and no new risk.
2. **v1's D8 sentence is half wrong, and the wrong half matters.** v1 said "a page can only reference its own
   author's listings … An admin-authored home can feature the admin's own listings, not sellers'." That is true
   for `ProductGrid` and `FeaturedProduct` and **false for `ProductRow`**, which takes any listing by `d` with no
   author filter. A featured page showing sellers' items **is expressible today**, one `d` tag per product, hand
   typed in the builder — which is exactly what the home composition does (`platform/web/routes/index.tsx:87`,
   one hardcoded `d`).
3. **That is the `list` feature's read path, already in production.** A `list` reference is `ProductRow`'s
   `productDTags` array with a name instead of an inline array. It is an addition because the query already
   exists (`:96`) and the storage already exists (`curationLists.ts:7-14`).
4. **One caveat that makes lists an improvement:** `ProductRow`'s `#d`-only read is *looser* than a coordinate —
   two sellers can publish the same listing `d` and the block cannot tell them apart. Lists store full
   `30402:<pubkey>:<d>` coordinates (`curationLists.ts:10`, `:28-38`), so adopting lists **tightens** the
   reference, it does not merely extend it.

---

## 2. What the model has to be, given the four facts

```
        ┌──────────────────────────────────────────────────────────┐
        │ L1  PAGES      kind 30024, one event per (author, d)     │  unbounded count
        │     d = the unique path segment (R2)                     │  author = the writer
        └──────────────────────────────────────────────────────────┘
                       ▲ resolved by exact #d          ▲ series by #t
        ┌──────────────────────────────────────────────────────────┐
        │ L2  CLAIMS     kind 30000, d='vanity-urls', app key      │  tens of rows, not hundreds
        │     contested names only: reservations, editor grants,   │  single occupancy (D4, scoped)
        │     admin overrides, series names, the default marker    │
        └──────────────────────────────────────────────────────────┘
                       ▼ consulted first
        ┌──────────────────────────────────────────────────────────┐
        │ L3  RESOLUTION  one pure ladder, used by /$path and by / │
        └──────────────────────────────────────────────────────────┘
```

The registry keeps what it is genuinely good at — a small, scarce, app-key-signed namespace of *reserved*
names — and stops being the storage for pages. That is the shape the ruling asked for, reached by measurement
rather than assumption.

---

## 3. The target and resolution model

### 3.1 What a page event carries

Unchanged except for two additions:

```
kind     30024
d        the path segment, lowercase, same grammar as a route name (3–30, [a-z0-9_-], alnum at both ends)
author   the person who wrote the page (today: the logged-in user — `storefrontPublish.ts:17-18, 82-93`)
content  { version, enabled, root, content }  — unchanged, `storefrontPage.ts:500-530`
tags     ["d", <segment>]
         ["title", <text>]                    — already emitted today (`storefrontPublish.ts:36, 62-63`)
         ["t", <series name>] × 0..n          — NEW. Series membership. Absent = not in a series.
```

Nothing else. No route entry, no claim, no appearance in the registry.

Why a tag and not a `d` prefix: relays filter single-letter tags exactly (`sdk/core/event-store/filter.ts:6-9`
types `#${string}` filters; `#t` is used in production at `sdk/commerce/discovery/productRead.ts:28` and
`sdk/commerce/messaging/bugReportRead.ts:43`), and `d` is exact-only (M1). A prefix convention would need a full
scan; `#t` is an index lookup.

### 3.2 What a claim carries

Same wire format increment 1 already built (`sdk/config/routeTable.ts` on `d7s2/route-table`), one new target
type:

```
["vanity", <name>, <pubkey>, <validUntil>]                         legacy, unchanged, profile target
["route", <name>, <type>, <target>, <authority>, <term>, <holder>]
["route-default", <path>]
```

| change | before (increment 1 / v1 §2.2) | after |
| --- | --- | --- |
| `type` | `profile \| page \| listing` | `profile \| page \| listing \| **series**` |
| `target` for `series` | — | `t:<series-tag>`, e.g. `t:featured` |
| `route-default` argument | must name a table entry | **names a path**, which may be a claim *or* a bare page path |
| conflict `non-page-default` | refuses a default that is not a `page` | **removed** — `/` may render any target type, because `/` is just a path (D18) |
| conflict `dangling-default` | default names a missing entry | renamed `unclaimed-default`, informational not a conflict (a default may name an unclaimed page path) |

A claim is written **only** when a name is contested or reserved. The intended steady state for an instance with
500 pages is **tens** of claims, which is what keeps the single-event table honest.

### 3.3 The resolution ladder

One pure function, one order, no special-casing of the path itself. `/` and `/x` run the identical ladder; only
the *floor* differs (§3.6), and that difference is stated as a decision, not hidden.

```
resolve(path):
  0. trusted page-author set = {app key} ∪ admins ∪ editors          (one cached read; §D16)
  1. claim = routeTable.lookup(path)
       claim exists and not lapsed →
           profile   → <StorefrontOrProfilePage profileId={pubkey}/>       (today's behaviour)
           page      → page at (target.author, target.dTag)
           listing   → the listing
           series    → step 3 with target.tag
       claim exists but lapsed  → honest failure state; DO NOT fall through
       claim's target fails     → honest failure state naming the claim; DO NOT fall through
  2. page by exact d, among trusted authors:
       { kinds:[30024], authors:[…trusted], '#d':[path] }
       one event per (author,d) after replaceable merge
       candidates = enabled ∧ parseable ∧ d === path
       winner = OLDEST created_at, tie → lexically lowest id
       → render; if none, step 3
  3. series by t, among trusted authors:
       { kinds:[30024], authors:[…trusted], '#t':[path] }, newest-first, windowed
       newest enabled ∧ parseable in the window → render
       → else step 4
  4. floor (§3.6)
```

**Why step 1 is authoritative and step 2 is not:** a claim is a promise made by the operator (paid, granted, or
assigned). A page path is a fact someone published. A broken promise is reported; a broken fact is replaced by
the next candidate. That is the one place v2 knowingly departs from v1's "never fall through", and it is
deliberate: with hundreds of pages, "the newest event at this `d` is switched off" must not make the path fail
when a live page exists.

**Why oldest wins at step 2, not newest:** the failure mode an operator would notice is a *later* event silently
displacing an established page at the same path — squatting by recency. Oldest-enabled means a page cannot be
taken over by publishing again; it can only be taken by a claim (step 1) or by the incumbent switching off.
The cost is that a dead author's path stays theirs until they disable it or an admin claims it — a policy
question, not a mechanical one, and reversible by a claim.

**Concurrency at step 2 is a policy question, not a data question.** Two authors publishing the same `d` in the
same second both succeed; every reader picks the same winner (oldest, id-tiebreak), so clients never disagree.
One page is silently shadowed — its author's own copy remains at `(author, d)` and is reachable by that
coordinate, and the publish path warns before it happens (§5, N16). This is strictly weaker harm than v1's
whole-table lost update, which erased *other people's unrelated* entries.

### 3.4 R3 in detail — why `t`, and the alternatives rejected

| option | read cost | write cost | why not |
| --- | --- | --- | --- |
| **`t` tag + `#t` query, newest wins** *(lean)* | one indexed filter, windowed | one extra tag on publish | — |
| duplicate the page at `d=<series>` so the series path is an exact hit | O(1) | a **second full page document** per publish; the series coordinate keeps only the latest, so history at that address is destroyed and "the newest is switched off" has no earlier candidate to fall back to | rejected: it stores content twice and makes the failure case unrecoverable |
| scan the author's pages and prefix-match `d` client-side | hundreds of full page documents per hit | none | rejected as the *primary* path: relays cannot prefix-match, so this downloads every page to answer one question. Retained as the last resort in §3.5 |
| a separate "series pointer" event rewritten on each publish | O(1) | a second write + a stale-pointer failure mode | rejected: a pointer that can disagree with the pages is a second source of truth, and it fails exactly when a publish half-succeeds |

The `t`-tag lean means a page can belong to **several** series (multiple `t` tags) at no extra cost, which the
other three cannot do.

### 3.5 What `/featured` shows when the newest matching page is not usable

Every row ends in a rendered page, never a blank, never a spinner (the floor is §3.6). Window = 20 events per
query, up to 5 windows (100 candidates), then stop.

| state of the newest matching page | what `/featured` does | asserted by |
| --- | --- | --- |
| enabled and parseable | renders it | N11 |
| **switched off** (`enabled:false`, still carries `t`) | skips it, renders the next-newest enabled+parseable in the window | N12 |
| **unparseable** (`parseStorefrontPage` rejects) | skips it, counted as dropped, next candidate | N13 |
| **present but zero blocks** | `shouldRenderStorefrontPage` is false (`storefrontQuery.ts:150-154`) → skipped as unusable, next candidate | N14 |
| **absent** (no page carries `t`) | floor | N15 |
| **all candidates unusable** after the window | floor | N12/N15 |
| relay error / transport failure | keep the last known-good page for this path (`stale-while-error`, v1's accepted D3 posture, matching `storefrontQuery.ts:70-73`); if none, floor | N17 |
| a claim of type `series` exists but the tag is empty after parsing | claim is dropped at parse, counted → step 2 → floor | N9 |

**The floor is never blank and never a 404** — the constraint `order.md:84-85` and `ruling-acl.md:66` both set.

### 3.6 The floor, and the one place `/` stays privileged — stated, not hidden

| path | floor |
| --- | --- |
| `/` (the default path, whether claimed or bare) | the inline composition — `platform/web/routes/index.tsx:81-113`: a `Search` block, one `ProductRow`, three category links. It is already expressed *as a page document* (`:81-99`), so the same renderer draws it. |
| any other path | an honest per-path empty state: "nothing is published at this path" — the existing `EmptyState` at `StorefrontAddressPage.tsx:60-67`, with the path named. |

**This is a real asymmetry and I will not pretend otherwise.** R4 says the home is "just one more path, not a
privileged special case". It holds for *resolution* — one ladder, no branch that tests `path === '/'` — and it
does **not** hold for the empty state, because an absent `/` means "this site has no home" while an absent
`/featured-13-11-2026` means "that page does not exist". They are different facts and deserve different pages.

**If the owner wants strict R4**, the asymmetry is removable without code: publish the inline composition as a
real page (it is already a page document in code) and point the default at it. Then `/` has exactly the same
floor as every other path, and the fallback becomes dead code kept only for "the relay has nothing at all". This
is D19's alternative, at a cost of one publish and one editorial decision.

---

## 4. The decisions

Continuing v1's numbering (D1–D12 exist; D1, D2, D3 accepted and untouched). Each: question, **lean**, why,
cost, and what happens if pushed back. `↑` marks one that changes what the product is.

### D4 — restated: single occupancy, scoped to claims ↑

**Question.** v1: "one name has exactly one entry", justified by the single replaceable table. Still true?

**Lean: true for claims, false for paths.** One *claim* per name, enforced at write by the server, exactly as
v1 said. A *path* may have several page events (different authors); resolution picks one deterministically
(§3.3). Claims are tens of rows; paths are hundreds.

**Why:** measured, the table's ceiling is ~465 entries at 141 B each against a 64 KB event (M3), and every write
rewrites all of them. Hundreds of pages cannot live there; tens of claims can live there comfortably.

**Cost, plainly:** "one name, one entry" was load-bearing for v1's precedence story — it made precedence a
*write-time* question with no read-time rank. For unclaimed paths there is now a read-time rule. It is
deterministic (every client agrees), but it is a rule, not a constraint: two pages can exist at one path and one
is shadowed. v1's guarantee — "they never coexist" — no longer holds for paths. It still holds for claims.

**If you push back:** the only way to keep one-entry-per-path is to put every path in the table, i.e. to refuse
R1. That is the collision the ruling predicted; I am resolving it in R1's favour and saying so.

### D13 — Three layers: pages are the storage, the registry is a claim layer ↑ ESCALATED

**Question.** Does the registry stay the route table, or become something smaller?

**Lean: pages (kind 30024) are the storage; the registry holds only contested names + the default marker; a pure
resolver joins them.** No new event kind anywhere. The registry's coordinate, tag families and legacy `vanity`
mirror are unchanged from increment 1.

**Why:** M1 — the storage already exists, is already user-authored, and already carries the path in `d`. The
only thing v1 added to it was a second copy of the name in an app-key-signed event, which buys nothing for
uncontested pages and costs the ceiling.

**Cost — what v1 loses:** one read instead of a lookup. `/x` now costs a claim read **and** a page read (two
bounded fetches, not one), and `/` costs the same plus the role lists on first resolve. The management surface
must read pages *and* claims to show one coherent list, and the "did the table change under me?" check no longer
covers page paths — a page can appear at a path between two reads. Both are real; neither is avoidable if pages
are to be authored by their author.

**If you push back:** keeping pages in the table means the app key signs every admin's page (ruling reason 3),
the table crosses 64 KB at 461 entries, and every publish rewrites all of them. That is v1, and it fails R1.

**Budget, so this cannot silently rot:** the claim table carries a **32 KB tag budget** — measured capacity
**230 claims** (230 entries = 32,681 B; 231 = 32,823 B at 142 B marginal) — enforced by the write path with a
stated refusal (`claim-budget-exceeded`). The number is **our choice**, not a spec value; the reason is that no
relay cap is configured in this repo (U) so the design must not depend on one being generous. A claim that would
exceed the budget is refused with a message naming the count, never truncated.

### D14 — `d` is the path; the publish path gains an address ↑

**Question.** How does a page become reachable at `featured-13-11-2026`?

**Lean: `buildStorefrontPageEvent(page, address)` where `address = { dTag, series? }`; `publishStorefrontPage`
takes the same. The default argument stays `STOREFRONT_PAGE_D_TAG`, so every existing caller and test compiles
and behaves identically.** The path grammar (`/^[a-z0-9][a-z0-9_-]{1,28}[a-z0-9]$/`, mirrored from
`sdk/config/vanity.ts:171-175`) is enforced at publish for path-addressed pages; the profile page at
`d='storefront-page'` keeps its free-form `d`.

**Why:** M1 — a parameter, not a redesign. `storefrontPublish.ts:60` is the whole obstacle.

**Cost:** the editor must now know *which page* it is editing and *what address* it will have; the dashboard
grows a page list and a per-page builder. That is new UI, not new data. And the existing profile page keeps its
constant `d`, so an author has one "profile page" plus N "path pages" — two concepts to explain in the UI.

**If you push back:** naming pages by `title` tag alone would leave two pages able to share a `d` accidentally;
the grammar plus a pre-publish existence check is cheaper than a later migration.

### D15 — Series resolution: a `t` tag, newest wins ↑

**Question.** R3: `/featured` must resolve to the newest page of that kind, dynamically.

**Lean: a page declares its series with `["t", <series>]`; `/featured` queries `#t=featured` restricted to
trusted authors, newest-first, and renders the newest enabled+parseable, windowed per §3.5.** Publishing a new
page with `t=featured` changes what `/featured` shows with **no other write** — that is the "dynamic resolution"
the ruling asks for.

**Why:** relays cannot prefix-match `d` (M1), so a `d`-prefix convention would need a full scan. `#t` is an
indexed filter with production precedent (`productRead.ts:28`). It also allows several series per page at no
cost.

**Cost:** the series name is a *convention on the write*, so a page published without the tag is invisible to
`/featured` even though its path says `featured-…`. That divergence is real: `featured-13-11-2026` can look like
a series member without being one, and the only defence is the publish path deriving `t` automatically from a
`featured-<date>` `d` **when the author opts in**. Lean: derive the `t` tag automatically when the `d` matches
`^(series)-(\d{2}-\d{2}-\d{4})$` and the author confirms the series in the publish form; never derive silently
from an arbitrary `d`. And the failure window is bounded: the fallback scan (the row §3.4 rejected as primary)
is available as a last resort if the tag is missing — build it only if measured to be needed.

**If you push back:** the alternative is the duplicate-at-`d=<series>` write (§3.4 row 2). It reads O(1) but
stores every page twice and cannot fall back when the newest is switched off.

### D16 — Who may own a top-level path ↑ ESCALATED

**Question.** With pages user-authored and published straight to relays (no server gate — `storefrontPublish.ts`
uses `publishNostrEvent`, `:95`), opening step 2 to *any* author means any logged-in user controls `/anything`
on the instance. Today the top-level namespace is operator-controlled by construction, because
`StorefrontAddressPage` only ever reads the app key (`:31`).

**Lean: step 2 and step 3 resolve only among the trusted page-author set — app key ∪ admins ∪ editors** (read
from the existing lists, `curationRead.ts:75-83`). Ordinary users' multi-page publishing arrives with the
**sub-path namespace** under their reserved name (`/alice/featured`), which `ADR-0006:209` already describes and
v1 correctly flagged as out of scope (C14). This increment meets R1 for the audience the ruling names —
"specifically admins/editors should be able to publish many pages".

**Why:** the ruling's R1 names admins/editors; R2's example path is an operator path; and the alternative hands
every logged-in user a page at any top-level URL in a wallet-bearing app. The read-side allowlist is cheap (one
cached role read) and reversible.

**Cost, and it is not small:** this is a **read-side** allowlist, not an enforcement wall. A user can still
publish kind 30024 at `d='about'`; our resolver simply will not render it. Any other client reading the same
relay will. And a page disappears from its path the moment its author is demoted out of the editor list — a
consequence the management surface must state before a demotion, not after.

**If you push back (and this needs your word, not mine):** the open namespace is one deleted `authors` filter.
It gives every user `/whatever` immediately, and the mitigations are then: reserved-word refusal at publish
(client-side, bypassable), attribution visible on every page ("published by npub…"), and admin claims overriding
any page path. I do not recommend it in a wallet-bearing app without those three.

### D17 — Collisions on an unclaimed path

**Question.** Two authors publish the same `d`. Who wins?

**Lean: oldest enabled+parseable wins; tie → lexically lowest event id. Admin override via a claim, which is
step 1 and beats both.** The publish path checks `#d` before signing and refuses with
"this path is already published by <npub>" unless the requester is that npub, an admin, or is publishing a
different series.

**Why oldest:** the observable failure of "newest wins" is a page silently mutating under a URL an operator has
already printed. Recency-squatting is the attack a payment-bearing namespace attracts.

**Cost:** a path whose owner disappears is unusable until they disable their page or an admin claims it. And the
pre-publish check is TOCTOU — two publishes inside one second both succeed; the resolver still agrees with
itself, so the damage is one shadowed page plus a warning, not disagreement.

**If you push back:** "newest wins" makes republishing a takeover primitive; "first wins" makes dead pages
sticky. I prefer sticky over hijackable, and an admin claim clears either.

### D18 — The default names a path, not a target (R4)

**Question.** v1's D11 refused a non-page default because `/` renders through `StorefrontRenderer`. Still right?

**Lean: the `route-default` tag names a **path**; `/` runs the same ladder on that path. Any target type is
therefore admissible at `/`, including a series path — so `/` can be pointed at `/featured` and will track its
newest page for free.** v1's `non-page-default` conflict is removed; `dangling-default` becomes
`unclaimed-default` and is informational, because a default may legitimately name an unclaimed page path.

**Why:** R4. If `/` resolved differently from `/x`, "the home is just one more path" would be false at the
mechanism level, which is precisely the misunderstanding the ruling corrected.

**Cost:** the front page can become a profile or a listing page. That is a coherent consequence of R4, not a bug,
but it means `/` has no guaranteed shape and every consumer that assumes "the front page is a storefront page"
must be checked. In practice the default will name a page or a series path.

**If you push back:** keep `non-page-default` as a warning rather than a refusal — still checked, still reported,
not blocking.

### D19 — The floor (see §3.6) ↑

**Question.** What is under the last rung?

**Lean: `/` floors to the inline composition at `index.tsx:81-113`; every other path floors to a per-path empty
state naming the path. The resolver itself never branches on `/`.**

**Cost:** a documented asymmetry (D19's whole content). The mitigation is available and cheap: publish the
inline composition as a real page, point the default at it, and delete the privilege. I lean to doing that in
the same increment that wires `/` — but it is an editorial call about what the front page is, so it is not
bundled into this increment's build.

### D20 — The `list` reference: room now, built later (follow-up, marked)

**Question.** The ruling requires the reference model to have room for "the members of the named list".

**Lean: the page schema's product reference becomes a discriminated union, and `list` is parsed as
*known-but-unsupported* — dropped, counted, never fatal.** Today a `ProductRow` block carries
`productDTags: string[]` (`StorefrontBlockSlots.tsx:92-96`). v2 specifies:

```ts
type ProductReference =
  | { kind: 'items'; coordinates: string[] }   // 30402:<pubkey>:<d> — today's d-tags, tightened to coordinates
  | { kind: 'list'; list: string }             // the members of the named list — PARSED, NOT RESOLVED
```

**Not built in this increment.** `list` must round-trip through the schema, be rejected by the resolver with a
counted `unsupported-reference` reason, and render the block's existing empty state — so the follow-up is a
resolver branch, not a schema migration. `AGENTS.md:63-64` (a new kind needs code, tests and docs) is *not*
triggered, because no new event kind is introduced now.

**Why this is an addition and not a re-architecture:** measured — the list *storage* already exists
(`curationLists.ts:7-14`, `:41-54`), the list *read* exists (`curationRead.ts:193-201`), and the *reference read*
exists (`StorefrontBlockSlots.tsx:96`, a `#d`-coordinate query). What is missing is (a) authoring lists as a user
rather than the app key, (b) one list kind rather than four, (c) the UI to pick products. All three are the
follow-up.

**Cost of doing it later rather than now:** the `ProductRow` block's prop shape changes once (from
`productDTags` to `ProductReference`), so pages published before v2's schema bump render their row through the
`items` variant. That is why the union goes in now: a later addition would be a schema version bump with a
migration instead of a resolver branch.

---

## 5. Requirement status — R1 to R4, each with its mechanism and its evidence

Convention carried from v1 §7: **SPECIFIED** = an accepted document or the owner's verbatim ruling prints it;
**SUGGESTED** = a proposed document describes it; **OUR CHOICE** = nothing states it.

| # | requirement | mechanism that meets it | grade | evidence |
| --- | --- | --- | --- | --- |
| **R1** | hundreds of pages per author | one kind-30024 event per `(author, d)`; no count ceiling anywhere in the read or write path | **SPECIFIED** (ruling §2) | `storefrontPage.ts:31`; `mergeRules.ts:9-11, 19`; the only single-page assumption is `storefrontPublish.ts:60` |
| **R2** | a unique custom path per page | the page's own `d`, published and resolved verbatim | **SPECIFIED** (ruling §2) | `$vanityName.tsx:34-41`; `StorefrontAddressPage.tsx:14-20`; `storefrontQuery.ts:83-94` |
| **R3** | a general path resolving to the newest page of the series | `["t",<series>]` on the page + `#t` query, newest-first, windowed | **SPECIFIED as requirement, OUR CHOICE as mechanism** | ruling §2 ("a new resolution mode"); `productRead.ts:28` for `#t` precedent |
| **R4** | the home is one more path | `route-default` names a path; `/` runs the ladder | **SPECIFIED** (ruling §2) | replaces `index.tsx:57` |
| R5 | a `list` reference has room in the model | `ProductReference` union, `list` parsed and refused by the resolver | **SPECIFIED** (ruling §3) | this section, D20 |
| R6 | admin/editor pages are their own signed events | page author = the logged-in user, unchanged | **SPECIFIED** (ruling §2 reason 3) | `storefrontPublish.ts:17-18, 82-93` |
| R7 | claims: one name, one entry | single replaceable event, single writer, write-time refusal | **SPECIFIED** (v1 D4, scoped) | `vanityRead.ts:5, 21-28`; `ZapPurchaseManager.ts:190-202`, `:399-413` |
| R8 | reservations keep working | claim of type `profile`, legacy `vanity` mirror unchanged | **SPECIFIED** (v1 D1/D5, accepted) | `vanityRead.ts:31-35`; `ZapPurchaseManager.ts:83-95` |
| R9 | the ladder never blanks a path | §3.5 matrix + §3.6 floor | **SPECIFIED as constraint** | `order.md:84-85`; `ruling-acl.md:66` |
| R10 | top-level paths are operator-controlled | trusted-author filter on steps 2–3 | **OUR CHOICE, escalated (D16)** | D16 |

**Not an obligation, and I will not present it as one:** the `t`-tag choice, the oldest-wins tie-break, the
20×5 window, the 32 KB claim budget, the per-path empty state, and D16's allowlist are all our choices. They are
shaped by the measurements; no document required them.

---

## 6. What in v1 is superseded, and what survives

**Superseded — do not implement from v1:**

| v1 item | why it falls |
| --- | --- |
| §2.1 "what the registry carries today" as the target model | the registry is a claim layer now, not the route table |
| §2.2 `route` tag for every managed name, `page` target `author:d` for each page | pages are not claims; one claim per *contested* name |
| **D4** — "one name has exactly one entry", as the resolution mechanism | scoped to claims (D4 restated) |
| **D8** — "does the home become a page an admin can author" | the question was wrong (ruling §2); and its factual premise about listings is half wrong (M4) |
| **D9** target types | `series` added; `page` targets survive only as *override* claims |
| **D10/D11** — the default is a page target, one default, no non-page default | the default names a *path*; any target type may sit at `/` (D18) |
| §3.1 resolution ladder | replaced by §3.3's four-rung ladder; the "no fall-through" rule now applies to claims only |
| §4 "the default flag, in full" | rewritten by D18/D19 |
| §5 "a route named `home` is not a new name" | still true and still worth warning about, but it is now a *page-path* warning (N16), not a table rule |
| §6.2 "the proxy is not an enforcement point" | still true, and now *less* relevant: the registry write path shrinks, and pages never go through the proxy at all |
| **D12 / §8** — the management surface is a route table | it becomes a *page list* (per author) plus a claim list (admin), two views over two layers |
| §10 build order steps 1–4 | resequenced; the byte budget and the page-path resolver come before any UI |

**Survives unchanged:**

- **D1, D2, D3** — accepted by the ruling (§1), untouched.
- **D5** (lapse, grace, warnings), **D6** (`/name` means a URL segment, no DNS), **D7** (grammar, 37 reserved
  names, real-route collisions) — all still exactly right, and D7 now also governs page paths.
- the whole of §6 (trust and permissions) *for claims*: the server is the enforcement point, and it needs the
  content validator (`validateRouteTableEvent`) more than ever, because the claim layer is the only thing that
  can override a page path.
- §9's negative paths N1–N10, all still valid at claim level.
- §11's C1–C14 corrections, except C11 (which D4's restatement replaces) and C14 (sub-paths, still out of scope
  but now the named home for ordinary users' multi-page publishing, D16).

**Two corrections to v1's own text, stated because they were load-bearing:**

1. **C15 (new)** — v1 D8 and §D8's rationale said a page "can only reference its own author's listings". False
   for `ProductRow` (`StorefrontBlockSlots.tsx:90-98`, no author filter). The featured-page use case was always
   expressible; v1 used a wrong premise to explain the hardcoded home `d`-tag.
2. **C16 (new)** — v1 §6.2 called the multi-writer clobber "already flagged … made certain by scale". Measured,
   the *current* code has one writer and no clobber (M3); the clobber is introduced by v1's client-composed
   write. The finding survives; its cause was misattributed.

---

## 7. Acceptance plan — the new negative paths

Carried from v1 §9.1 (N1–N10 still stand at claim level). New, all of them assertable without a live stack
except where noted:

| # | path | what it must prove | assertable today? |
| --- | --- | --- | --- |
| N11 | `/featured`, newest matching page enabled | renders the newest by `created_at` | **no** — new: `pagePaths.test.ts`, `seriesResolution.test.tsx` |
| N12 | newest matching page switched off | renders the next newest; if none, floor; never blank | **no** — new |
| N13 | newest matching page unparseable (`content:'not json'`) | skipped and counted; next candidate | **partly** — `StorefrontAddressPage.test.tsx:117-123` proves no-blank for a *single* address; the fall-to-next case is new |
| N14 | newest matching page has zero blocks | skipped (`storefrontQuery.ts:150-154`), next candidate | **partly** — `storefrontQuery.test.ts:271,289` proves the predicate; the fall-to-next is new |
| N15 | no page carries the series tag | floor, path named in the empty state | **no** — new |
| N16 | publish a `d` already published by another author | refused with the holder named; admin may override via a claim | **no** — new |
| N17 | relay error while resolving a series | last known-good kept; else floor; never a spinner forever | **no** — new (the `isLoaded`-forever edge, v1 §3.2, must not be inherited) |
| N18 | 500 pages for one author, all resolvable | list renders, no truncation, one page resolves in O(1) | **no** — new; a fixture test, no relay needed |
| N19 | a `list` reference in a page document | parsed, not resolved, counted as `unsupported-reference`, block renders its empty state | **no** — new; pins D20's boundary |
| N20 | claim table would exceed the 32 KB budget | write refused with `claim-budget-exceeded` and the count | **no** — new |

**Existing tests that must change:** `storefrontQuery.test.ts` (the by-`d`-any-author and by-`t` reads),
`StorefrontAddressPage.test.tsx` (the `author` prop and the per-path empty state),
`storefrontPublish.test.ts`/`buildStorefrontPageEvent` callers (the address argument, defaulted),
and `sdk/config/routeTable.test.ts` on `d7s2/route-table` (the `series` type, the removed `non-page-default`,
the renamed `unclaimed-default`, the budget).

**Gates** are v1 §9.4's, unchanged, with one correction: **quote the branch's own baseline**, do not carry 205
from `master` onto `d7s2/route-table` — that branch adds two files and its clean-tree count has not been
measured by this document (U).

---

## 8. Build order

| # | step | why here |
| --- | --- | --- |
| 2 | **page-path layer** (this increment, `order-increment-2.md`): `series` target type, budget, page-path grammar, candidate selection, publish/publish-read parameterised | everything else reads these; no UI, no route change, nothing user-visible |
| 3 | **`/` and `/$vanityName` run the ladder** | the first user-visible change, and the one that demonstrates R4 |
| 4 | **page list + per-page builder** (the multi-page CMS) | this is what makes R1 real for an admin: without a list, "hundreds of pages" is true but unreachable |
| 5 | **claim management** (admin override, series declaration, default marker, export) | the claim layer only matters once pages can be overridden |
| 6 | **server content validator for claims** (`validateRouteTableEvent`) | before any claim UI exists — v1 §6.2's finding stands |
| 7 | **lists** — follow-up, explicitly not this increment | D20 |

Step 6's ordering is worth defending: v1 put the validator first. But the validator validates *claims*, and
claims now change *less* than v1 assumed (they no longer carry every path). Steps 2–3 ship without a new write
surface, so the validator is only needed at step 5. That is a real simplification of v1's order, not a weakened
one.

---

## 9. What remains unverifiable here, stated plainly

| claim | status | what would settle it |
| --- | --- | --- |
| the deployment's relay indexes `#t` on kind 30024 | **U** | a live query against the instance's relay; the repo uses `#t` elsewhere (`productRead.ts:28`) but not on 30024 |
| the relay's maximum event size (the 64 KB used in M3) | **U** | relay config; not present in this repo (measured negative grep) |
| how many claims exist today | **U** | a registry read; no relay reachable in this run |
| that a `#d`-only query (no `authors`) is honoured by this relay | **U** — though the code already issues that shape at `browseQuery.ts:510` | a live query |
| that the oldest-wins rule is what the owner wants for path collisions | **judged** | D17 is a decision; it is not a measured fact |
| the typecheck baseline on `d7s2/route-table` | **U** | `bunx tsc --noEmit` in a clean worktree of that branch; not run here (this document builds nothing) |

**Nothing in this revision was deployed, built, or run.** No source file, branch or worktree was modified.