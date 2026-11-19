# Report — consolidation of run A (admin-routes)

**Role:** consolidator · **Base:** `/home/admin_maxime/work/market`, `master`, HEAD `3a07e7067` · **Wrote:** three
files, all under `runs/2026-11-13-admin-routes/`, nothing in the source tree, no branch, no build, no deploy:

- `ARCHITECTURE.md`
- `IMPLEMENTATION-PLAN.md`
- `report-consolidation.md` (this file)

No worktree was touched; `runs/2026-11-13-auctions-ui/` was not read or written.

---

## 1. What I did

1. Read all six rulings in the order given, then `order.md`, `order-increment-1.md`, `order-increment-2.md`,
   `proposal-v2.md`, the four design documents, `review-adversarial.json` (all 12 findings), and the
   `d7s2/route-table` branch itself via `git show` (it is not checked out in this tree).
2. Measured the ground: `platform/server/` (28 entries, 7 `*Manager.ts`, 18 test files), `platform/web/routes/`
   (21 entries), `routeTree.gen.ts` (93 `path:` literals; 9 → 8 top-level static segments), both reserved lists
   (37 each, sets equal), the vanity read/write path, the free-lease hole, and the bash derivation of the
   compiled-in segment set.
3. Wrote the two deliverables against the rulings, marking every superseded design passage with its
   `file:line` and the ruling that supersedes it.
4. Mechanically verified **82** `file:line` claims in the two documents against the tree (script comparing the
   cited line to an expected token). **23 mismatched on the first pass; 4 were genuine off-by-one/off-by-several
   citations and are fixed** (`entry.tsx:26→:27`; `storefrontQuery.ts:85` was a filter line, `selectReplaceable`
   is at `:44`/`:97`; `_dashboard-layout.tsx:20-24` → `:31`, `:5`, `:232`; the dynamic-segment parse claim was
   wrong and is rewritten). The rest were boundary-line citations (`:112` for a block ending at `:112`) and are
   left as-is deliberately.

**A correction I owe the run about my own measurement.** My first typecheck attempt timed out at 180 s and
appeared to hang with 0 errors because stdout was **block-buffered to a file**. Re-run unbuffered, on this **dirty**
checkout, it completed with **exit 2 and 401 errors**, of which **241 are in files that are not the app**: 94
`runs/`, 72 `notes/pr-1226-orderdetail-descriptor-view.tsx`, 72 `node_modules/*.d.ts`, 30 `src/`, plus
`deploy-simple/` and `e2e/`. typescript resolves to **5.9.3**, matching `order.md:132-134`. **So neither 401 nor the
carried 205 is a baseline on this tree, and both documents say so and require a per-branch re-baseline asserting on
the sorted error list.**

---

## 2. What survives from increment 1 (`d7s2/route-table` @ `1cc31cb37`)

Read at the branch: `sdk/config/routeTable.ts` = **408 lines**; `sdk/config/routeTable.test.ts` = **326 lines,
35 `test(` calls, 72 `expect(` calls** (`git show d7s2/route-table:… | grep -cE '^\s*test\('` → 35).

**SURVIVES — cherry-pick the helpers, carry the tests, do not merge the branch:**

| survives | why |
|---|---|
| the name grammar `^[a-z0-9][a-z0-9_-]{1,28}[a-z0-9]$` and `isValidRouteName` | identical to both live copies (`sdk/config/vanity.ts:173`, `platform/server/VanityManager.ts:184`) — it is the app's grammar, not the branch's |
| the 37 reserved names as data + the copy-drift test | a list that exists three times needs a drift test |
| the "drop, record, never throw" parse posture (`DroppedRoute` / `RouteConflict`) | matches `AGENTS.md:100-115`: a direct navigation states which constraint failed |
| `term: 0` ≠ permanent for the legacy family, pinned **by name** | the same distinction the architecture makes with two binding kinds |
| the hex/`dTag` target codecs and their edge cases (63-char author, empty `d`, colons in `d`) | pure, tested, reusable |
| the no-mutation and byte-stable-serialisation tests | exactly the discipline the file writer needs |

**REDONE — do not carry:**

