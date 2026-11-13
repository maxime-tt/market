# Design B — the server is the authority; Nostr is a publication

**Commission:** `runs/2026-11-13-admin-routes/` · ruling-d3-persistence-and-redesign §4
**Base:** `/home/admin_maxime/work/market`, branch `master`, HEAD `6541bcc3d` · source tree read-only, no branch, no build, no deploy
**Author role:** independent candidate B of three. This document is the only artifact I produce.

**Labels used throughout:** **[M]** measured by me at this HEAD with the command shown · **[S]** read
from source at the `file:line` given · **[J]** judgment, mine, arguable · **[U]** unverified.

**How to answer:** ACCEPT / REFUSE / ACCEPT WITH. Each decision below states what it costs. If one
decision is wrong, name its number; the others do not depend on it being right.

---

## 0. The bet, in one paragraph

The owner's instinct — *persist the proofs and the routes in the server's own store* — is not a patch
on v1, it is a different system, and it should be taken all the way: **the server owns a real database
of routes, ownership, leases, grants and payment proofs; it is the single source of truth; it enforces
the ACL there, verifies payments there, and resolution is answered from it with no relay in the path.
Nostr becomes a one-way projection: signed, published, auditable, portable — and never the authority.**

Two failures of v1 die by construction rather than by test:

1. **The clobber** (`ruling-d3` §3): v1 has no table, it has an in-memory `Map` (`ZapPurchaseManager.ts:62`)
   that is serialised wholesale over a live event (`:393-418`). With one relational table and one
   serialiser that reads *that table*, "the publish step drops what the map does not know" is not a bug
   to avoid — there is nothing else to know.
2. **Cold start**: v1 rebuilds its entire state from a relay fetch at boot (`:210-236`) and **takes
   payment for a name it then cannot store** if the relay is down at publish time (`:415-417` catches,
   logs, and loses the row on restart with the receipt suppressed by `:125-131`). With the authority in
   the database, boot reads a file.

What the bet has to buy with that is the whole of §9: when Nostr stops being the authority, the operator
becomes both the point of control and the point of failure, and the design has to say out loud what that
costs.

---

## 1. What measurement did to the bet

I was asked to test the hypothesis, not defend it. Three results.

### 1.1 Upheld

- **There is no server-side persistence of any kind.** `platform/server/` contains no database, no
  `bun:sqlite`, no file-backed store. The applesauce event store the owner cites is used **only** by the
  browser (`platform/web/applesauceReadContext.ts:100`, `platform/web/ndkReadContext.ts:79`), never by
  the server:
  ```
  $ git grep -ln 'createApplesauceEventStore' -- platform/ sdk/ | grep -v test
  platform/web/applesauceReadContext.ts
  platform/web/ndkReadContext.ts
  sdk/core/event-store/applesauceEventStore.ts
  ```
  **[M]** So "the server owns a database" is genuinely new, and the direction is not an extension of
  live server machinery — it is the addition of the missing half.
- **The clobber is exactly as `ruling-d3` §3 describes it**, and worse than described: `publishRegistry`
  (`:393-418`) rebuilds from `this.registry`, whose only writer path is `buildRegistryTags`
  (`VanityManager.ts:110-112`) emitting `['vanity', …]` alone. I did not need to re-derive this — the
  adversarial review's F2 is correct and I verified its two load-bearing citations.
- **Payment verification machinery already exists server-side, in the sibling subsystem.** NUT-07 proof
  state is queried by `platform/server/auction-validator/nut7Poller.ts:24` and
  `.../mintReachability.ts:1`, both importing `sdk/commerce/payments/cashu/nut7.ts:116`
  (`checkProofStateBatch`). **[S]** So "the server can verify a Cashu payment without a relay" is not a
  proposal; it is code that runs today for auction bids. That is the strongest single fact in favour of
  the bet, and it was not in the brief.
- **The read seam is one choke point.** Every client read of a page, a table or a feed goes through
  `getReadContext()` (`platform/web/readContext.ts:130`), which dispatches on a **configuration value**,
  `readContextConfig.adapter` (`:110-121`), not on an import. **[S]** A server-backed read adapter is a
  third `ReadAdapterKind`, not a rewrite of consumers.

### 1.2 Qualified — my own bet was too strong, and I am correcting it

**"No relay dependency at all" is not achievable for page *content* without changing the publish path.**
The CMS publishes browser → relay with **no server round trip**: `platform/web/storefront/storefrontPublish.ts:23-26`
says so in the file's own doc comment, and `:95` calls `publishNostrEvent(signed)` directly. **[S]** The
server never sees the event unless it is subscribed.

The honest form of the bet, and the one this design implements:

> **No relay dependency for *resolution* and for *payment verification*.** Page content is served from a
> server-side cache of *signed* events; that cache is filled by the publish path being routed through the
> server (increment 2), not by trusting an unsigned copy. Read-authority and content-authority are
> separated: the server decides *which event answers this path*; the author's signature decides *what the
> event says*, and the client re-verifies it.

That separation is the design's spine, and it is what makes the loss in §9 survivable: the operator gains
power over **reachability**, not over **content**.

### 1.3 Refuted — two premises in the commission's own reasoning

1. **`platform/server/server-bootstrap-persistence.test.ts` is not evidence of server-side persistence.**
   I read all 103 lines. It constructs `AdminManagerImpl([pubkey])` and `BootstrapManagerImpl(admin,
   count, hasSetup, allow)` — in-memory `Set`s (`AdminManager.ts:5-9`) — and asserts bootstrap flag
   behaviour. There is no store, no database, no file, and no event in it. **[M]** `ruling-d3` §2 rests
   its first bullet on this file. The direction survives; the cited reason does not.
