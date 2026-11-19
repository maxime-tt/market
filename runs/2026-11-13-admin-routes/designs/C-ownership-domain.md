# Candidate C — ownership as a subsystem; transport and storage as adapters

**Commission:** `ruling-d3-persistence-and-redesign.md` §4. **Designer:** C. **Deliverable:** this file only.

**Base, measured at the time of writing:**

```
$ git rev-parse --short HEAD                      → ba9d9668d   (branch master)
$ git rev-parse --short HEAD^                     → 6541bcc3d   (the commit this task names)
$ git diff --name-only 2326938b3 HEAD | grep -v '^runs/'
                                                   → (empty)      no source drift vs the order's pin
```

So the four pinned facts the order turns on hold at this HEAD, and every `file:line` below was read at `ba9d9668d`. **Drift to report:** the task names `6541bcc3d` as the base; that is HEAD's parent. HEAD carries exactly one further commit, which adds `runs/2026-11-13-admin-routes/ruling-d3-persistence-and-redesign.md` (`git diff --name-only 6541bcc3d HEAD` → that one path). No source change either way.

Labels used throughout, and they are not decoration: **[M]** measured by a command quoted here · **[S]** read from source at the line given · **[J]** judged, an inference I am making · **[U]** UNVERIFIED — a claim I could not establish and am therefore not building on.

---

## 0. The central bet, stated so it can fail

> **Ownership is a first-class subsystem, and transport is an adapter.**

The bet is not "use Nostr" or "use a database". It is that **v1's failures share one cause: v1 began from a wire format** — a kind-30000 event with `vanity` tags — **and grew a product inside it.** Every structural defect the adversarial review found is a defect of that inheritance, not of the requirements:

| v1 defect | why it exists |
| --- | --- |
| F2 / ruling §3 — the clobber | the table *is* one replaceable event, so every write rebuilds it from whatever the writer happens to remember |
| R1/R3 — hundreds of pages, newest-in-series | a single event has a size ceiling and one author; a series needs a total order, not a tag list |
| ACL — per-path editor grants | a tag list has no room for a second axis of authority, so authority was flattened to "admin signs" |
| D1 — the app key becomes the only author | the *reader* is pinned to one author (`vanityRead.ts:24`), so authorship was a read constraint turned into a trust model |
| D3 — stale-while-error justified by a doc comment (F3) | there was no storage layer to hold a standing fact, so "liveness" had to be re-derived from a read that may fail |

If the bet is right, then choosing storage and transport *after* the domain makes those five problems **disappear or become explicit**, and the price is a new trust surface (a server-owned store) plus a projection that can lag.

**Verdict of measurement, stated up front: the bet was upheld on four of five points and refuted on one.** §11 is the accounting, including the one behaviour that genuinely cannot be separated from the transport (newest-of-series ordering) and one discovery that *strengthens* the bet more than I expected (§11.4: the repo already contains the correct verification primitive and the purchase path does not use it).

---

## 1. What measurement found, before any design

Five measurements changed what I was going to write. They are load-bearing, so they come before the model.

### 1.1 The server has **no** durable storage at all

```
$ grep -rn "Bun.file|Database|\.write\(|mkdir|writeFile|readFile|node:fs" platform/server/ --include=*.ts | grep -v '\.test\.'
   → (no matches)
$ grep -rn "event-store" platform/server/*.ts platform/server/http/*.ts
   → (no matches)
```

**Measured: zero.** `platform/server` writes nothing to disk and imports nothing from `sdk/core/event-store`. Every manager (`AdminManager.ts:4-47`, `EditorManager.ts:4-47`, `VanityManager.ts:61-187`, `ZapPurchaseManager.ts:61-419`) is an in-memory `Map`/`Set` rebuilt from a relay read at boot. **Its durable store is the relay, and only the relay.**

This contradicts `ruling-d3-persistence-and-redesign.md:36-38` in the letter, and the contradiction matters:

> "the app **already has** an event store (`sdk/core/event-store/applesauceEventStore.ts` …; server-side persistence is exercised by `platform/server/server-bootstrap-persistence.test.ts`)"

- `server-bootstrap-persistence.test.ts` exercises **a boolean** — `hasExistingSetup`, a constructor argument at `BootstrapManager.ts:14` — not an event store. Its five tests (`:43,59,69,87,97`) all assert the bootstrap gate, none persists an event.
- `sdk/core/event-store` is an SDK port with two adapters: `memoryEventStore.ts:18` ("no I/O, no persistence, no shared state") and `applesauceEventStore.ts:41-83` over applesauce's `AsyncEventStore`, whose default database is **in-memory** (`applesauceEventStore.ts:19-36`); IndexedDB is the browser adapter. Neither runs in `platform/server`.

**[M] Conclusion: "persist the zap events server-side" is a commitment to build a store, not an extension of live machinery.** The ruling's *direction* is right; its stated evidence is not. Any candidate that assumes a server event store exists will discover this in increment 1.

### 1.2 Today's zap verification is a **presence check, not a proof of payment**

```
$ grep -rn "verifyEvent" platform/server/*.ts platform/server/http/*.ts
platform/server/ogMeta.ts:219
platform/server/websocket.ts:30
     ← and nowhere in ZapPurchaseManager.ts
```

At `ZapPurchaseManager.ts:113-207` the receipt path checks, in order: event id present (`:114`), not already processed (`:116`), **not older than 300 s** (`:126-131`), a `description` tag parses (`:134-143`), an `L` tag equals the purchase label (`:146-147`), a `vanity` tag names the key (`:152-156`), `validateRegistration` (`:161-165`), a `bolt11` tag **exists** (`:167-172`), and then:

```ts
:175  const amountTag = zapRequest.tags.find((t) => t[0] === 'amount')
:176  const amountMsats = amountTag ? parseInt(amountTag[1]) : 0
:180  const validitySeconds = this.matchPricingTier(amountSats)
```

**The amount that prices the lease comes from the `amount` tag inside the requester's own signed zap request [S], not from the invoice and not from the receipt.** Nothing checks: the receipt's author, the `P` (zapper) tag, the receipt's `p` tag against the app, the bolt11's amount, or that a bolt11 was ever issued by this server. `nostrPubkey` — the provider key that LUD-06/NIP-57 says signs receipts — is **declared in the type and never read** (`ZapPurchaseManager.ts:40`; `[M]` a grep for `nostrPubkey` in `platform/server` returns that one line and nothing else).

**Consequence [J], and I would not build on anything else until this is fixed:** any key can publish a correctly-shaped kind-9735 to a relay the zap NDK subscribes to (`EventHandler.ts:167-176`) with a self-signed description claiming `amount = 180000000` msats and `L=vanity-register`, and the server will mint a one-year lease on any free name for nothing. The 300-second window (`:126`) is the only brake. The collision check (`:90-93`) stops you stealing a *live* name; it does not stop you minting one.

The repo already knows this. `sdk/commerce/payments/zapRead.ts:17-19`, written for the read side:

> "The amount is what the receipt's bolt11 invoice claims; **receipt presence is not settlement proof**."

and it ships a real parser, `parseProviderZapReceipt` (`zapRead.ts:96-120`: decodes the bolt11, takes the amount from it, reads `providerPubkey` from the event author) plus `buildProviderZapReceiptFilter` (`:67-82`, `authors: [providerPubkey]`). **The correct verifier exists in the SDK and the purchase path does not call it.** That is the strongest single fact in this report: payment verification is not a research problem here, it is a wiring problem plus one missing table.

### 1.3 A payment-hash binding is possible **locally**, with a dependency already installed

```
$ node --input-type=module -e "…decode(BOLT11_20U).sections…"
lightning_network,coin_network,amount,separator,timestamp,payment_hash,description,
payment_secret,expiry,min_final_cltv_expiry,feature_bits,route_hint,route_hint,signature,checksum
```

**[M]** `light-bolt11-decoder` (already `package.json:83`, already imported at `zapRead.ts:1`) yields `payment_hash` and `amount`. So a receipt can be bound to an invoice **this server issued** without any network call: store the invoice's `payment_hash` at issue time, require the receipt's `bolt11` to decode to it, require the receipt's author to be the LNURL provider's `nostrPubkey` (fetched at issue time, `ZapPurchaseManager.ts:327`), and require the amount to equal what was invoiced. That is a local, offline-checkable proof at L2 (§5.3) and it closes §1.2.

