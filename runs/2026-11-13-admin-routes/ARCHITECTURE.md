# ARCHITECTURE — admin-managed routes, consolidated from the accepted rulings

**Run:** `runs/2026-11-13-admin-routes` (run A) · **Role:** consolidator, one implementation plan out of four
candidate designs plus six owner rulings · **Base:** `/home/admin_maxime/work/market`, `master`, HEAD
`3a07e7067` · **State:** read-only. No source change, no branch, no build, no deploy. This file and
`IMPLEMENTATION-PLAN.md` (plus `report-consolidation.md`, `report-revision-2.md`, `report-revision-3.md` and
`report-revision-4.md`) are the only things written.

**REVISION 2 (2026-11-13, same day).** Three new owner rulings arrived after this document was first written —
`ruling-local-pages-acl-and-legacy-routes.md` — and they invalidate specific passages below. §REVISION 2 at the
top lists every one of them with the ruling that killed it, then the affected sections are rewritten in place.
Where this file and that ruling disagree, **the ruling wins**; nothing below is presented as a ruling.

**REVISION 3 (2026-11-13, later the same day).** `ruling-pages-widgets-and-app-relay.md` corrects one layer of
REVISION 2 — the **widget layer** (§5.7) and the **relay split** (§5.6) — and confirms three items that had been
leans (§R3.3). It is the newest authority in this file: §REVISION 3 lists every passage it invalidated, and where it
and REVISION 2 disagree, this revision wins. The shell/page-store model of REVISION 2 is explicitly **not**
re-opened.

**REVISION 4 (2026-11-13, fourth pass) — a SCOPE CUT, not a correction of facts.**
`ruling-react-components-and-deferred-widgets.md` **demotes the web-component/widget-bundle layer of REVISION 3 to
DEFERRED**: page composition is **React components — the CMS's existing block definitions**, the loader is *"a
Plebeian Market instance or similar"*, and no script binding or widget compiling is built. The **serving model is
untouched** (§R4.2), the routing work is stated as the deliverable, and the ingest-time renderer is **named and
priced** rather than assumed (§R4.3). Where this revision and REVISION 3 disagree, **this one wins**; the widget
text is kept, marked deferred, with its consequence (§R4.5).

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
so the relay facts collected for the first revision (`#t` on kind 30024, an `ids`-only read) are `[U]`. **Since
REVISION 2 that does not matter**: served pages come from local storage, so no relay fact is on the site's
critical path (ruling 1, §5.3, §5.5).

---

## REVISION 4 — what changed and why (a SCOPE CUT)

**Authority:** `ruling-react-components-and-deferred-widgets.md` (owner, 2026-11-13), binding. It does **not** correct
a fact; it removes a layer from the build. The owner's words, which are the ruling (`:5-9`):

> *"…what we usually fall back on is the fact that we can stick to React components, assume the loaders will either be
> Plebeian Market instances or similar, and thus stick to our current widget definitions that we use in the CMS, to
> avoid script binding and widget compiling. I think it would be better to stick that to simplify scope and focus on
> the routing functionality first"*

And the scope consequence is stated by the ruling itself (`:60-65`): *"A third party cannot ship a page into the
instance without the instance building their block. The page-composition vocabulary is ours."*

### R4.1 Every passage this scope cut changed, with what it changed to

| # | passage as written in REVISION 3 | changed by | now reads as |
|---|---|---|---|
| 1 | §3.1 nouns: `PAGE` "REFERENCES widgets by registry id", plus a second block adding the nouns `WIDGET` and `WIDGET REGISTRY` | ruling "reuse the EXISTING CMS widget definitions" | `PAGE` references **the existing CMS block types** (`ProductGrid`, `ProductRow`, `ProductStrips`, `Search`, `Categories`, `Hero`, `Text`, `Image`, `LinkList`, `Divider`, `Spacer`, `BrowseStats`, `BrowseFeed`, `AuctionList`, …) — real React components already in the tree and already in the CMS editor. `WIDGET` / `WIDGET REGISTRY` become a **DEFERRED** block in the same place, not a noun of the model (§3.1) |
| 2 | §3.1 paragraph "A widget registry is not the 'manifest' this paragraph refuses" | same | replaced by a paragraph that keeps the refusal of a second routing record and says the block vocabulary is **the instance's build**, not a registry the page talks to (§3.1) |
| 3 | §5.5 stored page, field "`its widget ids` — the registry ids the document references, so `pageHtml` can emit exactly those script imports without re-scanning" | nothing is emitted per block | **removed**. The stored page is document + fragment + meta + identity + series memberships. There is no id list because there is no per-block asset to emit (§5.5) |
| 4 | §5.5.2 block table, row 2: the five data-bound blocks at ingest are "**an empty widget mount point**", at request "a **widget** upgrades it and fetches its own live data in the browser" | same | at ingest: a **placeholder region** carrying the block's `type`; at request: **served as-is, then filled in the browser by the existing React slot map** after hydration. No element upgrade, no bundle (§5.5.2) |
| 5 | §5.5.2 split rule: "*anything that is a function of live network state is a widget and is never rendered on the server*" | same | "*…is a **data-bound block** and is never rendered on the server*" — same rule, our vocabulary again (§5.5.2) |
| 6 | §5.5.2 correcting box, last sentence: "(b) builds a smaller renderer … `pageRender.ts` renders static blocks and emits mount points" | same | still true and now sharper: the renderer renders **static blocks** and emits a **placeholder** for the five data-bound ones. Its mechanism is named and priced in §R4.3 |
| 7 | §5.5.3 dispatch, step 5a: `→ widget ids resolve (§5.7.2) → pageRender → writeAtomic` | same | `→ pageRender → writeAtomic`. **The second ingest refusal ("a page that names an unknown widget id is refused") is removed**, leaving the one that was always the real one: a page that cannot render is never stored (§5.5.3) |
| 8 | §5.7 in full — heading "The widget layer — pages reference widgets, never source", §5.7.1 four constraints, §5.7.2 the registry and its collision, §5.7.3 "how it actually renders", §5.7.4 the measured cost table, §5.7.5 | the scope cut | **kept verbatim in substance and marked DEFERRED** (§5.7). It is the record of *what the layer would be* and *why it is not being built now*, with the consequence stated. Nothing in it is implemented by any increment (§R4.5) |
| 9 | §10 O-7 table, row "**widget** (§5.7, this run's model)" | same | row relabelled "**widget** (§5.7, **deferred**)" — the slot/widget distinction survives, the widget column is future (§10 O-7) |
| 10 | §10 O-8 "Who admits a widget to the registry?" — an open process question of this build | same | **deferred with the layer**, not an open question of this build and not needed by any increment (§10 O-8) |
| 11 | §13 diagram: "Dynamic regions: an EMPTY MOUNT POINT, filled in the browser by a WIDGET (custom element, script-imported bundle)"; page store "+ the widget ids the document references"; write line "`widget ids in registry?`" | same | "data-bound blocks: a PLACEHOLDER, filled in the browser by the existing React slot map **after** hydration"; no id list; dispatch is `parse → render → store` (§13) |
| 12 | §13 invariant sentence 5: "…or gives a page a way to name a widget by URL, it is wrong" | same | "**If it server-renders a page's dynamic content, or lets a page introduce code, it is wrong.**" — the invariant without the deferred vocabulary (§13) |
| 13 | §REVISION 3's table and §REVISION 2's tables, presenting the widget model as current | same | a **READ THIS FIRST** note added at the head of §REVISION 3 saying which of its rows are deferred and which stand; the tables stay as history (§REVISION 3) |

**Not changed by this cut:** the relay split (§5.6), the single ingest endpoint, the ACL, leases, the routing file, the
page store, and every served-page property (§R4.2).

### R4.2 The serving model is **not** touched — stated explicitly, because a scope cut invites over-reading

These three properties are preserved exactly, because they carry the owner's SEO and dynamic-content requirements
(`ruling-react-components-and-deferred-widgets.md:47-58`):

1. **A bound page is served from local storage, with no relay round-trip.** The routing decision never touches the
   network (§2 rules 1–2, §5.3, §5.4, §5.5).
2. **Render once at ingest, store the fragment, hydrate the SAME DOM client-side** rather than re-rendering — so the
   page a crawler sees and the page a person sees cannot diverge (§5.5.2). The cut does not weaken this; it *reduces*
   what has to be hydrated (no element upgrade layer).
3. **Data-bound blocks fetch their own live data in the browser after hydration.** This is coherent **because the
   existing data-bound CMS blocks already behave that way**: `platform/web/storefront/StorefrontBlockSlots.tsx:48-56`
   runs `useQuery(productsByPubkeyQueryOptions(pubkey))` and passes `isLoading` into the props-only block
   (`ui/storefront/blocks/ProductGridBlock.tsx:67,90`), so the block is a React component that renders without data and
   fills itself when data arrives **[S]**. Removing the widget layer restores that mechanism rather than replacing it.

### R4.3 The mechanism that renders the stored fragment at ingest — **named and priced**

REVISION 2 cited `renderToStaticMarkup` in 102 files as evidence that server rendering was established; REVISION 3
measured that **all 102 are tests**, so it establishes a *convention*, not a production path. This revision closes the
gap by naming the mechanism and its actual cost. **Measured at `fee719957`** (commands in `report-revision-4.md` §2):

| question | answer | evidence |
|---|---|---|
| is `react-dom/server` present? | **yes**, a declared dependency and installed | `package.json:92` `"react-dom": "^19.2.6"`; `node_modules/react-dom` 19.2.6 and `node_modules/react` 19.2.6 **[M]** |
| is it used in **non-test** code? | **no — 0 files** | `grep -rl renderToStaticMarkup --include=*.ts --include=*.tsx . --exclude-dir=node_modules \| wc -l` → **102**; the same list filtered `\| grep -vE '\.(test\|spec)\.(ts\|tsx)$'` → **0**; by top-level dir **94 `ui/`, 8 `platform/`** **[M]**. Ten files under `platform/` import `react-dom/server` and all ten are `*.test.*` **[M]** |
| any precedent for rendering to a string in `platform/server/`? | **none.** `grep -rn "react" platform/server/ --include=*.ts` → **0 hits**; `grep -rn "from '@ui/" platform/server/ --include=*.ts` → **0** **[M]** | the only HTML the server emits today is built by **string concatenation**: `sdk/commerce/products/ogTags.ts:301-306` (with `escapeHtmlAttribute` at `:233`) injected into a shell it fetches from itself (`platform/server/http/og.ts:27-31`, `platform/server/ogMeta.ts:198-215`) **[S]** |
| does it work where it has to work? | **yes, measured**: the real `ui/storefront` block components render to a string in a **Bun process with no `window` and no `document`** | probe output in `report-revision-4.md` §2.3: `renderToStaticMarkup` over `StorefrontBlockView` → 1054 chars of HTML, `typeof window === 'undefined'`, `typeof document === 'undefined'` **[M]** |

**So the mechanism is:** a new `pageRender.ts` imports `renderToStaticMarkup` from `react-dom/server` and
`StorefrontRenderer` / `StorefrontBlockView` from `ui/storefront/`, runs **once at ingest inside the Bun server
process**, and returns `{ html, meta }`. The data-bound five are rendered with **no slot map**, which is not a
special case: `ui/storefront/StorefrontRenderer.tsx:103-166` already falls back to each block's props-only "no data
yet" state when a slot is absent (`:105-136`), and it is rendered as the placeholder's content.

**What it costs, item by item:**

1. **One module, not a subsystem.** `pageRender.ts` maps document → elements → string. No framework, no streaming
   API, no per-request rendering. The TSX it imports is transpiled by Bun at import, and the server entrypoint is
   already run as `bun platform/web/app/entry.tsx` (`IMPLEMENTATION-PLAN.md` §0.1/E3), so **no build step and no
   `package.json` change** are added. **[M]** for the dependency; **[J]** for the module size.
2. **One boundary-guard amendment — the cost REVISION 3 missed.** `platform/boundary.test.ts:83-88` asserts that no
   module under `platform/server/` imports `react`, `react-dom*`, or `@ui/*`:

   ```ts
   test('server code does not import the web host or React', async () => {
       const violations = (await collectImports(join(PLATFORM_ROOT, 'server')))
           .filter(({ specifier }) => /^(?:@platform\/web|react(?:-dom)?(?:\/|$)|@ui\/)/.test(specifier))
   ```

   Those are precisely the three specifiers `pageRender.ts` needs. Two honest options, and the plan picks one as
   **OUR CHOICE**: keep the module at `platform/server/routes/pageRender.ts` and add **one named allowlist entry**
   with the reason, because the guard's subject is "server code does not pull the browser host in" and this module
   renders React **to a string, with no DOM** — the same thing 102 test files already do; *or* move the module outside
   `platform/server/` (e.g. `platform/render/pageRender.ts`) and leave the guard untouched, at the cost of a
   one-file directory. **Cost of being wrong:** E12/S9 (`bun test --isolate platform/boundary.test.ts`) fails, which
   is loud and immediate, not silent.
3. **One resolution trap, measured so it is not hit in production.** A probe run from a directory without
   `node_modules` resolved `react-dom@19.3.1` from Bun's global install cache against the repo's `react@19.2.6` and
   failed with *"Invalid hook call … more than one copy of React"* **[M]**. Both React packages must resolve from
   **one tree**; that is automatic once `pageRender.ts` lives in the repo, and it is the reason this was measured
   rather than assumed.