2. **The existing zap path never verifies the receipt.** `ZapPurchaseManager.handleZapReceipt`
   (`:113-207`) checks dedupe, age, the `L` label, the amount and the bolt11 tag's presence — and
   **never checks who signed the kind-9735**. There is no receipt-verification function anywhere:
   ```
   $ git grep -rn 'validateZapReceipt\|verifyZap\|nostrPubkey' -- sdk/ platform/ | grep -v test
   platform/server/ZapPurchaseManager.ts:40:	nostrPubkey?: string
   ```
   **[M]** — the field is declared on the LNURL response type and **never read**. The subscription is a
   `#p` filter on **seven public relays** (`EventHandler.ts:175`, `sdk/config/constants.ts:72-80`). So
   any party who can publish to any one of them can mint a free reservation by writing a kind-9735 with
   the right `L` tag. **[J]** I state the exploit as judgment, not measurement: I did not run it. But the
   absent check is measured, and it is the single most important thing "the server verifies payments
   there" has to fix.

### 1.4 The auctions ruling — does it bind routes?

The owner's words are quoted in `notes/HANDOVER-nostr-read-path-and-verdict-publish.md:15-19` and
restated as binding in `runs/2026-11-13-auctions-ui/order.md:36`:

> "the read path … should be 100% nostr based. So we should read from the nostr relays **in order to get
> the actual read path out of auctions**. That way we can view bids and listings directly … and then the
> validator blockchain becomes only for checking what bids were … the consensus layer."

**It binds auctions and it does not bind routes — but not because routes are exempt from the principle.**
Three reasons, in order of strength:

1. **Scope.** The sentence names its object: *"out of auctions"*. The cited problem is that auction state
   was being read by polling a **validator's** HTTP API (`/api/state` through the proxy at
   `platform/server/http/auctionsProtocol.ts:72-83`) — i.e. reading the **consensus** layer's view. The
   ruling separates consensus from read; it says nothing about a CMS.
2. **The reason does not transfer.** The reason NOT to read auctions from an API is that *a validator is
   an independent third party in a multi-party protocol*: reading one validator's view reintroduces the
   central dependency that consensus exists to remove, and makes the reader trust a party whose incentives
   are not the reader's. In the routes system there is no independent third party to preserve. The app key
   already signs every route write (`EventSigner.ts:16-26`, `EventHandler.ts:238`); the payment already
   goes to the operator's Lightning address (`lightning.ts:18-23`). The trust is **already** concentrated
   in the operator under v1. Moving the read onto the same party does not concentrate anything new — it
   makes the existing concentration legible.
3. **The cost the ruling names is real and I pay it in §9.** What the ruling protects is that an operator
   outage or a refusal cannot silently remove a reader's view. That is exactly the loss this design
   incurs, and denying it would be the dishonesty the commission is designed to catch.

**What I will not do:** claim the ruling endorses this. It is silent on routes, and the presumption it
creates ("reads should not depend on the operator's API") runs **against** this design. If the owner
intends that presumption as house doctrine rather than as an auctions-scoped rule, **this design is
refuted at the level of the bet, not at the level of a detail** — and the correct response is to reject
candidate B, not to patch it. I would rather say that here than discover it after increment 3.

---

## 2. The model

### 2.1 What a route *is*

A route is a **resolution record**: `path → target`, plus who may change it and until when. It is not a
document, not a page, and not an event. It is a row.

```ts
type RouteTarget =
  | { kind: 'profile';  pubkey: string }
  | { kind: 'page';     author: string; d: string }          // any author, not only the app key
  | { kind: 'series';   author: string; seriesKey: string }   // R3: newest member
  | { kind: 'listing';  pubkey: string; d: string; eventKind: number }
  | { kind: 'url';      url: string }                         // external, admin only
  | { kind: 'list';     listId: string }                      // RESERVED — see §4.4, not built

interface Route {
  name: string                 // lowercase, primary key
  target: RouteTarget
  tier: 'admin' | 'editor' | 'reservation'
  holder: string | null        // pubkey the grant belongs to; null for admin
  seriesKey: string | null     // set when this page is a member of a series ('featured')
  leaseId: string | null
  isDefault: boolean
  createdAt: number; updatedAt: number; updatedBy: string
}
```

`seriesKey` on the *member* (not the series route) is the decision that makes R3 exact: `/featured` is a
route whose target is `{kind:'series', seriesKey:'featured'}`, and its answer is the newest route row
with `seriesKey='featured'`. Membership is **declared by the author at publish time and enforced by the
server** (the server requires `name.startsWith(seriesKey + '-')`), not inferred from a string prefix. A
page called `featured-garbage` cannot join the series by accident, and a page cannot be in two series.
**[J]** This is a smaller rule than glob matching and it is checkable in one line of SQL.

### 2.2 Ownership

**Ownership is a lease over a name, held by a pubkey, with a source of authority and a term.** It is not
a property of the page, and it is not a property of the event. Consequences:

- **A page outlives its route.** Losing a name never deletes content; the page stays reachable at
  `/profile/{pubkey}` and by coordinate. This preserves the one thing `ADR-0006-cms-and-nostr-native-page-building.md:216-218`
  and `storefrontPublish.ts:23-26` both insist on — the page is the author's speech, the name is rented.
- **Transfer is explicit and recorded.** An admin reassigning a name revokes the old lease
  (`state='revoked'`, `revoked_by`, `revoked_at`) and creates a new one **in one transaction**. Nothing is
  deleted; the displaced holder still sees it, with its end reason. That is `ruling-acl.md:47-48` and
  `:65` ("the affected holder is informed") made mechanical.
