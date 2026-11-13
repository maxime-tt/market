# Report — REVISION 2 of run A (admin-routes)

**Role:** plan reviser · **Base:** `/home/admin_maxime/work/market`, `master`, HEAD `3a07e7067` · **State:**
read-only. No source change, no branch, no build, no deploy. **Wrote exactly three files**, all under
`runs/2026-11-13-admin-routes/`:

- `ARCHITECTURE.md` (rewritten in place: **+523 / −140** lines)
- `IMPLEMENTATION-PLAN.md` (rewritten in place: **+341 / −149** lines)
- `report-revision-2.md` (this file)

No worktree touched; `runs/2026-11-13-auctions-ui/` was not read or written. `report-consolidation.md` was **not**
edited — the three raises it records are answered in the new ruling, and its §5 items 1–5 are now split between
"closed" (1), "still open" (2, 3, 4) and "reversed" (5). That is recorded here rather than by editing history.

---

## 1. The three changes, and what each one invalidated

### 1.1 No relay round-trip for served data (ruling 1)

**What changed structurally.** `ARCHITECTURE.md` gains a fourth noun, **PAGE STORE** (§3.1), a new §5.5 in four
parts (what is stored; what is rendered at ingest; how a request is answered; the write-restricted ingest), and
`IMPLEMENTATION-PLAN.md` §1 is re-founded on it: increment 1 is no longer "resolve, then fetch the event" — it is
"ingest a signed page to local storage, resolve, serve from the store".

**Passages identified as invalidated** (all now rewritten, all listed in `ARCHITECTURE.md` §R2.1 rows 1–6 and
`IMPLEMENTATION-PLAN.md` §REVISION 2 rows 1–6):

| passage | was | now |
|---|---|---|
| §1 one-sentence architecture | "serves the resulting page" | "… **from its own local page store**" |
| §2 rule 2 | network forbidden only in *routing* | also forbidden **to serve a bound page** |
| §3.1 | "A page **lives on relays**" | three nouns → four; the served copy is local |
| §3.2 | "page not renderable → 200 item unavailable" | a bound *page* cannot be unrenderable; narrowed to non-page targets |
| §3.3 | "a relay outage degrades a page, never a route" | a relay outage degrades **nothing** |
| §4.3 | "No page bodies. Pages stay on relays." | bodies live in the page store |
| §5.3 | series membership = relay `#t` query | local series index, built at ingest |
| §5.3 `[U]` | R3 gated on `#t` measurement | gate retired; measurement only matters for a backfill |
| plan §1.4 | "Two reads exist" + `{"ids":[…]}` `[U]` | one read, local |
| plan §1.4(4) | "stop and report" if the id read fails | the "fallback" **is** the design |
| plan §6 gate | "gated on one measurement… stops and reports" | gate removed; R8 redefined as "needs no network" |
| plan §11 R-1 | "the one network call that remains, and the one I could not measure" | **deleted outright** |

### 1.2 The ACL's actor is closed (ruling 2)

`ARCHITECTURE.md` §7 is now **four levels** — `app` → `admin/owner` → `editor` → no ACL — keyed on the signing
pubkey, with `may()` rewritten and two new bullets: `actor = event.pubkey` after `verifyEvent`, and a replay window
(OUR CHOICE). **`ruling-acl.md`'s three tiers are superseded for authority**, and the important part is that this
is not a relabelling: `premium/paid` was a *tier* in the old table and is now explicitly **not** one — a lease
grants a path, a level grants authority, and a person may hold both, either, or neither
(`ruling-local-pages-acl-and-legacy-routes.md:61-62`).

Invalidated: §7 heading + tier table; §7.1 `may()` (no `app` branch); §9.2's B/NIP-98 row; §9.3's C/actor row;
§9.5's X3 row; **§10 O-1 in full** (marked CLOSED, text kept as history); plan §5's "Blocked on O-1"; plan §11 R-2.

**What made this cheap, measured:** `platform/server/EventValidator.ts:53` already encodes `app ∨ admin`
(`event.pubkey !== appPubkey && !adminManager.isAdmin(...)`), `:75` encodes `admin ∨ editor`, `:86` encodes
admin-only. The four-level model is a widening of a predicate the server already applies **[S]** — not a new
authority system. The sets are `platform/server/AdminManager.ts:5` (`Set<string>`) and `EditorManager.ts`, seeded
from `adminPubkeys: []` (`platform/server/startup.ts:71`) and rebuilt from kind-30000 `d='admins'`/`d='editors'`
(`platform/server/EventHandler.ts:249-259`) **[S]**.

### 1.3 Compiled-in routes are re-pointable (ruling 3) — the reversal