4. **A hydration obligation, read from source.** The server renders the five data-bound blocks slot-less (the empty
   state), while the client's slot passes `isLoading` from its query (`StorefrontBlockSlots.tsx:50,56` →
   `ProductGridBlock.tsx:90`). If the client's **first** commit renders the slot map, those five subtrees hydrate as
   **mismatches** and React 19 re-renders them — the DOM a person sees would then differ from the DOM a crawler got,
   which is this run's rule 2 failing one level down. The mitigation is in the seam the plan already builds: the
   `#__AR_PAGE__` client applies the live slot map **after** hydration, not during it. **Named as a criterion, not a
   hope** (`IMPLEMENTATION-PLAN.md` §1.4.2, E10b).
5. **Not paid:** no SSR tier, no stream rendering, no style extraction. The CSS import at
   `ui/storefront/StorefrontRenderer.tsx:8` (`./storefront-theme.css`) did **not** break the Bun server import
   **[M]**; the fragment carries classes and inline theme vars exactly as it does in the browser today.

### R4.4 Scope of this build — what is IN, and what is explicitly OUT

The owner's priority is explicit (`ruling-react-components-and-deferred-widgets.md:21-22`: *"focus on the routing
functionality first"*). Stated once, so no increment has to imply it:

| | **IN this build** | |
|---|---|---|
| 1 | the routing file — one JSON file, validator, single writer (`apply`), boot-refuses-if-bad | §4 |
| 2 | resolution — three rungs, two binding kinds, longest-prefix, 404 default | §3.2–§3.5 |
| 3 | the page store — local, one file per page, atomic writes, series index | §5.5 |
| 4 | serving — the fragment from local storage, no relay, `#__AR_PAGE__`, hydrate-the-same-DOM | §5.5.2 |
| 5 | the one ingest endpoint at the app relay's POST surface, kind-dispatched | §5.5.3, §5.6 |
| 6 | the ACL — four levels on the signing pubkey, `may()`, `grants`, visible refusals | §7 |
| 7 | leases — top-level only, term, 404 on lapse, no grace | §3.4, §7.4 |
| 8 | the management surface, and the legacy registry's retirement | plan §9 |

| | **OUT of this build (deferred, recorded)** | |
|---|---|---|
| A | **the widget / portability layer** — custom elements, per-widget bundles, `WIDGET`/`WIDGET REGISTRY`, script imports, widget compiling, a page shipping code, "link a git repo" as delivery | §5.7, §R4.5 |
| B | **modular sub-apps** — compiled pages' contents modularised into replaceable regions; "basic slots" stays the whole requirement (O-7) | §10 O-7 |
| C | **the signed lease-confirmation ledger**, and honouring another instance's leases | §11 |
| D | **list management** — `list` references resolved, user-authored lists, the product picker | §6 |

### R4.5 Deferred is not deleted — the distinction, and the consequence

The widget layer is **DEFERRED**, and the door is not silently closed. Recorded in the same words the ruling uses so a
later reader cannot mistake this for an omission:

- **What it would have been:** §5.7 in full — a page referencing a widget **by registry id, never by URL** (§5.7.2),
  delivered as a custom element from a script-imported, content-hashed bundle the operator shipped (§5.7.3).
- **Why it is not built now:** it is **new machinery on three measured axes** — 0 occurrences of `customElements` /
  `extends HTMLElement` / `attachShadow`; no widget-bundle build (`build.ts:138-140` derives entrypoints from
  `src/**.html` and there are 0 such files); no remote script loading in app code (§5.7.4). Deferring **declines to
  build something absent**; it does not remove something present.
- **The consequence, plainly:** **a third party cannot ship a page into the instance without the instance building
  their block.** The page-composition vocabulary is ours — the CMS's block registry — and extending it means shipping
  React components with the app. If a partner ever needs to contribute a block, **that** is the work the deferred
  layer represents, and it is new machinery, not a configuration change.
- **It is distinct from the DELETED.** The **auctions-relay-as-app-relay** conflation, the **two-write-surface** shape
  and the **`/api/pages/publish`** endpoint are deleted (§5.5.3, §5.6). The widget layer is *not* deleted: §5.7 stays
  in this document as the design of record, and O-8 stays as the process question it will raise.

---

## REVISION 3 — what changed and why

> **READ THIS FIRST (added by REVISION 4).** This revision's **widget layer** — rows 3, 4, 5, 8 in the table below, and
> all of §5.7 — is **DEFERRED** by `ruling-react-components-and-deferred-widgets.md`. The **relay split** (§5.6) and the
> **single ingest endpoint** (§5.5.3, §5.6.3) stand and are not affected. The tables in this section are kept as the
> history of what REVISION 3 corrected; where they describe the widget layer as the model, §REVISION 4 and §5.7's
> DEFERRED banner are the current text.

**Authority:** `ruling-pages-widgets-and-app-relay.md` (owner, 2026-11-13). It post-dates REVISION 2 and corrects
**one layer** of it: pages are **web-components-focused, rendered in the browser from script-imported widget
bundles**, and the **app's relay is not the auctions relay** — that is settled, not open. Where this revision and
REVISION 2 disagree, this one is written to the ruling. **Everything REVISION 2 established about the *shell*
stands and is preserved in intent**: `pageStore.ts` / `pageRender.ts` / `pageHtml.ts`, render-once-and-store,
`#__AR_PAGE__`, and hydrate-the-same-DOM-don't-re-render-it.

**Measured before writing this revision** (commands and counts in `report-revision-3.md` §2), because the ruling
asks for a capability this document would otherwise have implied already existed:

| what a widget layer needs | what the repo has | evidence |
|---|---|---|
| custom elements / shadow DOM | **0 occurrences** of `customElements`, `extends HTMLElement`, `attachShadow` | `grep -rlE 'customElements\|extends HTMLElement\|attachShadow' --include=*.ts --include=*.tsx . --exclude-dir=node_modules \| wc -l` → **0** **[M]** |
| a widget-bundle build | **none**: `build.ts:138-140` derives entrypoints from `src/**.html` and there are **0** such files (`find src -name '*.html' \| wc -l` → 0 **[M]**), so `bun run build` emits no bundle today | `build.ts:138-140` **[S]** |
| a script import of remote code | **none** in app code — no `<script src="https://…">`, no `import('https://…')`, no import map | 3 hits, all inside a captured `omp-session-*.html` artifact, none in `platform/`/`ui/`/`sdk/` **[M]** |

So the widget layer is **new machinery**, and this revision prices it as such rather than describing it as a
re-description of something present. That matters because `storefrontPage.ts:10-22` states the opposite invariant in
so many words (see §5.7.2).

### R3.1 Every invalidated passage, with the ruling that killed it

| # | passage as written in REVISION 2 | invalidated by | now reads as |
|---|---|---|---|
| 1 | §1 one-sentence architecture: "…and may additionally **publish signed confirmations to Nostr** as a bonus that nothing in the route path depends on" — silent about where a *write* lands | ruling §5 | a write lands on the **app's own internal relay**, whose event-POST endpoint **is** the ingest path (§5.6). Nothing about "Nostr" changes for public relays; the internal relay is a different object |
| 2 | §2 rule 4: "Nostr is a **publication target and an audit mirror**, never an input to routing and never an input to serving" | ruling §5 | still true of public relays; the **internal** relay is an input to the **write** path only — never to routing, never to serving (§5.6) |
| 3 | §3.1 nouns — "**Four nouns, and nothing else**", where `PAGE` is a document and there is no code noun at all | ruling §3 | `PAGE` becomes the **page definition that references widgets**; `WIDGET` and `WIDGET REGISTRY` are added (§5.7) |
| 4 | §5.5.2 table, row 2: the five data-bound blocks are "**placeholder + hydration**" and "they display *live* commerce data" — i.e. the dynamic layer is React hydration | ruling §§1–3 | the dynamic layer is **widgets**: custom elements delivered as script-imported bundles that fetch their own live data in the browser (§5.7) |
| 5 | §5.5.2: "the stored fragment is the full page with data-bound blocks as **named, empty slots** that the client fills after hydration" | ruling §3 | the slot survives as the **mount point**; what fills it is a widget bundle, not a React slot map (§5.7.3) |
| 6 | §5.5.2 correction box: "(b) *builds* one … What (b) genuinely buys is that a request does no rendering at all" — true, but stated without the reason the split **exists** | ruling §§1–2 | unchanged, and now **paired with the two recorded reasons** so a later reader cannot propose prerendering everything (§5.5.2) |
| 7 | §5.5.3: "`POST /api/pages/publish` … It is deliberately the **only** way a page enters the store", and §7.1: "**One actor model, two write surfaces** (routes and pages)" | ruling §5 (there is **one** ingest endpoint, for signed app events) | **one ingest surface** — the app relay's event-POST endpoint — **dispatched by kind**: `30024` → page store, route intent → `may()` + `apply()` (§5.5.3, §5.6.3) |
| 8 | §5.5.4 table, option **(i)**: "the app accepts the signed event directly … **no relay dependency at all** … OUR CHOICE for increment 1", with (ii) "a write-restricted app relay" marked "compatible later; not needed now" | ruling §5 | the app relay **exists** and its POST endpoint **is** the ingest path. (i) is not wrong about the *mechanism*, it is wrong about the *owner* of the endpoint (§5.6.3) |
| 9 | §10 **O-6** "Does the app run its own relay, and is it the one the auctions use?" — open, with a lean, and the closing claim "the app's page ingest does not need a relay at all" | ruling §5 | **CLOSED**: two relays, two roles. The auctions relay is a **test placeholder for the real public relays**; the app's relay is **purely internal** (§5.6). Kept in place as history |
| 10 | §11: "pages are **stored locally** by the app … and mirroring them to a public relay is **not built**" — reads as "no relay on the write side" | ruling §5 | pages are still stored locally; the **write** arrives through the app's internal relay, and mirroring to a **public** relay remains unbuilt (§5.6.3, §11) |
| 11 | §12 Q7 "Does the app gain an **SSR tier** for page bodies?" — framed as one choice between render-per-request and render-at-publish | ruling §§1–2 | **re-framed and closed in substance**: the shell and the page's static content are React-rendered **once at ingest**; the dynamic content is never server-rendered. Prerendering "everything" is ruled out for a stated reason (§5.5.2) |
| 12 | §13 diagram: "PAGE STORE … **data-bound blocks are slots, hydrated client**", and the write line "`/api/pages/publish` — verify sig → kind allowlist → parse → render → store" | ruling §§3–5 | the slot is a **widget mount point** filled by a script-imported bundle; the write line is the **app relay's event-POST endpoint**, dispatched by kind (§5.6.3, §13) |

### R3.2 What this revision did **not** change

- **The shell stays React.** `pageRender.ts` renders the shell and the page's **static** content to HTML once, at
  ingest; `pageHtml.ts` composes it; the client **hydrates the same DOM** and never re-renders it. Ruling §4 names
  this as the part that "must be preserved rather than rewritten", and it is preserved verbatim in intent.
- **The page store is still local, and still the read path.** No relay is consulted to resolve a route or to serve a
  bound page. `POST /api/pages/publish`'s *function* — verify, authorise by pubkey, check kind and size, parse,
  render, store — is unchanged; only its **name and owner** move (§5.6.3).
- **No widget is remote at serve time.** A page references a widget **by registry id**, never by URL (§5.7.2), so
  "script import" does not become "load a script from wherever the page says".
- Leases stay top-level-only, 404 on lapse, one binding per path, and the binding wins (§R3.3).
- Nothing publishes to a public relay in increments 1–8, and the signed lease-confirmation ledger stays deferred (§11).

### R3.3 The three confirmations, now recorded as settled rather than leaned

Ruling §6 settles three things this document had been carrying as leans or inferences. They are **not** re-opened
here; they are restated once so no later section contradicts them:

1. **"Modular" means basic replaceable slots.** *"some basic slots that can be replaced is good enough to start."*
   §10 O-7's "shell with named slots" is therefore **the whole requirement**, and no increment grows a slot system.
2. **Sub-app sub-paths do not conflict with top-level-only leases.** Programmed routes may be arbitrarily deep;
   **only leases** are restricted to top level (§3.4, §5.2). This was already §3.4; it is now confirmed rather than
   inferred.
3. **One binding per path, and the binding wins.** A re-pointed legacy path is **not** served in parallel from the
   compiled tree (§5.2, §5.4). This was `ruling-local-pages-acl-and-legacy-routes.md:118-121`'s *lean*; it is now a
   confirmation.

---

## REVISION 2 — what changed and why

**Authority:** `ruling-local-pages-acl-and-legacy-routes.md` (owner, 2026-11-13) answers the three raises in
`report-consolidation.md` §5. It post-dates every ruling this document was built on, so where the two disagree,
**this file is rewritten to match it**. Three of its clauses **reverse** text written below; one **closes** the
document's only architectural open question.

### R2.1 Every invalidated passage, with the ruling that killed it