- **Ownership is not a token.** There is no NFT, no signed transferable credential. **[J]** A transferable
  ownership token would be a second authority alongside the database and is exactly the kind of
  competing-writer problem that produced v1's clobber. One authority or none.

### 2.3 Leases and the term

```
leases(id, name, holder, starts_at, ends_at, state, payment_id, renews, revoked_by, revoked_at)
state ∈ active | grace | lapsed | revoked      (grace = now > ends_at, now ≤ ends_at + 14d)
```

- **`ends_at = 0` means perpetual** — admin and editor routes. This is the answer to `ruling-acl.md:28-31`
  ("admin and editor routes are permanent; a reservation is a term that lapses") using the existing field's
  shape without inheriting its trap: v1 reads `0` as "expired since 1970" (`vanityRead.ts:63`); a lease row
  reads it as "no term", and the two readers never share a code path.
- **Grace is derived, not swept.** `state` is computed from `now` versus `ends_at` at read time; no cron is
  needed for correctness. A sweeper exists only to clean rows. **[J]** This matters because v1 has no
  sweeper at all and therefore republishes expired entries indefinitely (research 01 §2, point 5).
- **Renewal extends from `max(now, ends_at)`**, matching the existing semantics at
  `ZapPurchaseManager.ts:190-193` so early renewal does not burn time.

---

## 3. Persistence

### 3.1 One file, two shapes

SQLite via `bun:sqlite`, WAL, one file at `ROUTES_DB_PATH` (default `./data/routes.db`). Precedent in this
repo, outside the Bun server: `contextvm/tools/rates-cache.ts:1-13` opens `bun:sqlite`, sets
`journal_mode = WAL`, and uses prepared statements. **[S]** Bun is 1.4.2 **[M]** (`bun --version`), so
`bun:sqlite` is built in — no new package.

Two shapes live in the same file because they answer different questions:

```
-- (a) authority: relational, because the questions are relational
routes(name PK, target_*, series_key, tier, holder, lease_id, is_default, created_at, updated_at, updated_by)
leases(id PK, name, holder, starts_at, ends_at, state, payment_id, renews, revoked_by, revoked_at)
grants(editor, pattern, granted_by, granted_at, revoked_at, PRIMARY KEY(editor, pattern))
payments(id PK, rail, payer, sats, state, quote_id, proof_event_id, proof_event, proof_author,
         payment_hash, verification, verifier, created_at, verified_at)
commands(id PK, actor, op, payload, decision, reason, result_seq, at)          -- append-only audit log
projections(seq PK AUTOINCREMENT, table_root, event_id, published_at, attempt)
CREATE UNIQUE INDEX one_default ON routes(is_default) WHERE is_default = 1;
CREATE UNIQUE INDEX one_payment_hash ON payments(payment_hash) WHERE payment_hash IS NOT NULL;

-- (b) content cache: an event store, because the questions are event-shaped
documents(author, kind, d, event_id, created_at, content, raw_event, sig_ok, fetched_at,
          PRIMARY KEY(author, kind, d))
```

`documents` is deliberately **an event store, not a table of pages**: it holds the full signed event JSON
and is served verbatim, so the client can and must re-verify the signature. It is exposed to the server as
an `IAsyncEventDatabase` so the server gets the existing `EventStorePort` semantics (replaceable rules,
deletion, `supersede`) for free rather than reimplementing them — `sdk/core/event-store/applesauceEventStore.ts:80-88`
takes a `database` option for exactly this.

**A hazard to be explicit about:** that adapter sets `verifyEvent: () => true` (`:87`, documented at
`:52-54`) — it *disables* signature checking by design, because admission is the port's per-kind contract.
A server store built on it therefore **must verify at ingest**, not at read. The design puts `sig_ok` on
the row and refuses to serve a `sig_ok = 0` document (§5.3).

### 3.2 The projection is a commitment, not a copy

The published event carries, besides v1's tags:

```
["seq",  "<monotonic integer>"]
["root", "<sha256 over the canonical, sorted tag list of this shard>"]
```

content: `{"v":1,"seq":…,"root":"…","at":…,"counts":{"routes":…,"leases":…}}`

Anyone holding an old projection can (a) recompute `root` from the event's own tags and confirm it is
internally consistent, and (b) compare it against a newer projection and **detect that history was
rewritten** — a route that silently changed holder without a lease row, or a name that vanished without a
`revoked` transition, produces an inconsistency the operator cannot edit away without also editing the
older copy the verifier holds. **[J]** This is the design's answer to "who can be compelled": the operator
can be compelled to stop serving, but it can no longer silently *rewrite what it previously asserted*
without leaving a detectable trace.

### 3.3 Sharding, and why the size ceiling stops being a protocol question

`ruling-d8` §2 item 1 is right: one replaceable event has a size ceiling, and hundreds of pages per author
plus tag encoding will reach it. Under v1 that argument is fatal because the event *is* the table. Here it
is an engineering detail:

- `d='vanity-urls'` keeps the **small, scarce** namespace: reservations, editor grants, admin routes, the
  default marker, the legacy `vanity` mirrors. This is the event every old client reads, and it stays
  small forever.
- bulk page routes go into shards `d='routes-<xx>'` (first two chars of the name, 256 shards max, created
  on demand), each published only when its contents change, each capped at 32 KB.
- One serialiser owns **all** of them; the shard set is a function of the table, not a parallel state.

**[J]** A protocol that shards its publication is still a protocol; a protocol whose *authority* shards is
a database. That distinction is only available once the authority is not the event.

---

## 4. Resolution

One endpoint answers everything; the client never assembles a route from parts.