| redone | why |
|---|---|
| **the storage**: `d='vanity-urls'`, `parseRouteTable(tags)` / `serializeRouteTable(tags)` over **event tags** | the table is a **file** now (`ruling-simple-routing-file.md:5-18`): JSON ↔ typed union, no event |
| `source: 'route' \| 'vanity'` and the legacy `vanity` mirror (`routeTable.ts:92`, `:396-406`) | nothing to mirror — the table is not an event |
| `legacy-shadowed` | a consequence of two families in one event; the file validator refuses a second binding on a path |
| `non-page-default` / `resolveDefaultRoute` refusing a non-page default (`:401-410`) | **superseded by R4/D18**: `/` is just a path |
| the `RouteTableError`-throws-from-the-serialiser contract | the file refuses at **load** (boot) and at **write** (`Denied`) |
| `ROUTE_AUTHORITIES = ['admin','editor','reservation']` | the ruling's tier is **premium/paid** and the binding kind is **lease** |
| exit criterion 3 ("`sdk/config/ + sdk/core/curation/` identical before and after") | **unsatisfiable as written** — the new file lives in the directory being compared (`review-adversarial.json` F9) |
| the `series` wire format from `order-increment-2.md:60-100` (`t:<tag>`) | that tag family no longer exists |

---

## 3. The increment list, in dependency order, with the parallelisable set

| # | increment | depends on | parallel-safe with |
|---|---|---|---|
| **1** | routing file + three-rung ladder, end to end: `/x` served from `data/routes.json`, `/item/:eventId` served without an indexer, 404 otherwise, boot refuses a corrupt file, boots with a dead `APP_RELAY_URL` | — | **nothing** |
| 2 | file's full shape: lease `meaning`, subpath rule, ancestor check, `grants`, generated `COMPILED_IN` set | 1 | **3**, **5**, **6** |
| 3 | `/` and `/<name>` served from the table (R1/R2/R4 visible); client stops resolving | 1 | **2**, **5**, **6** |
| 4 | ACL: `may()`, grants, the actor, one write path (`apply`) | 1, 2 | **5**, **6** |
| 5 | R3 series (relay-gated on one live `#t` measurement) | 1, 3 | **2**, **3**, **4**, **6** |
| 6 | zap receipt verification (closes the free-lease hole) | — | **everything** |
| 7 | lease purchase, paid top-level path | 2, 4, **6** | — |
| 8 | management surface + legacy registry retirement | 4, 7, 5 | — |

**Tracks:** I = 1→2→4→8 (sequential: they all edit `platform/server/routes/routeFile.ts`, and `apply()` is the
single writer — parallelising inside it is the lost-update bug this run exists to delete). II = 3→5→8 (can start
the moment 1 lands, touches different files). III = 6→7 (6 is fully independent and the longest lead, so it should
start first).

**Genuinely parallel pairs:** `(2∥3)`, `(2∥5)`, `(4∥5)`, `(6∥anything)`.
**Unsafe pairs:** `(1∥anything)`, `(2∥4)` (both write the file), `(4∥7)`.
**One merge hazard named:** 3 and 4 both stop the client reading the vanity registry; the plan assigns the single
replacement read to **3** and forbids 4 from touching client files.

---

## 4. The single riskiest thing in the plan

**Increment 1's page fetch — the one network read the architecture cannot forbid, and the one I could not
measure.** Routing must not touch the network; serving a page must, because pages live on relays. So increment 1
resolves `/item/<eventId>` from the URL with no indexer and *then* fetches the event **by id**. Whether an
`{"ids":[…]}` read returns anything on this deployment's relay is **`[U]`** — I reached no relay. If it does not,
the honest alternatives are (a) bind only by `(author, d)`, which costs the prefix rung, or (b) a server-side
kind-30024 subscription, which is a real architectural addition and must be argued, not slipped in. The plan stops
and reports rather than choosing (b) silently.

Why this is the riskiest rather than the biggest: it is the one place where the proof and the architecture's own
boundary touch. The visible failure of a relay outage on a *bound* path is a page that cannot render — which looks
exactly like a routing failure unless the distinction is pinned. Hence exit criteria E2 and S5: **an unrenderable
page is 200 + "item unavailable"; only an unmatched path is 404.** If those collapse, the architecture's central
distinction is gone and no green test will show it.