| # | passage as originally written | invalidated by | now reads as |
|---|---|---|---|
| 1 | Header, "What I could not measure": every relay-indexing claim is `[U]`, and "the plan phrases its evidence commands so that a relay-dependent rung is **never** on the site's critical path" | ruling 1 (local pages) | no rung is relay-dependent **at all**. A bound page is served from local storage, so the unmeasured relay facts stop gating anything (§5.3, §5.4) |
| 2 | §1, the one-sentence architecture: "serves the resulting page or a 404" — silent about *where the page comes from* | ruling 1 | "serves the resulting page **from local storage** or a 404" |
| 3 | §2, the rule "No route resolution, and no path-authorized decision, may perform a network call **to decide what this instance serves**" | ruling 1 | the prohibition **widens**: no network call to **serve a bound page** either. SEO and instant response are the driver, so this is a requirement, not an optimisation |
| 4 | §3.1 nouns: "PAGE … A page **lives on relays**, authored by its author" | ruling 1 | a **PAGE STORE** becomes the fourth noun; a page is still authored by its author, but the **served copy is local** |
| 5 | §3.3: "A relay outage therefore degrades a **page**, never a **route**" | ruling 1 | a relay outage degrades **nothing**. A page that is stored is served; only *new publishes* can fail |
| 6 | §4.3: "**Page content.** No page bodies. **Pages stay on relays**, authored by their author." | ruling 1 | page bodies live in the page store. The routing file still holds no content, but for a new reason: it holds *meaning*, the store holds *content* |
| 7 | §5.1: "Compiled-in pages … The ladder **does not apply** to them: they are rungs **above** the ladder, matched by the router" | ruling 3 (legacy re-pointing) | a compiled-in path **is** a rung-1 target. The routing tree may bind it (§5.2, §5.4) |
| 8 | §5.2 in full — "`/dashboard` … stands the application surface … **A binding on `dashboard` is refused by the validator** … If the owner wants the dashboard itself reassignable, that is a different, larger change … **It is not in this plan**" | ruling 3 | **REVERSED.** `/dashboard` is re-pointable **now**, by the routing table, **without** modularising the page first |
| 9 | §5.3 series membership read as a relay query `{kinds:[30024], '#t':[…]}` at request time, and its `[U]` gate on `#t` indexing | ruling 1 | membership is resolved from the **local series index** maintained at ingest; the relay is not consulted |
| 10 | §5.4: "**Compiled-in route matches first.** … **This is settled and non-negotiable**" | ruling 3 | a **binding on a compiled-in path wins**; the compiled-in route is the *default*, not the ceiling |
| 11 | §7 heading "The ACL — **three tiers**, enforced server-side", and the `premium / paid` row inside the tier table | ruling 2 (pubkey ACL) | **four levels**: `app` → `admin/owner` → `editor` → no ACL. `premium/paid` is **not a tier**; it is a *lease* — a path right, not authority |
| 12 | §7.1 `may(actor, …)` — no `app` branch, and `actor` itself unestablished | ruling 2 | a five-branch function with `app` at the top; `actor` **is** the signing pubkey. **No NIP-98** |
| 13 | §8.3 table: COMPILED_IN — "a binding on one is **refused** and the refusal is explained as 'app-owned'"; consequence 2 — "the file becomes invalid on load and **the site refuses to boot**" | ruling 3 | **ALLOW with a warning.** A collision is a warning at load and `warning: 'compiled-in-path'` on the write. Never a boot refusal |
| 14 | §9.2, row on `designs/B-server-authoritative.md:357-382` — NIP-98 "**NOT ADOPTED, and not superseded by a ruling** … **§10 flags this as an open decision**" | ruling 2 | NIP-98 is **unnecessary**. The credential is a signed Nostr event; the tier is a pubkey lookup |
| 15 | §9.3, row on `designs/C-ownership-domain.md:248-265` — "The actor is settled in §10 as **an open decision**" | ruling 2 | the actor is **settled** (§7.1) |
| 16 | §9.5, row on `designs/COMPARISON.md:161` X3 — "adopt NIP-98 … **not settled by any ruling**" | ruling 2 | settled, and settled **against** NIP-98 |
| 17 | §10 **O-1 "Who does the server think you are? (the ACL's actor)"** in full, including the NIP-98 cost comparison | ruling 2 | **CLOSED** (§7.1). Kept in place as history, marked CLOSED |
| 18 | §12 Q1 — "Is `auctions` supposed to be reassignable?" | ruling 3 | **answered: yes.** Compiled-in paths are re-pointable and `auctions` is not a special case |
| 19 | §12 Q2 — "Does the owner want `/dashboard` itself reroutable, or a path of his choosing?" | ruling 3 | **answered: the former.** It was the example all along, not a misreading |
| 20 | §12 Q3 — "Does `#t` work on kind 30024 on this deployment's relay?" | ruling 1 | **demoted, not answered**: R3 no longer depends on it (§5.3) |
| 21 | §13 diagram — `compiled-in routes (the app's own)` drawn **above** the routing file, and `PAGE … fetched AFTER routing … relay may be down` | rulings 1 + 3 | the file is consulted **before** the compiled-in tree; the page box becomes the local store |
| 22 | §7.1 "Roles are read from the existing managers" — correct, but the list it enumerates is the three-tier one | ruling 2 | same two managers, four levels. `app` is the app pubkey, not a third set |
| 23 | §2 rule 3, and §11 "**Nothing in increments 1–8 publishes to Nostr**" — read as "Nostr is not involved anywhere" | ruling 1 | still true, but the sharper statement is: Nostr is **not on the read path**, and the page store's ingest is local-first. Whether a publish is also mirrored to a public relay is an implementation choice (§5.5) |

### R2.2 What the three rulings did **not** change

Listed deliberately, so this revision is not read as a rewrite:

- **The routing table is still a single file** (`ruling-simple-routing-file.md:5-18`), with no fallback and no
  degraded mode. A page store is not a second routing table: the file holds **what a path means**, the store
  holds **content**.
- **Two binding kinds, never one row with an optional term** (§3.2), and **lease expiry → 404**.
- **Leases are top-level only and carry their subpaths** (§3.4). The one surviving precedence question —
  admin binding vs a leaseholder's subpath (O-2) — is still open and still not needed by this plan.
- **The ladder is still three rungs**, and a lapsed lease still **stops** at rung 1 rather than falling through.
- **Nothing publishes to Nostr on the read path**, and the signed lease-confirmation ledger stays deferred (§11).

### R2.3 The thing this revision adds that no ruling specified

A **writer** for the page store, with an allowlist. Ruling 1 requires that any ingest path be
**write-restricted** (specific pubkeys, specific kinds) and names the relay's out-of-memory errors as the symptom
of the model being rejected. Measured, the relay this app talks to has **no author allowlist at all**:

```
$ sed -n '84,90p' deploy-simple/relay/cmd/market-relay/main.go
relay.OnEvent = policies.SeqEvent(
        policies.ValidateKind,
        policies.RejectEventsWithBase64Media,
        policies.RejectUnprefixedNostrReferences,
)
relay.OnRequest = policies.SeqRequest(policies.NoComplexFilters)
```

Kind-and-shape validation only — any pubkey may write (`main.go:84-87`) **[S]**. So the write restriction is
**new code**, and it is the reason increment 1 changes shape (`IMPLEMENTATION-PLAN.md` §1).

---

## 1. The one-sentence architecture

**The instance is its own authority: it holds a single server-side routing file, resolves every request against
that file with no network call, serves the resulting page *from its own local page store* or a 404, and may
additionally publish signed confirmations to Nostr as a bonus that nothing in the route path depends on.**

That sentence is the whole thing. Everything below is its consequence, and everything in the four designs that
contradicts it is superseded. "From its own local page store" is REVISION 2: a page at a set route is
**never** fetched from a relay to answer a request (§5.5), because SEO, link previews and instant responses are
the stated driver, not an optimisation.

**REVISION 3 adds where a write lands, and it is the other half of the same sentence.** A write — a page, a route
intent — arrives as a **signed Nostr event** at the **app's own internal relay**, whose event-POST endpoint *is* the
ingest path (§5.6). The **auctions relay is not that relay**: it is a test placeholder standing in for the real
public relays (§5.6.1). Reads never touch either relay; writes touch only the internal one, and only to be ingested.

**REVISION 4 adds the composition vocabulary, and it is not a new noun.** A page's blocks are **React components the
CMS already defines**; the loader is *"a Plebeian Market instance or similar"*; and the page is rendered once at
ingest from those components, then hydrated by the same app. No web components, no bundle per block, no code in a page
(§R4.2, §5.7).

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
2. **No request for a bound page may perform a network call to serve it.** REVISION 2, ruling 1: the page is
   read from local storage, so a relay outage cannot produce a "page unavailable" state. This is the SEO,
   preview and instant-response requirement, and it is why the page store is increment 1's core rather than an
   optimisation.
3. The routing table is the server's own state, loaded from disk, and served by the server.
4. Nostr is a **publication target and an audit mirror**, never an input to routing **and never an input to
   serving**. Its only remaining role on the write side is as a possible *transport* for a signed event the
   server then stores (§5.6). **REVISION 3 disambiguates the transport**: the app's **internal** relay is the write
   transport and ingest surface; a **public** relay is a publication target and nothing else. Neither is ever an
   input to routing or serving.

The consequence the owner accepted with his eyes open (`ruling-simple-routing-file.md:12-16`): **an unreadable
table means the site is broken.** There is no degraded mode, no snapshot fallback, no stale cache story. The
operational answer is a backup and an alarm — not an architectural layer. That is settled; §9 records it as
superseding everything that proposed otherwise.

---

## 3. The model

### 3.1 Four nouns, and nothing else

```
BINDING     a path resolves to a target. Two kinds, never one row with an optional term (§3.2).
PAGE        the page DEFINITION: a document, authored by the page's author, that REFERENCES blocks by
            the CMS's existing block type and carries no source of any kind (§5.7). Kind 30024 on the
            wire, `d` = its identity.
PAGE STORE  the instance's LOCAL copy of the pages it serves: the document, plus what is needed to
            answer a request without a relay (§5.5). Storage format is the implementer's choice —
            ruling 1 says so explicitly ("a custom database in a more efficient way, I don't mind").
REFERENCE   what a page block points at: a coordinate, or a list name (reserved, not built — §6).
```

**REVISION 4 — what a page references, and the vocabulary it does not have.** A page references **the block types the
CMS already ships** — `ProductGrid`, `ProductRow`, `ProductStrips`, `Search`, `Categories`, `Hero`, `Text`, `Image`,
`LinkList`, `Divider`, `Spacer`, `BrowseStats`, `BrowseFeed`, `AuctionList`, … — which are **React components already
in the tree and already in the CMS editor** (`platform/web/storefront/storefrontCms.tsx:149,196` builds the editor's
`components` map over the same union `sdk/commerce/storefront/storefrontPage.ts:293-306` closes) **[S]**. The
composition vocabulary is therefore **ours**; a third party extending it ships a React component with the app
(§R4.5).

**DEFERRED, and not nouns of this model** (`ruling-react-components-and-deferred-widgets.md:38-45`). Listed here so the
door is visibly open rather than silently shut, and so nothing below reads as if it were built:

```
WIDGET          (DEFERRED) a custom element delivered as a script-imported bundle, built into the deploy
                artefact and served as a static asset, fetching its own live data in the browser (§5.7).
WIDGET REGISTRY (DEFERRED) the instance's allowlist for widgets: id → element name → bundle path →
                props schema. A page would name an id, never a URL (§5.7.2).
```

Both are described in full in §5.7, which is retained as the **design of record**, and **neither appears in any
increment**. Deferring them is `[M]`-backed as *declining to build something absent*: 0 custom elements, 0 widget
bundles, 0 remote script loads in app code (§5.7.4).

There is no separate "route table event", no "claim event", no "default event", no "manifest", no sharded
projection, no event-store, no database for *routing*. A binding lives in the routing file (§4). A page is still
the author's speech and the app still does not own it — but the **served copy** is local (REVISION 2, ruling 1),
because a round trip per request decides whether the page can be indexed, previewed, or answered instantly. The
routing file holds **no page content** — only what the instance has decided a path means; the page store holds
content and nothing about paths.

**Why this is not the "manifest" the previous paragraph refuses, and not a registry either.** That refusal is about a
second *routing* record (a sharded table of paths on a relay). The block vocabulary is different in kind: it is **code
the instance already ships**, it never names a path, and a page reaches it by *type* through the same closed union the
schema validates — no lookup table, no registration, no per-block asset. Paths come from the routing file; blocks come
from the build artefact; a page references both without owning either (§5.7.2, §R4.5).

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
- **binding resolved, its target not renderable → the page's own honest state** ("item unavailable"), **still
  HTTP 200** for the route. Routing succeeded; the content is missing. Different failure, different error.

**REVISION 2 changes who can be in that second state.** A bound *page* can no longer become unrenderable at
request time, because the store refuses an invalid page at **ingest** (`pageRender` must succeed before the
write commits, `IMPLEMENTATION-PLAN.md` §1.5). So "item unavailable" survives only where the route's *target is
not a page* — a prefix route whose page then looks up an object that has gone. That is a narrowing, not a
relaxation: the pre-revision design accepted an unbounded set of request-time failures that the local store
converts into a write-time refusal.

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
relay to answer "what is at this path" — the anti-pattern. Here, routing decides **which page** answers, from
`(author, d)` the server already knew, and then the **local page store** supplies it. REVISION 2 sharpened this
past the original text: it is not merely that the relay is consulted *after* routing — it is not consulted at
all. A relay outage therefore degrades **nothing**: a stored page is served, and only *new publishes* can fail.
That is the difference between this ladder and `proposal-v2.md:235-257`, and it is the difference between the
pre-revision text and this one.

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
  AND name is not in RESERVED \ COMPILED_IN (§8.3)       ← the URL space and un-handed-out names
  AND name is not COMPILED_IN (§8.3)                     ← REVISION 2: a lease may not take a
                                                            compiled-in path; admin/app may (§7.1)
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