```
GET /api/routes/resolve?path=<segment>
→ { status, route?, document?, seq }
status ∈ resolved | lapsed | none | broken | unreadable
```

### 4.1 `/name`

| # | case | what happens |
|---|---|---|
| 1 | route exists, lease `active`, target document present and parses | `resolved` — return the route **and the full signed target event** in one response |
| 2 | route exists, lease `lapsed`/`revoked` | `lapsed` — the client renders an honest state naming the lapse. **No fall-through** |
| 3 | route exists, target document missing / switched off / zero blocks / unparseable | `broken` — honest failure naming the route and which predicate failed (`AGENTS.md:110-115` requires exactly this) |
| 4 | no route | `none` → today's behaviour, unchanged: the app-key page at `d=<segment>` (`$vanityName.tsx:34-41`) |
| 5 | the database cannot be read | `unreadable` — the client uses its last cached table and says so; **never a permanent spinner** (the failure `$vanityName.tsx:25-27` has today) |

Case 4 is a deliberate bridge: `platform/web/routes/$vanityName.tsx` already treats an unresolved segment
as an app-key page address, and that behaviour is what makes `/featured` work today. The design does not
change it; it inserts the authority *before* it.

### 4.2 `/` — R4, the home is just another path

`/` asks for the route with `is_default = 1`. Exactly one can exist — `one_default` is a partial unique
index, so a second insert fails at the storage layer, not in a validation convention. **[J]** This is one
of the few places where the database gives a guarantee code cannot: v1's "first wins on read, second is a
reported conflict" (`proposal.md` §4) is a rule; here it is a constraint.

Fallback ladder, and `/` is never blank or 404 in any row:
`default resolves` → render it · `default lapsed/broken/unparseable` → the existing inline composition
(`index.tsx:102`, `publishedHome ?? parseStorefrontPage(…)`) · `no default` → inline composition · `table
unreadable` → inline composition + an admin banner.

Note what R4 does **not** mean: the home is not "the app key's page". Because the target carries its own
author, `/` can render an admin's page without the app key being its author — the indirection `order.md:86-89`
asked the proposal to decide, decided here by making authorship a field of the target rather than a
property of the name.

### 4.3 R1 and R2 — hundreds of pages, one path each

R1: a page is a row in `documents`; a route is a row in `routes`. Neither has a per-author ceiling. The
only ceiling is the shard budget (§3.3), which is a publication concern. R2: `routes.name` is the primary
key — a duplicate path is a constraint violation, not a validation rule.

### 4.4 The `list` reference — marked follow-up, with room left

`RouteTarget` reserves `{ kind: 'list'; listId }`. `listing` and `list` are different: a listing target
names one product; a list target names a *set* resolved by list membership. **Nothing is built for `list`
in this design** (`ruling-d8` §3 says follow-up). What is built now is the shape: the target union is a
tagged union with an `eventKind` discriminator, so adding `list` is a new variant plus a resolver branch,
not a re-architecture. The failure mode for an unknown kind is defined and non-fatal: an unrecognised
target kind resolves to `broken`, is counted, and never blanks the site.

---

## 5. Payment

Two rails, one record, one verification surface. The rail is a column, not a subsystem: the *decision* to
grant a lease is one function.

### 5.1 Quote → verify → settle

```
POST /api/routes/quote      (NIP-98)  → { quoteId, sats, rail, {invoice} | {nutzapPubkey, mints} , expires }
POST /api/routes/settle     (NIP-98)  → nutzap only: submit the signed kind-9321
GET  /api/routes/mine       (NIP-98)  → the caller's leases, states and renewal dates
```

A **quote** is a `payments` row in state `quoted`, carrying `(payer, name, sats, rail, created_at,
expires_at)`. It is the binding between a payment and an intent, and it is what makes the verification
checks meaningful. It is created only after `may(actor, 'reserve', name)` returns yes (§7), so a name that
is refused costs no invoice.

**Why NIP-98 and not the WS proxy.** The proxy (`websocket.ts:30-46` → `EventHandler.ts:238`) re-signs
whatever an admin sends (`EventSigner.ts:17-25` copies tags and `created_at` verbatim), which `proposal.md`
§6.2 correctly identifies as *not* an enforcement point. Keeping it for legacy while the routes API
authenticates its own writes is the only way to satisfy "the server decides the tags" — the server builds
the row from a parsed *intent*, never from a submitted tag list, so there is nothing to smuggle.
**[J]** NIP-98 (kind 27235) is a registered kind, so `AGENTS.md:63-64` ("no new event kinds … without code,
tests and documentation") is satisfied by documentation, not by an exception. It is new machinery for this
repo — there is no precedent:
```
$ git grep -n '27235\|NIP-98' -- platform/ sdk/ docs/ | wc -l
0
```
**[M]** That cost is real and is carried in increment 2.

### 5.2 The zap rail, verified

This is the rail that exists (`http/zapPurchase.ts`, `lightning.ts`) and the one whose verification is
missing (§1.3). Keeping the invoice flow, the settle step becomes:

1. `verifyEvent(receipt)` — the receipt's own signature. **[new]**
2. `receipt.pubkey == nostrPubkey` from the app's LNURL-pay document, fetched and cached. **[new — this is
   the check that makes forgery fail]**
3. `receipt`'s `p` = app pubkey; exactly one `description` tag; `e` tag = the 9734's id (NIP-57).
4. `description` parses to a kind-9734 whose `sig` verifies and whose `pubkey` = the quote's payer.
5. `amount` tag in the 9734 = quote sats × 1000.
6. `receipt.created_at` ∈ `[quote.created_at, quote.created_at + 600]`.
7. bolt11 payment hash not already in `payments` (`one_payment_hash`) — kills replay.
8. `validateRegistration` (name/format/reserved/collision) against the **database**, not the in-memory map.

