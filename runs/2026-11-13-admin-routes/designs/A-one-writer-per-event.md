# Candidate A — one writer per event

**Run:** 2026-11-13-admin-routes · **Base:** `/home/admin_maxime/work/market` @ `6541bcc3d` (source identical to the pin `2326938b3`; every commit above it touches only `runs/`).
**Author:** designer A of three, working independently.
**Status of this file:** a candidate architecture, not a proposal to accept. It states one central bet, tests it against measurement, and — where measurement refutes it — says so instead of defending it.

Labels on every claim: **[M]** measured by a command (the command is named), **[S]** read from source (`file:line` states it), **[J]** my judgement, **[U]** unverified.

---

## 0. The bet, stated so it can fail

> **Every collision in v1 traces to several namespaces sharing one replaceable event. Give each thing its own event, written by exactly one writer, and the class of collision disappears.**

Concretely:

1. A **page** is one author-signed kind-30024 event. A hundred pages are a hundred events. Nobody but the author ever writes one.
2. A **path** is one app-key-signed claim event (new kind 30025), whose `d` tag is the path. Buying, granting or reassigning `/shop` writes the event at `d='shop'` and touches no other path.
3. The **site default** is one singleton event (new kind 30026) whose entire content is a single path name.
4. A **payment** is one persisted, signed artifact (9735 zap receipt, or 9321 nutzap), stored as bytes and re-verifiable offline.
5. The server's routes database is a **materialised view** — a fold over the events — not an authority. Delete it and nothing is lost.

**What would refute the bet:** a required behaviour that *cannot* be delivered by independent single-writer events. The candidate is the need to guarantee that one scarce name has exactly one holder when two buyers act concurrently. Measurement (§2.6) says the bet **does not** deliver that on its own, and this design says so in the model rather than papering over it.

---

## 1. What is being replaced, in one paragraph

Today a route is one `["vanity", name, pubkey, validUntil]` tag inside **one** app-key-signed kind-30000 event at `d='vanity-urls'` (`sdk/core/curation/vanityRead.ts:5`, `:31-35`; `platform/server/VanityManager.ts:97-112`). It maps a name to a **person**, never to a page. Every write rebuilds that whole event from an in-memory map that holds only `vanity` entries (`platform/server/VanityManager.ts:110-112` → `platform/server/ZapPurchaseManager.ts:404-405`), which is why the first paying user deletes every admin route (review F2, confirmed). Meanwhile pages already exist as an addressable kind — 30024 — authored by their own user (`platform/web/storefront/storefrontPublish.ts:15-18`), but pinned to one fixed `d` for every author (`:60`), so one page per author, no path of its own.

---

## 2. Measurement

### 2.1 Kind 30024 is addressable; only a constant makes it one-page-per-author — bet confirmed

- `sdk/commerce/storefront/storefrontPage.ts:31` — `export const STOREFRONT_PAGE_KIND = 30024`. **[S]**
- `:34` — `export const STOREFRONT_PAGE_D_TAG = 'storefront-page'`; the doc comment at `:33` calls it "the single storefront page belonging to a pubkey". **[S]**
- The file's own header, `:7` — "kind 30024, `d=storefront-page`, **one per pubkey**". **[S]**
- The publish builder hard-codes it: `platform/web/storefront/storefrontPublish.ts:60` — `const tags: string[][] = [['d', STOREFRONT_PAGE_D_TAG]]`. **[S]** — the fixed `d` is the only thing making it one page per author.
- 30024 ∈ [30000, 39999], so NIP-01 addressability applies: keyed by `(kind, pubkey, d)`, newest wins (research `02-target-and-gaps.md` §1, NIP-01 quoted there). **[S]**
- The reader is already generic in `d`, and already exists: `platform/web/storefront/storefrontQuery.ts:75` — `fetchStorefrontPage(pubkey: string, dTag: string = STOREFRONT_PAGE_D_TAG)`, filter at `:82-88` is `kinds:[30024], authors:[pubkey], '#d':[dTag]`, and it re-picks the newest itself (`selectReplaceable`, `:44-60`, ties broken on smallest `id`) "because relays are not required to return only the newest". **[S]**
- The filter type already supports arbitrary tag filters: `sdk/core/event-store/filter.ts:3-12` — `[tagFilter: '#${string}']: string[]`. **[S]** So a series read (`'#t': [...]`) needs no new plumbing.

**Consequence:** R1 (hundreds of pages per author) is a one-parameter change, not an architecture. **[J, from the above]**

**The one hard pin is not the `d` but the author.** `platform/web/storefront/StorefrontAddressPage.tsx:31` — `const author = config?.appPublicKey ?? ''`, with the component taking only a `dTag` prop (`:29`). So "page at `(author,d)`" needs one prop threaded, exactly as v1 measured. **[S]**

### 2.2 Server-side persistence: the extension point exists, the implementation does not — ruling premise qualified

The ruling (`ruling-d3-persistence-and-redesign.md:36-38`) names `sdk/core/event-store/applesauceEventStore.ts`, `eventAccess.ts` and `platform/server/server-bootstrap-persistence.test.ts` as evidence that server-side persistence is "live machinery". Measured, that is **half right**:

- The event store is real and abstracted: `applesauceEventStore.ts:80-88` builds an `AsyncEventStore` with an injectable database; `:65-75` takes `database?: IAsyncEventDatabase`, defaulting to an **in-memory** implementation (`:23-38`, wrapping applesauce's `EventMemory`); the doc comment at `:20-21` says browser hosts inject `applesauce-indexeddb`. **[S]**
- `eventAccess.ts:1-33` composes `EventStorePort` with a host-supplied stream — it "owns no relay/pool/WebSocket" (`:10-12`). **[S]**
- **Nothing in `platform/server/` uses any of it.** `grep -rn 'createApplesauceEventStore\|createEventAccess' platform/server` returns **0** hits outside the SDK. **[M]**
- **The server writes no files and opens no database.** `grep -rn 'writeFile\|readFile\|fs\.' platform/server/*.ts` returns **nothing**; `grep -rlniE 'sqlite|leveldb|lowdb' platform/server` returns **nothing**. **[M]**
- `platform/server/server-bootstrap-persistence.test.ts` is about **bootstrap state passed into a constructor**, not stored events: `BootstrapManagerImpl(adminManager, initialAdminCount, hasExistingSetup, allowPublicBootstrap)` (`platform/server/BootstrapManager.ts:11-18`), asserted at `server-bootstrap-persistence.test.ts:69-95`. **[S]** Its "persistence" is a caller's claim, not the server's storage.
- The repo says so itself: `notes/BOOTSTRAP-EVENT-STORE-PERSISTENCE.md:1-10` describes the lane whose mission is to "**replace the missing local event database**", scopes it to `sdk/core` only, and states that "the persisted instance is *host-supplied*". Its hard boundary is "never touch `platform/server/**`". **[S]** (The note is untracked in the working tree — `git status --porcelain` shows `?? notes/BOOTSTRAP-EVENT-STORE-PERSISTENCE.md` **[M]** — so treat it as intent, not as landed code.)

**So the ruling's direction is right but its cost line is understated:** persisting payment proof server-side is **new infrastructure**, not an extension of running machinery. It is cheap infrastructure — the runtime can already do it with zero new dependencies: `/home/admin_maxime/.bun/bin/bun -e 'new (require("bun:sqlite").Database)(":memory:")'` → `bun:sqlite OK`. **[M]** And `IAsyncEventDatabase` (`applesauceEventStore.ts:23-38`) is a 12-method interface that a `bun:sqlite` adapter satisfies directly. That is the single most useful thing this candidate found: **the schema of the missing piece is already written down in the SDK.**

### 2.3 The zap path does not persist, and its verification trusts the payer's own number

- Restart behaviour, as the ruling says: `ZapPurchaseManager.ts:125-131` — receipts older than `maxReceiptAge` (300 s default, `:126`) are **skipped**, expressly "prevents re-processing on server restart". **[S]** Nothing is written down; state is re-derived from the relay at boot (`loadExistingRegistry`, `:210-236`). **[S]**
- **The invoice is forgettable.** `generateInvoice()` returns `{ pr }` and records nothing (`:361-369`); there is no invoice registry and no map from invoice → (path, payer, sats). **[S]**
- **At settlement the amount comes from the payer-signed zap request, not from the invoice:** `:175-177` reads the `amount` tag out of the 9734 and `:180` maps it to a tier. The `bolt11` tag is only checked for **presence** (`:168-172`); its amount is never decoded or compared. **[S]**
- Judged consequence: this is a reachable underpayment path. The LNURL callback is the app's public Lightning address callback, proxied but not gated (`:348-359` builds the URL from the LNURL document and fetches it). A payer may call it directly with any amount and any `nostr=` request, pay it, and receive a genuine 9735 signed by the node whose `description` carries a request claiming a larger `amount`. The server would accept it. **[J, from the code above]** I did not execute this — it needs a live LN node — so its *reachability* is **[U]**; the code path is **[S]**.
- The renewal rule is already right and should be kept: `:190-193` extends from the existing expiry when the same pubkey renews in term. **[S]**
- The clobber: `publishRegistry()` `:393-407` builds `[['d','vanity-urls'], ...this.buildRegistryTags(this.registry)]` from the map alone, and `VanityManager.ts:110-112` emits only `['vanity', …]`. **[S]** Every receipt rewrites the whole event. **[S]**

### 2.4 Nutzap machinery exists — in the SDK, not on the server

`grep -rniE 'nutzap|NIP-?61|9321' --include=*.ts --include=*.tsx sdk platform ui | wc -l` → **274** matches. **[M]** `sdk/commerce/payments/wallet/nutzap.ts` is 624 lines and implements both sides:

- kinds: `NUTZAP_INFO_KIND = 10019`, `NUTZAP_KIND = 9321`, `NUTZAP_REDEMPTION_KIND = 7376` (`:34-37`). **[S]**
- `buildNutzapTags` (`:287-304`) — one `proof` tag per proof, `unit`, `u` (mint, byte-identical per NIP-61), optional `e`/`k` when zapping an event, `p`.
- `validateNutzap` (`:355-…`) — the NIP-61 observer checklist with the severity split: structural faults are **errors**, missing/mismatched `e`/`P` are **warnings** (`:326-338`).
- `createNutzapSender` (`:516-…`), `parseNutzapRecipientInfo` (`:224`), `buildNutzapFilter` (`:315-324`).

**What does not exist:** a server-side Cashu wallet. No `platform/server/` file mentions cashu at all. **[M]** `@cashu/cashu-ts@5.0.0-rc.4` is a dependency (`package.json:44`), and the wallet lives in `sdk/commerce/payments/wallet/`. **[S]** So accepting a nutzap for a route means the **server** must hold a mint account and redeem — new, and it is a network egress to a mint, which `AGENTS.md:63-64` requires be an explicit, documented decision.

### 2.5 The three tiers' actual authority today

| tier | what the code grants | where |
|---|---|---|
| admin | can write **anything** through the WS proxy — the only branch that admits an arbitrary kind | `platform/server/EventValidator.ts:85-93` (`validateGeneralEvent` → `adminManager.isAdmin`), reached for every unclassified event by `:30-31`, `:47` |
| editor | **one** event class: kind 10000 blacklist | `EventValidator.ts:74-83` — the only call site of `editorManager.isEditor` in the validator |
| paid | the only tier with working machinery: pricing, invoice, receipt→registry | `VanityManager.ts:47-55`, `ZapPurchaseManager.ts:113-207` |

- The claim "an editor cannot write the route registry today, by any path" is **[S]**: `validateGeneralEvent` is admin-only, and `getEventType` routes `d='vanity-urls'` to `general` (`EventValidator.ts:39-43`).
- Per-path grants have **no representation anywhere** — no schema, no field, no read. **[M]** (negative search for `editorGrant|pathGrant|grantedPath|allowedPaths`, research 02 §3.4).
- The manager pattern is uniform and trivially extensible: `AdminManagerImpl`/`EditorManagerImpl` are 48-line classes over a `Set` with `updateFromEvent` (`platform/server/AdminManager.ts:4-39`, `EditorManager.ts:4-39`). **[S]**
- **Everything an admin writes is re-signed as the app key:** `websocket.ts:30-33` verifies the client's own signature, `:37` hands it to `EventHandler.handleEvent`, `EventHandler.ts:238` re-signs, `websocket.ts:44-46` publishes. `EventSigner.signEvent` copies `created_at` and `tags` verbatim and only swaps the pubkey (**§6.2 of v1, confirmed by F5**). **[S]**

### 2.6 The reserved list

`sdk/config/vanity.ts:51-89` and `platform/server/VanityManager.ts:6-44`: **37** names each, identical sets — `sed -n '51,89p' sdk/config/vanity.ts | grep -c "'"` → **37**. **[M]** `home`, `featured`, `auctions`, `blog` are **not** in it. **[M]** The grammar is `/^[a-z0-9][a-z0-9_-]{1,28}[a-z0-9]$/` (`sdk/config/vanity.ts:171-175`; server copy `VanityManager.ts:182-186`): 3–30 chars, alnum + `-`/`_`, alnum at both ends. **[S]**

Note the standing hazard the review found (F7 case 1) and this design keeps: `auctions` is a real top-level route and not reserved, so a claim on it would be dead on arrival under `/$vanityName` if TanStack ever prefers the static segment. **[J]** This design does not depend on router precedence: the **write** path refuses any name that is a real top-level segment, from a list compiled at build time (`platform/web/routeTree.gen.ts`), and that list is enforced server-side from a checked-in constant, not inferred at runtime.

### 2.7 Verdict on the bet

| claim of the bet | verdict |
|---|---|
| one event per page removes the size ceiling and the shared write | **upheld** — 30024 is addressable, the reader is already `(author,d)`-generic, only a constant blocks it |
| one event per path makes v1's clobber impossible | **upheld** — a write at `d='shop'` cannot name another path; the failure mode becomes "this one path is wrong", which is recoverable by rewriting one small event |
| per-path events make a name **uniquely** held across concurrent buyers | **REFUTED as stated.** Addressability is per `(kind, pubkey, d)`; two different keys can each publish `d='shop'`. Uniqueness needs one signing key **and** one serialisation point. This design supplies both (§4.3) and says plainly that the serialisation point, not the event model, is what makes it atomic |
| payment proof can be verified with no relay | **upheld for zaps** (a 9735 is self-contained once stored); **refuted for nutzaps** (a proof is only checkable by redeeming at the mint; after redemption the evidence is a *record of redemption*) |

The bet survives in the form that matters — **the write-path collision class is gone** — and is downgraded where it was over-claimed. The next section is built on the surviving part.

---

## 3. The model

### 3.1 Four things, four writers

```
kind 30024  PAGE          author = the page's author        one per (author, d)     unlimited
kind 30025  PATH CLAIM    author = the app key (only)       one per (appkey, d)     one per path
kind 30026  SITE DEFAULT  author = the app key (only)       one, d='site'           one per site
kind 9735 / 9321  PAYMENT payer-signed 9734 / 9321          one per payment         append-only
```

Two of those are new kinds, which `AGENTS.md:63-64` explicitly forbids adding without "code, tests, and documentation that make the decision explicit". This design accepts that cost and pays it: both kinds are specified here, get a pure parser module with its own test file, and are documented in the same commit. The alternative — overloading 30000 — is what produced the clobber.

Kind numbers checked free: the kinds in use across `sdk/` and `platform/` are `30000 30003 30018 30023 30024 30078 30311 30402 30405 30406 30408 30409 30440 30441 30442 31990` (`grep -rhoE '3[0-9]{4}' --include=*.ts sdk platform | sort -u`). **[M]** 30025 and 30026 are unused; 30025 sits beside 30024 deliberately (a claim is about a page).

### 3.2 The page (30024) — unchanged, plus two optional tags

```
["d", <pageId>]                 1..64 chars, unique per author by addressability
["title", <string>]             existing (storefrontPublish.ts:63)
["t", "series:<name>"]          0..1 — series membership, for R3
content                         unchanged: version 1 JSON (storefrontPage.ts:37)
```

`t` is used rather than a `series` tag because NIP-01 guarantees indexing for single-letter tags only, and the repo's own filter type is generic over `#<tag>` (`filter.ts:10-11`) but relays are not (`#t` is the only indexed hashtag in practice). Nothing in the parser reads tags — `parseStorefrontPage` reads `content` only (`storefrontPage.ts:592-…`) — so an old client ignores the extra tag. **[S]**

The page's `d` is **its identity, not its path**. Two paths may point at one page (an alias); one path points at exactly one `(author, d)`. That is what keeps R2 (a unique path per page) enforceable at a single place — the claim — instead of hoping authors coordinate.

### 3.3 The claim (30025) — the whole of "ownership"

```
["d", <path>]                         lowercase; grammar + reserved list + not-a-real-route (§2.6)
["target", "page", <author64>, <pageId>]
   | ["target", "series", <seriesName>]
   | ["target", "profile", <pubkey64>]
["tier", "admin" | "editor" | "reservation"]
["holder", <64-hex pointer>]          who owns the right
["editor", <64-hex>, ...]             0..n — per-path grants (the editor tier's second power)
["term", "0" | "<unixSeconds>"]       0 = permanent
["seq", "<n>"]                        monotone per path, from the server (§3.6)
["prev", <event-id>]                  0..1 — the claim this one replaces
["p", <pubkey>, "reassigned"]         0..1 — notice to a displaced holder
["payment", <event-id>]               0..1 — the proof artifact for a reservation
content                               '' — the claim is tags; a claim with content is malformed
```

A claim is **total for its path and nothing else**. That is the property the whole design buys: parsing one event answers "who holds `/shop`, until when, pointing at what, and who may edit it" completely, with no sibling events to consult. Today the same answer requires the whole kind-30000 event, which is why one write can destroy another namespace.

`term: "0"` is meaningful here where it is dead in the legacy registry: `resolveVanity` treats `0` as "expired since 1970" (`sdk/core/curation/vanityRead.ts:63`), and a 3-element vanity tag is dropped entirely (`:33`), which is why v1 chose a far-future sentinel. A new kind has no such baggage; `0` means permanent, and the claim parser is the only reader of that field.

Unknown `target` type, unknown `tier`, or a malformed claim: **dropped at the claim, never fatal**, matching the storefront parser's forward-compat precedent (`storefrontPage.ts:560-568`) and the ruling that a bad route must not blank the site. But — unlike v1 — the drop is **surfaced**: the parser returns `{ claim, issues[] }`, and the dashboard shows `issues` against the path. A silent drop is how a route "mysteriously stops working".

### 3.4 The default (30026) — the one legitimate shared event

```
["d", "site"]
["claim", <path>]      absent = no default
["seq", "<n>"] ["prev", <event-id>]
```

Why a singleton rather than a `["default"]` tag on the claim it names: a marker on the claim means **moving the default is a two-event write** (clear the old, set the new), and between those two events the site has either two defaults or none — precisely the cross-event inconsistency this design exists to remove. The singleton's entire content is one value, so rewriting it destroys nothing, and a move is atomic. **One writer, one value, one event.** That is the pattern applied at the only place where "one shared event" is not a compromise.

`/` resolution:

| state | what `/` renders |
|---|---|
| default names a path, that claim resolves, target renders | the target, through the existing `StorefrontRenderer` (`platform/web/routes/index.tsx:111`) with the **target's** author, not `APP_PUBKEY` |
| default names a path whose claim is absent / lapsed / unreadable | inline composition (`index.tsx:102`, `:81-101`) + an admin banner naming the broken path |
| default target exists but renders nothing (disabled, zero blocks, unparseable) | inline composition + banner (never a blank, never a spinner) |
| no 30026 at all | inline composition |
| relay error on the 30026 read | inline composition (bounded fetch, no cache to fall back on — F3's lesson: a bounded fetch has no stale value, so the *fallback* must be the inline page, not a spinner) |

`/` is never blank and never a 404 in any row. The floor is `order.md:84-85` and `ruling-acl.md:65-66`; the inline composition is a real page, so honouring it costs nothing.

**Non-page default:** refused at write. `index.tsx:111` renders through `StorefrontRenderer`; a profile or listing default would need a second renderer branch at `/` and would make the front page change shape by data. A `series` default *is* allowed, because a series resolves to a page.

### 3.5 Resolution of `/path`

```
0. claim = read (30025, appkey, d=path)                     ← one bounded fetch, cached 30s
   a. claim live (term 0, or term > now, or within grace for a reservation)
        page    → fetch (author, d) 30024 → render | honest "this route points at a page
                  that is not rendering" (no fall-through)
        series  → newest 30024, author=series holder, '#t'=["series:<name>"] → render
        profile → StorefrontOrProfilePage(pubkey)           ($vanityName.tsx:30-32 path)
   b. claim present but lapsed → "this address was reserved and has lapsed", NOT the
        app-key page. The holder sees the renewal warning before this happens (§5.5)
   c. claim present but malformed/unparseable → honest failure naming the path + admin banner
1. legacy vanity entry (kind 30000) → profile               ← today's behaviour, unchanged
2. app-key page at d=path                                   ← today's behaviour, unchanged
3. the existing deliberate empty state                      (StorefrontAddressPage.tsx:58-67)
```

Steps 1–3 exist so that **nothing an existing user relies on changes on day one**, and so increment 1 can ship before any claim is written. Step 0 precedes them so a claim always wins — including for `home`, which already renders something today (the app key's page at `d='home'`, `$vanityName.tsx:34-41`).

**No fall-through from a broken claim to step 2.** Falling through renders different content under the same URL and hides the failure; `AGENTS.md:110-115` requires a direct navigation to state which constraint failed.

### 3.6 `seq`, and why `created_at` is not enough

Two claims for `d='shop'` written in the same second are ordered by NIP-01 by `created_at`, then by the repo's tie-break of **smallest `id`** (`storefrontQuery.ts:44-60`) — arbitrary for a question of who owns a name. So the claim carries `seq`, monotonically increasing per path, and the reader picks the highest `(seq, created_at, id)`. **[J]**

Two consequences, both deliberate:

- **The server, not the client, sets `created_at`** — `max(now, prev.created_at + 1)`. This closes the hole v1's §6.2 found in the proxy (a client that sets a future `created_at` wins every replace until the clock catches up), because `EventSigner.signEvent` copies the client's `created_at` verbatim (`EventSigner.ts:17-25`).
- **A relay that keeps only the newest by `created_at` cannot lose the newest claim**, since the newest claim is also the greatest `created_at` by construction.

`seq` lives in the event, not only in the database, so a third party with the claim can order it without trusting the server's tables.

---

## 4. Ownership

### 4.1 What ownership *is*

Ownership of a path is: **the current live 30025 event at `d=<path>`**, whose `holder` is a pubkey. Nothing else. It is not a row in a database, not a flag in a page, not a role. This matters because it makes ownership **portable and checkable**: hand someone the claim event and they can verify the signature and read who owns the name, until when, and what it points at — without this server. v1 could not offer that: its reservation was a line inside a blob the operator rewrote wholesale.

Ownership is a **right to be the target of a name**, not ownership of content. The page inside is the author's, always (that is `storefrontPublish.ts:15-18`'s doctrine, preserved). Reassigning `/shop` from Alice to Bob does not touch Alice's page; it changes which page `/shop` shows.

### 4.2 How it transfers

| operation | who | what is written | what the displaced holder gets |
|---|---|---|---|
| create a claim on a free path | editor (self-service), admin | one 30025 | — |
| admin grants an editor access to a path | admin | rewrite that one 30025, adding `["editor", pk]` | — |
| transfer | admin | new 30025, `holder` = new, `prev` = old, `["p", old, "reassigned"]` | a findable notice: `{kinds:[30025], '#p':[me]}` |
| reassign a reserved path | admin | same as transfer, and the old `payment` tag is **retained** as history (`prev` chain) | the notice, and the term is not refunded (stated cost) |
| lapse | time | nothing | warnings at 14 and 3 days (§5.5) |
| reclaim after lapse | anyone | new 30025 with `prev` = the lapsed one | the lapsed holder still sees their old claim's `prev` chain |

The `p`-tag notice is the answer to the ruling's "the loser is told" (`ruling-acl.md:47-48`) in a way that survives a redesign of the dashboard: it is queryable by the affected person, from any client, forever.

**History is preserved where relays cannot.** NIP-01 keeps only the newest addressable event, so the relay forgets the previous claim — v1's D11 admitted exactly this and offered a JSON export. Here the server's event log keeps every version (`claim_versions`, §5.3), so a reassignment is auditable and a mistaken transfer is reversible by republishing the previous holder with a new `seq`. That is a genuine gain from "persist the events", not from "persist the routes table".

### 4.3 The honest limit, and the mechanism that covers it

Per §2.7, addressability does not stop two keys publishing `d='shop'`. Three things together do:

1. **Only the app key may author a claim.** The reader (`30025` filter pinned to `authors:[appkey]`, mirroring `vanityRead.ts:24`) ignores every other author. So a hostile claim is not a claim — it is an event nobody reads. **[J]**
2. **The server serialises.** There is one process, and the claim write is a single synchronous step against a `UNIQUE` constraint (§5.3).
3. **The name is reserved at invoice time, not at settlement** (§5.4). This is the piece that makes it *atomic for money*: the scarce name is claimed in the reservations table when the invoice is issued, so two buyers cannot both pay for `/shop`.

**What this costs, stated plainly:** the claim namespace has **one writer — the server**. The bet's "every thing its own writer" is honoured for pages and payments, and is *deliberately abandoned* for names, because a scarce name is a consensus problem and three independent claims need an arbiter. A design that refuses that trade (holder-signed claims, uniqueness settled at read time) is a legitimate different bet; it buys censorship-resistance of the name record and gives up atomicity. I chose atomicity. §11 says so again in the cost table, and §13 makes it the strongest objection to this candidate.

---

## 5. Payment

### 5.1 Two rails, one interface

```ts
type PaymentRail = 'zap' | 'nutzap'

interface PaymentRecord {
  id: string            // the proof event id (9735 or 9321)
  rail: PaymentRail
  payer: string         // the pubkey that signed the 9734 / 9321
  path: string
  sats: number          // computed server-side, never from a client field
  proof: string         // the raw signed event, stored verbatim
  verification: string  // JSON: what was checked and the outcome
  verifiedAt: number
}
```

A payment is **one signed artifact plus the checks that were run on it**. Persisting the artifact is what makes the checks re-runnable with no relay (`ruling-d3 §2`); persisting the checks is what makes the record *auditable* — a later reader can see whether the server verified a bolt11 or merely looked at it.

### 5.2 Zap purchase — with the verification v1 does not do

Invoice time (`POST /api/routeReserve`):

1. Check the path is claimable: no live claim, or a lapsed one past grace; not reserved; not a real route; grammar valid (§2.6).
2. **Insert a reservation row** `(path PRIMARY KEY, payer, invoice_pr, sats, rail, state='pending', expires_at=now+900)` — this is the atomic name claim (§5.4). A `UNIQUE` violation on `path` → `409`, with the reason ("held by an admin route"/"held by another reservation until <ISO>").
3. Ask the LNURL callback for the invoice at `amountSats * 1000`, and **remember** `pr`, `payment_hash`, `sats`, `path`, `payer`.
4. Return the invoice.

Settlement (`9735` received — subscribe to the app's `#p` as today, `EventHandler.ts:169-196`):

1. Verify the 9735's own signature.
2. Parse `description` → the 9734. **Verify the 9734's signature** and take `payer = zapRequest.pubkey`. v1 does not verify the embedded request's signature anywhere in the accept path; it only requires one at invoice time (`:286-288`).
3. Look up the reservation by `path` **and** by `bolt11 === reservation.invoice_pr`. **No reservation → reject.** This is the check that cannot be forged: it binds the receipt to an invoice *this server issued for this path*.
4. Decode the bolt11 amount and require it to equal `reservation.sats`. **Not** the `amount` tag on the zap request (which is the payer's claim, `:175-177`).
5. Require `reservation.payer === payer`.
6. Require the 9735 author to be in the configured LN-service pubkey set (the app's node) — otherwise anyone can sign a "receipt".
7. Only then: persist the 9735 verbatim, write the `payments` row, write the 30025 claim with `["payment", receiptId]`, `term = reservation.sats → tier seconds` (pricing kept from `VanityManager.ts:47-55`), `holder = payer`, and mark the reservation `paid`.

Steps 3, 4 and 6 are the three that turn "the payer told us they paid" into "we have an invoice we issued, paid, for the amount we asked, attested by our node". v1's §6.3 claim 6 ("the term is computed from the receipt, never accepted from the client") is true of the *term* and false of the *amount*; this closes it.

**Cost:** the server now stores `invoice_pr` for every pending purchase, i.e. it holds payment identifiers. That is a privacy change, small but real, and it is the price of atomicity.

### 5.3 Nutzap purchase — what is genuinely different

1. The buyer sends a 9321 with P2PK-locked proofs to the app's mint key, `['u']` = the app's mint, `['p']` = the app's pubkey, and a `['t','route-reserve']` + `['route', path]` pair.
2. The server **computes `sats` as the sum of the proofs** — never from a tag.
3. The server **redeems** (swaps) the proofs at the mint with `@cashu/cashu-ts`. Redemption success is the verification: it proves the proofs are unspent and valid. Structural validation first, using the existing `validateNutzap` (`nutzap.ts:355-…`) against the app's own 10019.
4. Persist: the 9321 verbatim, the swap response, and the resulting proofs. Mark the payment verified; write the claim with `["payment", nutzapId]`.

**The honest asymmetry, stated because it is easy to hide:** a zap receipt stays **third-party verifiable** forever (a signature over a payment the node attests). A nutzap is **not** — after redemption the proofs are spent, and only the mint can say anything about them. The durable artifact is therefore *our record of a successful swap*, not a portable credential. Anyone auditing a nutzap reservation is trusting the operator's stored swap response. That is weaker than the zap case and it should be written in the dashboard, not just in this document.

**Cost:** the server must hold a Cashu wallet and a mint account; a mint outage fails new nutzap purchases closed (consistent with the ruling's "a failed receipt check for a new purchase fails the reservation"), while existing claims are untouched because they are maintained for their lease without re-verification. **[S]** on the ruling (`ruling-d3 §1`), **[J]** on the operational risk.

### 5.4 The reservation row is what makes a scarce name atomic

```
reservations(
  path TEXT PRIMARY KEY,        -- ← the atomic claim
  payer TEXT NOT NULL,
  rail TEXT NOT NULL,
  invoice_pr TEXT,              -- null for a nutzap (paid in one step)
  sats INTEGER NOT NULL,
  state TEXT NOT NULL,          -- pending | paid | expired | cancelled
  created_at INTEGER, expires_at INTEGER
)
```

`path` is the primary key, so the database — not application code — refuses the second concurrent buyer. `INSERT … ON CONFLICT DO NOTHING` + `changes()` is the whole concurrency story: one process, one statement, one winner. **[J]**

- A pending reservation holds the name for 15 minutes. **Cost:** someone can deny inventory for 15 minutes by opening invoices. Mitigations: one pending reservation per payer per path, a cap of N pending per payer, and the reservation is released on `state='expired'` by a sweep. None of these eliminates the attack; they bound it. Say so.
- A paid reservation becomes a claim; the row is kept (it is the link from path to proof).
- If settlement arrives after the reservation expired and the name is still free, accept it; if the name has since been claimed by someone else, **refund path** — the money is real, and this design's answer is "the operator refunds", not "the system prevents it". That is a service obligation, and it is the same shape the ruling already accepted when it said the admin can always reassign.

### 5.5 Lapse, grace and renewal

- At `term`, the claim **stops resolving for everyone** (the client checks the same predicate; no server round trip).
- **14-day grace**: nobody else may claim it; only the holder may renew. Encoded in the claim by keeping the event (it is the evidence of the term) and in availability as `term + 14d`.
- Holder is warned at 14 and 3 days — reuse the existing display hook (`dashboard/account/vanity-url.tsx:113-150`, `formatExpiration` → `daysLeft` / `isExpiringSoon`).
- After grace the path is free for any tier.
- Shipping the exact `validUntil` semantics the registry already has is deliberate: `ruling-acl.md:28-31` says the field *is* the reservation's semantics, and reusing them means no user-visible change in what "my name expired" means.

---

## 6. Persistence

### 6.1 The layer

```
platform/server/eventStore/
  sqliteEventDatabase.ts     implements IAsyncEventDatabase (12 methods, applesauceEventStore.ts:23-38)
  serverEventLog.ts          createApplesauceEventStore({ database, admission }) + append-only raw log
```

`bun:sqlite`, zero new dependencies (measured, §2.2). One file, `data/events.sqlite` (path from config, created on boot). Tables:

```
events(id TEXT PRIMARY KEY, kind INT, pubkey TEXT, d TEXT, created_at INT, tags TEXT, content TEXT, sig TEXT)
  UNIQUE INDEX ON (kind, pubkey, d) WHERE d IS NOT NULL      -- one current addressable event
event_history(seq INTEGER PRIMARY KEY, id TEXT, kind INT, pubkey TEXT, d TEXT,
              created_at INT, received_at INT, tags TEXT, content TEXT, sig TEXT)
  -- append-only; nothing is ever updated or deleted here
```

`event_history` is the source of truth. `events` is the current-state index; `claims`, `reservations`, `payments` are all projections over `event_history`. **Every projection is rebuildable**: `rebuildClaims()` folds the newest claim per path by `(seq, created_at, id)`. **[J]**

### 6.2 Why this is a materialised view and not an authority

- The relays still carry the claims and the pages; a browser with no server reads them directly. The server's tables make the dashboard fast, the payment checks offline, and the concurrency serialised — they do not make the site work.
- If a projection is wrong, it is recomputed, not repaired. That is the whole difference from v1, where the in-memory map *was* the state and `publishRegistry` wrote the map back to the world.
- Consequence: a server that loses its database loses **history and pending reservations**, not routes. Boot re-reads claims from the relay and rebuilds. That is a materially better failure mode than v1's, where restart loses every receipt (§2.3).

### 6.3 What must be persisted, and what need not

| thing | persisted? | why |
|---|---|---|
| every 9735 receipt + its embedded 9734 | **yes**, verbatim in `event_history` | the ruling's requirement; re-verifiable offline |
| every 9321 + the mint's swap response | **yes** | the only evidence a nutzap was ever worth anything |
| every claim version | **yes** | relays keep only the newest; reassignment history and reclaim need the chain |
| pages | **no** (the author's, on relays) | the server must not become the page store; that is the user's event |
| the current routes view | **derived** | rebuildable, disposable |
| editor grants | **no separate store** | a grant is a tag on the claim it grants (`["editor", pk]`) — one path, one event |

**Admin reassignment is therefore not a special mechanism** — it is a claim write, and the audit trail is the event log. That is the concrete answer to the ruling's "the admin can always reassign" (`ruling-d3 §1`).

---

## 7. The three tiers, in this model

| tier | what they may do | how it is enforced | what they cannot do |
|---|---|---|---|
| **admin** | claim/rewrite any path, set the default, grant an editor a path, reassign a reservation | `adminManager.isAdmin` (`EventValidator.ts:85-93`) + a content validator that permits any `d` | — |
| **editor** | (a) publish pages, unlimited, as themselves; (b) claim any **free** path; (c) rewrite a claim on a path where they are listed in `["editor", …]` | (a) needs no server at all (`storefrontPublish.ts:81-99`); (b,c) the server checks `isEditor(pk)` **and** the grant tag on *that* claim | touch a path they are not granted; take a path held by a reservation |
| **paid** | reserve a path for themselves for a term, self-service, after paying | reservation row + verified proof; only on a free path | take an admin/editor claim; keep it past term + grace |

Two properties fall out that the ruling asked for and v1 could not express:

- **"Editors can create and publish pages to new places"** is satisfied *without a grant*: an editor may claim a free path self-service. Their pages are their own events. No admin in the loop. The ruling's two editor powers separate cleanly — creation is broad, *access to an existing path* is granted (`ruling-acl.md:17-20`).
- **Grants are per-path by construction.** A grant is a tag on the claim for that path; there is no such thing as a blanket editor right in the schema, so the "specific access to specific paths" cannot be accidentally widened by a role check.

Conflict precedence is then not a ranking — it is **who may write this event**:

1. admin: always;
2. editor: only on a claim they hold, or one that lists them;
3. paid: only when no live claim exists.

And collisions between tiers are settled at **write** time by the `UNIQUE(path)` row and the claim read, not by a read-time merge of two truths. This is the one piece of v1's D4 that measurement did not refute; it was refuted only in its *storage* assumption (F2), which is why it survives here unchanged in principle.

---

## 8. R1–R4, and the list follow-up

**R1 — hundreds of pages per author.** One event per page. `storefrontPublish` gains a `dTag` parameter (`:53-71`), default unchanged so existing callers keep publishing to `'storefront-page'`. A hundred pages = a hundred events, each under the existing 100-block cap (`storefrontPage.ts:43-50`). No ceiling but the relay's. **[S]**

**R2 — a unique path per page.** The claim's `d` is the path and the claim address is unique per path; a second claim replaces the first rather than coexisting. The page itself may be reused by an alias; that is a feature, not a violation.

**R3 — `/featured` resolves to the newest page of that kind.** A claim with `["target","series","featured"]`. Resolution: `{kinds:[30024], authors:[holder], '#t':['series:featured'], limit:1}` — one REQ, newest by `created_at` with the repo's tie-break. Two decisions worth naming:

- **The series is restricted to the claim holder's pages** (`authors:[holder]`). Without that filter, any user could publish a page tagged `series:featured` and become `/featured` — a name takeover by hashtag. This is a real hole in the naive reading of R3 and the `authors` filter closes it.
- **The series name is not the path.** `/featured` may point at `series:weekly`; the two namespaces stay separate so a claim can be renamed without republishing pages.

**R4 — the home is just another path.** `/` reads 30026 → a path → the same resolution as §3.5. There is no privileged page, no `APP_PUBKEY` special case. `index.tsx:57`'s hard-wired `useStorefrontAddressPage(APP_PUBKEY, 'home')` becomes "the default claim, resolved", and the hard-coded hex at `:48` stops being a second source of app identity.

**`list` — marked follow-up, with the room made now.** A claim target is a **tag list**, not a coordinate: `["target","list",<listId>]` parses under the same grammar and currently resolves to a "not yet supported" state. The CMS reference model therefore has a slot for "the members of the named list" without reopening the target union. No list machinery is built here (`ruling-d8 §3`).

---

## 9. The clobber: impossible by construction, and pinned by a test

**v1's mechanism, measured:** `publishRegistry()` rebuilds the whole kind-30000 event (`ZapPurchaseManager.ts:393-407`) from `this.registry`, a map populated only from `vanity` tags (`VanityManager.ts:97-112`). Every receipt therefore erases everything else in that event. It is not a race; it is every purchase (F2).

**This design's structural answer:**

1. No route, default, grant or reservation is ever written into kind 30000. The write is at `d=<path>` (30025) or `d='site'` (30026). **A write for one path cannot name another path** — the address is the isolation boundary.
2. The reservation path stops writing kind 30000 at all (§10, step 4). `publishRegistry` is not "fixed"; it is **left with no route-shaped callers**, and the only thing it can still rewrite is the vanity namespace it owns.
3. The worst case becomes: *this one path's claim is wrong*, recoverable by republishing it, with the previous version in `event_history`. That is a bounded, auditable failure instead of a silent, unbounded one.

**The regression test the ruling asked for and v1 lacked** (`ruling-d3 §3.5`), written as an executable assertion in increment 1's successor:

```
given  claim(home → page), claim(shop → page), default = 'home'
when   a legacy kind-30000 registry event is published (the old code path)
then   both claims still resolve, and '/' still renders the home page target
```

Plus the inverse, which is the one that would have caught F2:

```
when   a reservation for 'shop' settles
then   the claim for 'home' is byte-identical, and the 30026 default is unchanged
```

Both are cheap because the two things live in different events.

---

## 10. Migration from today's state

Six steps, each independently shippable, each leaving the site working. No flag day.

**Step 0 — freeze the base.** Work on `unite/1420-all`, never `master` (`order.md:37-46`). The 205-error typecheck baseline (`order.md:132-134`) is the gate for every step.

**Step 1 — pages get their own address (R1).** `buildStorefrontPageEvent(page, dTag = STOREFRONT_PAGE_D_TAG)` and `publishStorefrontPage(page, dTag)`. Reader untouched (`fetchStorefrontPage` already takes `dTag`, `storefrontQuery.ts:75`). *User-visible immediately:* an app-key page published at `d='featured-13-11-2026'` is reachable at `/featured-13-11-2026` through the existing fall-through (`$vanityName.tsx:34-41`). **This is increment 1's second half.**

**Step 2 — the claim type, read-only (increment 1).** `sdk/core/routing/pathClaim.ts` + tests; `/path` prefers a claim; `/` prefers 30026. No writer yet. Claims can still be created by hand through the existing admin proxy (§12.4), which is enough to demo end-to-end.

**Step 3 — the claim writer and the validator.** `RouteClaimManager` (server), content validation in `EventValidator` (a new `routeClaim` branch, mirroring `validateRoleListEvent` `:63-72`), `seq`/`created_at` assignment, and the dashboard surface at `/dashboard/app-settings/routes` (prefix-gated by `useRootRedirects.ts:28,40-41`, with the editor's narrower power enforced server-side, not by the router).

**Step 4 — payments move to claims.** New reservation endpoint (zap), invoice registry, the three verification checks of §5.2, `payments` table. `vanity-register` receipts stop publishing kind 30000 and start writing claims. **From this step kind 30000 is frozen for new names** — old clients stop seeing new vanity names, which is acceptable because the client ships with the server and the legacy read path stays for old names.

**Step 5 — one-shot import.** For each live `vanity` entry in kind 30000, publish one claim (`target: profile`, `tier: reservation`, `term`, `holder`, `prev: none`). Idempotent (skip if a claim exists for that path). After it, kind 30000 is **read-only legacy**, and the reader can keep step 1 of §3.5 forever at near-zero cost.

**Step 6 — nutzaps.** Server Cashu wallet, redemption, the nutzap rail behind the same `PaymentRecord`. Last because it carries the new egress (`AGENTS.md:63-64`) and the weakest verification (§5.3).

**What this migration gives up:** between step 1 and step 5 there are **two truths** for a path — a claim if one exists, else the legacy registry. The reader's order is total and deterministic, so it never disagrees with itself, but during the window an admin can create a claim on a name a legacy entry also holds, and the claim silently wins. That is intentional (the claim is the newer, explicit instrument) and must be *shown* in the dashboard on create — the same warning v1's §5 identified for `home`.

---

## 11. What each decision gives up

| decision | what it buys | what it costs |
|---|---|---|
| one event per page | no size ceiling, no shared write, authorship preserved | N pages = N relay events; the dashboard needs the server projection to list hundreds (relays cap `limit`) |
| one event per path | the clobber becomes impossible; per-path audit; a portable ownership record | **the claim namespace has one writer: the server** — no self-sovereign names |
| claims signed by the app key only | uniqueness is representable and enforceable; one reader filter | a claim is an operator statement; a rogue operator can reassign any name (mitigated by `prev` chains + the event log, not prevented) |
| a singleton default event | moving the default is atomic | one more kind; a second source of "what is the front page" that must be kept consistent with the path it names (checked at read, banner at write) |
| reservation row with `UNIQUE(path)` | atomic purchase of a scarce name | 15-minute inventory denial is possible; one pending per payer is a mitigation, not a fix |
| invoice-bound zap verification | closes the amount-trust hole and replay of foreign invoices | the server stores `invoice_pr`; a lost DB loses pending invoices (money can arrive with no reservation — refund path) |
| nutzap support | a second rail, no Lightning dependency | server holds a wallet; new mint egress; proof is **not** independently re-verifiable after redemption |
| `seq` + server-assigned `created_at` | deterministic ordering; closes v1's future-`created_at` hole | the claim's `created_at` is not the wall clock the author observed (visible, explicable) |
| server event log over `bun:sqlite` | offline verification, history relays cannot keep, rebuildable projections | new infrastructure the ruling believed existed (§2.2); a data directory and a backup story appear where there was none |
| legacy read path retained | no flag day; old names keep resolving | two truths during the migration window; a permanent extra branch in the resolver |

---

## 12. Increment 1 — precise enough to execute

**Goal:** a page can have its own address, and a path can be resolved from an owner-signed claim. No payment, no server, no database. It delivers R1 and the read half of ownership, and it is reversible by reverting three files.

### 12.1 The change, file by file

1. **`sdk/commerce/storefront/storefrontPage.ts`** — add, next to `STOREFRONT_PAGE_D_TAG` (`:34`):
   ```ts
   export const STOREFRONT_SERIES_TAG_PREFIX = 'series:'
   export function isValidPageDTag(d: string): boolean   // 1..64, /^[a-z0-9][a-z0-9._-]*$/i, no ':'? see note
   ```
   Note: the page `d` allows `.`/`_`/`-` and alphanumerics; the **path** grammar is the stricter registry one (§2.6). They are different fields on purpose.

2. **`platform/web/storefront/storefrontPublish.ts`** — `buildStorefrontPageEvent(page, dTag?: string)` (`:53`) and `publishStorefrontPage(page, dTag?: string)` (`:81`); `const tags: string[][] = [['d', dTag ?? STOREFRONT_PAGE_D_TAG]]` at `:60`. Optional second argument, so every existing caller compiles unchanged. Validation before signing is untouched (`:54-57`).

3. **`sdk/core/routing/pathClaim.ts`** (new, framework-free, no React, no NDK):
   ```ts
   export const PATH_CLAIM_KIND = 30025
   export const SITE_DEFAULT_KIND = 30026
   export const SITE_DEFAULT_D_TAG = 'site'
   export type ClaimTarget =
     | { type: 'page'; author: string; dTag: string }
     | { type: 'series'; name: string }
     | { type: 'profile'; pubkey: string }
     | { type: 'list'; listId: string }          // parsed, resolves to "not supported yet"
   export interface PathClaim {
     path: string; target: ClaimTarget | null; tier: 'admin'|'editor'|'reservation'
     holder: string | null; editors: string[]; term: number   // 0 = permanent
     seq: number; prev: string | null; payment: string | null
     notices: Array<{ pubkey: string; reason: string }>
   }
   export function parsePathClaim(event): { claim: PathClaim | null; issues: string[] }
   export function buildPathClaimTags(claim): string[][]
   export function claimIsLive(claim, now): boolean
   export function claimGraceEndsAt(claim): number
   export function pickCurrentClaim(events): PathClaim | null      // (seq, created_at, id)
   export function parseSiteDefault(event): { path: string | null; seq: number; issues: string[] }
   export function resolvePath(input: { claim, vanity, now }): Resolution   // pure precedence
   ```
   `resolvePath` returns a discriminated union — `claim-page | claim-series | claim-profile | claim-lapsed | claim-broken | legacy-vanity | address-page | empty` — so the component contains no branching logic and the rule is unit-testable without a DOM. **This is the piece that keeps increment 1 from needing a router harness.**

   Unknown target type / bad tier / non-hex holder / missing `d`: `claim` still returned with `target: null` and an `issues` entry; `resolvePath` maps that to `claim-broken`. Never throw. Never silent.

4. **`platform/web/routing/claimQuery.ts`** (new) — mirrors `storefrontAddressPageQueryOptions` (`storefrontQuery.ts:128-136`): a bounded `fetch` of `{kinds:[30025], authors:[appPk], '#d':[name]}` and of `{kinds:[30026], authors:[appPk], '#d':['site']}`, `staleTime: 30_000`, `enabled: isValidHexKey(appPk)`. **`retry: false` and no `throwOnError`**, so a relay failure is a value, not a hang.

5. **`platform/web/routes/$vanityName.tsx`** — replace the body's resolution with:
   ```tsx
   const claimQ = usePathClaim(vanityName, appPk)
   const resolution = resolvePath({ claim: claimQ.data?.claim ?? null, vanity: vanityActions.resolveVanity(vanityName), now })
   if (resolution.kind === 'claim-page') return <StorefrontAddressPage dTag={resolution.dTag} author={resolution.author} />
   ... existing StorefrontOrProfilePage / StorefrontAddressPage branches, unchanged ...
   ```
   **While the claim query is loading, fall through to today's behaviour** (`isLoaded` gate → vanity → address page). Do **not** add a new loading state: F3 showed that a bounded fetch has no cache, and a spinner here would be a regression on every cold load. The claim simply wins a frame later.

6. **`platform/web/storefront/StorefrontAddressPage.tsx`** — add the `author` prop (`:29`), defaulting to `config?.appPublicKey` exactly as today (`:31`), so every existing call site is unchanged.

7. **`platform/web/routes/index.tsx`** — `useSiteDefault(appPk)` then resolve; keep `publishedHome ?? inline` (`:102`) as the terminal fallback in every failure branch.

### 12.2 Tests

- `sdk/core/routing/pathClaim.test.ts` — ~24 tests: grammar accept/reject table (mirroring `sdk/config/vanity.ts:171-175`), reserved-name refusal, claim round-trip (`parse(build(x))` deep-equals `x` for a **shuffled** tag order — F9's lesson), `term:0` is permanent, lapsed, grace window, `seq` ordering incl. equal `created_at` and equal `seq`, unknown target dropped with an issue, `list` parsed but unsupported, 30026 with no `claim` tag = no default, duplicate default claim tags = first wins **plus** an issue.
- `sdk/core/routing/resolvePath.test.ts` — the precedence matrix of §3.5 as a table-driven test: claim beats legacy vanity; legacy beats address page; broken claim does **not** fall through; lapsed claim does **not** fall through.
- `platform/web/storefront/storefrontPublish.test.ts` — publish with an explicit `dTag` produces `['d', <dTag>]`; publishing with none produces `['d','storefront-page']` (regression guard).
- No component test in increment 1 — deliberate: the resolution rule lives in the SDK precisely so that the untested part is three lines of JSX.

### 12.3 Exit criteria

| # | criterion | command |
|---|---|---|
| 1 | typecheck unchanged at **205** | `NODE_OPTIONS=--max-old-space-size=12288 /home/admin_maxime/.bun/bin/bun bunx tsc --noEmit \| tail -1` — the baseline is the orchestrator's (`order.md:132-134`), not re-derived here |
| 2 | new module green | `bun test --isolate sdk/core/routing/` → all pass |
| 3 | no regression where this touches | `bun test --isolate platform/web/browse/` → **168 pass, 0 fail** (the isolated number is the only honest one; the unisolated run is 153/15 pre-existing, `order.md:143-147`) and `bun test --isolate platform/web/routes/` → same pass count as before the change, quoted |
| 4 | storefront publish unchanged for existing callers | `bun test --isolate sdk/commerce/storefront/ platform/web/storefront/` → same counts as before |
| 5 | manual acceptance, no server code needed | see §12.4 |

### 12.4 Manual acceptance — executable today

The existing WS proxy already accepts a kind-30025 event from an admin and re-signs it as the app key: `EventValidator.getEventType` classifies anything unlisted as `general` (`:30-31`, `:47`), `validateGeneralEvent` requires only `isAdmin` (`:85-93`), and `EventHandler.handleEvent` re-signs (`:238`). `platform/web/app-settings/appSettingsSubmit.ts:22-40` is a generic `['EVENT', …]` submitter despite its name.

1. As an admin, build and sign a 30025 with `d='featured-13-11-2026'`, `target=['page', <editor pubkey>, 'featured-13-11-2026']`, `tier=editor`, `holder=<editor pubkey>`, `term=0`, `seq=1`; submit it.
2. As the editor, publish a page with `dTag='featured-13-11-2026'` (step 1 of §10) containing one heading block.
3. Visit `/featured-13-11-2026` → the editor's page renders, authored by the editor, not the app key.
4. Visit `/home` → unchanged (no claim there).
5. Publish a 30026 with `["claim","featured-13-11-2026"]` → `/` renders the editor's page.
6. Publish a 30026 with no `claim` tag → `/` returns to the inline composition, not blank.

Each step is a browser action plus one signed event; no build, no deploy, no database.

---

## 13. Risks, unverified items, and the strongest objection to this candidate

**UNVERIFIED / not measured here**

- Relay behaviour at hundreds of events per app key, and whether the production relay enforces `limit` low enough to matter for the dashboard list. **[U]** — the server projection exists partly to make this irrelevant, which is a hedge, not a measurement.
- The underpayment path of §2.3 is reasoned from the code; I did not run it against a live LN node. **[U]** on exploitability, **[S]** on the code path.
- Whether `@cashu/cashu-ts@5.0.0-rc.4` can redeem P2PK-locked proofs server-side as this design assumes. The SDK already constructs them (`nutzap.ts:195-222`), but the redeem half is unexercised on the server. **[U]**
- `bun:sqlite` concurrency under the server's async load (single process, `WAL` mode assumed). **[U]** — small, but it is the piece the atomicity rests on.

**Known weaknesses I am not hiding**

- **15-minute inventory denial** via pending reservations (§5.4). Bounded, not eliminated.
- **The refund path is a human obligation**, not a mechanism (§5.4). Money can arrive for a name that was taken in the gap.
- **Two truths during migration** (§10).
- **Nut zap evidence is weaker than zap evidence** and the UI must say so (§5.3).

**The strongest objection to this design**

> The bet is "one writer per event", but the one place where it would matter most is the one place the design refuses to apply it: the name. Claims are app-key-signed because a scarce name needs an arbiter, and once you say that, the interesting properties of the redesign — censorship-resistance, verifiability, no privileged writer — collapse back to v1's shape: *the operator's statement about who owns what*. What the design actually buys over v1 is (a) the clobber is impossible and (b) history survives, and both of those are consequences of **splitting the table into per-path rows**, not of any deep property of events. A relational table with a primary key and an audit log would have delivered (a) and (b) with less ceremony and no new event kinds. So the honest description of this candidate is "v1's trust model, with the table normalised into events". Anyone who wants the stronger thing has to bet the other way — holder-signed claims, uniqueness settled at read time, and the operator demoted to a hint.

**My answer, not a rebuttal:** that is a correct description, and the design should be judged on whether the normalisation is worth the ceremony. I think it is, for three reasons that a table alone would not give: the claim is a **portable, signed statement** a user can hold and show; the read path works with **no server at all**, so the site survives the operator's absence even though it cannot survive the operator's malice; and pages, claims and payments land in **one storage and verification model**, so the event log that makes payments checkable offline is the same one that makes reassignment auditable. If the maintainer weights "no privileged writer" above those, this is the wrong candidate — and the fact that another designer may bet exactly that way is the reason to run three.