### 1.4 A nutzap rail already exists — and it is **stronger** than the zap rail, for free

`[S]` `sdk/commerce/payments/wallet/nutzap.ts` (624 lines) implements NIP-61 *send*: kinds 10019/9321/7376 (`:34-37`), recipient parsing (`:224-279`), template building (`:307-312`), and — the part that matters — `validateNutzap` (`:355-431`), a full L118-120 observer checklist with a closed error vocabulary (`:329-338`) including P2PK-lock verification against the recipient's advertised key and DLEQ presence. `walletOps.ts:718-760` wires NDK's `NDKZapper.zapNip61` to it.

**No receive/claim path exists server-side**, and there is no mint verification anywhere in `platform/server` (`[M]`: no `checkstate`, no mint client; the only `mintDestination.ts:118` reference is a URL-normalisation comment). So the rail is half-built — the *hard* half (constructing a valid P2PK-locked nutzap with DLEQ) is done, and the *easy* half (accept, check, claim) is missing.

Why this is stronger than zaps for this product, and the reason a payment **proof** can be a first-class domain object:

- a zap's proof is somebody's *assertion* (a receipt signed by a provider), verifiable only up to "the provider says so";
- a nutzap's proof is a **bearer instrument**: a P2PK-locked Cashu proof. Settlement is *custody*, and custody is established by a mint call, not a relay read. `[S]` `nutzap.ts:5-8`: "The event is the proof of payment."
- therefore nutzap entitlement satisfies the owner's §2 criterion ("checks with no relay connection at all") **by construction**, where the zap rail needs a persisted receipt table to get close.

Cost, stated now: a nutzap can only be *verified* at the mint (`checkstate`) and only *settled* by claiming (a swap). Until claimed it is a promise, and the sender retains a NUT-11 refund path if they set one. So a nutzap lease is minted on **claim**, not on receipt. `[J]`

### 1.5 The three-tier ACL has no mechanism whatsoever, and the patron cannot write at all

`[S]` `AdminManager.ts:4-24` and `EditorManager.ts:4-24` are two `Set<string>` of pubkeys, rebuilt wholesale from `p` tags of kind-30000 `d=admins`/`d=editors` events (`:26-39` each). `EventValidator.ts:19-48` routes by event kind and d-tag; the branches are:

| branch | who passes | line |
| --- | --- | --- |
| `setup` (31990 + `"name":`) | app key, admin, or bootstrap | `:50-61` |
| `adminList` / `editorList` (30000 `d=admins`/`editors`) | admin, or bootstrap | `:63-72` |
| `blacklist` (10000) | admin **or editor** | `:74-83` |
| **general** (everything else) | **admin only** | `:85-94` |

**Measured consequences:** an editor's entire server write authority is the blacklist; a *paying user* cannot write anything through the proxy at all (they fail `:86`). And the ledger has no per-path schema — `[M]` a search for `editorGrant|grantedPath|allowedPaths` returns nothing, as the proposal already recorded. So the ACL is not "role plus grants": it is **two sets and a fall-through**.

This matters for my bet because it shows the tiers are not *entitlements over resources* in the current code — they are *classes of writer over kinds*. The domain has to introduce the entitlement relationship; there is nothing to extend.

---

## 2. The domain

Names below are chosen to be un-Nostr-y on purpose. If a word comes from the wire format, it does not belong in this section.

### 2.1 Vocabulary

**Namespace.** One namespace: the first URL segment. `[S]` the router has exactly one single-segment dynamic route, `/$vanityName` (`routeTree.gen.ts:74-76`), so a name is one segment and nothing else. Sub-paths (`/name/sub`) do not exist and are not designed here (proposal §11 C14 flagged this; I inherit the flag).

**Name.** A value object. `{ text: string }` where `text` is NFC-normalised, lowercased, and satisfies exactly one of the grammars below. A `Name` cannot be constructed from an invalid string; there is no "parse then check" path. Grammar is **data**, not a regex scattered in readers:

- shape: `^[a-z0-9][a-z0-9_-]{1,28}[a-z0-9]$` — 3–30 chars, alnum plus `-`/`_`, alnum at both ends (`[S]` `VanityManager.ts:182-186`; `sdk/config/vanity.ts:171-175`; identical);
- excluded: the **37** reserved words (`[M]` `awk 'NR>=6&&NR<=44' platform/server/VanityManager.ts | grep -oE "'[a-z]+'" | wc -l` → 37; the SDK copy at `sdk/config/vanity.ts:51-89` counts 37 and the sets are equal — re-measured here, confirming proposal C2);
- excluded: any **static one-segment route segment**. `[M]` from `routeTree.gen.ts`, the `path:` values that are a single segment, carrying no `$`, are: `auctions, checkout, community, dashboard, nostr, posts, products, setup` (**8**; `/new` appears with two different parents and is *not* top-level, and `/` is not a name). Command: `grep -oE "path: '/[^']*'" platform/web/routeTree.gen.ts | sed "s/path: '//;s/'//" | awk -F/ 'NF==2 && $2!="" && $2 !~ /\$/ {print $2}' | sort -u`. This set is **injected into the domain**, derived in one place, and asserted equal to the router's own table by a test — see §11.2 for why the *domain* has to own it and the router cannot.

**Principal.** `{ pubkey: string }`. Roles are **not** stored on the principal; they are looked up from an `Authority` source (§2.4) at decision time. A principal is never "an admin" in the abstract, only "an admin *now*".

**Target.** A pointer to something renderable. Closed union, ≥1 variant reserved and refused:

| variant | payload | admissible |
| --- | --- | --- |
| `page` | `{ author, dTag }` | yes |
| `profile` | `{ pubkey }` | yes |
| `listing` | `{ pubkey, dTag }` (kind 30402) | yes |
| `series` | `{ author, key }` — resolves to the newest member | yes |
| `list` | `{ name }` — members of a named list | **refused now, reserved** (ruling-d8 §3) |
| `external` | `{ url }` | **refused**, with a reason (no egress policy; `storefrontPage.ts:59-69` `isSafeHref`; `AGENTS.md:63`) |

A `series` target is the only variant whose value is **not** a document but a query. That is deliberate and it is the hinge of R3 (§2.6).

**Term.** `perpetual` or `expiring{ at: seconds }`. Not a number with a magic zero. `[S]` v1 had to invent `0 = permanent` and then discovered the legacy reader treats `0` as "expired since 1970" (`vanityRead.ts:63`) — a sentinel colliding with a meaning. A union removes the collision instead of documenting it.

**Assurance.** The strength of a payment proof, as a value: `L1 structure`, `L2 provider-attested`, `L3 mint-custody` (§5.3). Stored and displayed; **never collapsed into a boolean** — `AGENTS.md:43` requires keeping settled / receipt-published / confirmed distinct, and this is the type that makes that possible.

**Lease.** The aggregate. A lease is the operator's standing grant of one name to one principal for one term, evidenced by zero or one payment proof.

```
Lease {
  id            : ulid                // assigned by the store, never by a client
  name          : Name
  holder        : Principal
  tier          : 'admin' | 'editor' | 'patron'
  term          : Term
  target        : Target
  status        : 'active' | 'revoked' | 'released'
  revokedBy?    : Principal           // present iff status = revoked
  revokedReason?: string
  proofRef?     : PaymentProofId      // required iff tier = patron and term ≠ perpetual
  grantedBy     : Principal           // the actor, or the app key for self-service
  revision      : Revision            // §2.2 — this is what orders versions
  supersedes?   : LeaseId             // set on reassignment
}
```