Only then `state='verified'` and the lease is granted, in one transaction with the projection outbox row.

**Fail closed, per D3.** Steps 1–4 are deterministic; step 2 can fail because the LNURL provider is
unreachable, in which case the purchase is **refused for now and the quote stays open** — a retry, not a
grant. That is the ruling's first bullet, and it costs the payer latency, not money.

### 5.3 The nutzap rail, verified

Sender machinery exists and is tested (`sdk/commerce/payments/wallet/nutzap.ts`, 26 tests). What does not
exist is a **recipient**: no `kind:10019` is published by the app:
```
$ git grep -rn 'NUTZAP_INFO_KIND|10019' -- platform/ contextvm/ | grep -v test | grep -c ''
0     (the only hits are the SDK module and its tests)
```
**[M]** So the rail needs the app to publish its own kind-10019 (app-key signed, `pubkey` tag = the app's
dedicated Cashu key, `u` tags = accepted mints). That is a publication, not a server secret leak — the
Cashu key is a payment-receiving key, not the identity key, and NIP-61 L40 forbids reusing the identity key
here anyway.

Settlement, given the signed 9321:

1. `verifyEvent`; author = the quote's payer; exactly one `p` = app pubkey; exactly one `u` ∈ the 10019's mints.
2. Reuse `validateNutzap` (`nutzap.ts:355`) — every `proof` parses, secret is P2PK, lock key = the app's
   10019 `pubkey`, DLEQ present, `e`/`P` consistent with the event.
3. `Σ proof.amount ≥ quote.sats`.
4. **`checkProofStateBatch(mint, Ys)`** (`nut7.ts:116`) — require **all `unspent`**. `'unknown'` on a mint
   timeout is returned by design (`nut7.ts:135-140`) and is treated as *not verified*: refuse, keep the
   quote open. **[J]** This is the D3 rule applied to a second rail without a second rule.
5. **Swap the proofs into the app wallet** and store the outputs. The lease is granted on swap success,
   not on state-check success, because an unspent-but-unswapped proof remains spendable by the payer
   elsewhere. Fail closed if the swap fails.
6. `state='verified'`, `proof_event` = the full 9321, `verification` = the JSON of checks run,
   `verifier` = a version string; the proofs are wiped from `payments` after the swap.

**What is given up on this rail, stated precisely:** after the swap, the nutzap is no longer
independently re-verifiable by a third party — the mint has moved the state and the proofs are the
server's. The 9321 remains as the payer's evidence that they sent it, and the swap's outputs are the
server's evidence that it received it. **A nutzap proof degrades from a bearer credential to a server
attestation at the moment of settlement**, and no design that takes custody avoids that.

### 5.4 What is deliberately not built: a credit ledger

The obvious extension — fund a balance, debit purchases from it — is **not** in this design. **[J]** It
would make the operator a custodian of unused customer funds, which is a regulated activity in most
jurisdictions and an unbounded liability, in exchange for saving one settle round trip. It is recorded as
the natural increment 5 if the owner wants subscriptions or renewals without a payment each time.

---

## 6. The three-tier ACL, enforced in one place

### 6.1 The role sets come from the database, not from an event read at request time

`AdminManagerImpl`/`EditorManagerImpl` are in-memory sets replaced wholesale from an event
(`AdminManager.ts:26-39`, `EditorManager.ts:26-39`), seeded from `adminPubkeys` which is **`[]`** at boot
(`startup.ts:71` **[S]**). Under this design the sets are tables:

```
roles(pubkey, role, granted_by, granted_at, revoked_at)   -- role ∈ owner|admin|editor
grants(editor, pattern, granted_by, ...)                  -- per-path authority, the tier-2 power
```

`grants.pattern` is either an exact name or `prefix:*`. Membership is evaluated in code, not in SQL, so a
`%` in a route name cannot become a wildcard.

### 6.2 The decision function

```
may(actor, op, name, target):
  name ∈ RESERVED ∪ STATIC_SEGMENTS            → NO, for every tier   (D7 / F7 case 1, fixed by construction)
  role(actor) == owner | admin                 → YES, any op, any target
  role(actor) == editor
      op ∈ {publish-page-to-path, retarget-own-page}
      AND granted(actor, name)
      AND target.author == actor                → YES                      (else NO, reason names the grant)
  op ∈ {reserve, renew}
      AND quotable(name) AND payment settled
      AND target.author == actor                → YES
  otherwise                                     → NO
```

Two consequences worth naming:

- **The namespace collision of F7 case 1 is gone.** `auctions` is a real static route
  (`platform/web/routes/auctions.index.tsx`) and is **not** in the 37 reserved names:
  ```
  $ comm -23 <static one-segment segments> <reserved names>
  auctions
  index
  ```
  **[M]** (9 static segments; 7 reserved; `index` is `/`). Under v1 the server cannot see `routeTree.gen.ts`
  and nothing denied it (§F7: "the server cannot derive it"). Here `STATIC_SEGMENTS` is a generated
  artifact committed beside `routeTree.gen.ts`, the server refuses the name at **write** time, and there
  is no read-side race. **[J]** The general lesson: a name the router owns is a fact about the *deployed
  build*, so it must be a build artifact, not a hand-kept list.
- **An editor cannot point a path at someone else's page.** Their grant is authority over a path, and the
  target must be theirs. The admin is the only tier that can bind a third party's page to a name — which
  is what "full control over the app and its pages" (`ruling-acl.md:6-9`) means operationally.