Six places asserted the opposite and are rewritten: §5.1 (compiled-in pages "above the ladder"), §5.2 in full
("a binding on `dashboard` is refused"), §5.4 ("compiled-in route matches first … settled and non-negotiable"),
§8.3 (COMPILED_IN in the refusal set; "the site refuses to boot"), §4.3's bullet list, and §12 Q1/Q2. In the plan:
§4/S4, §5/A5, §3/V2, §9/M2, §12's `/dashboard` row.

**The one thing the reversal forced that no ruling says.** Seven of the eight compiled-in segments are *also* in
the 37-name reserved list (`dashboard`, `products`, `checkout`, `setup`, `community`, `posts`, `nostr` —
`$ sed -n '51,89p' sdk/config/vanity.ts | grep -oE "'[a-z0-9_-]+'" | sort -u | wc -l` → 37 **[M]**). "Reserved
refuses everyone" and "compiled-in paths are re-pointable" cannot both hold. Adopted reading, labelled OUR CHOICE
in §7.1 and §8.3: **`RESERVED \ COMPILED_IN` refuses everyone; `COMPILED_IN` refuses editor and lease, allows
`app` and `admin`, with a warning.**

---

## 2. What I measured on the new ground

### 2.1 Does anything render a page body server-side today? **No — only meta.**

| fact | evidence |
|---|---|
| the server composes route records then a catch-all returning the SPA shell | `platform/server/buildServer.ts:36-54` **[S]** |
| the only server-rendered HTML enrichment is `og:` meta injected into a shell the server fetches **from itself** | `platform/server/http/og.ts:28-31` → `sdk/commerce/products/ogTags.ts:182-207` **[S]** |
| the one server-side lookup pattern: single `ids:` filter, `verifyEvent`, 2.5 s budget, `null` on failure | `platform/server/ogMeta.ts:198-215` (filter at `:203-208`) **[S]** |
| the server describes itself as "a SPA + config + nip05 host" | `platform/server/startup.ts:56-57` **[S]** |
| `react-dom/server` exists in the tree **only** in tests | `grep -rl renderToStaticMarkup --include=*.ts --include=*.tsx . --exclude-dir=node_modules \| wc -l` → **102**; the same list `\| grep -v '\.test\.'` → **0** **[M]** |
| the renderer's own directory is server-safe | `grep -nE 'localStorage\|ndk\|window\.' ui/storefront/*.tsx` → 1 hit, a comment **[M]** |
| the page document is a closed union with hard bounds | `sdk/commerce/storefront/storefrontPage.ts:125-292`, union at `:293`, `STOREFRONT_LIMITS` at `:47-55` (100 blocks / 20 000 chars / 2 048-char URL) **[S]** |
| block types: 12; 7 static, 5 data-bound (`ProductGrid`, `FeaturedProduct`, `ProductRow`, `Search`, `Categories`) | same file, `:125-292` **[S]** |
| `react-dom` 19 is already a dependency | `package.json:92` **[M]** |

**Judgement (`[J]`), and it is the load-bearing one in this revision:** the ruling's lean (b) — "render at publish,
store the result … with no SSR framework migration" — is **half right**. There is no framework migration, true.
But there is also no body renderer, so (b) *builds* one. The difference between (a) render-per-request and (b)
render-at-ingest is **when** the renderer runs, not **whether it exists**. What (b) buys is that a request does no
rendering, which is what "instant" means. The plan therefore builds the renderer and splits the block union:
7 types to HTML at ingest, 5 as named empty slots hydrated client-side (a frozen price is worse than a hydration).

### 2.2 The relay: what runs it, and is it open?

| fact | evidence |
|---|---|
| the relay is a repo-owned **khatru** application | `deploy-simple/relay/cmd/market-relay/main.go` (321 lines), `khatru.NewRelay()` at `:63` **[S]** |
| **write policy is public** — kind/shape validation only, no author allowlist | `main.go:84-87`: `policies.SeqEvent(policies.ValidateKind, policies.RejectEventsWithBase64Media, policies.RejectUnprefixedNostrReferences)` **[S]** |
| production supports NIP-1/11/50 (i.e. NIP-50 search), max query limit 500 | `deploy-simple/relay/config/production.env:11-12` **[S]** |
| storage is BoltDB raw + Bleve search | `main.go:150-182` (`eventstoreboltdb`, `eventstorebleve`) **[S]** |
| a documented memory-pressure failure mode exists | `deploy-simple/RELAY_DEPLOY.md:212-216`: *"refusing connection: emergency mode active … under memory pressure"*, with `free -h` as the check and a restart as the fix **[S]** |