Next two: **R-2** the ACL's `actor` is unspecified (`ARCHITECTURE.md` §10 O-1) — increment 4 must not start on a
guess; **R-3** the compiled-in segment derivation is a build artefact and a stale one silently un-protects a name
(naive parse yields 9, the truth is 8, because `/new` is nested).

---

## 5. What in the candidate designs I could NOT reconcile with a ruling

Everything else has a clean supersession in `ARCHITECTURE.md` §9. These five do not.

1. **The ACL's actor.** No ruling says how an incoming write proves which tier the caller holds —
   `ruling-resolution-and-signed-ledger.md:48-54` makes the server the enforcement point and
   `ruling-acl.md:5-24` defines the tiers, but the actor is unnamed. C's `can(actor, …)` has no actor
   (0 hits for NIP-98/session/cookie/auth — `review-adversarial.json`); B's NIP-98 closes it but is new machinery
   with zero precedent (`git grep '27235\|NIP-98' -- platform/ sdk/ docs/ | wc -l` → 0 **[M]**). Recorded as open
   with a lean (reuse the existing signed-intent submit channel, `platform/server/websocket.ts:30` →
   `platform/server/EventHandler.ts:238`), not as a decision.
2. **Admin binding under a leased path.** `ruling-simple-routing-file.md:61-64` names it and declines to rule. I
   did not rule it either. The build is shaped so the conflict cannot arise (a lease carries subpaths by right,
   and no leaseholder can write a subpath in this plan), which defers it honestly rather than inventing a
   precedence order.
3. **A grace window.** `designs/B-server-authoritative.md:203-212` proposes 14 days. `ruling-resolution-and-signed-ledger.md:39-40`
   says expiry → 404. A grace window is the "revert to a default" story the ruling rejected, one step removed, so
   this plan has none — marked **OUR CHOICE**, not a ruling.
4. **ADR-0006:211-215 vs the ruling.** The ADR requires a name record "verifiable by any client — not just the
   server", which is what convicted B in `designs/COMPARISON.md:104-123`. The owner then ruled publishing
   "relatively unimportant" and made the app the authority. I reconciled it by scoping the ADR's requirement to
   the **deferred ledger** (§11), not the read path — but that is my reading of a narrowed doctrine, not a ruling,
   and the owner may disagree.
5. **The owner's `/dashboard` example.** `ruling-app-authority-and-portable-leases.md:59-60` says an admin should
   be able to make `/dashboard` render a new dashboard page. Under this architecture `/dashboard` is one of the 8
   compiled-in segments (`platform/web/routeTree.gen.ts:725`) and the tree behind it is 31 files with its own
   layout, sidebar and admin gate — no routing file can carry it. What is buildable exactly as asked is `/`: it
   becomes the default binding. `/dashboard` itself is **refused** by the validator with an explanation. If the
   owner means the compiled-in dashboard must itself be reassignable, that is a larger change no increment here
   depends on, and the plan says so rather than pretending the example is met.

---

## 6. Verification status of the two deliverables

| check | status |
|---|---|
| every ruling cited by `file:line` | done; all six read in full |
| every superseded design passage named with its `file:line` | done, §9 of `ARCHITECTURE.md` (A, B, C, v2, COMPARISON) |
| `file:line` claims in the documents | 82 checked mechanically; 4 corrected; boundaries left as-is |
| every number carries its command | done in both documents |
| measured / read-from-source / judged separated | `[M]` `[S]` `[J]` `[U]` on every claim |
| 64-hex key-shaped literals | none in either file (`grep -nE '[0-9a-f]{64}'` → 0 hits); the app pubkey is referred to by location only |
| typecheck | **`[U]` as a baseline** — 401 on a dirty tree with 241 non-app errors; must be re-derived per branch |
| tests run | **none** — read-only base, and I did not want a test run writing into a shared `node_modules` |
| relays reached | **none** — hence the two relay-dependent items (`#t` on 30024, `ids`-only read) are gated in the plan, not assumed |
| anything deployed | no |