### 6.3 Precedence, and how the loser learns

`admin > editor > reservation`, enforced at **write** time as a single-occupancy check against the
database inside `BEGIN IMMEDIATE`. There is no read-time ranking and therefore no transient disagreement
(the merge problem that made `proposal.md` D1 expensive).

The loser is told in three ways, all mechanical: the refusal carries the holding tier's name; an admin
reassignment writes a `revoked` lease the displaced holder still sees on `GET /api/routes/mine`; and the
`commands` log records both the refusal and the revocation **with the actor**, so "why did I lose this
name" is a query, not a support ticket.

---

## 7. What happens to the clobber

`ruling-d3` §3 says persistence fixes the clobber only if the publish step reads the *same* store, and it
is right. Here that is structural:

```
write path:   apply(command) ──┐
                               ├─ one SQLite transaction ──► routes/leases/payments rows
receipt path: settle(payment) ─┘                              + projections(seq) row  [outbox]
                                                                        │
projector:    SELECT * FROM routes ORDER BY name  ─────────────────────┘  (reads the whole table)
```

- **One writer.** `apply()` is the only function that mutates `routes`. The receipt path, the admin UI and
  the nutzap settle all call it. There is no second writer and no in-memory table to diverge.
- **One serialiser.** `project()` builds tags from a `SELECT` over the full table. There is no `Map` that
  "only holds `vanity` entries", because there is no `Map`.
- **The write is atomic with the intent to publish.** The outbox row is in the same transaction, so a
  relay outage delays the projection and **never loses the write** — which is a strictly better failure
  than v1's, where a publish failure at `ZapPurchaseManager.ts:415-417` loses a paid reservation outright.
- **The regression test v1 lacks** (`ruling-d3` §3 item 5) becomes one assertion: write a reservation, an
  admin route and the default; take a payment; assert all three survive and the root changed by exactly
  the expected rows. It is test 3 of increment 1 (§10).

---

## 8. Migration

Nothing is ripped out. Four steps, each independently shippable, each with the old path still working.

| step | what lands | what still works exactly as before | the risk it retires |
|---|---|---|---|
| **1. Store + projector** (§10) | DB, store, projector, outbox, verified zap settle, restart-without-relay | every client; every read; the WS proxy; NIP-05 purchases (the base class gets an *optional* port, and `Nip05Manager` does not pass one) | the clobber, the lost-paid-reservation, the forged receipt |
| **2. Read switch** | `GET /api/routes/*`; a `server` read adapter behind `configureReadContext` (`readContext.ts:112-122`); page publishes routed through the server so `documents` is complete; app-settings cached in `documents` so `startup.ts:41-51` stops `exit(1)`-ing on a relay outage | relays remain for everything else | the cold start, the relay in the resolution path |
| **3. Management UI + grants** | `/dashboard/app-settings/routes`; grants table; editor per-path authority; admin reassignment | the purchase UI | the actual unblocker the run exists for |
| **4. Nutzap rail** | app 10019; nutzap settle; swap | the zap rail | payment-rail concentration |

**Import on first boot.** If `routes` is empty and the relay has a `vanity-urls` event, the server imports
it **once**, records the source event id in `commands`, and then never reads the relay for state again.
An instance that never migrates simply keeps working on v1 until step 2 lands. **[J]** This is the one
place where reading the relay is correct: it is a one-time data migration, not a read path.

**Rollback.** The DB file is a file. Deleting it and setting `ROUTES_AUTHORITY=relay` returns the process
to v1 behaviour with the projection as the only trace. That is a feature of putting the whole authority in
one file, and it is also the design's fragility (§9.6).

---

## 9. What this gives up

This is the section the commission asked to be rigorous about, and the bet only survives if these are real.

### 9.1 Censorship resistance

Under v1 a third-party client could read the table from the relay and render a name even if the app
refused. Under this design the operator can refuse to serve a route, and **the refusal is invisible to
third parties** unless they hold an older projection. What survives is the projection (§3.2): the operator
cannot *deny that it once said* a name pointed somewhere without the divergence being detectable. What
does not survive: the operator cannot be *bypassed*. **Reachability at a name becomes a permission.**

Content is a different matter and mostly survives: the page is still on the relay, author-signed, and
reachable by coordinate and by `/profile/{pubkey}`. The operator loses the ability to erase speech; it
retains the ability to make speech unfindable by name.

### 9.2 Third-party verifiability

Three separate losses, usually conflated:

- **Of a payment.** Improved, not lost: the full signed 9735/9321 and the checks that were run are stored
  (`payments.proof_event`, `payments.verification`) and exportable, so the zap rail is re-verifiable
  offline by anyone with the LNURL document. The nutzap rail is **not** — after the swap the mint state has
  moved (§5.3).
- **Of the table.** Weakened: a third party can verify a projection is internally consistent and can detect
  divergence between two of them, but cannot prove the projection is *complete* — an omitted row is
  invisible in a single projection. **[J]** A completeness proof would need a Merkle accumulator with
  published inclusion paths, and that is a real design, not a two-line addition. Marked as the honest gap.
- **Of the operation as a whole.** Lost: there is no way for an outsider to know the operator did not sell
  the same name twice across two backdated snapshots. The state root narrows the window; it does not close it.

### 9.3 Offline operation

The client was never offline-capable for routes (v1 needed a relay). But the *character* of the dependency
changes: a public relay is a third party with its own uptime and no incentive to serve this app; the app
server is a dependency the app already has for HTML. **If** the app is ever served as static files from a
CDN, this design puts a server on the critical path of every route render where v1 did not. **[J]** Worth
naming because it is a plausible future architecture.