**On the out-of-memory claim specifically: it is `[U]` as a causal claim, and I will not dress it up.** What is
measurable in this repo is (i) the write path has no author filter, so the owner's "public-writable" description is
accurate, and (ii) the ops doc documents an *emergency-mode / memory-pressure* symptom. Neither is a measurement of
OOM **under write load**, and the doc still refers to a service named `orly`, which suggests it predates the khatru
app. So: the architecture argument stands on its own (an allowlisted store cannot be flooded by strangers), and the
OOM claim is corroboration, not proof. Recorded that way in `ARCHITECTURE.md` §R2.3 and O-6.

### 2.3 Legacy re-pointing: what `$vanityName` intercepts, and what a re-point must beat

| fact | evidence |
|---|---|
| one top-level catch-all dynamic route owns every single-segment path | `platform/web/routeTree.gen.ts:74-78` (`/$vanityName`) **[M]** |
| it resolves vanity → pubkey, else renders the **app key's page at `d = segment`** | `platform/web/routes/$vanityName.tsx:19-41` (fall-through at `:34-41`) **[S]** |
| `/dashboard` is a real compiled-in route under a pathless layout | `routeTree.gen.ts:725`, parent `:70-72` **[M]** |
| the dashboard tree is 31 files | `find platform/web/routes/_dashboard-layout -type f \| wc -l` → 31 **[M]** |
| its layout owns chrome/nav | `_dashboard-layout.tsx:31` `createFileRoute('/_dashboard-layout')`, `:5` `DASHBOARD_NAV`, `:232` `<SidebarNav` **[S]** |
| the admin gate covers only `/dashboard/app-settings` | `platform/web/app/useRootRedirects.ts:28`, `:40-42` **[S]** |
| the root route is the single router-wide mount point | `platform/web/routes/__root.tsx:25-31` (`createRootRoute` → `RootLayout` → `Outlet`) **[S]** |
| top-level static segments are still 8 (9 processes: `/new` is nested) | `grep -oE "path: '/[^']*'" platform/web/routeTree.gen.ts \| sed … \| awk -F/ 'NF==2 …' \| sort -u` → 9 lines; `/new` parent-checked → 8 **[M]** |
| `/search/products` is depth 2, so it does not enter the top-level set | `routeTree.gen.ts:111`, `:683` **[M]** |

**Consequence, and it is the new design content for ruling 3:** serving a page at `/dashboard` is an HTTP-layer
act, so the 31 files and the layout do not move. But TanStack still contains `path: '/dashboard'`, and on hydration
it would mount the dashboard over the served page. The plan's answer is **one guard** — the served HTML carries
`#__AR_PAGE__`, and `__root.tsx` renders that payload instead of `<Outlet/>` when present (§5.2, plan §4). That is
what makes "re-point without modularising" true rather than aspirational, and it is one file.

### 2.4 The page store candidates: what a page definition actually is

| fact | evidence |
|---|---|
| a page is kind 30024, `d` = identity, `content` = JSON document | `sdk/commerce/storefront/storefrontPage.ts:31-40` **[S]** |
| parse is total and drops unknown/failed blocks (forward compatibility) | same file, header comment `:1-27` **[S]** |
| publish builds `[['d', STOREFRONT_PAGE_D_TAG]]` — the single-`d` constant is the only thing making one page per author | `platform/web/storefront/storefrontPublish.ts:60` **[S]** |
| publish is **relay-only** and fails closed on zero ACKs | `storefrontPublish.ts:81-99` **[S]** |
| the read is `(author, kind 30024, '#d')` + re-check + newest-wins | `platform/web/storefront/storefrontQuery.ts:75-100`, `selectReplaceable` at `:44` **[S]** |
| the renderer takes a slot map from the caller | `platform/web/storefront/StorefrontAddressPage.tsx:55` `StorefrontRenderer page=… pubkey=… slots=storefrontBlockSlots` **[S]** |

So the store does not invent a document: it stores the one that already exists, plus its render.

---

## 3. What I could not reconcile

1. **The ruling's SSR lean understates its own cost** (§2.1). Not a contradiction, but the lean reads as "cheap and
   settled" and the measurement says "cheap-ish and requires a new server module". Flagged in §5.5.2 as a
   correction, and put to the owner as Q7.
2. **`reserved` vs `compiled-in` cannot both refuse** (§1.3). Resolved with a split, labelled OUR CHOICE. It is the
   single most likely place for the owner to disagree, because it decides whether an *editor* can take `/dashboard`.
3. **`ruling-acl.md`'s premium/paid tier** is not the same axis as the new four levels. Read as "lease entitlement,
   not authority" — that is an inference from the new ruling's own sentence, not a ruling, and it deletes a row
   from a table the owner previously approved.
4. **Transport for page ingest.** Ruling 2 leaves it open; ruling 1 says the store must be write-restricted. The
   existing publish path is relay-only (`storefrontPublish.ts:81-99`), so "no relay on the read path" is compatible
   with "relay on the write path", and I had to choose. Chose a direct signed POST (§5.5.4 option i) because it
   needs no relay and makes the allowlist one function; recorded that the CMS must then post twice.