- **Page content.** No page bodies. They live in the **page store** (§5.5), not in the routing file and — since
  REVISION 2 — not on a relay either, as far as serving is concerned.
- **A binding on a reserved name** (§8.2–§8.3) — the validator refuses the whole file.
- **A binding on a compiled-in name** — **allowed, with a warning** (REVISION 2, ruling 3). See §8.3: what was a
  refusal is now a warning, and the file loads.
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
   §8.1 lists them. **REVISION 2**: the ladder applies to them like any other path. A compiled-in page is what
   rung 1 resolves to **when no binding exists**, and an admin binding on it supersedes it (§5.2, §8.3).
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

**REVISION 2 — the ruling decides, and it reverses this section.** The text that stood here said a binding on
`dashboard` is refused, and that making the dashboard reassignable was "a different, larger change … not in this
plan". `ruling-local-pages-acl-and-legacy-routes.md:64-89` says the opposite in as many words:

> "the compiled-in routes will have to be superceded by pages that are placed in the new routing system's
> routing tree. I wouldn't CMS-rebuild all those pages but would still consider their contents modular … So short
> answer: legacy routes will need to be superceded and re-pointed by the routing tree to the specific pages."

So:

- **A binding on `dashboard` is accepted**, not refused. The validator warns (`compiled-in-path`) and the file
  loads (§8.3).
- **Routing supersedes the compiled-in route.** Rung 1 is consulted for every path including the compiled-in
  ones; a live binding is served, and the compiled route is what answers *only when no binding exists* (§5.4).
- **One binding per path, and the binding wins.** The legacy URL is **not** served in parallel — otherwise the
  same URL has two meanings, which is the class of bug this run exists to delete. This is the lean stated in
  `ruling-local-pages-acl-and-legacy-routes.md:118-121`; it is a lean, so it is labelled one, but the alternative
  is incoherent and no increment is built for it.
- **No modularisation is a precondition.** Re-pointing a legacy path is a **routing** act and it lands first.
  Turning the page's *contents* modular — "replacing a navigation bar or otherwise for a dashboard section" —
  is the **next** step by the ruling's own sequencing, and the plan must be able to re-point without it.

**What this does *not* require, and the one thing it does.** It does **not** require touching the 31 files under
`platform/web/routes/_dashboard-layout/` (measured, §5.2 table), moving the layout, or re-deriving
`ui/nav/model.ts`. The page is served **instead of** the compiled tree, at the HTTP layer. The one real piece of
work is the client seam: the SPA bundle still boots at that URL and TanStack's generated route tree still
contains `path: '/dashboard'` (`platform/web/routeTree.gen.ts:725` **[M]**), so on hydration the compiled route
would mount over the served page. The served HTML must therefore carry the decision — the same
`#__AR_PAGE__` payload §5.5 defines — and `platform/web/routes/__root.tsx:25-31` must render that payload in
place of `<Outlet/>` when it is present. That is **one guard**, not a rebuild, and it is why re-pointing does not
depend on the modular-contents step.

**The direction of travel, recorded so the plan does not build a monolith.** The ruling wants these pages to
become "modularized and component-based pages that serve as 'sub-apps' with their sub-paths (browse experience,
seller dashboard, buyer/orders dashboard, and more…)". That is the step *after* routing, and it is why §3.4's
"leases are top-level only" does not constrain it: **programmed routes may be arbitrarily deep; only *leases* are
restricted to top level** (`ruling-local-pages-acl-and-legacy-routes.md:115-117`).

**`/` remains the case that is buildable with zero new client seam**, and still the cleanest demonstration:
`/` is a compiled-in route today (`platform/web/routes/index.tsx:29`) that renders `useStorefrontAddressPage`
for the app key's `home` page and falls back to an inline composition (`:81-101`). After increment 3, `/` renders
**the default binding's** page, from the page store. R4 is unchanged; what changed is that `/` is no longer the
*only* path where the table beats the router.

### 5.3 R3 — the series path, and its honest limit

`/featured` is a **programmed** path whose target is `{ type: 'series', series: 'featured' }`. Routing therefore
resolves `/featured` with no network call; the **series membership** is a fact the page store already holds.

- **Membership is declared on the page**: `["t", "featured"]` (single-letter tag; the repo's filter type already
  supports `#t`, `sdk/core/event-store/filter.ts:10` **[S]**) — and it is recorded in the **local series index**
  at ingest (`IMPLEMENTATION-PLAN.md` §1.5). REVISION 2: the request-time query is gone. `ruling 1` forbids the
  round trip, and it also makes R3 *faster and more reliable* than the pre-revision design, which was gated on an
  unmeasured relay property.
- **Ordering**: newest by `created_at`, ties broken by lexicographically lowest `id` — the repo's existing,
  already-tested rule (`sdk/core/event-store/mergeRules.ts:24` **[S]**, `selectReplaceable` at
  `platform/web/storefront/storefrontQuery.ts:44`, applied at `:97`). Unchanged; the same comparator runs over
  the local index.
- **Author-scoped**: the index entry is keyed `(seriesKey, author)`. Without the author dimension, any user
  publishing a page tagged `t=featured` becomes `/featured` — a name takeover by hashtag. **Who the series owner
  is** is part of the series binding (`target.author`), not inferred.
- **When the newest member is unusable** (switched off, unparseable, zero blocks): walk the index to the next
  newest usable member. `shouldRenderStorefrontPage`
  (`platform/web/storefront/storefrontQuery.ts:150-154`) already states the predicate — and since a stored page
  is validated at ingest, "unparseable" can only mean a page stored by an older build.

**The honest limit** (`designs/C-ownership-domain.md:676-680` is right about this and the ruling does not
overturn it): "newest" is an author-asserted timestamp, so a backdated page could win a series. Mitigation is
**not** a clock the operator controls — it is that the series query is author-scoped to the series owner, so
backdating is a self-attack by the only person who can publish into the series. Recorded as **accept**, not
solved.

**The `[U]` that used to sit here is retired, not answered.** Whether this deployment's relay indexes `#t` on
kind 30024 no longer matters to R3, because the request never reaches a relay: the series index is built when a
page is ingested (`IMPLEMENTATION-PLAN.md` §1.5). The measurement would now only matter for a *backfill* of pages
published before this increment — and a backfill is a one-off migration script, not a resolution path. Recorded
so nobody re-opens the gate.

### 5.4 Where the routing decision crosses the boundary

This is the piece every candidate fumbled, and it is worth stating plainly because it decides the thing they
fought over.

- **The routing file is consulted first, for every path.** **REVISION 2, ruling 3**: this is the reversal. A live
  binding on `/dashboard` is served, and the compiled-in dashboard answers only when no binding exists. The
  router owns its own paths by *default*, not by right — which is the owner's whole point ("anyone should be able
  to reroute the pages of the app").
- **Compiled-in routes are rung 1's fallback within the same rung**, not a tier above it: exact binding → else
  the compiled-in page or prefix → else 404. That ordering matters more than it looks, because it is what makes
  the compiled-in set a *warning* rather than a *refusal* (§8.3).
- **`/$vanityName` is the last rung-1 candidate.** With `proposal-v2.md:235-257`'s "trusted authors, oldest wins"
  replaced by the routing file: `/x` consults the file for `x`. A binding → its target. **No binding → 404**
  (rung 3), *not* "an app-key page at `d=x`" and *not* "the oldest page anybody published at `d=x`".
- **The server URL space stays fixed.** `/api/*`, `/images/*`, `/manifest.json`, `/sw.js`, `/favicon.ico`
  (`platform/server/http/static.ts:43-48`, `platform/server/http/config.ts:31-32`) are matched by the Bun server
  before the SPA catch-all (`platform/server/buildServer.ts:37-54`). A table binding on `api` or `images` would
  be dead — and the reserved list already refuses them (`'api'`, `'images'`, `'assets'`, `'static'`, `'public'`
  **[M]**), which is what §8.3 makes a checked invariant rather than a hope. **REVISION 2 does not change this**:
  routing beats the *router*, not the *server's own endpoints*.

**Why the client cannot be the enforcer.** `ruling-resolution-and-signed-ledger.md:8-20`: the server resolves
and serves; the only "client-side" choice is *which instance you use at all* (self-hosting). A client-side
allowlist, a client-side oldest-wins rule, or a per-user preference are all superseded.

### 5.5 The page store — what is stored, and how a request is answered (REVISION 2, new)

`ruling-local-pages-acl-and-legacy-routes.md:20-37`, binding: *"no relay round trip for served data such as
pages … The pages can equally be stored in different formats in a custom database in a more efficient way, I
don't mind … since that also decides on the page being able service search engines / SEO, page previews etc. It
must have instant responses."*

**Measured, what exists today.** The server renders **no page body at all**. `platform/server/buildServer.ts:36-54`
composes config, zap, nip05, static, browse-search, auctions, analytics and og routes, then a `'/*'` catch-all
that returns the SPA shell. The only server-rendered HTML enrichment is `og` meta injected into a shell it fetches
from itself (`platform/server/http/og.ts:28-31` → `sdk/commerce/products/ogTags.ts:182-207`), which builds a
`<meta>` block and never a body. `platform/server/ogMeta.ts:198-215` shows the one server-side lookup pattern in
the repo: a single `ids:`-filtered read, signature-verified, 2.5 s budget, `null` on failure **[S]**. So:

- **SEO machinery exists for meta, not for content.** That is the toehold the ruling names, and it is exactly a
  toehold: it proves the server can emit crawler-visible `<head>`, not that it can emit a page.
- **A server-side body renderer is new work.** `StorefrontRenderer` is a client component (`ui/storefront/
  StorefrontRenderer.tsx`), and `react-dom/server` appears **only in test files** today
  (`grep -rl renderToStaticMarkup --include=*.ts --include=*.tsx . --exclude-dir=node_modules | wc -l` → **102**
  files; `| grep -v '\.test\.'` → **0** **[M]**). The good news, measured: `ui/storefront/` imports no
  NDK, no `localStorage` and no `window` outside a comment (`grep -nE 'localStorage|ndk|window\.' ui/storefront/*.tsx`
  → 1 hit, a comment), so the renderer is not structurally hostile to a server render.

**What a stored page is.** The page *definition* is already a well-specified document, so the store does not
invent one: `sdk/commerce/storefront/storefrontPage.ts` defines kind 30024 with a closed block union of
**12 types** (`:125-292`, `StorefrontBlockSchema` at `:293`) and hard bounds (`STOREFRONT_LIMITS`, `:47-55`:
100 blocks, 20 000-char text, 2 048-char URLs). A stored page is:

```
the validated document           JSON, exactly what parseStorefrontPage accepts
the rendered HTML fragment       produced once, at ingest (§5.5.2)
its head meta                    title / description / og:* / twitter:* / canonical
its identity                     (author, d), kind 30024, event id, created_at
its series memberships           from ["t", …] tags, if any
```

**REVISION 4 removed one field from that list** — "the widget ids the document references, so `pageHtml` can emit
exactly those script imports". With the widget layer deferred there is **no per-block asset to emit** (§R4.5), so the
store holds nothing about block identity beyond the document itself. A page is data; the code that renders it is the
app.

**5.5.1 Storage format — OUR CHOICE, and deliberately boring.** Two shapes of file, no database, no index server:

```
data/pages/<author-hex>/<d>.json                 one file per page, written atomically (tmp + fsync + rename)
data/pages/series/<seriesKey>/<author-hex>.json  newest-first list of {d, createdAt, eventId}
```

- **Why not one big file**: a page may be 100 blocks and megabytes; re-reading the corpus to answer one request
  is the relay round-trip's cost in local form, which defeats the point. One file per page means a lookup is one
  `open`.
- **Why a separate series file**: `/featured` must not scan every author directory. It reads one small file.
- **Why not a database**: ruling 1 leaves format free, and `ruling-simple-routing-file.md:5-18` has already set
  the house style (a file, no layer). The retrieval shape needed here is `get(author, d)` and "newest in series"
  — both are path lookups.
- **Atomicity**: the same `writeAtomic` discipline as the routing table (§4.5). One writer (the server), one
  process, no lock file.
- **This is a choice, not a ruling** — a SQLite or LMDB store would satisfy the ruling equally. It is chosen for
  the reasons above, and swapping it touches `pageStore.ts` only, because nothing else opens these paths.

**5.5.2 Render-at-ingest, and the split that is now the design (REVISION 3).** Following the ruling's lean (b) —
*render at publish, store the result* — the shell and the page's **static content** are rendered to HTML when the
page is stored, not per request. The page's **dynamic** surfaces are not rendered at all, at any time, on the
server. That split is not an optimisation we chose; it is the owner's diagnosis and it is now the binding shape.

**Why the split exists — recorded here so nobody later "fixes" it by prerendering everything.** Two reasons, both
the owner's, both binding:

> **Reason 1 — full server-side rendering fails for dynamic content.** *"this could work in theory but I would
> perhaps point to the case of dynamic content as where its limits would show — since a full server-side rendering
> could not dynamically update content in realtime unless it was constantly refreshing all its contents."*
> (`ruling-pages-widgets-and-app-relay.md:7-9`). Read the failure precisely: it is not that SSR cannot produce
> HTML, it is that a server-rendered page is **a snapshot**, and the only way to keep a snapshot current is to
> re-render and re-send the whole thing, continuously. A page whose product prices are correct at render time and
> wrong five minutes later is serving stale data as fact — the same defect class this run exists to delete, one
> layer down.

