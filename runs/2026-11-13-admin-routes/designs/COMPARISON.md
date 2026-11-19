# Adjudication — four candidate architectures for admin-managed routes

**Run:** 2026-11-13-admin-routes · **Role:** adjudicator (no design of my own) · **Base:** `/home/admin_maxime/work/market`, branch `master`, HEAD `f79c923f5`; `git diff --name-only 2326938b3 HEAD | grep -v '^runs/'` → **empty**, so the four pinned facts still hold. No branch, no build, no test run, no write except this file.

**Labels.** **[M]** measured by me, command shown · **[S]** read from source at `file:line` · **[J]** judgement, arguable · **[U]** unverified. Where a candidate and I disagree, my command is printed so it can be re-run.

**What I could not do.** The typecheck baseline (**205**) is quoted by all four and by `order.md:132-134`; I did not run it — this task forbids builds. It is **[U]** for me and **[U]** for every candidate that carries it forward. `proposal-v2.md` is the only one that refuses to carry it across branches, and it is right to.

---

## 1. Convergence — findings more than one candidate reached independently

Independent agreement is the strongest evidence in this commission, because the four worked from the same tree without seeing each other. Eight findings converge. I re-measured every one.

### C1 — The server has **no durable storage of any kind**. **CONFIRMED**

Found by A (§2.2), B (§1.1), C (§1.1); v2 does not address it. It is the finding that decides whether the owner's proposal is a switch or a build.

```
$ grep -rnE 'bun:sqlite|node:fs|writeFile|readFile|Bun\.file|new Database|mkdir' platform/server/ --include=*.ts | grep -v '\.test\.'
   → (no matches)
$ grep -rn 'event-store' platform/server/ --include=*.ts
   → (no matches)
$ grep -rln 'createApplesauceEventStore\|createEventAccess' --include=*.ts . | grep -v node_modules
   → sdk/core/event-store/{applesauceEventStore,eventAccess,index}.ts, platform/web/{applesauceReadContext,ndkReadContext,indexedDbEventDatabase}.ts  (+ their .test.ts)
```

The event store is real and injectable — `applesauceEventStore.ts:80-88` takes a `database`, defaulting to in-memory (`:19-36`) — but **nothing under `platform/server/` imports it**. The owner's "persist the zap events in the server's own event-store" therefore names a store that does not exist. That is a **build**, not an extension of live machinery.