### 9.4 Who can be compelled — the sharpest cost

This design creates, for the first time, **a single compellable record**: payer pubkeys, names, sats,
timestamps, Lightning payment hashes and (until swapped) Cashu proofs, in one file, in one jurisdiction,
under one operator. v1's table lived on a public relay that the operator does not necessarily run, and the
relay held a table with no payment history.

Concretely: a subpoena, a GDPR erasure request, or a payment-processor's demand now has one address. An
erasure can be executed *and be effective for every reader instantly*, and the payer's only independent
record is a projection they kept — which almost nobody will. **[J]** The mitigations are procedural, not
architectural, and I would rather list them than pretend: the DB file's permissions and backup policy are
a security requirement, not an ops detail; proofs are wiped after swap; and the payer-visible export is
the only thing that makes §9.2's detection possible in practice.

### 9.5 The operator becomes the arbiter of names

Under v1 the purchase path was self-service and the validator checked format and collision against a map.
Under this design the operator can refuse a name for any reason and the refusal is indistinguishable from
a rule. That is not new power in principle (the app key always signed), but it is new *ease*, and ease is
what makes it used.

### 9.6 Operational fragility

A database is a new failure mode: corruption, a bad migration, a full disk. v1 had no state to lose and
could be rebuilt from a relay. Here, losing the file loses the table; the projection recovers the *last
published* state (lagging by the outbox), and any payment accepted since is recoverable only from
`payments` — which is in the same file. **[J]** The mitigation is a backup on a timer, and the design says
so rather than assuming it.

### 9.7 What is *not* given up, and why it matters to the balance

- The app key does not become the author of user pages. Content authority stays with the author's
  signature; every document served from `documents` is a signed event the client re-verifies.
- Admin and editor routes keep working with the relay off, and so do *reads*, which v1 cannot do.
- The paid reservation is no longer a thing that can be silently destroyed by the next customer. That was
  the actual complaint, and it is bought with all of the above.

---

## 10. Increment 1 — precise enough to execute

**Goal:** the authority exists, the clobber is dead, restart needs no relay, and the forgeable receipt is
refused. **No client change.** The app's behaviour is byte-identical; only the server's durability and its
verification change. That is what makes this increment safe to land before any UI exists.