> **Reason 2 — the efficient shape is compiled bundles served as static assets.** *"if we can compile the react or
> other typescript into built JavaScript bundles and serve those as static pages I do think it would make things
> more efficient"* (`:19-21`). Binding: the cost of rendering moves to **build/publish** time, and serving becomes
> a **static asset fetch**. Rendering per request is the thing being eliminated, not merely reduced.

So the split, stated as a rule a future reader can test a proposal against: **anything that is a function of the
page's own data is rendered once at ingest; anything that is a function of live network state is a data-bound block
and is never rendered on the server.** (REVISION 4: "widget" became "data-bound block" — the rule is unchanged, our
vocabulary is the CMS's.)

| block types (`storefrontPage.ts:293-306`) | at ingest | at request | why |
|---|---|---|---|
| `ProfileHeader`, `Hero`, `Text`, `LinkList`, `Image`, `Divider`, `Spacer` | **rendered to HTML** | served as-is | pure presentation of page data; no query, so no staleness |
| `ProductGrid`, `FeaturedProduct`, `ProductRow`, `Search`, `Categories` | **a placeholder region** carrying the block's `type`, with the block's own "no data yet" view as its content | served as-is, then **filled in the browser by the existing React slot map after hydration** | live commerce data: a frozen copy is a stale price and a dead add-to-cart |

The 7-static/5-dynamic split is REVISION 2's and is unchanged. **REVISION 4 restored what fills the slot**, and it is
what REVISION 2 said before REVISION 3 changed it: the client's own React components, supplied through
`StorefrontDataSlots` (`ui/storefront/StorefrontRenderer.tsx:50`) by
`platform/web/storefront/StorefrontBlockSlots.tsx:192` **[S]**. There is no element upgrade, no bundle, and no script
import (§R4.5). The placeholder is rendered by the same renderer with **no slot map** — `StorefrontBlockView` already
falls back to the props-only view for every data-bound type (`ui/storefront/StorefrontRenderer.tsx:105-136`) — so the
crawler sees the block's honest empty state rather than a blank hole.

**How the fragment is produced, named rather than assumed (REVISION 4).** `pageRender.ts` calls
`renderToStaticMarkup` from `react-dom/server` over `ui/storefront`'s components **inside the Bun server process, once,
at ingest**. Measured: react-dom 19.2.6 is already a dependency (`package.json:92`), the real block components render
to a string under Bun with **no `window` and no `document`**, and `platform/server/` has no React import today, so the
module is new — one module, no dependency change, no build step, one boundary-guard entry. The full cost, including the
hydration obligation for the five data-bound regions, is §R4.3.

**What the crawler sees, stated plainly so the SEO claim is not overclaimed.** A crawler that runs no JavaScript
sees the page's **static content and its head meta** — headings, text, links, images, `og:`/`twitter:`/canonical.
It does **not** see the five data-bound blocks' live content, because that is fetched in the browser by design — it
sees their empty state. That is the honest
boundary of the ruling's model, and it is the same boundary `storefrontPage.ts:10-22` already draws.

> **A correction to the ruling's lean, retained from REVISION 2.** The lean says (b) "gives instant responses and
> SEO with no SSR framework migration". The *first* half is right; the second is optimistic. There is no server body
> renderer today (§5.5, measured), so (b) *builds* one — the difference between (a) render-per-request and (b)
> render-at-ingest is **when** it runs, not **whether it exists**. What (b) genuinely buys is that a request does
> no rendering at all, which is what "instant" requires. REVISION 3 changes nothing in this box and adds one
> consequence: the renderer (b) builds is smaller than REVISION 2 assumed, because it never has to render a
> dynamic surface — `pageRender.ts` renders static blocks and emits a placeholder for each data-bound block. REVISION 4
> names that renderer's mechanism and prices it (§R4.3): `renderToStaticMarkup` from `react-dom/server`, already a
> dependency, one new module, no build step.

**5.5.3 The ingest path is write-restricted, and there is exactly one of it (REVISION 3).** This is the part
ruling 1 calls non-negotiable, and the part the current system does not have (§R2.3). Ruling §5 settles **what the
endpoint is**: the app relay's *"POST-like endpoint for nostr signed events related to the app functionality"*, and
it *"is the app's write/ingest path"*. So the endpoint is **kind-generic** and **dispatched by kind**, which is what
deletes the two-write-paths shape REVISION 2 had:

```
POST /api/app-events           body: one signed NIP-01 event, any kind in the app's allowlist
  1. verifyEvent(event)                                  ← the websocket.ts:30 template
  2. level(event.pubkey) must be app | admin | editor     ← §7.1; "no ACL" is refused here
  3. kind allowlist (below)  → else 400 'kind-not-allowed' ← "specific kinds"
  4. author allowlist: the level lookup IS the allowlist   ← "specific pubkeys"
  5. dispatch on kind:
       30024  page      → size caps → parseStorefrontPage → pageRender → writeAtomic(page file)
                          + series index
       <route-intent>   → the intent branch: may(actor, op, path, file) → apply(mutation)   (§4.5, §7.1)
  6. 200 { stored: true, kind, path? }  |  4xx { refused: <reason> }
```

The endpoint **path name is OUR CHOICE** (the ruling says "POST-like", not `/api/app-events`); that there is
**one** such endpoint, and that it is the app relay's, is the ruling. `POST /api/pages/publish` therefore **stops
existing as a separate surface**: its function becomes branch 5a, and a reader must not find two ways to write a
page. §5.6.3 says where the endpoint physically lives and what that costs.

Three consequences that are design, not implementation detail:

- **A page that cannot render is never stored**, which is why §3.2's "item unavailable" narrows to non-page
  targets. **REVISION 4 removed the second ingest refusal REVISION 3 added** ("a page that names a widget id found
  nowhere in the registry is refused", §5.7.2): with the widget layer deferred there is nothing to resolve an id
  against, and the block vocabulary is a closed union the parser already enforces. **One refusal remains, and it is
  the one that matters** — `pageRender` must succeed before the write commits.
- **Restriction is enforced on the *pubkey*, not on a submitted role.** The caller cannot claim a tier; the server
  looks the tier up (§7.1), which is exactly the shape ruling 2 describes for the ACL. **REVISION 3 collapses the
  two write surfaces into one endpoint dispatched by kind**, so the actor model is evaluated once, in one handler,
  for every kind the app accepts — a route intent cannot arrive through a laxer door than a page.

**5.5.4 Transport — SETTLED in REVISION 3, and it is not the auctions relay.** Ruling §5 answers the question
REVISION 2 left as a choice between "the app accepts the event directly" and "a write-restricted app relay". The
answer is the second one, with a POST surface: **the app's own internal relay accepts signed events, and its POST
endpoint is the ingest path.** §5.6 states the two relays and their roles; §5.6.3 states where the endpoint lives
and what the choice costs.

**What this means for the existing publish path, restated for the new owner of the endpoint:** `publishStorefrontPage`
publishes **only** to relays today (`platform/web/storefront/storefrontPublish.ts:81-99`, failing closed on zero
ACKs). Publishing a page to the auctions relay or to a public relay does **not** put it in the page store, so the
CMS must reach the app's ingest endpoint or the page is published and never served. That is a client change, it
belongs with increment 3, and it is the one place where "local-first" costs a modification to a working path.

---

### 5.6 Two relays, two roles — settled, never conflated

`ruling-pages-widgets-and-app-relay.md:65-81`, binding. The owner answered both open relay questions at once:

> "Auctions relay is not the app relay — the auctions relay (the one we're running locally) is a test placeholder
> relay for the real public relays. What we're talking about here is a relay purely for internal app use, with
> potential exposure to the outside world but with strict limitations and ACL/data management, serving purely
> internal app purposes and potentially a 'POST'-like endpoint for nostr signed events related to the app
> functionality."

#### 5.6.1 The auctions relay is a **test placeholder for the real public relays**

**Measured, what it is today:** one khatru application deployed from this repo (`khatru.NewRelay()` at
`deploy-simple/relay/cmd/market-relay/main.go:63`), whose write policy is kind-and-shape validation only —
`policies.SeqEvent(policies.ValidateKind, policies.RejectEventsWithBase64Media, policies.RejectUnprefixedNostrReferences)`
at `:84-87` and `policies.SeqRequest(policies.NoComplexFilters)` at `:89` — so **any pubkey may write** **[S]**. Its
HTTP surface is khatru's router plus `/healthz` (`:92-96`) behind one `http.Server` (`:98-106`): **event ingest is
WebSocket-only, and there is no POST event endpoint anywhere in it** **[S]**.

**What it is for, and what that forbids.** It stands in for the real public relays in development and staging: the
app's single relay setting points at it locally (`APP_RELAY_URL=ws://localhost:10547`, `.env.dev.example:2` →
`platform/server/runtime.ts:19`) and at the real public relay in production
(`APP_RELAY_URL=wss://relay.plebeian.market`, `deploy-simple/env/.env.production.example:14`). Therefore:

- It is **not** the app's relay, and a page must never be written to it *as the app's store of record*.
- A behaviour tested only against it is a behaviour tested against a **placeholder** — that is legitimate for the
  marketplace's public data (products, orders, the auctions protocol) and **not** evidence about the real public
  relays' policies.
- Its **absence** of an author allowlist says nothing about the app relay's ACL, which is new and separate. REVISION
  2's reading of `main.go:84-87` ("so the write restriction is new code") remains true and is now scoped: it is new
  code **in the app relay**, not a change to this one.

#### 5.6.2 The app's relay is **purely internal**

Binding properties, from the ruling:

| property | consequence for this architecture |
|---|---|
| **purely internal**, serving app purposes | it is not a marketplace relay and nothing at the marketplace's public addresses depends on it |
| **strict limitations + ACL** | the allowlist is §7.1's level lookup on the event's pubkey, applied at the endpoint, not in a relay policy file |
| **data management** | it owns retention/compaction of **app events**, which is why it may hold the signed event beside the projection rather than instead of it |
| **may be exposed to the outside world, with those constraints** | exposure is an **option**, never a requirement; if taken, the ACL travels with it |
| **a POST-like endpoint for signed app events** | that endpoint **is** the ingest path (§5.5.3, §5.6.3) |

**Measured: no such relay exists today.** The app has exactly **one** relay pointer (`export const RELAY_URL =
process.env.APP_RELAY_URL`, `platform/server/runtime.ts:19`) and one relay deployment, the placeholder in §5.6.1.
So the app relay is **new deployment surface** — new process (or new endpoint), new ACL, new backup story — and the
plan prices it rather than assuming it.

**A configuration trap worth naming now.** The split requires a **second, distinctly named** setting (an ingest
endpoint URL or an app-relay URL). Pointing `APP_RELAY_URL` at the app relay — or reusing it for both roles — would
recreate the conflation this section exists to forbid, and it would silently move the marketplace's public data
onto an internal ACL'd relay. `runtime.ts:19` must not be reused for this.

#### 5.6.3 Where the endpoint lives — **the role is the ruling, the topology is OUR CHOICE**

Two ways to honour "the app's internal relay has a POST ingest endpoint". Both satisfy the ruling; they differ in
cost, and the choice is labelled as ours:

| | (A) **in the app server process** — the Bun server implements the POST surface, and the page store and routing file are written **in the same request** | (B) **a separate internal relay process** — a relay with an HTTP event-POST handler stores the event, and the app server **projects** it by subscription |
|---|---|---|
| write transaction | one, synchronous: validate → project → `writeAtomic` | two: relay write, then a projection triggered asynchronously |
| availability | the write path needs the app server only | the write path needs **both** processes up; a relay outage means "published but not served" |
| lag | none | a projection lag, so a publish-then-fetch test is flaky by design |
| "data management" by the relay | the relay *role* is played by the server; retention is the store's | genuinely a relay's data management, which is closest to the ruling's words |
| new process to deploy/back up | none | one |

**OUR CHOICE: (A) for everything in this plan.** Reasons, all of them about the property this run is protecting:
one write, one transaction, no lag, and no second process on the path a publish takes. It also keeps §5.5.3's
single evaluate-the-actor-once rule literally true. **(B) stays compatible** because the *contract* is the same —
one signed event, POSTed, allowlisted by pubkey, ACKed or refused — so moving the surface into a separate relay
later is a deployment change, not a redesign. What would force (B) is the owner wanting the relay independently
reachable by other app instances; the ruling explicitly makes exposure optional, so nothing here requires it.

**Where this sits against REVISION 2's option table.** REVISION 2's option (i) — "the app accepts the signed event
directly … no relay dependency at all" — is (A) under a different description, and its *mechanism* was right. What
it got wrong was **whose endpoint it is**: under the ruling it is the app relay's POST surface, not a standalone
REST API that happens to accept events. Naming it correctly matters, because the relay role carries the ACL and
data-management obligations, and a bare `/api/…` handler does not.

#### 5.6.4 What the split does **not** touch

- **Reads.** Zero relay reads on the resolve path and zero on the serve path (§2, §5.5). Both relays are absent
  from every read.
- **The routing table.** Still a file (§4), still not an event, still not in either relay.
- **Public publication.** Mirroring a stored page to a public relay remains unbuilt (§11) and is not part of this
  run.

---

### 5.7 The widget layer — **DEFERRED** (REVISION 4), recorded so the door is not silently closed

> **STATUS: DEFERRED — not built by any increment in this plan.**
> `ruling-react-components-and-deferred-widgets.md` (2026-11-13) rules that page composition **stays on React
> components and the CMS's existing block definitions**, *"to avoid script binding and widget compiling"*. Everything
> in §5.7.1–§5.7.5 is therefore the **design of record for a layer that is not being built now**: it is why the
> deferral is a choice rather than an omission, what the layer would cost if it is ever required, and the invariant it
> would have to respect. **The consequence, restated from the ruling's own words:** *"A third party cannot ship a page
> into the instance without the instance building their block. The page-composition vocabulary is ours"*
> (`:60-65`). Nothing below contradicts §5.5.2's current model (React components, a placeholder, the existing slot map)
> — §5.5.2 is what is built; §5.7 is what is deferred.

**The ruling this text was written to** (`ruling-pages-widgets-and-app-relay.md:27-44`) remains on the record as the
thing the layer would satisfy:

> "For sure page publishing should not be source code (can link a git repo) but web components focused, renderable
> directly in the browser using script imports for widget libraries."

#### 5.7.1 What a page is, and four things it is not

A **page definition** is data (§3.1). Ruling §3 constrained it in four ways, and the fourth is the one that decided the
whole design. **REVISION 4: items 1–3 describe the build; item 4 is the deferred half.**

1. **It must not contain or inline source.** No script, no JSX, no inline HTML. **Still true, and unaffected** — the
   document is the same closed union (§5.5).
2. **It must not contain a copy of a block.** A block is referenced by its `type`, never embedded. **Still true.**
3. **It may link a git repo** — the place a *deferred* widget or sub-app would be built from — **as a link**. Measured
   toehold: the document's `safeHref` already allows `https://` URLs inside a `LinkList` block
   (`sdk/commerce/storefront/storefrontPage.ts:103`, `isSafeHref` at `:70-97`), so a repo link needs no new mechanism
   and no new field. The server **never fetches it**, at ingest or at serve. **Still true of a link**; what is deferred
   is any reading of it as *delivery* (§R4.5).
4. **(DEFERRED)** *It must be renderable directly in the browser, with widget libraries pulled in by **script
   imports**.* This is the clause the owner set aside, and it is the only one in §5.7.1 that is not built.

#### 5.7.2 The collision this layer walks into, and the resolution — *(deferred, and still the correct resolution if built)*

`storefrontPage.ts:10-22` states the invariant that currently makes page documents safe, in as many words:

> "Rather than sanitising attacker-controlled markup, the document is *structured data*: an ordered list of blocks
> drawn from a closed union … There is **no raw-HTML path, no remote script or stylesheet**, and no `src`/`href`
> that is not either `https:` or an in-app absolute path. That constraint is load-bearing and must not be relaxed
> for convenience: this app holds wallet material, so a single `dangerouslySetInnerHTML` here would be an
> account-draining XSS rather than a defacement."

A page that names a widget **by URL** is exactly "a remote script". So the resolution is not negotiable, and it is
also not a limitation on the owner's model — it is the same move the closed block union already makes, one level up:

**A page names a widget by registry id. It never names a URL.**

```
WIDGET REGISTRY (instance-owned, built into the deploy artefact)
  id            stable string the page document may reference          e.g. 'product-grid'
  element       the custom element name the bundle defines             e.g. 'ar-product-grid'
  bundle        instance-owned static asset path, content-hashed       e.g. /widgets/product-grid-<hash>.js
  propsSchema   the schema the widget validates its own props against  (for built-ins: the existing block schema)
```

Consequences, stated as consequences:

- **Adding a widget would be a deploy, not a publish.** The allowlist is the instance's, so a page could only reach
  code the operator shipped. This is *why* the owner's "link a git repo" is a **link**: the repo is provenance a reader
  can follow, not an input the server loads.
- **If built, ingest would refuse an unknown widget id**, so a stored page would be a page whose widgets exist. **Not
  built** — REVISION 4 removed that refusal from §5.5.3, because with the layer deferred there is no id to resolve.
- **The registry is not the "manifest" §3.1 refuses** — it maps ids to code, never to paths.
- **The id-and-props encoding is OUR CHOICE.** The ruling says "script imports for widget libraries"; it does not
  say how a document names one. This encoding is chosen because it is the only one that keeps §5.7.2's invariant.

**One thing the ruling implies that this document cannot settle, so it is recorded rather than answered (§10 O-8):**
if widget code may come from a repo someone else built, *who reviews and admits it to the registry* is a process
question. The architecture gives it a place to happen (the registry, at build time) and no policy for it. That is
the honest state, and it is the one place where "links a git repo" could quietly become "loads code from a repo"
if the registry is ever populated from the document instead of from the build.

#### 5.7.3 How it would render — **DEFERRED**; this is not what the build emits

```
pageStore holds:   document + static fragment + meta + the widget ids the document references
                   ← a deferred build would re-add that id list, which §5.5 removed
pageHtml emits:    <head> meta
                   the React-rendered static fragment
                   <ar-product-grid data-widget="product-grid">  ← SSR'd fallback children (the empty state)
                   …
                   <script type="module" src="/widgets/product-grid-<hash>.js" defer>   ← one per referenced widget
                   the SPA shell bundle + #__AR_PAGE__
```

- **The mount element and its fallback are server-rendered**, so a client that fails to load a bundle still sees the
  page minus that region, and a crawler still sees the static content (§5.5.2's honest boundary).
- **The element upgrades in place.** `customElements.define` upgrades elements already in the DOM, so the page's
  static DOM is never touched and the mount element is never re-created. The widget takes over **its own children**
  when it mounts; if the bundle never loads, they stay — which is what makes the SSR'd content a real fallback
  rather than a placeholder. The "hydrate the same DOM, never re-render it" rule the shell follows therefore holds
  one level down too, and it is why §5.5's `#__AR_PAGE__` seam does not change.
- **The widget fetches its own live data in the browser**, after upgrade. It receives its props from the page
  document and its author context from `#__AR_PAGE__`, and nothing else.
- **The store never holds code.** Content is in the page store; code is in the deploy artefact; the registry id is
  the only link between them, and it is one-directional — the store cannot add a widget by existing.

**Scope of the change, so it is not overbuilt.** The five dynamic block types are the widget layer's first five
widgets, and their documents already reference them by `type` (`storefrontPage.ts:293-306`). So the **block union
does not change** for them: only what resolves the reference — the registry and a custom-element bundle, instead of
`StorefrontDataSlots` (`ui/storefront/StorefrontRenderer.tsx:50`) and the React map in
`platform/web/storefront/StorefrontBlockSlots.tsx`. A generic `Widget` block for widgets that are not built in is
the **extension point**, added when the first such widget exists, not now — **OUR CHOICE**, and it keeps this build
from inventing a plugin protocol.

#### 5.7.4 What is new machinery, measured — **this table is the reason for the deferral**

| piece | state today | what the layer adds |
|---|---|---|
| custom elements | **0** occurrences of `customElements` / `extends HTMLElement` / `attachShadow` in the tree **[M]** | every widget; a client upgrade path |
| per-widget bundles | **none**. `build.ts:138-140` takes entrypoints from `src/**.html` and there are **0** such files **[M]**, so `bun run build` emits no bundle; production serves Bun's HTMLBundle from `platform/web/app/index.html` (`import index from './index.html'` at `platform/web/app/entry.tsx:10`, consumed at `:27`) | a widget build producing one ESM bundle per widget, content-hashed, plus a static mount |
| remote/dynamic script loading | **none** in app code — no `<script src="https://…">`, no `import('https://…')`, no import map **[M]** | nothing: by §5.7.2 the bundles are instance-owned, so this stays zero by design |
| component SSR | `renderToStaticMarkup` in **102** files, **all of them tests** — 94 under `ui/`, 8 under `platform/`, **0** non-test **[M]** | reuse only: it proves `ui/` components render without a DOM, which is what `pageRender.ts` needs. It is a *test* convention, not a production render path |

So: the widget layer is **new machinery** on three axes (elements, bundles, registry) and **reuses** the SSR
convention on a fourth. It must be priced as new work, not as a re-wiring of `StorefrontDataSlots`.

#### 5.7.5 What the deferral leaves true

The page document stays a **closed union** validated at ingest; the renderer stays React for everything the page
carries; the client still hydrates rather than re-renders; and **no page can introduce code**. What the deferral
removes is one object: a mount point whose filler would be a bundle the operator shipped. With it gone, the page's
dynamic regions are filled by the app's **own** components — which is the model the CMS already uses
(`platform/web/storefront/storefrontCms.tsx:46` renders every editor block through the same
`StorefrontBlockView`) **[S]**.

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

## 7. The ACL — four levels, keyed on the signing pubkey, enforced server-side

`ruling-local-pages-acl-and-legacy-routes.md:39-62`, binding, and it **supersedes `ruling-acl.md`'s three tiers for
authority**. The owner's words: *"ACL is simple: tiered access by nostr public key … the current model of
app -> admin/owner -> editor -> no acl is fine … The write should be a nostr signed event."*

| level | who | what it means operationally |
|---|---|---|
| **`app`** | the instance's own key | the instance acting on itself: bootstrapping, migrations, the default route, writing a page it authors. Above admin, because admin is *a person* and `app` is *the system* |
| **`admin` / owner** | pubkeys in the admin list | full control of the app and its pages: any operation on any binding or target, including one held by an editor or a leaseholder. **Also the level that authors the default route** (`ruling-acl.md:15-16`) |
| **`editor`** | pubkeys in the editor list | publishes pages to **free** top-level paths self-service; retargeting or touching an *existing* binding requires a **grant naming that path**. Not a role-derived blanket right |
| **no ACL** | everyone else | nothing on the write side. Reads are unaffected: the site is public |

**The credential is a signed Nostr event, and the level is a lookup on its pubkey.** That is the whole actor
question, and it is **CLOSED** (O-1, §10): **NIP-98 is not needed**. The existing WebSocket path is the template —
`platform/server/websocket.ts:30` verifies the client's own signature, then
`platform/server/EventHandler.ts:238` re-signs. What changes is only what is *carried*: an intent, not tags.

**Measured, the four levels are already half-built.** `platform/server/EventValidator.ts:53` encodes
`app ∨ admin` (`event.pubkey !== appPubkey && !adminManager.isAdmin(...)`), `:75` encodes `admin ∨ editor`, and
`:86` encodes admin-only for the `general` branch **[S]**. The tier sets themselves are the existing managers —
`platform/server/AdminManager.ts:5` `Set<string>`, `platform/server/EditorManager.ts` the same shape, seeded from
`adminPubkeys: []` at boot (`platform/server/startup.ts:71`) and rebuilt from kind-30000 `d='admins'` / `d='editors'`
(`platform/server/EventHandler.ts:249-259`) **[S]**. So this is a **widening of an existing predicate**, not a new
authority system.

**A lease is NOT a level — and this is the distinction the old text got wrong.** `ruling-acl.md` listed
premium/paid as a third *tier*; ruling 2 removes it from the ladder in as many words: a lease grants a **path**, a
level grants **authority**, and *"a person may hold both, either, or neither"*
(`ruling-local-pages-acl-and-legacy-routes.md:61-62`). Operationally:

- authority is answered by `may(actor, op, …)` from the three ordered levels above;
- a lease is answered by the **binding's `holder` field** and its term, per path (§3.2, §3.4);
- an editor who buys a lease is an editor (authority) *and* a leaseholder (path). Nothing composes them, and
  nothing needs to.

### 7.1 Enforcement and the decision function

**The server is the enforcement point** (`ruling-resolution-and-signed-ledger.md:48-54`). The write path is
`apply()` (§4.5); authorization is a pure function evaluated **inside** the mutation, against the **current
file**, never against anything the caller sent:

```
may(actor, op, path, file) → Allowed(warnings[]) | Denied(reason)

  level(actor) = 'app'    if actor === getAppPublicKey()        ← the instance itself
               | 'admin'  if AdminManager.isAdmin(actor)
               | 'editor' if EditorManager.isEditor(actor)
               | 'none'   otherwise          ← looked up BY PUBKEY, never taken from the request

  reserved(path) AND NOT compiledIn(path)   → Denied('app-owned-name')     every level, app included
  level === 'app'                           → Allowed                     (bootstrap, migrations, default route)
  level === 'admin'                         → Allowed                     (any op, any binding, any target)
  level === 'editor'
     compiledIn(path)                        → Denied('compiled-in-needs-admin')
     op ∈ {create, publishPageToPath} and path is FREE
        and granted(actor, path)             → Allowed
     op ∈ {retarget, release} and granted(actor, path)
        and target.author === actor          → Allowed
     otherwise                               → Denied('no-grant')         ← a VISIBLE refusal
  op ∈ {reserve, renew} and path is FREE and path is top-level
     and payment settled for (actor, path)   → Allowed                     ← this is a LEASE, not a level
  level === 'none'                          → Denied('no-acl')
  otherwise                                 → Denied(<reason naming the holder's level>)

  on every Allowed: if compiledIn(path) → warnings += 'compiled-in-path'  ← ruling 3: warn, never refuse
```

- **`compiledIn(path)` moved from the refusal set to the warning set.** REVISION 2, ruling 3: binding
  `/dashboard` is legal. The response carries `warning: 'compiled-in-path'` so the management surface can say
  "this path is a compiled-in route; your binding supersedes it" — informative, not blocking.
- **`reserved` had to be split, and this is an inference, not a ruling.** Seven of the eight compiled-in
  segments are *also* in the 37-name reserved list (`dashboard`, `products`, `checkout`, `setup`, `community`,
  `posts`, `nostr` — measured §8.3), so "reserved refuses everyone" and "compiled-in paths are re-pointable"
  cannot both hold. The reading adopted: **`RESERVED \ COMPILED_IN` refuses everyone; `COMPILED_IN` refuses
  editor and lease but allows `app` and `admin`, with the warning.** It follows from "admin has full control over
  the app and its pages" (`ruling-acl.md:13-16`) plus "legacy routes must be superseded"
  (`ruling-local-pages-acl-and-legacy-routes.md:78-80`). **This is OUR CHOICE and the owner can overturn it by
  saying an editor may take a compiled-in path.**

- **`grants` live in the file.** The ruling makes grants data, not a role: `"grants": { "<editor>": ["featured-*", "about"] }`.
  A `*` is a **suffix wildcard on a literal prefix**, matched in code — never as a regex or SQL pattern, so a
  name containing `%` cannot become a wildcard.
- **Levels are read from the existing managers**, which is where they already are: `AdminManagerImpl`/`EditorManagerImpl`
  are `Set`s rebuilt from kind-30000 `d='admins'`/`d='editors'` (`platform/server/AdminManager.ts:5-20`,
  `EditorManager.ts` **[S]**; seeded from `adminPubkeys: []` at boot, `platform/server/startup.ts:71`). They are
  consulted at decision time as "an admin *now*", never copied into the routing file. `app` is not a set at all:
  it is `getAppPublicKey()`, the key the instance already holds (`platform/server/runtime.ts`).
- **The actor is established once, at the edge, and cannot be asserted.** `actor = event.pubkey` after
  `verifyEvent` (§5.5.3 step 1); every other field the caller sent is ignored. **A signed intent older than a
  freshness window is refused** — replay protection is required precisely because there is no session, and this
  is **OUR CHOICE** (the ruling does not name a window); the window belongs on the intent event's `created_at`,
  checked for the same reason `ogMeta.ts` rejects a relay answer that is not the event it asked for.
- **A page write and a route write are the same write.** REVISION 3: they arrive at **one** endpoint and are
  dispatched by kind (§5.5.3, §5.6.3), so the actor is established once and `may()` sees exactly one idea of who is
  calling. If a second write surface ever appears, one of them is wrong.
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
| N2 | lease requested on a path held by an admin binding or an in-term lease | `Denied` naming what holds it — and **no invoice is issued** |
| N3 | a lease past its term is requested | **404** from the router. The holder was warned before the term (§7.4) |
| N4 | a lease is terminated by the provider | **404**, immediately, server-enforced |
| N5 | admin reassigns a route held by an editor or a paying user | takes effect, and the displaced holder sees the revocation with actor and reason on their own list |
| N6 | the default binding's page is unrenderable | `/` renders the inline composition; the state is reported, never blanked |
| N7 | a binding's target page is absent / switched off / zero blocks / unparseable | the ladder resolved; the page surface says **"item unavailable"** — never "route not found" |
| N8 | the routing file is unreadable | the server refuses to boot (§4.4); `/api/healthz` reports it |
| N9 | two admin bindings on one path in the file | refused at load, every violation printed |
| N10 | a lease on a subpath | refused by the validator |
| N11 | a lease on a free top-level path while an ancestor is leased | refused (`'held-by-ancestor'`) |
| N12 | **an admin binds a compiled-in path** (`/dashboard`) | **accepted**, `Allowed` with `warnings: ['compiled-in-path']`; `/dashboard` then serves the bound page and the compiled route is not served in parallel (§5.2, §5.4) |
| N13 | a page publish arrives with a bad signature | `Denied('bad-signature')`; nothing written (§5.5.3 step 1) |
| N14 | a page publish arrives from a `none`-level pubkey, or for a kind outside the allowlist | `Denied('no-acl')` / `Denied('kind-not-allowed')`; nothing written |
| N15 | a page publish carries an invalid block | `Denied('invalid-page: <path>')` — refused, **not** stored with the block dropped |

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
**Precedence between a compiled-in prefix and a table-declared one is therefore a real question**, and REVISION 2
answers it the other way round from the original text: **a table-declared prefix wins** when it is more specific,
because the routing tree supersedes the compiled-in tree (§5.4). The validator **warns** on a declared pattern
that shadows a compiled-in prefix (`compiled-in-path`), instead of refusing it. The compiled-in prefixes
(`/profile/:profileId`, `/products/:productId`, `/posts/:postId`, `/auctions/:auctionId`,
`/collection/:collectionId`) stay exactly as they are until someone binds over them.

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

**What the reserved list becomes, under the ruling — REVISION 2 splits it in three:**

| set | meaning | enforced where |
|---|---|---|
| **RESERVED \ COMPILED_IN** (the 37 minus the 7 that collide) | names not yet handed out, plus the server URL space; a binding on one is refused | file validator, at load and at write, for every level |
| **COMPILED_IN** (the 8, derived) | names the app's own router serves **by default**; a binding on one is **allowed** with a warning for `app`/`admin`, refused for editor/lease (§7.1) | file validator (warning), generated artefact, a drift test |
| everything else | handable to an editor or a leaseholder | — |

**Consequences, all three changed by ruling 3:**

1. **The refusal set is `RESERVED \ COMPILED_IN`, not the union.** The old text made
   `RESERVED ∪ COMPILED_IN` the refusal set and celebrated it as closing the `auctions` hole. **That celebration
   was wrong for the new ruling.** `auctions` being bindable is now *the intended behaviour* — an admin may
   re-point `/auctions`, and the binding supersedes the compiled route (§5.4). What still matters is that an
   **editor** cannot take it without an admin's decision, which the `compiled-in-needs-admin` branch gives.
2. **`auctions` is still the interesting name, for a different reason.** It is one of the two top-level segments
   *not* in the 37 (`static − reserved → {auctions, new}` **[M]**), so it is compiled-in but not reserved. Under
   the split above it is governed by the `COMPILED_IN` row — allowed with a warning — which is now the *same*
   treatment as `dashboard`. The asymmetry the review found is gone because it stopped being an asymmetry that
   matters: derivation from `routeTree.gen.ts` still supplies the set, and nothing is refused for being
   compiled-in.
3. **A *new* compiled-in segment appearing later must not break the site.** This reverses the old "refuse and do
   not boot". If a future release compiles a top-level route whose name a binding already holds, the file loads
   and **warns** (`compiled-in-path`), the binding keeps winning, and the management surface reports the collision
   before deploy. **Grandfather-and-warn is now the behaviour, by ruling** — `designs/C-ownership-domain.md:674`
   was right and the previous text ("OUR CHOICE: refuse") is withdrawn. A warning that does not affect serving is
   the only option consistent with "legacy routes are re-pointable": refusing would make the site unbootable for
   doing exactly what the owner asked for.

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
| `:466-478` §6.2 | `may(actor, op, name, target)` with `name ∈ RESERVED ∪ STATIC_SEGMENTS → NO` | **survives in shape, superseded in both encoding and policy**: the set is split into `RESERVED \ COMPILED_IN` (refuse) and `COMPILED_IN` (allow with a warning) at §8.3; the op table is kept, the SQL is gone |
| `:357-382` §5.1 | purchase via **NIP-98 (kind 27235)** for `quote`/`settle`/`mine` | **REJECTED by ruling 2**, and for a better reason than "no precedent": the credential is already a **signed Nostr event** and the level is a pubkey lookup (`ruling-local-pages-acl-and-legacy-routes.md:50-53`), so NIP-98 adds a second auth protocol to express what one signature already expresses. Zero precedent remains true (`git grep -n '27235\|NIP-98' -- platform/ sdk/ docs/ | wc -l` → 0 **[M]**) but is now corroboration, not the argument |
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
| `:248-265` §2.4 | `can(actor, op, subject, ctx)` with **no statement of how the server learns the actor** (`review-adversarial.json` records 0 hits for `NIP-98\|27235\|authent\|session\|cookie`) | **ACCEPTED as a shape, and the omission is now closed**: ruling 2 settles the actor as **the signing pubkey of a signed event**, so `actor` comes in as `event.pubkey` after `verifyEvent` (§7.1, `platform/server/websocket.ts:30`) |
| `:138` §2.1, `:161` | "Sub-paths (`/name/sub`) do not exist and are not designed here" | **Superseded by `ruling-resolution-and-signed-ledger.md:31-33`** ("Subpaths are in scope") and `ruling-simple-routing-file.md:37-54` (a lease carries its subpaths) |
| `:359-366` §3.1 | occupancy materialised + a **bounded background reap every 60 s** | **superseded**: liveness is derived; nothing needs a reap for correctness (§7.4). Hygiene, if ever needed, is not part of this architecture |
| `:623-629` §9 | increment 1 = domain + store, "wired to nothing", with a read-only `reconcile` | **superseded in content**: it is a good *shape* for a first increment and the minimality is preserved — but the smallest thing that proves **this** architecture end to end is different (§IMPLEMENTATION-PLAN §1) |
| `:674` §11.2 | a new top-level route may **retroactively invalidate** a live lease; rule should be **"grandfather, and warn"** | **ADOPTED by REVISION 2** (§8.3 consequence 3). The previous text refused the file and refused to boot; ruling 3 makes compiled-in paths re-pointable, so a refusal would make the site unbootable for doing the intended thing. **This row is now a carried-forward design, not a superseded one** |
| `:686-690` §11.4 | "no candidate should ship a routes ledger while the purchase path prices leases from a client-asserted amount" | **ADOPTED as a constraint on the plan**: any *paid* lease waits for the verification fix (§10, risk R-1) |
| `:676-680` §11.3 | R3 cannot be separated from the transport: "newest" is an author-asserted timestamp | **ADOPTED and recorded** in §5.3 as an accepted limit |

**C's parts that survive**: the tiers as **entitlements over a resource**, not classes of writer over an
event kind (`:128`, `:248-265`) — that is §7, now with four levels instead of three and with the lease kept
strictly *outside* the ladder (`ruling-local-pages-acl-and-legacy-routes.md:61-62`); `Delegation` as a *separate*
aggregate from ownership (`:185-195`), which is §7's `grants` map; `Assurance` as a type that does not collapse
payment states into a boolean (`:163`,
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
| `:161` X3, `:165` | adopt **NIP-98** from B to close C's missing actor | **SETTLED AGAINST by ruling 2**, and the question changes shape: the actor is a signing pubkey (`ruling-local-pages-acl-and-legacy-routes.md:50-53`), so no second auth protocol is introduced. §10 O-1 is closed, not deferred |
| `:104-123` C8, ADR-0006 | ADR-0006:211-215 asks for a signing proof "any client can verify" and this makes B's bet untenable | **reconciled, and its weight changes**: the owner's ruling (`ruling-app-authority-and-portable-leases.md:23-24,50-53`) makes publishing "relatively unimportant" for routing. So ADR-0006's requirement now binds the **deferred ledger** (§11), not the read path. The adjudication was not wrong about the doctrine; the doctrine was narrowed by the owner |
| `:7` what it could not do | "the typecheck baseline 205 is `[U]` for me" | **still `[U]`, and now quantified**: the same command on this **dirty** checkout reports **401**, of which **241 are in non-app files** (94 `runs/`, 72 `notes/`, 72 `node_modules/*.d.ts`, 30 `src/` **[M]**). Neither number is a baseline; the plan re-derives it per branch |

The adjudication's **measured findings** (C1–C7) all stand and are cited in this document where they matter:
C1 (no server-side storage), C5 (30024 addressable), C6 (the clobber's mechanism), C7 (the namespace overlaps and
`auctions` is unprotected).

---

## 10. What is NOT settled, with a lean and its cost

Nothing below is a ruling; nothing below is presented as one. The plan is shaped so that **only R-1 blocks a
release**, and only increments 6+ depend on the rest.

**REVISION 2 changed the list.** O-1 is **CLOSED**. The two questions the new ruling opens that touch this
document are recorded as O-6 and O-7 at the end of this section, with leans and no ruling.

### O-1 · Who does the server think you are? (the ACL's actor) — **CLOSED**

**Status: closed by `ruling-local-pages-acl-and-legacy-routes.md:39-62`.** The text below is kept as the record of
why it was open, because the reasoning is the reason the answer is what it is.

What was open: the rulings made the server the enforcement point
(`ruling-resolution-and-signed-ledger.md:48-54`) and defined the tiers (`ruling-acl.md:5-24`) — but never said how
an incoming write proves *which tier* the caller holds. Without that, §7.1's `may(actor, …)` had no `actor`,
which was C's largest omission (`review-adversarial.json`, C §"unsupported claims").

**What closed it:** the owner ruled that the write *is* a signed Nostr event and the tier is a lookup by its
pubkey — *"tiered access by nostr public key"* — with the transport deliberately left open. Consequences, all
now built into §7.1 rather than proposed: `actor = event.pubkey` after `verifyEvent`; **no NIP-98**; the existing
WS submit path (`platform/server/websocket.ts:30` → `platform/server/EventHandler.ts:238`) is the template; and
the payload is an **intent**, not a tag list, so the server still composes every field.

The repo has exactly one authenticated write path today, and it is measured:

- the client signs its own event and sends it over a WebSocket (`platform/server/websocket.ts:20-33`, `verifyEvent` at `:30`);
- the server validates *who* that pubkey is (`platform/server/EventValidator.ts:74-93`) and then **re-signs it as
  the app key** (`platform/server/EventHandler.ts:238` → `platform/server/EventSigner.ts:16-26`, which copies
  `tags` and `created_at` verbatim **[S]**).

That path works for admin and editor (both are pubkeys the server already holds in `AdminManager`/`EditorManager`)
and is **wrong as an enforcement point for paths**, because the client composes the tags the server then
rubber-stamps (`designs/COMPARISON.md:161`, F5).

**The lean that was adopted, now confirmed by the ruling:** keep the signed submit channel as the **transport**,
but make it carry an *intent*, not tags — the same discipline `ruling-resolution-and-signed-ledger.md:18-20`
requires (the server builds the record). The client's signature establishes `actor`; the server decides every
field. NIP-98 (`designs/B-server-authoritative.md:370-382`) would do the same job with a standardised proof, at
the cost of machinery with zero precedent (`git grep '27235\|NIP-98' -- platform/ sdk/ docs/ | wc -l` → 0 **[M]**)
— and ruling 2's answer makes it unnecessary rather than merely unattractive.

**The cost is unchanged and still real**: the channel's *current* semantics are "re-sign what you send", so the
change is a **removal** of the generic `general` branch for route and page intents
(`platform/server/EventValidator.ts:85-93`) — behaviour-changing for anything else that uses it. Plus the replay
window noted in §7.1, which the ruling does not specify and the plan must pick. **This is now increment 4's
work, not a blocker on it.**

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

### O-6 · Does the app run its own relay, and is it the one the auctions use? — **CLOSED**

**Status: closed by `ruling-pages-widgets-and-app-relay.md:65-81`.** Kept as the record of why it was open. The text
below is REVISION 2's, and **its closing claim is withdrawn**: "the app's page ingest does not need a relay at all"
is now false — the ingest path **is** the app relay's POST endpoint (§5.6). What the ruling settles, in three lines:
the auctions relay is a **test placeholder for the real public relays**; the app's relay is **purely internal**
(strict limitations, ACL, data management, optionally exposed with those constraints); and its **POST-like endpoint
for signed app events is the app's write/ingest path**. §5.6 carries the consequences, §5.6.3 the topology choice.

`ruling-local-pages-acl-and-legacy-routes.md:102-105` — the owner's private-use model "implies a store with a
write allowlist", and he offers two shapes: one instance serving both the public auctions role and the private
app role, or two roles kept separate.

**Measured state:** one khatru relay, deployed from this repo (`deploy-simple/relay/cmd/market-relay/main.go`),
with **no author filter** (`:84-87`) and `RELAY_SUPPORTED_NIPS="1,11,50"`
(`deploy-simple/relay/config/production.env:12`). Its own ops doc documents a memory-pressure failure mode —
*"refusing connection: emergency mode active … under memory pressure"* (`deploy-simple/RELAY_DEPLOY.md:212-216`)
**[S]**. That is the closest thing in the tree to the symptom the owner named, and it is a *documented ops
symptom*, not a measurement of OOM under write load — **[U]** on the causal claim.

**Lean: separate roles.** Do not make the public/auctions relay the app's private store; the symptom he named is
an argument against mixing them, and the cost is one more process. **Cost of the lean:** two things to deploy,
monitor and back up. **Cost of the alternative (one relay, two filters):** a single failure domain where a public
write flood degrades page serving — the exact coupling ruling 1 exists to break.

**But note what REVISION 2 removed from the question:** under §5.5.4's option (i), the app's page ingest did not
need a relay at all, so this looked like deployment hygiene rather than correctness. **REVISION 3 reverses that
reading and that is why the item is closed rather than merely leaned.** The ingest path is now the app relay's own
POST endpoint, so the relay is on the **write** path by construction — and whether the auctions relay may double as
it is no longer a question, because the ruling says it may not: it is a placeholder for the public relays (§5.6.1).

### O-7 · How modular is "modular"? *(new, ruling 1's question 4)*

Replaceable regions inside a compiled page (a navbar slot) versus a page shell that mounts a compiled sub-app.
`ruling-local-pages-acl-and-legacy-routes.md:111-114` leans **a shell with named slots the sub-app owns
internally**.

**This document adopts that lean as the direction, and nothing more.** §5.5.2 already produces one kind of region for a
different reason (the placeholder a data-bound block renders into), so the vocabulary exists without a slot system.
But the ruling's own sequencing is explicit — re-pointing is routing (**this run**), modular contents are the **next**
step — so **no increment here builds a slot system**, and increment 1 must not grow one. The only thing this run owes
the next step is that re-pointing does not *preclude* it, which §5.2's one-guard seam already guarantees.

**REVISION 3 — confirmed and closed as a question.** Ruling §6 settles the depth: *"some basic slots that can be
replaced is good enough to start."* So the requirement is **basic replaceable slots**, not a slot framework, and
this document over-designed nothing by leaving it out. The widget layer (§5.7) is the *other* kind of replaceability
— a page region whose implementation is a separately built bundle — and it is worth distinguishing them once:

| | **slot** (O-7, next step) | **widget** (§5.7, **deferred** — REVISION 4) |
|---|---|---|
| replaces | content *inside* one compiled page | a *region of a published page* |
| who owns it | the page, chosen by the author | the instance, admitted to the registry |
| built when | at build time, with the page | separately, into its own bundle |

### O-8 · Who admits a widget to the registry? *(new in REVISION 3; **DEFERRED with the layer** in REVISION 4)*

> **Status: DEFERRED.** The widget layer is not built (§5.7, §R4.5), so this is not an open question of this build and
> **no increment needs an answer**. It is kept because it is the question that will have to be answered *before* the
> deferred layer is built, and because the failure mode it names is quiet.

The ruling permits a page to **link a git repo** "e.g. where a widget or sub-app is built from". That is a link and
this architecture keeps it a link (§5.7.1), which means **widget code enters the instance only through the registry,
at build time** (§5.7.2). Who reviews that code, and what evidence a widget's repo must carry before it is admitted,
is **a process question the ruling does not answer and this document does not invent**.

**Why it is recorded rather than resolved:** the failure mode is quiet. If the registry is ever populated from a
document field, or from a URL at ingest, the model silently becomes "pages load remote code" — the one thing
`storefrontPage.ts:10-22` says must never happen. So the open item is not "should there be a policy" but "there must
be one before the second widget exists".

**Lean (not a ruling):** a widget is admitted by a **code change to the registry module** (a diff, reviewed like any
other code), never by a runtime registration path. **Cost of the lean:** adding a widget requires a deploy, so a
third-party author cannot self-publish one. **Cost of the alternative** (runtime registration): the page document
becomes a code-loading channel, and the invariant in §5.7.2 goes with it. **Not needed by any increment in this
plan**: increments 1–8 ship zero registry entries beyond the built-ins.

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
REVISION 2 adds one clarification rather than a change: pages are **stored locally** by the app (§5.5) and
mirroring them to a public relay is **not built** — it would be a publication feature, not a serving one, and the
serving path never waits for it.

**REVISION 3 sharpens the vocabulary, because "does not publish to Nostr" was being read as "no relay on the write
side", which is now wrong.** Three distinct things, and the plan uses these words precisely:

| | what it is | in this plan |
|---|---|---|
| **the app's internal relay** | the app-relay role of §5.6.2; accepts signed app events on a POST endpoint; ACL'd | **used** — it *is* the write/ingest path |
| **a public relay** (real, or the local auctions placeholder standing in for it) | the marketplace's public data, and the publication target for announcements | **not written to** by any increment; mirroring a page there is unbuilt |
| **the signed lease-confirmation ledger** | per-lease confirmations published publicly | **deferred** (§11's subject) |

So the sentence "nothing publishes to Nostr" survives, and the sentence "the app has no relay" does not.

---

## 12. Open questions this consolidation could not close

| # | question | why it is open | whether the plan depends on it |
|---|---|---|---|
| Q1 | Is `auctions` supposed to be reassignable? | **ANSWERED by ruling 3 (REVISION 2)**: yes. It is a compiled-in path like the other seven, and a compiled-in path is re-pointable by an admin with a warning (§8.3) | no — it is the intended behaviour |
| Q2 | Does the owner want `/dashboard` itself reroutable, or a path of his choosing? | **ANSWERED by ruling 3**: reroutable, verbatim. The earlier text read the example down to "a path of his choosing"; the ruling says "legacy routes will need to be superceded and re-pointed" | no — increment 4 builds it and must **warn**, not refuse |
| Q3 | Does `#t` work on kind 30024 on this deployment's relay? | **demoted, and no longer blocking**: R3 reads a local index built at ingest (§5.3). Still `[U]`, but only relevant to a backfill of pre-existing pages | no |
| Q4 | The typecheck baseline | **`[U]`** — 205 cannot be reproduced on a clean tree in this run; the dirty checkout reports **401** with **241** of them in non-app files, which is why a per-branch re-baseline is mandatory (`proposal-v2.md:619-621`) | yes, as a gate — the plan requires per-branch numbers and asserts on the sorted error list |
| Q5 | Who signs a self-service reservation (a paid lease)? | `ruling-acl.md:36-42` open; §10 O-5 | yes, for increment 7 only |
| Q6 | Who may re-point a **compiled-in** path — admin only, or editor too? | ruling 3 says legacy routes are re-pointable and does not name the actor; §7.1's split (admin/app yes, editor no) is **OUR INFERENCE** from "admin has full control" | no for 1–8 as written; it becomes real the first time the owner tries an editor on `/dashboard` |
| Q7 | Does the app gain an **SSR tier** for page bodies? | **RE-FRAMED by REVISION 3, and closed in substance.** The question was framed as one choice between render-per-request and render-at-publish. The ruling splits the object instead: the **shell and static content** are React-rendered once at ingest, and the **dynamic content** is never server-rendered at all (§5.5.2, §5.7). What remains is not a *tier* question but the increment-1 renderer, which this document builds | yes for increment 1 — but it no longer decides whether the app gains an SSR tier, because it does not |

---

## 13. The whole architecture on one page

```
                        ┌───────────────────────────────────────────────┐
  request /x  ─────────▶│  URL space: /api/*, /images/* (fixed, matched   │
                        │  by the Bun server before anything else)        │
                        │                         ↓                       │
                        │  the ROUTING FILE, for EVERY path — including   │
                        │  the compiled-in ones (REVISION 2)              │
                        └──────────────────────┬────────────────────────┘
                                               │  in memory, loaded once, boot-refuses-if-bad
                        ┌──────────────────────▼────────────────────────┐
                        │  RUNG 1  exact path, live                     │  admin binding → target
                        │          expired/terminated lease → 404       │  no network call
                        │  RUNG 1b no binding? then a compiled-in page  │  the app's own default
                        │          or prefix answers (warning at write) │
                        │  RUNG 2  programmed prefix (item/:eventId,    │  no network call to ROUTE
                        │          p/:npub, series)                     │
                        │  RUNG 3  404                                  │
                        └──────────────────────┬────────────────────────┘
                                               │ routing decided: (author, d) or prefix+param
                        ┌──────────────────────▼────────────────────────┐
                        │  PAGE STORE  local files at (author, d):       │  NO relay, NO indexer:
                        │  document + rendered fragment + meta          │  instant, indexable, previewable
                        │  static content: React, rendered ONCE at      │
                        │  ingest. Data-bound blocks: a PLACEHOLDER,    │
                        │  filled in the browser by the existing React  │
                        │  slot map AFTER hydration (REVISION 4)        │
                        └───────────────────────────────────────────────┘

  writes:  ONE endpoint — the app relay's event-POST surface (§5.5.3, §5.6.3)
             └─▶ verify sig ──▶ level(pubkey) ∈ {app, admin, editor} ──▶ dispatch on kind
                   ├─ kind 30024 (page)      ──▶ parse ──▶ render ──▶ store
                   └─ kind <route intent>    ──▶ may(actor, op, path, file)
                                                  └─▶ apply(mutation) ──▶ validate ──▶ tmp+rename (.bak)

  RELAYS — two, never one:
    auctions relay  = the LOCAL TEST PLACEHOLDER for the real public relays. Not the app's relay.
    app relay       = purely internal, ACL + data management, optionally exposed. Its POST
                      endpoint IS the write path above. Never read by routing or serving.

  NOTHING in the route path or the serve path touches: a database · a cache · an event store ·
  a relay · an indexer. Nostr is an output mirror, never an input.
```

Five sentences that are the test of any future change:

1. **If it makes a request consult the network to decide which path matched, it is wrong.**
2. **If it makes a request consult the network to render a bound page, it is wrong.** (REVISION 2 — the SEO and
   instant-response requirement.)
3. **If it makes a lapsed lease render something other than 404, it is wrong.**
4. **If it writes the routing file from anything but a full copy of the routing file, it is wrong.**
5. **If it server-renders a page's dynamic content, or lets a page introduce code, it is wrong.** (REVISION 3's reason
   1 of §5.5.2, with REVISION 4's vocabulary: a page references the **CMS's existing block types** and nothing else; it
   cannot name a URL, ship a script, or bring its own renderer. Extending the vocabulary means shipping a React
   component with the app — §R4.5.)