5. **The client seam for a re-pointed compiled-in path** (§2.3). The ruling says the binding wins; it does not say
   how the SPA yields. One guard in `__root.tsx` is my design, and it is `[J]`.
6. **`report-consolidation.md` §5 item 4 (ADR-0006 vs the narrowed doctrine)** is untouched by the new ruling and
   stays as it was — a reading, not a resolution.
7. **The OOM claim** (§2.2) — I could not verify it as stated. Recorded as `[U]` rather than repeated as fact.

---

## 4. My leans on the seven questions the new ruling opens

Each: the lean, and whether the ruling already answers it.

| # | question | ruling already answers it? | my lean |
|---|---|---|---|
| 1 | What is the page store, and does the app render server-side? | **No** — it leans (b) and says it needs a ruling because it decides whether the app gains an SSR tier | **(b) render at ingest, store document + fragment + meta**, with the block split (7 static / 5 slot). But state the cost honestly: (b) still adds a server renderer, so the "no SSR tier" framing is wrong — the app gains a *render step*, not a framework. Lean is in the docs, flagged as needing the ruling |
| 2 | Does the app run a relay, and is it the auctions relay? | **No** — offers two shapes | **Separate roles.** Measured: one relay today (`main.go:84-87`), no author filter, NIP-50 search, documented memory-pressure mode. Mixing a public write surface with the page store is the coupling ruling 1 exists to break. Cost: one more process to run and back up |
| 3 | Is the private store a relay at all? | **Partly** — format is free, so the relay is a *consequence* of choosing event-shaped storage | **No. Store natively (files), and do not use the relay even as the write transport** — the signed-event POST is cheaper than a relay policy change plus a subscription. Stronger than the ruling's own lean, which only demotes the relay to a transport |
| 4 | How modular is "modular"? | **Leans** shell + named slots; calls it next step | **Shell with named slots, sub-app owns them internally** — and **build none of it now**. The store already produces one kind of slot (data-bound blocks), so the vocabulary is free; anything more would violate the ruling's own sequencing |
| 5 | Do sub-app sub-paths live in the routing tree while leases stay top-level? | **Effectively yes** — `ruling-simple-routing-file.md:37-54` restricts only *leases* | **Yes, no conflict.** Programmed routes may be arbitrarily deep; only leases are top-level. This is the sentence that keeps the sub-app direction legal, so it is worth keeping in the docs even though it needs no build |
| 6 | Does re-pointing a legacy path require the old page to keep working? | **Leans** one binding, binding wins, no parallel serve | **Same, and treat it as more than a lean**: two live answers for one URL is the defect class this whole run exists to delete. Implemented as "binding wins; compiled route is the fallback when unbound" (S4/S4b). The *mechanism* (one `__root.tsx` guard) is mine, not the ruling's |
| 7 | The relay's memory (the symptom he named) | **No** — and it says so: "worth a separate look, not part of this increment" | **Agree it is operational, and split it**: the architecture fix is the allowlist (done); the operational fix is relay memory/restart policy, which belongs to whoever owns `deploy-simple/relay`. Do not let it into the route increments. Also: `[U]` on the causal claim (§2.2) |

---

## 5. Verification status of this revision

| check | status |
|---|---|
| every passage the three rulings invalidate | enumerated: 23 rows in `ARCHITECTURE.md` §R2.1, 19 rows in `IMPLEMENTATION-PLAN.md` §REVISION 2; every one has a rewrite in the body, not only a table row |
| every code claim carries `file:line`, every number its command | yes in both files; new claims measured this session, listed in §2 |
| measured / read-from-source / judged separated | `[M]` `[S]` `[J]` `[U]` on every new claim |
| 64-hex key-shaped literals | none: `grep -nE '[0-9a-f]{64}' ARCHITECTURE.md IMPLEMENTATION-PLAN.md` → 0 hits |
| increments still in dependency order | yes — 1→2→4→8 sequential; `(2∥3)`, `(2∥5)`, `(4∥5)`, `(6∥anything)` parallel; unsafe `(1∥·)`, `(2∥4)`, `(4∥7)`; one new intra-increment split named |
| not-doing lists kept | yes, all eight increments; increment 1's list gained "no relay ingest" and lost "no write path exists yet" (it exists now) |
| typecheck / tests run | **none** — read-only base, no branch, no build |
| relays reached | **none** — and after this revision nothing in the plan depends on it |
| presented our choice as a ruling | no; every inference is labelled OUR CHOICE / OUR INFERENCE (`reserved` split, replay window, block split, storage format, transport option) |