The ruling's evidence for the opposite is wrong in a specific, checkable way. `platform/server/server-bootstrap-persistence.test.ts` contains **5** tests (`grep -c 'test('` → 5) that construct `AdminManagerImpl` and `BootstrapManagerImpl` over in-memory `Set`s and assert the bootstrap gate. It persists nothing; there is no event in it. Ruling `ruling-d3-persistence-and-redesign.md:36-38` rests a bullet on that file.

**Why it matters more than it looks.** The ruling's cost line ("this is an extension of live machinery") is what made server persistence look cheap. It is cheap, but it is not free, and A is right that the price is a data directory, a backup story and a new failure mode where none existed.

### C2 — Today's zap verification is a **presence check**, not proof of payment. **CONFIRMED**

Found by A (§2.3), B (§1.3), C (§1.2) — and, independently, by the repo's own doctrine at `AGENTS.md:45`: *"Do not equate wallet acknowledgement, receipt publication, **zap presence**, or an external payment marker with settlement."* The purchase path violates the rule the repository wrote for itself.

`handleZapReceipt` (`platform/server/ZapPurchaseManager.ts:113-207`) checks, in order: id present (`:114`), not in an in-memory dedupe set (`:116-123`), younger than 300 s (`:126-131`), a `description` tag parses (`:134-143`), an `L` label matches, a `vanity` key is present, `validateRegistration`, and a `bolt11` tag **exists** (`:167-172`). Then:

- the amount comes from the **payer's own signed request**, not the invoice: `:175-176` reads the `amount` tag out of the 9734; `:180` maps it to a tier. The `bolt11` is never decoded.
- `verifyEvent` is **never called** on the receipt: `grep -rn 'verifyEvent' platform/server/*.ts platform/server/http/*.ts` → only `ogMeta.ts:219` and `websocket.ts:30`.
- the receipt's author is never compared to the provider: `nostrPubkey` is declared on the LNURL type at `:40` and **never read anywhere in `platform/server`**.
- the subscription is a `#p`-only filter on quiet relays: `EventHandler.ts:167-178` (`kinds:[9735], '#p':[appPubkey]`), against `ZAP_RELAYS` — **7** relays, `sdk/config/constants.ts:72-80`.

So any key that can publish a kind-9735 to any one of seven public relays, carrying a self-signed `description` with `amount=180000000` and `L=<purchase label>`, obtains a one-year reservation for nothing. **[S]** on the code path; **[J]** on exploitability — nobody ran it against a live node, and relay write policy is **[U]**. The absent checks are measured; the exploit is reasoned.

### C3 — Nutzap machinery already exists, and the rail is **stronger than zaps** in one decisive way. **CONFIRMED, with a correction that costs two candidates**

Found by A (§2.4), B (§5.3), C (§1.4). `sdk/commerce/payments/wallet/nutzap.ts` is **624** lines (`wc -l`), defines `NUTZAP_INFO_KIND=10019 / NUTZAP_KIND=9321 / NUTZAP_REDEMPTION_KIND=7376` (`:34-37`), builds P2PK-locked proofs, and ships `validateNutzap` (`:355`) — the full NIP-61 observer checklist. `grep -rniE 'nutzap|NIP-?61|9321' --include=*.ts --include=*.tsx sdk platform ui | wc -l` → **274**.

The decisive asymmetry all three state and I confirm: a **zap** proof is an assertion (a provider says it was paid); a **nutzap** proof is a bearer instrument, and settlement is **custody** — a mint call, not a relay read (`nutzap.ts:5-8`: *"The event is the proof of payment"*). That is what lets a nutzap satisfy the owner's "checks with no relay connection at all" by construction.

**The correction.** A says *"No `platform/server/` file mentions cashu at all. [M]"*. False. C says *"no checkstate, no mint client … nothing in the repo calls a mint from the server [M]"*. Also false. The server already owns a policy-checked mint egress:

```
$ grep -rniE 'cashu|checkstate' platform/server --include=*.ts | grep -v '\.test\.'
   → platform/server/util/cashu.ts:1,13   (cashu-ts `Mint`, getKeySets)
   → platform/server/auction-validator/mintDestination.ts (SSRF-guarded transport)
   → platform/server/auction-validator/mintReachability.ts:99  checkMintReachability(...)
   → platform/server/auction-validator/subscriber.ts:369       … called on every auction ingest
```

NUT-07 batching itself is `sdk/commerce/payments/cashu/nut7.ts:116` (`checkProofStateBatch`), and it is imported server-side. **B is the only candidate that found this** (§1.1), and B calls it "the strongest single fact in favour of the bet."

B still overstates it by one notch: the poller that checks *bid proofs* is a **no-op**. `platform/server/auction-validator/nut7Poller.ts:88-90`: *"NUT-7 polling is disabled — the client now queries the mint directly … `tick` is retained as a no-op."* What runs today is a **reachability probe** with a dummy `Y` (`nut7.ts:94`), not a proof-state verdict. So: the *client and the egress policy* exist; the *verification of a payment* does not. That is a wiring job, not a research job — which is the same conclusion, one notch less flattering.

### C4 — A correct verification primitive already exists in the repo, and the purchase path does not call it. **CONFIRMED**

C found it (§11.4) and called it "the strongest single fact in this report"; A found the same hole from the other direction (§5.2 steps 3–4) without noticing the existing parser. Both are right.

`sdk/commerce/payments/zapRead.ts` states the correct epistemology at `:17-19` — *"The amount is what the receipt's bolt11 invoice claims; receipt presence is not settlement proof"* — and ships the machinery: `readBolt11AmountMillisats` (`:86`, decodes the bolt11), `parseProviderZapReceipt` (`:96-115`, takes the amount from the invoice and `providerPubkey` from `event.pubkey`), and `buildProviderZapReceiptFilter` (`:67-82`, `authors:[providerPubkey]`).

`grep -rn "zapRead" platform/ sdk --include=*.ts | grep -v '\.test\.'` → **one hit**, `sdk/commerce/payments/index.ts:6` (a re-export). The purchase path imports none of it. Payment verification here is a **wiring gap plus one missing table** (the invoice row), not a design problem.

### C5 — Kind 30024 is addressable; only a constant makes it one page per author. **CONFIRMED**

Unanimous, and it is the load-bearing fact for R1. `storefrontPage.ts:31` (`= 30024`), `:34` (`STOREFRONT_PAGE_D_TAG = 'storefront-page'`), `:7` ("one per pubkey"); the publish builder hard-codes it at `storefrontPublish.ts:60`; the reader is **already** `(author, d)`-generic — `storefrontQuery.ts:75` takes `dTag = STOREFRONT_PAGE_D_TAG` and filters `'#d':[dTag]` at `:85`. Addressability is `sdk/core/event-store/mergeRules.ts:9-11` + `:19` (`kind:pubkey:d`).

So "one page per author" is one constant in one function, not a storage property. All four agree; the difference is only what they do with the fact.

### C6 — One shared replaceable event is the clobber's cause; per-name records kill the class. **CONFIRMED**

A §9, B §7, C §6, v2 §M3/D13. The mechanism, measured: `publishRegistry()` (`ZapPurchaseManager.ts:393-417`) builds `[['d', dTag], ...this.buildRegistryTags(this.registry)]` (`:404-405`) and `buildRegistryTags` emits **only** `['vanity', name, pubkey, validUntil]` (`VanityManager.ts:110-112`); the ingest that fills that map likewise accepts only 4-element `vanity` tags (`:97-108`). Every receipt calls `publishRegistry` (`:202`). Anything in that event that is not a `vanity` tag is destroyed on the next purchase — not as a race, as a rule.

The repair all four converge on is the same: **stop putting routing data in that event**. A does it with per-path events; C does it with a store plus a per-name mirror; B does it with a table; v2 shrinks the event and moves pages out. Only v2 keeps claims *inside* the same event — see §4.

### C7 — The namespace collides with the router: exactly one name, `auctions`. **CONFIRMED** (the count is disputed; the conclusion is not)

A (§2.6), B (§6.2), C (§11.2), v2 (D7). Measured:

```
$ reserved names            sed -n '51,89p' sdk/config/vanity.ts | grep -oE "'[a-z0-9_-]+'" | sort -u | wc -l      → 37
                            awk 'NR>=6&&NR<=44' platform/server/VanityManager.ts | … | wc -l                     → 37  (identical sets)
$ top-level static segments grep -oE "path: '/[^']*'" platform/web/routeTree.gen.ts | sed … | awk -F/ 'NF==2 && $2!="" && $2 !~ /\$/ {print $2}' | sort -u
                            → auctions checkout community dashboard new nostr posts products setup          → 9 strings, 8 real
$ comm -23 <static> <reserved>
                            → auctions
```

`auctions` is a real top-level route and is **not** reserved: a claim on it is silently dead under `/$vanityName`. That is a live hole in v1, and every candidate closes it at write time.

**Dispute settled:** B reports "**9** static segments … `index` is `/`". C reports **8** and says `/new` is nested. C is right: `routeTree.gen.ts:269-280` declares `path: '/new'` under `getParentRoute: () => DashboardLayoutDashboardProductsProductsRoute` (and again under `…CollectionsRoute`), so `/new` is `/_dashboard-layout/dashboard/products/…/new`, not top-level; `index` never appears as a path in that parse. B's `awk` counted the literal string and could not see the parent. The number 9 is reproducible; the reading behind it is wrong.

### C8 — `docs/adr/ADR-0006` **already decides the authority question** that three candidates reopen. **CONFIRMED — my finding; no candidate cites it as binding**

This is the sleeper of the commission, and it is why the divergence in §2 is smaller than it looks.

`docs/adr/ADR-0006-cms-and-nostr-native-page-building.md:211`:

> *"For interoperability and data resilience, the app should sign a proof event that a vanity URL has been assigned to a specific pubkey … This proof event lives on relays and **can be verified by any client — not just the Plebeian Market server**."*

and `:215`:

> *"This keeps the vanity URL system as the single source of truth for routing, **with the app's signature as the authority proof**."*

The same ADR at `:205-206` already names the route classes — App-reserved (code), Admin-assigned (app pubkey), Seller-owned (seller pubkey + app proof) — and at `:209` gives ordinary users their multi-page space **under** their reserved name (`/alice-store/featured`), not at top level.

Three consequences:

1. **A's central mechanism is not new**; it is ADR-0006:211's unimplemented commitment. A cites `AGENTS.md` for the cost of new kinds but never cites the ADR that asks for the event — so A under-sells its own strongest warrant.
2. **B's bet contradicts an accepted ADR.** B is candid: it says at §1.4 that if "reads must not depend on the operator's API" is house doctrine, *"this design is refuted at the level of the bet."* ADR-0006:211-215 is that doctrine, scoped exactly to routing. B asked to be rejected on this ground; the document it did not cite supplies it.
3. **C survives it** — but only because of the per-name mirror (§4.2), not because of the store. C's authority is the DB, yet any client can still resolve a name from `d="route:<name>"`. That is the ADR's requirement met, by a component C treats as secondary.

---

## 2. Divergence — the real axes

Six axes. Each is marked **VALUES** (what the product is; only the owner can settle it) or **FACTS** (settleable by measurement — I settled every one I could).

### X1 — Where the record of a name lives. **VALUES**, with an ADR fact attached

| | position |
|---|---|
| **A** | one app-key-signed kind-30025 event per path; the server is the only writer; the DB is a rebuildable view |
| **B** | a SQLite table is the authority; Nostr is a one-way sharded projection with a hash root |
| **C** | a SQLite lease table is the authority; a per-name app-key-signed event is a mirror that can rehydrate it |
| **v2** | the existing single kind-30000 event, holding claims for contested names only |

**A buys** portability and a readable-with-no-server record: hand someone the event and they can verify who holds a name without this operator. **A gives up** self-sovereignty of the name (it says so in §4.3 and §13 — the claim namespace has one writer, the server), and makes every write a relay write.

**B buys** the strongest guarantees a single process can give — uniqueness, ordering, transactionality, replay defence — in one file, with a write path that cannot forget an entry class. **B gives up** the one genuinely good property v1 has: a name that resolves when the operator is down. B names this honestly (§9.1) and then declines to soften it.

**C buys** B's guarantees *plus* a per-name relay mirror, so the operator can be bypassed for reads and a lost DB can be rehydrated. **C gives up** the same freshness guarantee B does at the edges ("a projection is only as fresh as its last publish", §12) — but the failure is bounded to a lag, not to nothing.

**v2 buys** no new storage at all. **v2 gives up** durability, atomicity and history, and pays a 32 KB budget it invented (`230` claims, its own number).

**Fact attached:** ADR-0006:211-215 requires the name record to be verifiable "by any client — not just the Plebeian Market server". That does not forbid a DB; it forbids a DB being the *only* record. C meets it. B does not (a sharded blob with a hash root lets a third party detect rewriting, not resolve a name). **So X1 is not A-vs-B-vs-C; it is "must the record survive the server?" — and the repo has already answered yes.**

### X2 — Is a path the page's own address, or a separate record? **VALUES**

**v2:** `d` **is** the path. Publishing a page at `d='featured-13-11-2026'` puts it at that URL; claims exist only for contested names. **A/B/C:** a path is always a record that *points at* a target; a page has an identity (`author, d`) that is not its path, and two paths may alias one page.

**v2 buys** the smallest possible model — no claim for the common case, no server, one publish and the page is live. That is genuinely attractive for an admin who wants "publish a page to a path" with no ceremony. **v2 gives up** arbitration by default: an unclaimed path is governed by a read-time rule (oldest-wins), so "who owns `/about`" has no record, only a convention every reader must implement identically.

**A/B/C buy** one place that answers "who holds this name, until when, pointing at what" — a claim total for its path. **They give up** v2's zero-ceremony publish: every path needs a record, so publishing to a new path is two steps (page + record) or a server call.

**Fact attached:** ADR-0006:209 says the name is *"rented and arbitrated"* while the page *"is the author's"*. v2's default state has a name that is neither rented nor arbitrated — it is just the page's `d`. That is a real departure from a documented decision, and v2 does not notice it.

### X3 — How a write is authenticated. **FACT + a gap in one candidate**

**A** keeps the existing WS proxy: admin writes are signature-checked (`websocket.ts:30`) then **re-signed as the app key** (`EventSigner.ts:17-26` copies `tags` and `created_at` verbatim, swaps the pubkey; `EventHandler.ts:238`). A then *adds* server-side `seq` and server-assigned `created_at` to close the future-clock hole. **B** refuses the proxy as an enforcement point — correctly, because it copies the client's tag list — and specifies **NIP-98** (kind 27235) with the server building rows from a parsed intent, never from submitted tags. **C** specifies an HTTP API and a pure `can(actor, op, subject, ctx)` — and **never says how the server learns who the caller is.** `grep -c` for `NIP-98`, `27235`, `authent`, `session`, `cookie` in `C-ownership-domain.md` → **0**. **v2** keeps the proxy and therefore keeps v1's §6.2 finding.

Settled fact: NIP-98 has **zero** precedent here — `git grep -n '27235\|NIP-98' -- platform/ sdk/ docs/ | wc -l` → 0. B is right that this is new machinery and prices it in increment 2.

**C's gap is the most serious single omission in any candidate**: an authority function whose `actor` is never established is not an authority function, and its HTTP surface (`POST /api/routes/grant|retarget|renew|revoke|release|reassign|default`) is otherwise exactly the right shape. It is fixable by adopting B's NIP-98 answer, which is what I recommend in §5.

### X4 — How "newest in a series" resolves. **FACTS, mostly settled**

**v2 / A:** a `["t","series:featured"]` tag on the page; `/featured` queries `#t` restricted to the holder's pages, newest-first. **B:** a `seriesKey` column on the route row, membership enforced by a name-prefix rule. **C:** `Target{series}` as a query with invariant I9 (a new member must be strictly newer).

**Settled:** the *tag* axis is right and the *d-prefix* reading is dead — relays match `#d` exactly, so "newest `d` starting with `featured-`" is a full scan (v2 M1, A §3.2, C §2.6 agree). `#t` is already used in production for other kinds (`sdk/commerce/discovery/productRead.ts:28`).

**Unsettled, and it matters:** whether this deployment's relay indexes `#t` on **kind 30024** — **[U]**, no live relay in this run, and v2 is the only candidate that lists it as a risk it is taking. A and B silently assume it. B side-steps it by putting the series key in the row, which is a real advantage of B's model at a real cost (the series is then a server fact, unreadable without the server).

**One attack all three miss in the same way and one closes:** A closes "anyone tags their page `series:featured` and becomes `/featured`" with `authors:[holder]` (§8-R3). C closes backdating with I9. B closes accidental membership with a prefix rule. v2 addresses it with a trusted-author filter (§D16), which is weaker — see §4.

### X5 — Who wins when two people publish the same unclaimed path. **VALUES**

**v2:** oldest enabled page wins; ties by lowest event id; a pre-publish check warns but is TOCTOU. **A:** the case barely exists (a path needs a claim; unclaimed falls through to legacy behaviour). **B/C:** one live lease per name, refused at write, `Denied('held-by:…')`.

**v2 buys** "a URL an operator already printed never changes under them" — a real concern, and its reasoning ("I prefer sticky over hijackable") is sound. **v2 gives up** reclaimability: a dead author's path is unusable until an admin claims it. **B/C buy** a single occupant and a named refusal. **They give up** the cheap self-service publish — every contested name needs a write to the authority.

### X6 — Scope of the payment work. **JUDGEMENT, and the sharpest split**

**A** fixes zap verification in step 4 and defers nutzap to step 6 (correctly: it carries new egress and the weakest evidence). **B** fixes zap in increment 1 and nutzap in increment 4. **C** fixes zap in phase 3 *before* the ledger accepts new leases, and nutzap after. **v2 does not touch verification at all** — it keeps v1's accepted D1/D3 and inherits the free-lease hole.

That is the single largest difference in what the owner gets, and it is not an architecture question. C states the rule the others imply: *"no candidate should ship a routes ledger while the purchase path prices leases from a client-asserted amount"* (§11.4). I agree, and it is the one finding that makes v2-as-final-answer untenable even though v2-as-first-step is excellent.

---

## 3. The one-way doors

Ranked by how expensive the mistake is, not by how interesting it is.

**1. Whether a name is reconstructible outside the database. — THE door.**
Once payments are accepted and the invoice→proof→lease binding exists only in a SQLite file, going back to relay authority loses money-relevant history. B's own rollback story ("delete the DB file … returns the process to v1", §8) is only safe **if no payment was accepted since the last projection** — which B concedes in §9.6. The mitigation costs almost nothing *now* and cannot be bought later: **write a self-sufficient, app-key-signed event per name inside the same transaction that grants the lease.** A's §3.3 ("a claim is total for its path and nothing else") is the property to insist on; C's mirror has it; B's sharded blob does not. This is the door my recommendation is built to keep open.

**2. Whether the server or the client sets ordering. — Mostly one-way.**
A and C both assign `seq` and `created_at` server-side, closing the future-clock hole that `EventSigner.ts:17-26` opens. Once names are ordered that way, a third-party reader must trust the tag; you cannot un-invent it. Cheap now, impossible to reverse later without re-ordering live names. v2 avoids the door by keeping client `created_at` + oldest-wins — a different permanent semantic, visible to users.

**3. New event kinds. — Cheap to add, permanent once published.**
A's 30025/30026 and C's mirror are effectively permanent (relays keep them; other readers may adopt them). Both are *additive* — nothing breaks if you stop writing them — so this is a low-cost door, not a trap. One correction: C calls 30078 a "new event kind"; **five** modules already define it (`cartSnapshotPublish.ts:6`, `nwcWalletList.ts:6`, `paymentDetailRead.ts:4`, `v4vRead.ts:4`, `relayListPublish.ts:6`) and **15** non-test files reference it. Reusing it is *cheaper* than C prices it, and needs a `d`/`l` namespace check rather than an ADR for a new kind.

**4. `d` = path on pages. — NOT a one-way door, and this is the key to the sequencing.**
All four adopt it. Once hundreds of pages exist at `d=<path>`, you can still insert a claim layer *above* them without touching a single published page or URL — because the claim is step 0 of the ladder and the page-by-`d` read is step 2 (v2 §3.3, A §3.5, C §2.6 all have this shape). **Choosing v2's read model first therefore does not close the door to A's or C's ownership model.** That is why the first ship can be the conservative one without prejudging the destination.

**5. Taking custody of customer funds for nutzap. — A business door, not a technical one.**
All three that build it need a server wallet and a swap (A §5.3, B §5.3/§5.4, C §5.3). B is the only one that names the regulatory character of the adjacent credit ledger and refuses it (§5.4). Defer: the rail's evidence is also the weakest (a nutzap degrades from bearer credential to operator attestation at settlement — all three say so).

**6. `oldest wins` for unclaimed paths. — Low stakes, user-visible, hard to change quietly.**
It is a semantic a user experiences ("my page stopped being at `/x`"). Reversible in code, not in people's links.

---

## 4. Unsupported claims, per candidate

Ordered by how much the claim is load-bearing for its own design.

### A

- **"No `platform/server/` file mentions cashu at all. [M]" (§2.4) — REFUTED.** `platform/server/util/cashu.ts:1,13` constructs a cashu-ts `Mint` and calls `getKeySets()`; `auction-validator/` has 24 tracked files, several of which call a mint. The command that produced "no matches" was evidently non-recursive over `platform/server/*.ts`. The *conclusion* A needs ("no server-side Cashu **wallet**") survives; the census does not. Consequence: A over-prices the nutzap rail by the whole mint-client/egress-policy layer, which exists.
- **The kind census (§3.1) — INCOMPLETE [M].** A lists 16 kinds in use. `grep -rhoE '3[0-9]{4}' --include=*.ts sdk platform | sort -u` returns **35** (including 30078, 30410, 30454, 30998, 31298 …). The conclusion A draws — "30025 and 30026 are unused" — is **correct** (zero hits), so this is a broken measurement with a surviving conclusion. Worth flagging because the same census is what would catch a collision.
- **"The server's routes database is a materialised view … Delete it and nothing is lost" (§0.5) — OVERSTATED against its own §6.2**, which says losing the DB loses "history and pending reservations". Pending reservations hold **money**: a buyer can have paid an invoice whose reservation row is gone (A §5.4 then relies on a human refund). "Nothing is lost" is false for exactly the case that costs the owner cash.
- Honest items that deserve credit: the underpayment path is labelled **[U]** for reachability and **[S]** for the code path; the inventory-denial and refund obligations are stated as costs; §13 prints the strongest objection to itself and answers it rather than deflecting.

### B

- **"The server can verify a Cashu payment without a relay … is code that runs today for auction bids" (§1.1) — PARTIALLY REFUTED.** The **bid-proof** poller is a no-op: `auction-validator/nut7Poller.ts:88-90` — *"NUT-7 polling is disabled … `tick` is retained as a no-op."* What runs today is `checkMintReachability` (a probe with a dummy `Y`) reached from `subscriber.ts:369`. B's *point* — the client and the SSRF-guarded egress exist, so the rail is a wiring job — is **right and is the best single discovery in the commission**. The sentence as written claims a verification that does not execute.
- **"9 static segments … `index` is `/`" (§6.2) — WRONG READING, conclusion right.** The real set is **8** (see C7); `/new` is nested. The `comm` result `auctions` is correct, which is what the design depends on.
- **NIP-98 and `AGENTS.md:63-64` (§5.1).** B argues a registered kind satisfies the rule "by documentation, not by an exception". The rule is about *new event kinds, payment semantics, relay assumptions and network egress paths*; NIP-98 is a new **authentication mechanism** with zero precedent in the repo (`git grep … | wc -l` → 0). B is buying an exemption it says it isn't buying. Minor, but it is the shape of overclaim an adjudicator should mark.
- **"Nothing is ripped out … rollback: delete the DB file and set `ROUTES_AUTHORITY=relay`" (§8) — OVERSTATED**, by B's own §9.6: payments accepted since the last successful projection live only in the deleted file. A rollback that silently discards paid reservations is not a rollback.
- Credit: B is the only candidate that states the *exact* condition under which its own bet dies (§1.4) and asks to be rejected rather than patched. That is the most honest paragraph in the four documents — even though the condition it names is met by ADR-0006:211.

### C

- **"no checkstate, no mint client … nothing in the repo calls a mint from the server [M]" (§1.4, §5.3) — REFUTED.** `mintDestination.ts` is a full policy-enforced transport, `mintReachability.ts:99` calls `checkMintReachability`, `subscriber.ts:369` calls that on ingest. C saw `mintDestination.ts:118` and dismissed it as "a URL-normalisation comment". This is the one place C's measurement is simply wrong, and it inflates C's cost line for the nutzap rail.
- **"`kind 30078` … a new event kind, which `AGENTS.md:63` requires to be a documented decision" (§4.2, §7) — WRONG.** 30078 is already defined by **5** modules and referenced in **15** non-test files. Not a new kind; needs a namespace check, not an ADR-for-a-new-kind.
- **The HTTP API has no authentication story (§4.1, §2.4).** `can(actor, …)` takes an actor; nothing in the document says how the server establishes one. Searched: `NIP-98`, `27235`, `authent`, `session`, `cookie` → 0 hits. Every other candidate names its mechanism (proxy re-sign for A, NIP-98 for B, the legacy proxy for v2). This is a hole, not a preference, and it is the largest single omission in any of the four.
- **Non-recursive greps presented as whole-tree measurements** (§1.1: `grep -rn "event-store" platform/server/*.ts platform/server/http/*.ts`). The conclusion happens to hold today; the command cannot support it if a `platform/server/routes/` directory exists — which C's own design creates. Its own increment would invalidate its own evidence command.
- Credit: C is the only candidate that states an invariant set (I1–I12) that is testable with no server, no relay and no UI, and the only one whose negative-path table (N1–N11) is derived from its own model rather than copied from v1.

### v2 (the conservative candidate)

- **"No lost update exists in the current code" (§M3) — TRUE BUT VACUOUS, and it is used to argue something false.** True: one process, one `Map`, one event loop (`ZapPurchaseManager.ts:199-202`). But the sentence is deployed to support **C16**: *"the clobber is introduced by v1's client-composed write."* That is **wrong**. The clobber is not a race and not a client problem: `publishRegistry` rebuilds the event from a map that holds **only** `vanity` entries, so it destroys any other tag class **on the server's own write path**, on every receipt. v2's own M3 evidence (`registry.clear()` at `:97`, `buildRegistryTags` emitting only `vanity` at `VanityManager.ts:110-112`) proves the opposite of C16.
- **The consequence v2 misses: v2 keeps claims inside that same event.** Its §3.2 puts `["route", …]` and `["route-default", …]` in `d='vanity-urls'`, and it never specifies changing `VanityManager.buildRegistryTags` or `ZapPurchaseManager.publishRegistry`. On the base as measured, the **first paying customer after a claim is written deletes every claim and the default** — the exact bug the ruling asked all candidates to make impossible. v2 inherits it and its C16 sentence argues it out of existence. This is the most serious defect in the conservative candidate, and it is measured, not judged.
- **"The republish serialises every entry" (§M3) — correct, and it also refutes v2's own mitigations**: the ingest drops expired rows (`:100-104`), so the event is not a durable record even for the entries it holds. v2 says this (M3(c)) — about v1 — without noticing it applies to v2's claim layer because the claim layer lives in the same event.
- **§D16's read-side allowlist — honestly labelled, still an overclaim of control.** v2 says the page "still exists on the relay; our resolver simply will not render it", and that "any other client reading the same relay will [render it]". That is accurate. But the section is titled "Who may own a top-level path", and the answer is *nobody controls it; we only control our own renderer*. Two clients showing different sites at the same URL is a product defect, not a security nuance, and it is the direct consequence of X2.
- Credit: v2 is the only candidate that (a) refuses to carry the 205 baseline onto a branch, (b) lists what it cannot verify as a table rather than a sentence, and (c) corrects v1's own factual error about `ProductRow` (M4, `StorefrontBlockSlots.tsx:90-98` issues `#d`-only with no author filter — verified). Its M3 byte arithmetic is also the only quantified ceiling in the four documents (461 entries at 142 B crosses 64 KB), and it is right to treat the relay's max event size as **[U]**.

---

## 5. The synthesis, and my recommendation

**Recommendation: C's ownership domain, recorded per name as an app-key-signed event in A's shape, written through B's discipline, shipped in v2's order.**

That is a combination, and it is not a compromise — each part is taken because the others are measurably worse at that one thing:

**Take C's domain.** It is the only model in which the owner's three tiers are *entitlements over a resource* rather than classes of writer over an event kind — which is what the code actually is today (`EventValidator.ts:74-93`: editor = blacklist only, everything else admin-only, patron = nothing). Its invariants I1–I12 are testable with no server, no relay and no UI, and its `Assurance` type (L1/L2/L3) is the only construct that satisfies `AGENTS.md:41-46` (never collapse payment states into a boolean). C's increment 1 — a pure domain plus a store wired to nothing — is the smallest thing that can be *proved* before anything is *shipped*.

**Take A's record shape, not A's authority.** Write one self-sufficient, app-key-signed event per name (`d=<path>`), total for that path: holder, term, target, tier, grants, proof id, and a monotone sequence. This satisfies ADR-0006:211-215 — the name is verifiable by any client, not just the operator — and it is what makes the DB rebuildable rather than load-bearing. It also makes the two best properties of the whole commission survive: no clobber **and** a name that still resolves if the server is down. This is C's §4.2 mirror; the only change I am making to C is to insist the mirror is written **inside the same transaction** as the lease row, from day one, and is treated as the write-ahead record rather than a downstream export. A's §3.3 phrasing ("total for its path and nothing else, with `seq`/`prev`") is the spec for that event.

**Take B's write path.** The proxy re-signs a client's tag list (`EventSigner.ts:17-26`), so it cannot be the enforcement point for a system that decides tags server-side. B's answer is the right one: the server builds the row from a parsed *intent*, authenticates the caller with NIP-98, and commits the row, the audit line and the projection-outbox entry in one `BEGIN IMMEDIATE`. Adopt that, and it closes C's missing authentication hole at the same time.

**Take v2's order, and v2's ladder as the first ship.** Step 1 is `d` on pages; step 2 is the pure resolver running claim → page-by-`d` → series → floor. That is cheap, reversible, needs no server, needs no new kind, and it delivers the owner's actual unblocker — a page at a named path, and a home that is a path — before any database exists. It also proves the `#t` series read against a real relay before anyone depends on it.

**What I reject, and why.**

- **B's bet.** It contradicts ADR-0006:211-215, and it trades away the only property of v1 worth keeping. B asked to be judged on exactly this and supplied the honesty to make the judgment easy. Its *authority model* is the part to reject; its *write discipline* is the part to take.
- **v2 as the destination.** Not because it is conservative — because it keeps claims in the event that destroys them, and because it leaves the free-lease hole open while shipping a paid-names feature. Either defect alone is disqualifying for a final answer. It remains the right *first step*.
- **A's authority model.** A is right for a reason it under-sells (ADR-0006 already asks for its event) and wrong about one thing: it calls the store disposable when the store holds pending money. Its §13 objection — "this is v1's trust model with the table normalised into events" — is correct, and normalising into per-name *signed* records is worth the ceremony for the reason ADR-0006 gives, not for the reason A gives.

**One sentence for the owner:** the thing he asked for (a dashboard to manage routes) is the *last* piece, not the first; the first piece is that pages get their own address and a path stops being the home page's private property — and the money check must be fixed in the same season, because today a name can be taken for free.

**What must not ship, ever, regardless of the choice:** a ledger that accepts new paid leases while `handleZapReceipt` still prices them from the requester's own `amount` tag (`ZapPurchaseManager.ts:175-180`). That is independent of A/B/C/v2. All three redesigns fix it; v2 does not.

---

## 6. Decisions for the owner

Plain language. Each is a question you answer; my lean is first. No tables, because this is for reading, not reference.

**1. Do we ship the first visible slice now, or wait until the whole redesign is finished?**
*My lean: ship now.* The slice is "a page can have its own address, and a path can resolve to a page" — no database, no payment changes, reversible by reverting a few files. You would see a weekly featured page at `/featured-13-11-2026` and the home pointing at a page, within days. The cost of waiting is that nothing is visible until the whole thing lands, and the longer the money hole stays open the more it looks like a decision. The cost of shipping now is that paths you create before the ownership rules exist are governed by a simple first-published-wins rule until an admin record is added over them.

**2. If our server's database is lost, must the site's names still work?**
*My lean: yes — every name should be recoverable from a signed record on the relay, with the database as a fast copy.* This costs a little extra work on every name write, from day one, and it cannot be added later without re-writing names that already exist. What it buys you: a server crash, a bad deploy, or a move to a different host does not take your storefront paths with it, and a customer can prove what they were sold without asking you. What it costs you: one more thing to keep consistent, and the honest fact that someone who copies the record can read your route list. If you say no, the design gets simpler and your names live and die with one file on one machine — which is exactly what today's system does *not* do, so it is a real step down in resilience.

**3. Can a paying customer take a free path instantly, or does an admin approve it?**
*My lean: instantly, self-service.* It is what "will be able to reserve a path for themselves" reads like, and it is the only version that scales past a handful of customers. What it costs: you will occasionally have to tell someone their name was taken, and you will need a habit of reassigning names when a payment fails to renew — you keep that power either way. If you choose approval, you get control and a queue, and every reservation becomes your time.

**4. When two people publish to the same path, who wins — the first, the newest, or whoever you point it at?**
*My lean: the first, until an admin record moves it.* "Newest wins" sounds fair until you notice it lets anyone take over `/featured` by publishing again — in a shop with money in it, that is a squatting tool. "First wins" means an abandoned path stays abandoned until you claim it, which is a small annoyance you can fix in ten seconds and a much smaller problem than a takeover. What it costs: a few support requests about dead paths, and one dashboard button that must exist.

**5. Do we accept nutzap payments in this round?**
*My lean: no, not this round.* Nutzaps are the stronger payment technically — the money arrives as a bearer token you can check without a relay — but taking them means your server briefly holds customer funds and has to swap them at a mint, which is a custody and compliance position, and after the swap the receipt is no longer independently provable by a third party. Zaps, once we actually check them, are weaker technically but better evidence. What it costs to defer: customers who only hold ecash cannot buy a path yet. What it costs to do it now: a wallet to run, a mint outage that blocks purchases, and a new kind of money on your balance sheet before the rest of the system is stable.

---

## Appendix — commands behind every number

```bash
# C1 — no durable server storage
grep -rnE 'bun:sqlite|node:fs|writeFile|readFile|Bun\.file|new Database|mkdir' platform/server/ --include=*.ts | grep -v '\.test\.'   # → 0
grep -rn 'event-store' platform/server/ --include=*.ts                                                                              # → 0
grep -rln 'createApplesauceEventStore\|createEventAccess' --include=*.ts . | grep -v node_modules                                     # → sdk/… + platform/web/… only
grep -c 'test(' platform/server/server-bootstrap-persistence.test.ts                                                                  # → 5 (no store in any)

# C2 — presence, not proof
grep -rn 'verifyEvent' platform/server/*.ts platform/server/http/*.ts                                                                # → ogMeta.ts:219, websocket.ts:30 only
grep -rn 'nostrPubkey' --include=*.ts sdk platform | grep -v '\.test\.'                                                              # → only ZapPurchaseManager.ts:40 (declared, never read)
sed -n '72,80p' sdk/config/constants.ts                                                                                              # → 7 ZAP_RELAYS

# C3 — nutzap
wc -l sdk/commerce/payments/wallet/nutzap.ts                                                                                         # → 624
grep -rniE 'nutzap|NIP-?61|9321' --include=*.ts --include=*.tsx sdk platform ui | wc -l                                              # → 274
grep -rniE 'cashu|checkstate' platform/server --include=*.ts | grep -v '\.test\.'                                                    # → util/cashu.ts, auction-validator/*
git ls-files platform/server/auction-validator | wc -l                                                                                # → 24

# C4 — verifier exists, unused
grep -n 'parseProviderZapReceipt\|readBolt11AmountMillisats' sdk/commerce/payments/zapRead.ts                                        # → :86, :96
grep -rn 'zapRead' platform/ sdk --include=*.ts | grep -v '\.test\.'                                                                  # → sdk/commerce/payments/index.ts:6 only

# C5 — 30024
grep -n 'STOREFRONT_PAGE_KIND\|STOREFRONT_PAGE_D_TAG' sdk/commerce/storefront/storefrontPage.ts                                       # → :31, :34
grep -n "const tags" platform/web/storefront/storefrontPublish.ts                                                                     # → :60

# C6 — the clobber
grep -n 'buildRegistryTags' platform/server/VanityManager.ts platform/server/ZapPurchaseManager.ts                                     # → :110-112, :405
sed -n '393,417p' platform/server/ZapPurchaseManager.ts                                                                               # → rebuild from this.registry

# C7 — namespace
sed -n '51,89p' sdk/config/vanity.ts | grep -oE "'[a-z0-9_-]+'" | sort -u | wc -l                                                     # → 37
grep -oE "path: '/[^']*'" platform/web/routeTree.gen.ts | sed "s/path: '//;s/'$//" | awk -F/ 'NF==2 && $2!="" && $2 !~ /\$/ {print $2}' | sort -u   # → 9 strings / 8 real
comm -23 <static> <reserved>                                                                                                          # → auctions

# kinds
grep -rhoE '3[0-9]{4}' --include=*.ts sdk platform | sort -u | wc -l                                                                  # → 35
grep -rn '30025\|30026' --include=*.ts sdk platform                                                                                   # → 0
grep -rln 'KIND = 30078' --include=*.ts sdk platform | grep -v '\.test\.' | wc -l                                                  # → 5 modules (15 files reference it)

# NIP-98
git grep -n '27235\|NIP-98' -- platform/ sdk/ docs/ | wc -l                                                                            # → 0
```

No key material is reproduced above; the app public key at `platform/web/routes/index.tsx:48` is a committed literal and is referred to by location only. Nothing outside this file was created or modified; no branch, build, test or deploy was run.