**Step 0 — worktree and baseline.**
```
git worktree add ../wt-routes-b unite/1420-all        # NOT master: order.md:37-46 binds unite/1420-all
cd ../wt-routes-b && bun install --frozen-lockfile
NODE_OPTIONS=--max-old-space-size=12288 /home/admin_maxime/.bun/bin/bun bunx tsc --noEmit | tail -1
```
Exit criterion 0: the reported error count is **205** (the order's baseline, `order.md:132-142`). If it is
not 205, stop and report the number — a different baseline invalidates every "before/after" below. Do not
use the dirty main checkout, and do not symlink its `node_modules` (both traps are documented at
`order.md:134-142`).

**Step 1 — `sdk/config/routeNames.ts` (new, pure).** Export `RESERVED_NAMES` (37 names) and
`STATIC_SEGMENTS`; make `sdk/config/vanity.ts:51-89` and `platform/server/VanityManager.ts:6-44` import
from it instead of holding their own copies. This de-duplicates the list that research 01 §1 measured twice.
**No behaviour change** — assert set equality against both old literals in a test before deleting them.

**Step 2 — `platform/server/routes/db.ts` (new).** `openRoutesDb(path)` → `bun:sqlite` `Database`,
`PRAGMA journal_mode = WAL`, `foreign_keys = ON`, and `migrate()` creating the §3.1 schema at
`user_version = 1`. Migration is idempotent and additive. **[S]** Copy the shape from
`contextvm/tools/rates-cache.ts:7-25`.

**Step 3 — `platform/server/routes/store.ts` (new).** `RouteStore` over the db: `upsertLease`, `getRoute`,
`listRoutes`, `resolveName`, `resolveSeries`, `defaultRoute`, `revokeLease`, `exportRows` (canonical,
sorted). Every mutating method opens `BEGIN IMMEDIATE` and is the unit of atomicity.

**Step 4 — `platform/server/routes/project.ts` (new).** `buildProjection(rows, seq)` → `{ shards: Array<{d,
tags, root}>, seq }`: legacy `["vanity",…]` mirrors for profile targets and in-term reservations, `["route",
name, kind, spec, tier, term, holder]` in v1's wire format (`proposal.md` §2.2 — kept compatible on purpose),
`["route-series", …]`, `["route-default", name]`, `["seq", n]`, `["root", hex]`. Root = sha256 over the
canonical sorted tag lines of that shard. `publish(shards)` takes an injected publisher port (`ndk` in prod,
a recording fake in tests).

**Step 5 — `platform/server/routes/outbox.ts` (new).** `schedule(db)` inserts a `projections` row **inside
the caller's transaction**; a 5 s timer drains un-published rows (attempt++, publish, stamp). On boot, drain
first, then serve. A failed publish is retried, never dropped.

**Step 6 — `platform/server/ZapPurchaseManager.ts` (edit, minimal).** Add an optional `store?: RouteStore`
to `ZapPurchaseConfig`. When present: `handleZapReceipt` writes a lease through the store inside one
transaction instead of `this.registry.set(...)` (`:198-199`), and **does not call `publishRegistry`**
(`:202`). When absent: unchanged, byte for byte. `Nip05Manager` passes no store, so NIP-05 is untouched.

**Step 7 — `platform/server/VanityManager.ts` (edit).** Pass the store; add `verifyZapReceipt(receipt,
quote)` implementing §5.2 steps 1–7 with an injected `LnurlProvider` port for the `nostrPubkey` fetch (the
field already exists, unread, at `:40`). Kill the 300 s age skip (`ZapPurchaseManager.ts:125-131`) **only**
for the store path: with the proof persisted, `one_payment_hash` is the replay guard and age is irrelevant.

**Step 8 — `platform/server/EventHandler.ts` (edit).** Construct `RouteStore` + projector; pass the store to
`VanityManagerImpl`; keep the 9735 subscription unchanged.

**Step 9 — tests (new, `platform/server/routes/`).**
1. `store.test.ts` — lease upsert/renew extends from `max(now, ends_at)`; `one_default` rejects a second
   default; a revoked lease is kept and readable.
2. `project.test.ts` — round-trip: `parse(build(rows)) == rows`; root changes by exactly the changed rows;
   sharding never exceeds 32 KB; the legacy mirror is present for profile reservations and absent for page
   routes (so no `legacy-shadowed` false conflict — the v1 rule-19/rue-10 defect).
3. `clobber.test.ts` — **the regression the ruling asks for**: admin route + default + editor grant, then a
   paid reservation; assert all three still resolve and the reservation exists.
4. `restart.test.ts` — write a lease, close the db, reopen the store with `ndk = null` (a fake that throws
   if touched), assert the lease resolves. **This is the cold-start proof.**
5. `zapReceiptVerification.test.ts` — a receipt signed by the wrong key is refused; the right key is
   accepted; a reused payment hash is refused; an unreachable LNURL provider refuses **without** granting.

**Exit criteria** — all five, quoted with counts:
1. `bun test --isolate platform/server/routes/` → all pass, and the five files above are the only new ones.
2. `NODE_OPTIONS=… bunx tsc --noEmit` → **205**, identical to step 0. Any increase fails the increment.
3. `bun test --isolate platform/server/` → pass count ≥ the pre-increment count, 0 fail. Quote both.
4. `bun test --isolate sdk/config/ platform/web/storefront/ sdk/core/curation/` → identical to before
   (the step-1 de-duplication and step-7 verification are the only things that could move them).
5. `git diff --stat` touches **only**: `sdk/config/routeNames.ts` (new), `sdk/config/vanity.ts`,
   `platform/server/VanityManager.ts`, `platform/server/ZapPurchaseManager.ts`, `platform/server/EventHandler.ts`,
   `platform/server/routes/*` (new). If a seventh file appears, the increment overran its bound.

**Explicitly not in increment 1:** any HTTP endpoint, any client change, any read switch, NIP-98, the
management UI, grants *enforcement* (the table is created; `may()` lands with the UI in increment 3), the
nutzap rail, and `list`.

---

## 11. Open questions, and what would change my mind

| # | question | lean | what would flip it |
|---|---|---|---|
| B1 | Does the auctions ruling bind routes as doctrine? | No — it names auctions and its reason (a third-party validator) does not transfer (§1.4) | an explicit statement that "reads must not depend on the operator's API" is house-wide. **This refutes the bet, not a detail.** |
| B2 | Is the projection's completeness gap (§9.2) acceptable? | Yes for v1; a Merkle accumulator is a later increment | a requirement that a third party must be able to prove no route was omitted |
| B3 | Nutzap settlement requires the server to hold a Cashu wallet and take custody | Yes, and it needs an ADR (`AGENTS.md:63-64`) | the owner prefers a non-custodial design, in which case the nutzap rail cannot grant a lease and must be dropped |
| B4 | The app publishes a kind-10019 for a Cashu key | Yes (§5.3) | if the key cannot be generated and held without touching the app identity key's material |
| B5 | 14-day grace, immediate stop at `ends_at` | follows `proposal.md` D5 | an owner preference; it is one column and one comparison |

**UNVERIFIED, and it matters:** I did not run the test suite or the typecheck (read-only base, no branch, no
build). The 205 figure is the order's, not mine. I did not execute the forged-receipt exploit — only
established that the check is absent. I did not verify that any of the seven zap relays would accept a
kind-9735 from an arbitrary pubkey; the claim depends on relay policy, not on this code. **[U]**

---

## Appendix — commands behind the numbers

```
# no server-side persistence
git grep -ln 'createApplesauceEventStore' -- platform/ sdk/ | grep -v test
git grep -rn 'bun:sqlite' -- . | grep -v node_modules          # → contextvm/tools/rates-cache.ts:1 only

# no zap-receipt verification
git grep -rn 'validateZapReceipt|verifyZap|nostrPubkey' -- sdk/ platform/ | grep -v test
# → platform/server/ZapPurchaseManager.ts:40 only (a type field, never read)

# no nip-98 precedent
git grep -n '27235|NIP-98' -- platform/ sdk/ docs/ | wc -l      # → 0

# no nutzap recipient
git grep -rn 'NUTZAP_INFO_KIND|10019' -- platform/ contextvm/ | grep -v test

# reserved names vs real static routes  → 9 static, 37 reserved, exactly one collision: 'auctions'
ls platform/web/routes/ | grep -v '^_' | grep -v '\.test\.' | grep -v '\.md$' | grep -v '\$' \
  | sed 's/\.tsx$//' | sed 's/\..*//' | sort -u
sed -n '51,89p' sdk/config/vanity.ts | grep -o "'[a-z0-9_-]*'" | tr -d "'" | sort -u
comm -23 <(first) <(second)                                     # → auctions, index

bun --version                                                    # → 1.4.2
```

Key-shaped literals in cited code are referred to by location only; none is reproduced here. The app public
key at `platform/web/routes/index.tsx:48` is a committed literal and is not a secret, but this document does
not print it.