**Delegation** (the editor's "specific access to specific paths", `ruling-acl.md:7-8`). A separate aggregate, because it is authority *over names*, not ownership *of* one:

```
Delegation {
  id, grantee: Principal, grantedBy: Principal,
  pattern: { kind: 'exact', name } | { kind: 'prefix', prefix },  // 'featured-'
  ops: Op[],                       // subset of [create, retarget, release]
  maxTerm: Term,                   // an editor cannot mint a perpetual lease
  expiresAt?: seconds
}
```

**SiteDefault** (R4). A *singleton row*, not a flag inside a table: `{ name, setBy, at, revision }`. The store's primary key is a constant, so "exactly one default" is a schema fact (§3.1), not a rule to remember.

**PaymentProof** (immutable, append-only):

```
PaymentProof {
  id, rail: 'zap' | 'nutzap',
  amountSats, payer: Principal, payee: 'app',
  assurance: Assurance,
  evidence: { eventId, rawEventJson, signature }     // 9735 or 9321, verbatim
           | { invoiceHash, nutzapEventId, mintUrl, proofSecretsDigest, claimState }
  observedAt, settledAt?
}
```

### 2.2 Revision — the one place the transport leaks, and how it is contained

Every mutable aggregate carries a `Revision = { seq: int, at: seconds, by: Principal, id: string }`. The **domain** defines the total order:

```
compare(a, b) = seq, then at, then id (lexicographic)     // a total order, no ties
```

Why not `created_at`? Because `created_at` is *client-asserted* on every path in this app. `[S]` `EventSigner.ts:17-25` copies the client's `created_at` verbatim and only swaps the pubkey, and proposal §6.2 already noted that a client controlling `created_at` can win every replace until the clock catches up. If the domain ordered versions by `created_at`, the transport's weakness would become the domain's weakness. It does not: **`seq` is assigned by the store inside the transaction that appends the lease** (`select max(seq)+1` for the name), and `at` is the store's clock.

The one exception, and it is unavoidable: a *page's* publication time is only knowable from the author's signed event, so `Target{series}` ordering uses `(publishedAt from the signed event, eventId)` and the domain adds an invariant (I9) to stop backdating from mattering.

### 2.3 Invariants

These are the deliverable. Each names what breaks without it, and where it is enforced.

| # | invariant | enforced in | breaks if absent |
| --- | --- | --- | --- |
| **I1** | At most one **live** lease per name, at all times. Live = `status='active'` and (`term` perpetual or `at < term.at`). | store, by a unique index on the occupancy table (§3.1), inside the write transaction | two pages answer one URL; F2's "they never coexist" becomes false again |
| **I2** | A grant that would collide with a *live* lease is **refused**; it is never silently substituted. Occupying another's name requires the explicit op `reassign`, which revokes then grants in one transaction and leaves two audit rows. | domain `grant`/`reassign`; store transaction | the displaced holder loses a name with no record — `ruling-acl.md:47-48` forbids exactly this |
| **I3** | Renewal **never shortens** a term: new term = `max(now, current.at) + granted`. | domain `renew` | a patron renewing early loses paid time (`[S]` the existing path gets this right at `ZapPurchaseManager.ts:190-193`; keep it) |
| **I4** | A `patron` lease with a finite term **must** reference a `PaymentProof` whose `settledAt` is set and whose `amountSats` funds the term. An `admin`/`editor` lease **must not** reference one. | domain `grant` (pure), plus a store `check` | free leases (§1.2), or a paid name that a proof-deletion silently empties |
| **I5** | **Liveness never re-verifies the proof.** Entitlement is checked at grant and at renewal only. | domain: `isLive` reads term and clock, nothing else | the F3/cold-start class: a read that depends on a payment re-check |
| **I6** | Only the holder (within their tier's admissible targets) or an admin may change a lease's target. | domain `retarget` | an editor retargeting a patron's name to their own page |
| **I7** | Revocation by an admin is always permitted, always audited (`revokedBy`, `revokedReason`), and always **visible to the displaced holder**. | domain `revoke`; the holder's surface reads `supersedes` + audit | `ruling-acl.md:65` "the affected holder is informed" |
| **I8** | Liveness is **derived** from (term, clock), never a stored flag; `status` records only facts that need an event (`revoked`, `released`). | domain `isLive` | a sweep is needed for correctness, and there is no sweep — `[S]` research 01 §2.5: "nothing sweeps", expired tags republish forever |
| **I9** | Within a series, a newly published member must have `publishedAt` **strictly greater** than the current newest member's; a stale publish is refused. | domain `resolveSeries` + publisher | backdating a page to win `/featured`, which is R3's only attack |
| **I10** | Resolution is **total and non-throwing**: every `(name, clock)` yields exactly one of `Leased`, `Lapsed`, `Absent`, `SeriesEmpty`. | domain `resolve` | a blank site; `order.md:84-85` |
| **I11** | A `Target` is admissible for a tier: `page`/`profile`/`listing` for all; `series` for admin/editor only; `list` and `external` never (now). | domain `grant`/`retarget` | an admin accidentally pointing the site at an unsupported renderer |
| **I12** | The **default** is a name that currently resolves to a `page`-target lease; if it stops doing so, `/` falls back and the state is reported, never blanked. | domain `defaultFor`; the reader | `ruling-acl.md:66` |

Two invariants I **rejected**, and why — because a reviewer will ask:

- **"A principal may hold at most one patron lease."** Rejected: `ruling-d8.md:31` says one admin/editor may hold hundreds; the same must be true for a paying user's store (a store with a `/shop` and a `/clearance`). The reverse-index constraint in `VanityManager.ts:62,125-133` (`pubkeyToVanity`, one name per pubkey) is a *limitation of the current code*, not a requirement, and it silently overwrites on a second name (`:125`) — a bug I would not carry forward.
- **"Names are globally unique across tiers by rank at read time."** Rejected: read-time ranking over two records can disagree transiently (proposal D4's argument, and it is right). Uniqueness is a write-time property (I1); rank exists only as a *permission to displace*, which is `reassign`.

### 2.4 Authority, as a pure function

`can(actor, op, subject, ctx) → Allowed | Denied(reason)` where `ctx` supplies `{ isAdmin, isEditor, delegations, clock }` read from the server's own lists at decision time. Ops and their policy:

| op | admin | editor | patron | notes |
| --- | --- | --- | --- | --- |
| `create` on a free name | ✓ | ✓ if a `Delegation` matches the name and `create ∈ ops` | ✓ if `proof` settles and name free | patron's lease term comes from the proof, never from the request |
| `retarget` a lease they hold | ✓ | ✓ if the delegation matches | ✓ (own lease) | target must be admissible (I11) |
| `retarget` a lease held by another | ✓ | ✗ | ✗ | |
| `renew` | ✓ | ✓ if delegation matches | ✓ (own lease, new proof) | term extends (I3) |
| `reassign` (displace) | ✓ | ✗ | ✗ | I2, I7 |
| `release` | ✓ | ✓ if delegation matches | ✓ (own lease) | frees the name immediately |
| `setDefault` | ✓ | ✗ | ✗ | `ruling-acl.md:15-16` — the tier that authors the default is admin |
| `delegate` (create a Delegation) | ✓ | ✗ | ✗ | admin only |

Everything here is a **decision over the server's own lists** (`AdminManager.ts:18-20`, `EditorManager.ts:18-20`) and the store's delegations — never over anything the caller sent. That is the one thing v1 got right and I keep: the client proposes, the server decides (`proposal §6.3`).

Note what changed versus v1's D1: **who signs is no longer the trust question**, because the authoritative read is the store's, not a relay's author filter. A patron's claim event and the operator's lease are *different records in different tables*, so there is no "second read to join" and no precedence that can disagree. The cost v1 paid for app-key-only signing (no independently verifiable reservation) is not paid here — the proof is independently verifiable (§5.3) and the lease is merely the operator's record of it.

### 2.5 Operations, as transitions

```
grant(name, holder, tier, target, proof?) →
    Name must be valid (grammar + reserved + route segments)
    I1: no live lease on name                      else Denied('held-by:<tier>')
    I4: tier=patron ⇒ proof settled, term := fundedTerm(proof.amountSats)
        tier∈{admin,editor} ⇒ proof must be absent, term := requested (editor ≤ delegation.maxTerm)
    I11: target admissible for tier
    append Lease{rev = {seq++, now, actor, ulid}}, audit('grant')

renew(name, actor, proof?) →
    lease must be live and actor permitted
    I4 again for patron (a patron renewal needs a fresh settled proof)
    I3: term := max(now, old.at) + granted
    append Lease{rev = {seq++, …}}, audit('renew')

retarget(name, actor, target) → I6, I11, append, audit
revoke(name, actor, reason)  → admin only; append Lease{status:'revoked', revokedBy, revokedReason}, audit('revoke')
release(name, actor)         → holder or admin; append Lease{status:'released'}, audit('release')

reassign(name, newHolder, tier, target, proof?) →
    one transaction: revoke(current, reason='reassigned'), then grant(new)   // I2, I7
```

Every transition appends; **nothing is updated in place and nothing is rebuilt.** History is the table, not a log beside it. That is the structural difference from v1: there is no serialiser that can forget an entry class, because there is no whole-table serialisation (see §6).

### 2.6 Resolution, and why R3 is a domain query

```
resolve(name, at) →
  leases ← history(name)                      // newest-first by Revision
  if none                                        → Absent
  cur ← newest
  if not isLive(cur, at)                         → Lapsed{ name, at: cur.term.at, holder }
  match cur.target:
    page{author,d}    → Leased(cur, Resident{author,d})          // may 404 into the page's own failure state
    profile{pubkey}   → Leased(cur, Resident{pubkey})
    listing{...}      → Leased(cur, Resident{...})
    series{author,k}  → members ← seriesMembers(author,k, at)
                        none → SeriesEmpty{cur}
                        else → SeriesTarget(cur, newestMember)   // R3
```

**R1/R2/R3/R4 fall out:**

- **R1** — hundreds of pages per author: a `page` target is a coordinate, not a table row. There is no per-author table, no per-author event, no ceiling. **[S]** kind 30024 is addressable with a `d` tag (`storefrontPage.ts:34`), so hundreds of pages = hundreds of `d` values; only the *constant* makes it one-per-author today (`storefrontPublish.ts:60`). The domain does not care how many pages exist.
- **R2** — a unique path per page: every page that should be reachable by name has its own lease (I1 guarantees one name, one page, one live holder). A page may also exist *unleased* — reachable only by coordinate — and that is a feature, not a gap: draft pages need no name.
- **R3** — the general path: `Target{series}` is a query, and `newestMember` is `max(members, by (publishedAt, id))` with I9 protecting the order. **This is the requirement that genuinely couples the domain to the transport**: "newest" requires an author-asserted timestamp, and only the author's signed event supplies one. I do not pretend otherwise — I contain it with I9 and I name it in §11.3.
- **R4** — the home is one more path: `SiteDefault` names a lease; `/` is `resolve(defaultName)`, falling back to today's inline composition (`index.tsx:102`) whenever the answer is `Lapsed`, `Absent`, `SeriesEmpty`, or the store is unreachable (I12).

Distinguishability is part of the contract: `Lapsed` and `Absent` are **different** outcomes, which is precisely the ambiguity F7/§3.1 costs v1 a rewrite over. Today `resolveVanity` returns `null` for both, and the route then falls through to an app-key page (`[S]` `$vanityName.tsx:41`), so a lapsed name silently changes what the URL means.

---

## 3. Storage adapter

### 3.1 The store

**Choice: SQLite via `bun:sqlite`, one database file owned by `platform/server`.**

`[M]` `bun --version` → 1.4.2; `bun -e "import {Database} from 'bun:sqlite'"` → works; precedent in this repo at `contextvm/tools/rates-cache.ts:1`. **Zero new dependencies**, synchronous, transactional, and it survives restart — which is the entire point of §1.1.

Schema, with the enforcement points that carry the invariants:

```sql
create table lease (
  id text primary key,
  name text not null,
  seq integer not null,
  at integer not null,
  by text not null,
  holder text not null,
  tier text not null check (tier in ('admin','editor','patron')),
  term_kind text not null check (term_kind in ('perpetual','expiring')),
  term_at integer,
  target_kind text not null,
  target_json text not null,
  status text not null check (status in ('active','revoked','released')),
  revoked_by text, revoked_reason text,
  proof_id text references payment_proof(id),
  supersedes text,
  check (term_kind='expiring' or term_at is null),
  check ((tier='patron') = (proof_id is not null))          -- I4, as a constraint
);
create unique index lease_rev on lease(name, seq);          -- I1's ordering key
create index lease_hist on lease(name, seq desc);

-- Occupancy: one row per name that is currently spoken for. Uniqueness is the DB's, not the code's.
create table occupancy (name text primary key, lease_id text not null);
```

`[M]` verified in this environment that SQLite enforces it: a second `insert` into a `primary key` column raises `UNIQUE constraint failed`, and a **partial unique index** (`create unique index … where ended is null`) also enforces and permits reuse after the row is ended. The occupancy table is the *simplest* of those: grant = `insert into occupancy` (unique violation → `Denied('held-by:…')`), lapse/release/revoke = `delete`, reassign = both in one transaction.

**A note on lapse and the occupancy table, stated because it is the store's one soft spot.** Liveness is derived (I8), but occupancy is materialised. So a name whose term has passed still has an occupancy row until something touches it. Two dispositions, and I choose the second:

1. sweep on read (a read that writes — rejected: `resolve` must be side-effect free and must work on a read replica);
2. **lazy reap on the next write touching the name, plus a bounded background reap every 60 s** over `occupancy join lease where term_at < now - grace`. Reads treat an expired occupancy row as `Lapsed` and never as live (I8), so the only thing the reap affects is *claimability*, and the reclaim grace window (§9, D5-equivalent) makes a stale row **correct**, not merely tolerable: during the grace window nobody but the holder may claim anyway.

That is the honest version: the table is a cache of "who sits here", the lease history is the truth, and a stale cache entry can only delay a claim inside a window that is already closed.

### 3.2 Why not "the relay is the database"

Because it demonstrably is not one: no uniqueness, no transaction, no history, no order, and — measured — no signature check on the purchase path (§1.2). The relay is an excellent **distribution and portability** layer. It is a poor **authority**, and v1's five defects are what happens when authority is assumed of it.

I am aware of the doctrine this touches: `AGENTS.md:64-65` — "An outbox-style publisher is an architectural option for future server-side work, not a verified current architecture for this repository." A store-then-project design is an outbox. So this design *is* a new architectural decision and must be documented as one (an ADR, and `AGENTS.md:63-64`'s "no new event kinds, payment semantics, relay assumptions … without code, tests and documentation"). That is a cost, and it is in §7.

---

## 4. Transport adapters

Three, each doing only what it is good at. None is consulted as truth by the resolution path.

### 4.1 `HttpApi` — the authoritative read/write surface

`[S]` the server already mounts `BunRoutes` objects (`platform/server/http/types.ts`; `zapPurchase.ts:13-58`), so this is a live convention, not an invention.

```
GET  /api/routes/resolve?name=<n>       → Resolution (Leased|Lapsed|Absent|SeriesEmpty) + default flag
GET  /api/routes/list?holder=<pk>       → that holder's leases (their dashboard)
POST /api/routes/grant                  → admin/editor/patron, body = proposal, server decides
POST /api/routes/retarget | renew | revoke | release | reassign | default
POST /api/routes/nutzap                 → submit a 9321 for claim (avoids the relay entirely)
```

Every response carries `revision` so a client can detect that it is stale, and every mutation returns the *server's* resulting lease, not the client's optimism (`proposal §6.5`'s "it can still lie in its own UI" is closed by this).

**Why an API and not a relay read at `/`:** because the read must be able to say *which* of `Lapsed` / `Absent` / `SeriesEmpty` happened, and it must not depend on a relay being reachable. The API also lets the client stop needing an app pubkey to render a route — `[S]` today `/$vanityName.tsx:25-27` renders `LoadingState` forever when the query is disabled for want of an app key (research 01 §3 R6; proposal §3.2 names the edge).

### 4.2 `RelayMirror` — portability and offline-ish reads, one event per name

Published on every lease transition, app-key signed, **one addressable event per name**:

```
kind 30078, d = "route:<name>", author = app key
tags: [d, route:<name>], [v, seq], [h, holder], [tier, …], [term, perpetual|at],
      [target, page|profile|listing|series, …], [status, …], [proof, <proofId>]
content: the lease JSON, for forward-compat and for humans reading a relay raw
```

Why per-name and not one table: a per-name event means **two writers to different names never touch the same event**, so there is nothing to rebuild and nothing to drop. The clobber's mechanism (a whole-table serialiser reading a partial in-memory map) has no analogue.

Plus one `RoutesManifest` for discovery, because Nostr filters cannot prefix-match `d`:

```
kind 30078, d = "routes-manifest", tags: [n, <name>, <seq>] per name
```

`[M]` measured cost: 33 bytes per entry (`JSON.stringify(['n','featured-0001','0000007'])` = 33). 500 names → 17 KiB; 1000 → 33 KiB; **2000 → 66 KiB, over the 64 KiB event ceiling → shard at 1500 into 2 manifests keyed by a stable hash of the name** (`d = "routes-manifest:<bucket>"`). Numbers, not vibes; the shard rule is stated now so it is not discovered at scale — the exact failure mode `ruling-d8.md:51-55` predicts for v1.

**The mirror is never authoritative.** It is read in exactly two cases: (a) the store is empty on a fresh instance, where it **rehydrates** the store (replaying per-name events in `seq` order and treating a `revoked`/`released` mirror as history), and (b) a client that cannot reach the API, where it renders a route with a "read from relay, may be stale" marker. Both are explicitly stamped in the UI; neither is silent.

`kind 30078` is NIP-78 (application-specific data). Using it means **the mirror's kind is a decision documented in an ADR** — `AGENTS.md:63`. The alternative (reusing 30000) collides with three live `d`-tag namespaces in this app: `vanity-urls`, `admins`, `editors` (`[S]` `EventValidator.ts:39-43`, `vanityRead.ts:5`, `Nip05Manager.ts:50`).

### 4.3 `AppKeyRegistry` — the legacy kind-30000, demoted to a projection

The existing `VANITY_REGISTRY` (`vanityRead.ts:5`) keeps exactly one job: **the `name → pubkey` profile reservation that old clients already read**. `[S]` old clients filter `tag[0]==='vanity'` and nothing else (`vanityRead.ts:31-35`), so the tag must keep being emitted for the reservation names those clients understand.

It becomes a **downstream projection with a single serialiser that reads the store**:

```
publishRegistry() :=
   entries = store.projectionVanityTags()      // leases where target.kind='profile' and term ≠ perpetual
   event   = [['d','vanity-urls'], ...entries]
```

Two consequences, both of which are the ruling's own fixes:

- **§3 fix #1 ("one store, one serialiser") is satisfied by construction**, because the projection *derives* from the lease table rather than from a `Map` that only holds `vanity` entries. `[S]` the current `buildRegistryTags` emits `['vanity', name, pubkey, validUntil]` and nothing else (`VanityManager.ts:110-112`), and `publishRegistry` rebuilds the whole event from that map (`ZapPurchaseManager.ts:399-406`) — every receipt therefore deletes every entry class the map does not know (F2).
- **§3 fix #3 ("one writer per event") is unnecessary here**: the app key remains the only writer of that event *by construction*, because it is now a one-way output. Admin/editor/patron leases do not live in it at all.

What I **give up** by this: a client that only knows the legacy tag can see a name→pubkey reservation but nothing about page targets, terms of non-profile leases, or the default. That is acceptable — those clients are the *reason* the projection exists, and extending them is not this run's work.

### 4.4 What the relay is *not* used for any more

- It is not the lease authority (the store is).
- It is not a write path for anything but the mirror projection (the app key signs the mirror; no client does).
- It is not the payment-proof store (the store holds the proofs, §5.4) — though the proof events also exist on the relay because they were published there.

That last item is worth stating plainly: **the owner's D3 direction ("persist the zap events and their signatures so a check needs no relay") is implemented, but it is not the architecture — it is one adapter's storage requirement.** In my design it is a five-column table, not a subsystem.

---

## 5. Payment: purchase, verification, persistence

### 5.1 The purchase is a two-artefact act

| artefact | author | meaning | where it lives |
| --- | --- | --- | --- |
| **claim** | the payer | "I want this name, and here is my payment" | kind 9734 (signed zap request, *already built client-side*, `[S]` `platform/web/payments/zapPurchase.ts`) or kind 9321 (nutzap) — or POSTed to `/api/routes/nutzap` |
| **lease** | the operator (app key) | "this name is yours until T" | the store; mirrored to the relay |

Neither alone is a lease. The claim without a verified proof is a request; the lease without a claim's proof would be the operator inventing a payment. This is `ruling-acl.md:38-42` option (b) — and it is cheap here precisely because the authoritative read is the store, so there is no second relay read and no merge that can disagree (the cost that made v1 choose option (a)).

### 5.2 Zap rail

**Issue:** `POST /api/routes/invoice` (new) — reuse `generateInvoice`'s LNURL work (`ZapPurchaseManager.ts:268-370`), but **persist an `invoice` row before returning** `pr`:

```
invoice { payment_hash (from the returned bolt11, decoded), amount_sats,
          purpose json {op, name, target, tier}, requester pubkey,
          provider_pubkey (= LnurlPayData.nostrPubkey, :40 — stored, at last),
          nonce, issued_at, expires_at (= now + 15 min), consumed_by lease id? }
```

**Verify (all local, no network):**

1. `event.kind === 9735`, `verifyEvent(event)` — the generic signature check the path does not do today (`[M]` §1.2).
2. `event.pubkey === invoice.provider_pubkey` — the provider that issued the invoice signed the receipt. This is `buildProviderZapReceiptFilter`'s `authors:` rule (`zapRead.ts:67-82`) applied to the *stored* invoice rather than a guessed provider.
3. `decode(receipt.bolt11).payment_hash === invoice.payment_hash` **[M]** the section exists (§1.3).
4. `decode(receipt.bolt11).amount === invoice.amount_msats`.
5. `receipt.tags['P'] === invoice.requester` and `receipt.tags['p'] === [appPubkey]`.
6. `invoice.consumed_by is null` and `now < invoice.expires_at + slack`.

All six pass → `PaymentProof{rail:'zap', assurance:'L2-provider-attested', settledAt: receipt.created_at}`. Any fail → `refused`, **fail closed** (`ruling-d3.md:22-23`).

**What L2 means, said without flattering it:** nothing in this repository can prove sats landed at a Lightning node — `[S]` `platform/server/lightning.ts:14-35` resolves a *lud16 identifier* and nothing else; there is no node client, no `lookupinvoice`, no NWC. The strongest local claim is *"the provider that issued an invoice we minted attests that it was paid, in the amount we asked"*. The party who could lie is the party holding the funds, which is the same party the operator already trusts with the money. That is the ceiling, and it is a real ceiling, not a step.

### 5.3 Nutzap rail

**Accept:** a kind 9321 arrives by relay subscription or by `POST /api/routes/nutzap` (the HTTP path makes the whole rail independent of relay reachability).

**Verify, in order:**

| step | check | code that already exists |
| --- | --- | --- |
| L1 | structure: exactly one `p`/`u`, ≥1 `proof`, proofs parse, NUT-11 lock key == `recipient.nutzapPubkey`, mint is one the recipient listed | `[S]` `validateNutzap` `nutzap.ts:355-431`; `parseNutzapRecipientInfo` `:224-279` |
| L2 | the mint says the proofs are unspent: `POST /v1/checkstate` for each `Y` | **missing** — nothing in the repo calls a mint from the server; `[M]` `mintDestination.ts:118` is a comment |
| L3 | **claim**: swap the proofs, and custody is the proof of settlement | **missing** — `nutzap.ts` has no receiver; `walletOps.ts:718-760` is send-side only |

**Lease is minted on L3, not on L1** (§1.4). `PaymentProof{rail:'nutzap', assurance:'L3-mint-custody', evidence:{nutzapEventId, mintUrl, proofSecretsDigest, claimState:'claimed'}, settledAt}` — and **the bearer material itself is not persisted** (it is money; `AGENTS.md:50` forbids committing wallet material, and a DB is no better). What is persisted is a *digest* of the claimed secrets plus the claim's outcome, which is enough to prove "this event's proofs were claimed by us" and to re-detect a replay of the same event id.

That asymmetry — L2 for zaps, L3 for nutzaps — is not a wart. It is the honest statement that a bearer instrument can be proved by taking custody and an assertion can only be proved by its issuer's signature. **`Assurance` is a domain type precisely so this difference cannot be collapsed into `paid: true`** (`AGENTS.md:43`).

### 5.4 Proof persistence

`payment_proof` is append-only and stores the **verbatim evidence event and its signature**, so a check re-runs offline:

```sql
create table payment_proof (
  id text primary key, rail text not null, amount_sats integer not null,
  payer text not null, assurance text not null,
  event_id text not null, raw_event text not null, signature text not null,
  invoice_hash text, mint_url text, proof_record text,
  observed_at integer not null, settled_at integer
);
create unique index proof_unique on payment_proof(rail, event_id);   -- replay defence
```

`unique(rail, event_id)` is the replay defence: the same 9735 cannot fund two leases, and the same 9321 cannot fund two names. Today the defence is a `Set` cleared at 2000 entries (`ZapPurchaseManager.ts:116-123`) and a 300-second age cut-off (`:126-131`) — i.e. the current design deliberately *forgets*, which is exactly why it re-derives from relays on every restart.

`settled_at is not null` is the single gate the domain consults (I4). Note how the ruling's §1 refinement lands naturally here: once a lease exists, **nothing re-reads `payment_proof`** (I5). The proof matters at grant and renewal only, so a relay outage cannot expire a lease and a cold start cannot fail one — the F3 defect is not fixed by caching, it is designed out.

**Tamper note, stated because it is a real limit:** an actor with write access to the database can insert a `payment_proof` row. The row will not verify (`verifyEvent` + provider pubkey + invoice-hash binding), so the tamper is *detectable* by re-running verification, and the invoice table is signed at issue time by the app key (`invoice` rows carry an app-key `attestation` over `(payment_hash, amount, purpose, nonce)`). It is **not preventable**, because the operator holds both the app key and the database. A lease is the operator's record, not a third-party credential. Same conclusion as v1's D1, different reasoning, and the difference is that here the *evidence* behind the record is independently checkable.

---

## 6. The clobber: why it cannot recur

`ruling-d3.md:46-78` names five ordered fixes. Here is the mapping, and the one that does the work:

| ruling's fix | this design |
| --- | --- |
| 1. one store, one serialiser | the lease table is the only store; the kind-30000 registry is a **projection derived from it** (§4.3) and has no other writer |
| 2. read-modify-write, not rebuild | the store has no "rebuild" operation at all: every change is an append inside a transaction |
| 3. stop sharing one event between namespaces | the shared event now carries **only** the legacy reservation namespace, and it is one-way output. Leases live in per-name events (§4.2) |
| 4. page paths need not live in that event | they do not: pages are their own addressable documents; names are leases; a `Target` joins them |
| 5. a regression test that does not exist | `lease.test.ts` + `LeaseStore.test.ts`: grant a patron lease *after* an admin route and the default exist, then assert both still resolve **and** that `projectionVanityTags()` still contains the admin's profile entry. The test is written against the store, so it fails if any future writer reintroduces a partial view |

The mechanism, named precisely: **a clobber requires a write that replaces more than it knows. This design has no such write.** The only whole-document write left is the projection, and its input is the full table by construction.

---

## 7. What each decision gives up

| decision | what it buys | **what it gives up** |
| --- | --- | --- |
| server-owned SQLite store as authority | uniqueness, transactions, history, ordering, restart survival | **the relay is no longer sufficient to run the app.** A fresh instance with an empty DB and a dead relay has no routes; a store lost = leases lost (mitigated by mirror rehydration, which is a projection and can lag) |
| `bun:sqlite` (not Postgres) | zero deps, one file, sync, transactional | single-writer; no replication; backup is a file copy and nobody has written the backup story. Multi-instance deployment becomes a problem this design does not solve `[U]` |
| per-name relay mirror + manifest | no clobber, portability, offline-ish reads | ~1 extra event per lease transition; a manifest with a shard rule at 1500 names; two readers (API, mirror) that can disagree — stamped, but they can |
| new kind 30078 for the mirror | no collision with 3 live `d` namespaces | a **new event kind**, which `AGENTS.md:63` requires to be a documented decision with tests |
| two-artefact purchase (claim + lease) | no merge, no read-time rank, no "operator invented a payment" | two moving parts per purchase; a claim can exist with no lease (must be visible as *pending*, not lost) |
| assurance as a type (L1/L2/L3) | zap and nutzap can differ honestly; `AGENTS.md:43` respected | more UI states; two verification code paths; a nutzap lease is minted later (on claim) than a zap lease |
| derived liveness + occupancy cache | no sweeper is required for correctness | a stale occupancy row inside the grace window; a background reap that must exist for claimability to be timely |
| `Revision{seq,at,id}` store-assigned | the transport's `created_at` weakness cannot reach the domain | two clocks (store, relay) and an ordering that a relay-only reader cannot reproduce — a mirror reader must trust `seq` in tags |
| admin `reassign` as displace-with-history | `ruling-acl.md:47-48` satisfied (the loser is told) | an admin can always take a name — by design, and the audit row is the only remedy |
| domain owns the reserved-segment set | one place decides "this name can never be a route" | the set can drift from `routeTree.gen.ts`; a test must derive it, and adding a top-level route could retroactively invalidate a live lease (see §11.2) |

---

## 8. Migration from today's state

Nothing is deleted until the thing that replaces it is carrying traffic. Six phases, each independently revertible.

**Phase 0 — shadow (this increment, §9).** Domain + store land, empty, **wired to nothing**. A read-only `reconcile` command reads the current registry event (`buildVanityRegistryFilter`, `vanityRead.ts:21-28`) and prints the leases it *would* create, with a count. No writes, no behaviour change, typecheck delta 0.

**Phase 1 — the API reads the store, the UI still does not.** `/api/routes/resolve` goes live behind a flag. `$vanityName` and `/` keep today's behaviour; the client *calls* the API alongside and logs disagreements. Exit: zero disagreements on the production registry, or every one explained.

**Phase 2 — the mirror, and the registry becomes a projection.** Per-name events published; `publishRegistry()` rewritten to derive from `projectionVanityTags()`. **This is the commit that removes the clobber** — and it must come *before* any new writer (payments, management UI), because every new writer before it is a new way to trigger it. `[S]` the ruling says the same: persistence "fixes the clobber only if the *same* store is what the publish step reads" (`ruling-d3.md:61-64`).

**Phase 3 — payments.** Invoice persistence + the six-check zap verifier (§5.2) + the nutzap claim path (§5.3). **The zap verifier ships before the ledger accepts new leases** — otherwise the free-lease hole in §1.2 stays open under a new name. Existing reservations are imported as `tier='patron'` leases with `proofRef = null` and **`imported: true`** — an exception flag that exists only for migration and is asserted absent from any new grant by a test. This is the honest way to admit that today's leases have no recoverable proof: they never had one.

**Phase 4 — the management surface + editor delegations.** The dashboard page, `Delegation` rows, `SettingsAccessDenied` visible refusals. The page reads through the API, not the temporary store (`[S]` `platform/web/config/vanityStore.ts:12-14` marks itself TEMPORARY).

**Phase 5 — multi-page publishing, R1–R4.** `buildStorefrontPageEvent` gains a `dTag` parameter (`[S]` today a constant at `storefrontPublish.ts:60`), the `series` index, `SiteDefault` rendering at `/`, and `/` stops reading `useStorefrontAddressPage(APP_PUBKEY,'home')` (`[S]` `index.tsx:57`).

**Phase 6 — docs, ADR, e2e.** Correct `docs/vanity-urls.md` (it promises a 404 that does not exist and an endpoint that does not exist — research 01 §7), and one ADR covering: server-owned store, the outbox projection, kind 30078, and the assurance ladder.

**The `list` reference stays a marked follow-up** (`ruling-d8.md:70-80`): `Target` has the `list` variant reserved and *refused at the policy layer* (I11), so the follow-up is an addition to one union member and one renderer branch, not a re-architecture.

---

## 9. Increment 1, precise enough to execute

**Scope:** domain + store. No HTTP, no relay, no UI, no payment *wiring* (the payment types and the pure `fundedTerm` function are in scope; no invoice, no verifier). It is deliberately the smallest thing that makes the clobber structurally impossible to reintroduce.

**Branch:** cut from `unite/1420-all`, never `master` (`order.md:37-46`; F9's step-0 defect). Worktree `wt-c-admin-routes-inc1`; `bun install --frozen-lockfile` first or `bunx` fetches `typescript@latest` and reports 15215 errors (`order.md:135-142`).

**New files — SDK (framework-free, no store, no React):**

| file | contents |
| --- | --- |
| `sdk/core/routes/name.ts` | `Name` value object; `parseName(raw, policy) → Ok(Name) \| Err(NameError)`. `policy = { reserved: readonly string[], segments: readonly string[] }` — **injected**, never imported from `platform/` |
| `sdk/core/routes/target.ts` | `Target` union, `parseTarget(tag) → Target \| null` (unknown → `null`, never throws — the posture `storefrontPage.ts:616-625` already takes), `describeTarget` |
| `sdk/core/routes/lease.ts` | `Lease`, `Revision`, `compareRevision`, `isLive`, `lapseOf`, and the pure transitions `grant` / `renew` / `retarget` / `revoke` / `release` / `reassign` as `(state, cmd, ctx) → Result` |
| `sdk/core/routes/authority.ts` | `can(actor, op, subject, ctx)` — the table in §2.4, as data + a pure function |
| `sdk/core/routes/resolve.ts` | `resolve(history, at)`, `resolveSeries(members, at)`, `defaultFor(defaultRow, history, at)` |
| `sdk/core/routes/payment.ts` | `Assurance`, `PaymentProof` types, `fundedTerm(amountSats, tiers) → Term \| null` (reuses the tier semantics at `VanityManager.ts:47-55`, not the class) |
| `sdk/core/routes/index.ts` | re-exports |

**New files — server:**

| file | contents |
| --- | --- |
| `platform/server/routes/schema.ts` | the DDL of §3.1, exported as a string + `migrate(db)` idempotent on `user_version` |
| `platform/server/routes/LeaseStore.ts` | the port + a `bun:sqlite` implementation: `append(lease)` (assigns `seq`, updates `occupancy`, in one transaction), `history(name)`, `live(name)`, `setDefault(name)`, `audit(entry)`, `projectionVanityTags()`, `rehydrate(leases)` |
| `platform/server/routes/reconcile.ts` | read-only: registry event → proposed leases → **printed report** (no writes) |

**Tests (new):** `sdk/core/routes/name.test.ts`, `lease.test.ts`, `authority.test.ts`, `resolve.test.ts`, `payment.test.ts`, `platform/server/routes/LeaseStore.test.ts`.

**The properties increment 1 must prove — this is the exit criteria, not a test count:**

1. `Name` rejects: 2 chars, 31 chars, leading `_`, trailing `-`, uppercase input is *lowercased and accepted*, each of the 37 reserved words, and each of the 8 static segments. (Table-driven, one case per word.)
2. **I1 under contention:** two `append` calls granting the same name in the same process → exactly one succeeds, the loser receives `Denied('held-by:patron')`, and `occupancy` holds one row. (This is the store's unique index doing the work, `[M]` verified enforceable.)
3. **The clobber property:** seed a `perpetual` admin lease on `home`, a `patron` lease on `shop`, and a default on `home`; then grant a third patron lease; assert (a) all three still resolve, (b) `defaultFor` still returns `home`, (c) `projectionVanityTags()` still contains the admin's profile entry. **This test is the one the current code cannot pass** — `[S]` `publishRegistry` rebuilds from a map holding only `vanity` entries (`ZapPurchaseManager.ts:399-406`, `VanityManager.ts:110-112`).
4. **I2/I7:** `reassign` produces two rows, a `revoked` lease naming the actor and reason, and a new live lease with `supersedes` set; `history` shows both in `seq` order.
5. **I3:** renewing an unexpired lease adds to the old expiry (mirroring `ZapPurchaseManager.ts:190-193`); renewing an expired one starts from now.
6. **I4:** `grant(tier='patron')` with no proof → `Denied('proof-required')`; with a proof whose `settledAt` is null → `Denied('proof-unsettled')`; `grant(tier='admin')` *with* a proof → `Denied('proof-not-applicable')`.
7. **I8:** a lease with `term.expiring` at `t` is `Lapsed` at `t+1` **without any write** — same store, no reap, resolved from the derived clock.
8. **I10:** `resolve` returns a value for every `(name, at)` in a generated matrix (live/lapsed/revoked/released/absent/series-empty) and never throws.
9. **I9:** a series member published with a `publishedAt` older than the current newest is refused; equal timestamps resolve by `id` deterministically.
10. `reconcile` on a fixture registry event produces N proposals and **writes nothing** (assert `occupancy` and `lease` counts are unchanged).

**Gates:**

| gate | command | baseline |
| --- | --- | --- |
| typecheck | `NODE_OPTIONS=--max-old-space-size=12288 /home/admin_maxime/.bun/bin/bun bunx tsc --noEmit \| grep -c "error TS"` | **205** on a clean tree (`order.md:133`); compare the sorted error list, not just the count |
| new suite | `bun test --isolate sdk/core/routes/ platform/server/routes/` | no prior count — this is the number to record and carry forward |
| boundary | `bun test --isolate sdk/boundary.test.ts` | must stay green: `sdk/core/routes` imports nothing from `platform/` (`[S]` `sdk/boundary.test.ts` checks forbidden modules and sdk-escaping relative imports) |
| no behaviour change | `git diff --stat` touches only new files | phase 0 is additive by definition |

**Out of increment 1:** the verifier, the invoice table, the nutzap claim, HTTP, the mirror publisher, the projection rewrite (phase 2), the UI. Each has its own increment and its own gate.

---

## 10. Acceptance beyond increment 1 (the negative paths this design must own)

| # | case | expected | why this design can state it |
| --- | --- | --- | --- |
| N1 | editor touches a name outside their delegation | `Denied('no-delegation')`, rendered as a visible refusal | `can` is pure and returns a reason; `SettingsAccessDenied` already exists (`[S]` `ui/settings/operator-settings-views.tsx:59`) |
| N2 | patron requests a name held by admin/editor | `Denied('held-by:admin')`, reason names the tier | `occupancy` knows the lease id; the lease knows the tier |
| N3 | reservation used after its term | `Lapsed` — a *distinct* state from absent, with the lapse date | §2.6; today both are `null` (`vanityRead.ts:62-64`) |
| N4 | admin removes another tier's route | revocation takes effect; the holder sees `revokedBy` + reason on their own list | I7 |
| N5 | the default's lease lapses | `/` falls back to the inline composition and the dashboard says why | I12; `[S]` the fallback already exists at `index.tsx:102` |
| N6 | target document unparseable / switched off / zero blocks | the *page's* own honest failure state; the route does not blank the site | inherited, already asserted at `StorefrontAddressPage.test.tsx:108-123` |
| N7 | a lease whose `target` variant this version does not know | lease resolves, target is `Unsupported` and the surface says so; **never a blank** | `parseTarget` returns null for unknown, and `resolve` returns a value (§2.6) |
| N8 | a second default | impossible: one row, primary key | §2.1 |
| N9 | two concurrent grants of one name | one wins, one is refused with a reason | I1 + `[M]` unique index |
| N10 | a replayed payment proof | refused: `unique(rail, event_id)` | §5.4 |
| N11 | a forged 9735 (the §1.2 hole) | refused at check 2 or 3 (§5.2) | the invoice table is the missing artifact |

---

## 11. Where measurement refuted or complicated the bet

This is the part the commission asks for, so it is not buried.

### 11.1 Upheld: the clobber, R1/R2, the ACL, and the persistence direction

Four of v1's five defects are, on measurement, inheritance defects, and each dissolves when the domain is primary:

- the clobber needs a whole-table serialiser; the domain has no such operation (§6);
- R1/R2 need pages to be independent of names; the domain's `Target` makes that structural, and `[S]` the kind is already addressable (`storefrontPage.ts:34`), so the only change is the constant at `storefrontPublish.ts:60`;
- the ACL's three tiers need an entitlement relation; the domain's `Delegation` is that relation, and `[M]` nothing in the codebase implements one today;
- the persistence direction is right, and stronger than the ruling's evidence implies, because the server has **no** store at all (§1.1) — so building one is not an extension but it is also not a regression of anything that exists.

### 11.2 Refuted (partly): "the name space is a domain concern only"

The name space **overlaps the router's**, and the router is not something the domain can see. `[M]` 8 static one-segment segments exist; `[S]` TanStack gives static segments priority over `/$vanityName` (`routeTree.gen.ts:74-76`, pinned by `sellerRoute.test.tsx:52-64`). So a lease on `auctions` would be silently dead — and `auctions` is **not** in the 37 reserved words (`[M]`, both lists checked), which is F7's first undecided case and it is a real hole, not a nit.

I keep the bet, but the honest form is weaker than "the domain owns the namespace": **the domain owns the namespace, subject to an injected exclusion set that only the router can enumerate**, and the set must be derived by a test rather than typed by hand:

```
[test] the injected `segments` equals the set parsed out of platform/web/routeTree.gen.ts
```

Consequence I accept: adding a top-level route later can retroactively invalidate a live lease (a name that was legal yesterday). The rule must then be *grandfather, and warn* — not "silently stop resolving", which would be the exact class of silent meaning-change this report keeps objecting to.

### 11.3 Refuted: R3 cannot be fully separated from the transport

**"Newest page of that kind" is a fact about a sequence of signed documents, and the only trustworthy timestamp on a document is the one its author asserted.** There is no domain-side clock that can establish it without becoming an authority over content ordering that the operator should not have (the operator could reorder a series by rewriting its own clock).

So: `Target{series}` couples to the transport, and I contain it with I9 (monotonic publish) rather than pretend otherwise. **This is the one place where a behaviour exists only because events are signed and ordered, and the bet's clean separation fails.** A reviewer should read §2.6's `series` row as "the domain defines the *question*, the transport supplies the *answer*, and the invariant is what stops the answer from being gamed".

### 11.4 Strengthened beyond expectation: the verifier already exists, and the payment path ignores it

`zapRead.ts:17-19` states the correct epistemology ("receipt presence is not settlement proof") and ships the parser; `ZapPurchaseManager.ts:113-207` does the opposite (prices a lease from a requester-asserted `amount` tag, `:175-180`) and never calls it. That is not a design gap, it is a **wiring gap plus one missing table** (§5.2), and it means the payment half of this design is smaller than I budgeted for — while the *risk* it closes (§1.2: free one-year leases for anyone who can publish a 9735) is larger than anything in the commission's brief.

I flag it as a **finding against the current state, independent of which candidate is accepted**: no candidate should ship a routes ledger while the purchase path prices leases from a client-asserted amount.

### 11.5 Complicated: "the relay stays the source of truth" is not a cost I can wish away

My design moves authority to a server store. `AGENTS.md:64-65` calls an outbox "an architectural option … not a verified current architecture". So this candidate is the one that most clearly *changes the architecture*, and it should be read as such. If the maintainer's actual requirement is "the app works with the relay and nothing else", this candidate is the wrong shape and v1's conservative revision is right — that is a product decision, not a technical one, and it is the first thing to settle if C is chosen.

**And the unresolved half of it:** the app's *pages* are still authored by users and read from relays. Only *names* move to the store. So the design is a hybrid by construction: names are leased centrally, pages are published openly, and the join (`Target{page}`) is a coordinate. I think that is the right seam — it is exactly the seam `ruling-d8.md:56-68` points at — but a hybrid has two failure modes, not one, and §7's "two readers can disagree" is the one I cannot close.

---

## 12. The single strongest objection to this design

> **A server-owned store makes the site's routes depend on the operator's server. That is a worse failure mode than any bug in v1, if "your storefront path resolves even when the operator is off" is part of the product.**

v1, for all its clobber, has one genuinely excellent property: a route is resolved from a relay event by a client, so the operator's downtime does not change what `/shop` means. My design puts that meaning in a SQLite file behind an HTTP endpoint, and the mirror is a *projection* — which is to say, on a cold instance with a dead relay, `/shop` resolves to nothing and the fallback renders. I mitigate it (mirror rehydration, per-name events, a bounded staleness marker), but I cannot remove it, because a projection is only as fresh as its last successful publish.

**Why I still choose it:** the alternative is to keep the relay authoritative, and then uniqueness (I1), history (I2/I7), ordering (I9), replay defence (§5.4) and a fail-closed payment check (`ruling-d3.md:22`) all have to be re-implemented *on top of a store that provides none of them* — which is precisely the work v1 is doing, and precisely where its five defects come from. The bet is that the operator's server being up is a weaker assumption than an eventually-consistent relay being a database. If that assumption is false for this product, the design is wrong at the root and should be replaced, not patched.

**Second, and cheaper to fix if the maintainer disagrees:** two artefacts per purchase (claim + lease) is more machinery than v1's one, and a claim with no lease is a state that needs a visible home on the dashboard or it becomes a support ticket.

---

## Appendix — evidence index

Every `file:line` above, grouped so a reviewer can re-run the reads:

- **Registry/legacy:** `sdk/core/curation/vanityRead.ts:5,7-11,21-28,31-35,38-42,44-54,56-65,90-102`
- **Purchase path:** `platform/server/ZapPurchaseManager.ts:40,90-108,113-207,126-131,167-172,175-184,187-193,268-370,376-390,393-418`
- **Pricing/name rules:** `platform/server/VanityManager.ts:6-44,47-55,83-95,97-108,110-112,145-172,182-186`; `sdk/config/vanity.ts:51-89,171-175`
- **ACL:** `platform/server/AdminManager.ts:4-47`; `platform/server/EditorManager.ts:4-47`; `platform/server/EventValidator.ts:19-48,50-94`
- **Signing/proxy:** `platform/server/EventSigner.ts:10-25`; `platform/server/websocket.ts:30-46`; `platform/server/EventHandler.ts:72,167-197`
- **Payments (SDK):** `sdk/commerce/payments/zapRead.ts:1,17-33,67-82,85-90,96-120`; `sdk/commerce/payments/wallet/nutzap.ts:5-8,34-37,224-279,307-312,329-338,355-431`; `platform/web/wallet/walletOps.ts:718-760`
- **Storefront/pages:** `sdk/commerce/storefront/storefrontPage.ts:7,34,59-69,616-625`; `platform/web/storefront/storefrontPublish.ts:60`; `platform/web/routes/index.tsx:48,57,102`; `platform/web/routes/$vanityName.tsx:15-41`
- **Event store (client-side only):** `sdk/core/event-store/port.ts:24-31`; `memoryEventStore.ts:18`; `applesauceEventStore.ts:19-36,41-83`
- **Doctrine:** `AGENTS.md:36-38,43,50,63-65`; `sdk/AGENTS.md:38-61`
- **Server routing convention:** `platform/server/http/types.ts`; `platform/server/http/zapPurchase.ts:13-58`

Numbers and their commands, collected:

```
37 reserved names      awk 'NR>=6&&NR<=44' platform/server/VanityManager.ts | grep -oE "'[a-z]+'" | wc -l
37 reserved names (SDK) awk 'NR>=51&&NR<=89' sdk/config/vanity.ts | grep -oE "'[a-z]+'" | wc -l
8 static segments      grep -oE "path: '/[^']*'" platform/web/routeTree.gen.ts | sed "s/path: '//;s/'//" \
                       | awk -F/ 'NF==2 && $2!="" && $2 !~ /\$/ {print $2}' | sort -u
0 durable writes       grep -rn "Bun.file|Database|writeFile|node:fs" platform/server/ --include=*.ts | grep -v '\.test\.'
0 event-store imports  grep -rn "event-store" platform/server/*.ts platform/server/http/*.ts
33 B/manifest entry    bun -e "JSON.stringify(['n','featured-0001','0000007']).length"
bun 1.4.2 + sqlite     bun --version; bun -e "import {Database} from 'bun:sqlite'"
partial unique index   bun -e "<create unique index … where ended is null>; second insert throws"
bolt11 payment_hash    node --input-type=module -e "decode(BOLT11_20U).sections"
```

No key material is reproduced in this document. No file outside this one was created or modified; no build, test, branch or deployment was run.