# Report — REVISION 3 of run A (admin-routes)

**Role:** targeted reviser, third pass · **Base:** `/home/admin_maxime/work/market`, `master`, HEAD `76ace8044` ·
**State:** read-only. No source change, no branch, no build, no deploy. **Wrote exactly three files**, all under
`runs/2026-11-13-admin-routes/`:

- `ARCHITECTURE.md` (updated in place: a new `§REVISION 3`, plus §1, §2, §3.1, §5.5.1–5.5.4, new §5.6 and §5.7,
  §7.1, §10 O-6/O-7/new O-8, §11, §12 Q7, §13)
- `IMPLEMENTATION-PLAN.md` (updated in place: a new `§REVISION 3`, §0.3, §1.1, §1.4.2–1.4.3, §1.5, §1.7, §1.8,
  §2, §2.1, §2.2, §4, §5, §8, §9, new §9b, §11 R-4, §12)
- `report-revision-3.md` (this file)

Not touched: any worktree, any source file, `report-revision-2.md`, `report-consolidation.md`, and the sibling run
`runs/2026-11-13-auctions-ui/` (not read, not written). `git status` on the repo was not modified by me.

**Authority used.** `ruling-pages-widgets-and-app-relay.md` (owner, 2026-11-13), binding. It corrects **one layer**
of REVISION 2 — the page's dynamic layer (widgets) and the write path (the app relay's POST endpoint) — and confirms
three items that had been leans. Nothing REVISION 2 established about the **shell** was re-litigated: `pageStore.ts`
/ `pageRender.ts` / `pageHtml.ts`, render-once-and-store, `#__AR_PAGE__`, and hydrate-don't-re-render are preserved
in intent, as ruling §4 asks.

---

## 1. What changed, passage by passage

`ARCHITECTURE.md` §R3.1 lists **12** invalidated passages with the ruling that killed each; `IMPLEMENTATION-PLAN.md`
§REVISION 3 lists **12** edits. Both tables are complete — every row has a rewrite in the body, not only a table
entry. The substantive changes, grouped:

### 1.1 The widget layer replaced React-slot hydration as the model for dynamic regions

- **New `§5.7`** (`ARCHITECTURE.md`): a page is a definition that **references** widgets and **contains no source**;
  a widget is a **custom element delivered as a script-imported bundle**; a page **may link a git repo as a link**
  (measured toehold: `safeHref` already allows `https://` in a `LinkList`, `storefrontPage.ts:103`).
- **`§3.1`** gained two nouns — `WIDGET` and `WIDGET REGISTRY` — and `PAGE` became "the page **definition** that
  references widgets by registry id". A paragraph distinguishes the registry from the "manifest" §3.1 refuses.
- **`§5.5.2`** was rewritten around the split: shell + static content React-rendered **once at ingest**; dynamic
  surfaces **never** server-rendered. The dynamic row of the block table is now "an empty widget mount point".
- **New `§9b` / increment 9** in the plan: bundles, mount points, the five built-in widgets, exit criteria W1–W13.
  Increments 1–8 keep their positions; increment 1's registry seeds the 5 built-ins with `bundle: null`, so the
  increment's behaviour is unchanged and no increment is destabilised.

### 1.2 The two reasons the split exists, recorded next to the design

`§5.5.2` now carries two block-quoted, attributed reasons — SSR fails for dynamic content because a server-rendered
page is a snapshot that can only be kept current by re-rendering everything continuously; and the efficient shape is
compiled JS bundles served as static assets, so rendering cost moves to build/ingest time. Both are restated with
citations to `ruling-pages-widgets-and-app-relay.md:7-9` and `:19-21`, plus a testable rule: *anything that is a
function of the page's own data is rendered once at ingest; anything that is a function of live network state is a
widget and is never rendered on the server.* §13 gained a fifth invariant sentence so the rule survives a skim.

### 1.3 The relay split, settled

- **New `§5.6`**: 5.6.1 the auctions relay is a **test placeholder for the real public relays** (measured: khatru,
  `main.go:63`, write policy `:84-87`, HTTP surface = router + `/healthz` `:92-96` behind one `http.Server`
  `:98-106`, **WebSocket-only ingest, no POST event endpoint**); 5.6.2 the app's relay is **purely internal**
  (strict limitations, ACL, data management, optional exposure); 5.6.3 where the endpoint lives.
- **Two write surfaces collapsed into one.** `POST /api/pages/publish` is **retired**; the ingest is now one
  **kind-dispatched** endpoint (`POST /api/app-events`), which is the app relay's POST surface. Pages (`30024`) and
  route intents are dispatched by kind through **one** actor lookup and **one** kind allowlist. §7.1's "one actor
  model, two write surfaces" was the passage that made this explicit, and it is rewritten.
- **Plan consequences**: increment 1's `http/pages.ts` → `http/appEvents.ts` and 15 (not 13) new files; increment 4
  no longer creates `http/routes.ts` — the intent branch goes into the same handler; increment 7 does the same for
  `reserve`/`renew`; increment 8's `routesApi.ts` posts intents to the one endpoint; new exit criterion **E14**
  asserts exactly one write surface (`grep -rn "pages/publish" platform/ sdk/ ui/` → 0).
- **`O-6` is CLOSED**, and its closing claim ("the app's page ingest does not need a relay at all") is **withdrawn**
  in place. **New `O-8`** records who admits a widget to the registry as an unanswered process question with a lean
  and both costs.
- **A configuration trap is named** in `§5.6.2` and in the plan's §0.3 fact 3: the app has one relay pointer
  (`runtime.ts:19`), and reusing it for the app relay is the conflation the ruling forbids.

### 1.4 The three confirmations, recorded as settled

`§R3.3` restates them once: modular means **basic replaceable slots** (and no increment grows a slot system); **sub-app
sub-paths do not conflict** with top-level-only leases; **one binding per path and the binding wins** (no parallel
serve of a re-pointed legacy path). `O-7` gained a short table distinguishing a **slot** (next step, content inside a
compiled page) from a **widget** (this run's model, a region of a published page).

---

## 2. What I measured

All at `76ace8044`, read-only. Labels: **[M]** measured with the command shown · **[S]** read from source at
`file:line` · **[J]** judgement · **[U]** could not establish.

### 2.1 Does the repo use web components / custom elements?

**No — zero.** **[M]**

```bash
$ grep -rlE "customElements|extends HTMLElement|attachShadow|shadowRoot" \
    --include=*.ts --include=*.tsx --include=*.js --include=*.jsx --include=*.html . \
    --exclude-dir=node_modules --exclude-dir=.git | wc -l
0
```

**And the word "widget" is already taken, by something that is not a web component.** `widget-book/` is **52 files**
**[M]** and is a *React* catalogue of the `ui/` library for manual review and Playwright assertions
(`widget-book/README.md:1-20`); it is a separate client with its own Bun server and its HTML entry
(`widget-book/index.html:18` `<script type="module" src="./main.tsx">`). Its entries are React component states, not
custom elements, and its AGENTS.md forbids data fetching in it (`widget-book/AGENTS.md` "If a widget needs data, pass
a literal"). **Consequence for the docs:** `widget-book/` is *not* the widget layer, and increment 9 must not be
confused with it. I noted the distinction in the plan rather than reusing the name.

*(Minor drift noticed, not fixed, out of scope: `widget-book/AGENTS.md` says the server "injects LIBRARY via
`/config.js`", while the code serves `/config.json` — `widget-book/server.ts:21`.)* **[S]**

### 2.2 How are client bundles built and served today?

**There is no client-bundle build step in use. The SPA is bundled by Bun from an HTML entry, at server start.** **[S]**

- `platform/web/app/entry.tsx:10` `import index from './index.html'` → `:27` `resolvedServer = buildServer({ indexHtml: index })`.
  Bun's `HTMLBundle` is the catch-all route value (`platform/server/buildServer.ts:54` `'/*': indexHtml`), so the
  bundle is emitted by Bun when the server runs — not by a separate build.
- **`bun run build` is vestigial.** `build.ts:138-140` derives its entrypoints from `src/**.html`:
  `$ find src -name '*.html' | wc -l` → **0** **[M]** (and `src/` contains only `components/` and `lib/` **[M]**).
  So the build produces **no** JS bundle, and `deploy-staging.sh:19-27` copies an effectively empty `dist/`
  (`cp -r dist/ "$DEPLOY_DIR/"` beside `sdk/ ui/ platform/`). There is no `dist/` in the tree **[M]**.
- **Code splitting is available but unused for this:** `build.ts`'s own help text lists `--splitting` **[S]**, and
  there are **0** `lazyRouteComponent` / `createLazyRoute` uses **[M]**.
- **The one runtime dynamic-import pattern is local-module only**: `platform/web/auctions/auctionPublishRelease.ts:133-138`
  and `:205-207` `Promise.all([import('@platform/web/auctions/auctionsQuery'), …])` **[S]**. The other 43 textual
  `import(` hits are TypeScript `import('mod').Type` **type** positions **[M]**.

### 2.3 What `renderToStaticMarkup` is used for across those 102 files

**It is a test convention, and only a test convention.** **[M]**

```bash
$ grep -rl renderToStaticMarkup --include=*.ts --include=*.tsx . --exclude-dir=node_modules --exclude-dir=.git | wc -l
102
$ ... | sed 's|^\./||' | cut -d/ -f1 | sort | uniq -c
     94 ui
      8 platform
$ ... | grep -vE '\.(test|spec)\.(ts|tsx)$' | wc -l
0
```

The 8 under `platform/` are all `*.test.tsx`/`*.test.ts` (`StorefrontAddressPage.test.tsx`,
`AuctionDisplayHost.test.ts`, `BrowseIndexHost*.test.tsx`, `appChrome.test.tsx`, `ProfilePage.test.tsx`) **[M]**.
A representative use pre-seeds a query cache and renders the page component to a string
(`platform/web/storefront/StorefrontAddressPage.test.tsx:96`) **[S]**.

**What that means for the widget layer, stated precisely:** it proves `ui/` components render **without a DOM** —
which is exactly what `pageRender.ts` needs — and it does **not** establish a production server-render path. The
ruling's phrasing ("server rendering of components is an established pattern in this repo") is true as a *test*
pattern and would be over-claimed as a *production* one. Both documents now say "test convention, not a production
render path" (§5.7.4 table), and §5.5.2's REVISION 2 correction box (b "builds a renderer") stands unchanged.

### 2.4 Does anything load remote code today?

**No, in app code.** **[M]**

```bash
$ grep -rnE '<script[^>]+src=["'"'"']https?://' --include=*.html --include=*.tsx --include=*.ts . \
    --exclude-dir=node_modules --exclude-dir=.git | wc -l
3            # all three in ./omp-session-2026-11-04T…html — a captured session-viewer artifact, not app code
$ grep -rnE "import\(\s*[\`'\"]https?://|from ['\"]https?://|importmap" ... | wc -l
0
$ grep -rnE "createElement\(['\"]script['\"]\)|document\.write" ... | wc -l
0
```

The only `<script src="https://…">` tags in the tree are `stencil.so` viewer assets inside a saved omp session page
(`omp-session-2026-11-04T…html:17-19`) **[S]**. The app's own shell loads only same-origin module scripts
(`platform/web/app/index.html:30-31`, `./polyfills.ts` and `../frontend.tsx`) plus Google Fonts `<link>`s **[S]**.

### 2.5 The existing dynamic-surface seam, for mapping the widget boundary

- `ui/storefront/StorefrontRenderer.tsx:50` `interface StorefrontDataSlots` — the props-only renderer takes its
  data-bound renderers from the caller **[S]**, and `:103` `StorefrontBlockView({ block, slots })` switches on the
  union **[S]**.
- `platform/web/storefront/StorefrontBlockSlots.tsx:48-197` is the platform's slot map (six slot functions, the map at `:192`); every slot takes its pubkey
  from `useStorefrontContext()`, never from the document **[S]**.
- The CMS already has a **component registry**: `platform/web/storefront/storefrontCms.tsx` builds a Puck `Config`
  whose keys are type-checked against the block union (`storefrontCmsConfig` at `:149`, `components` at `:196`) **[S]**.
- The block union is closed at **12** types (`storefrontPage.ts:293-306`) **[S]** and the document's security model
  forbids "raw-HTML path, **no remote script or stylesheet**" (`:10-22`) **[S]**.

---

## 3. Is the widget layer new machinery here, and what does it cost?

**Yes — on three axes, with zero precedent.** **[M]**

| axis | precedent today | what increment 9 adds |
|---|---|---|
| custom elements | **0** | 5 widget elements + a shared upgrade helper; the app's first `customElements.define` |
| per-widget bundles | **0** — no build emits one (`build.ts:138-140`, 0 `src/**.html`) | `scripts/build-widgets.ts`: one content-hashed ESM bundle per entry + shared chunks (`--splitting` exists in the toolchain) |
| script import of instance-owned assets | **0** | a `<script type="module">` per **referenced** widget, emitted by `pageHtml.ts` |
| server-side component SSR | 102 **test** files | reuse only — `pageRender.ts` |

**Cost, in the plan's own currency**: 8 new client/build files + 1 new test module + 5 modified files (registry,
`pageHtml`, `static.ts`, `buildServer.ts`, `package.json`), one new build script that must run **before** the server
starts, one new static route, and a Playwright assertion (W7). It is increment **9**, a leaf: nothing depends on it
and it depends only on 1 and 3, so it cannot delay the proof increment.

**Why it is priced as new rather than as a re-wiring of `StorefrontDataSlots`:** the seam exists (`:50`), but it is a
React component map resolved at module scope. A custom element delivered by its own bundle is a different delivery
mechanism, and the two cannot be swapped without new code. Saying otherwise would have hidden a real increment.

**The cost I flagged hardest, because it is not a schedule cost:** `storefrontPage.ts:10-22` says the page document
has "no remote script or stylesheet" and that relaxing it "would be an account-draining XSS rather than a
defacement". A widget layer is structurally "the page causes a script to run". The resolution in `§5.7.2` is that a
page names a widget **by registry id and never by URL**, so adding a widget is a **deploy**, not a publish — and
`O-8` records that *who admits a widget* is a process question the ruling does not answer.

---

## 4. How the widget layer interacts with the local page store

Four interactions, all of them in `§5.5.1`, `§5.5.3`, `§5.7.3` and plan §1.4/§1.5:

1. **The store gains one field and no code.** A stored page is document + static fragment + meta + identity + series
   memberships + **the widget ids the document references**. The store never holds a bundle, a script, or a URL.
   `pageHtml` emits exactly the script tags for those ids, with no re-scan.
2. **Ingest refuses an unknown id** (`400 'unknown-widget: <id>'`), by the same discipline as "a page that cannot
   render is never stored": a stored page is a page whose dynamic regions can mount. In increment 1 the registry
   holds the five built-ins, so only ids the instance never shipped are refused.
3. **The read path is unchanged.** Serve = one file read from the store; the mount point is already in the fragment,
   so the widget adds **no server work per request** — which is the point of reason 2 (bundles as static assets).
4. **Code and content are separated by direction.** Content lives in the store; code lives in the deploy artefact;
   the registry id is the only link, and it runs one way — a page cannot introduce a widget by existing, only
   reference one the operator admitted.

**One honest boundary recorded rather than glossed:** the crawler sees the page's static content and meta, **not**
widget output, because widget output is fetched in the browser by design (§5.5.2). The SEO claim is therefore
narrower than "the whole page is indexable", and both documents now say so.

---

## 5. What I could not reconcile, and what I deliberately left open

1. **Two, not one, unresolved items — both labelled as such rather than answered.**
   - **O-8 (new): what process admits a widget to the registry.** The ruling permits a repo link; this architecture
     keeps it a link and admits code only via a reviewed change to the registry at build time. *Who* reviews, and
     what evidence a repo must carry, is unanswered. The lean (a code diff, never a runtime registration path) and
     the cost of the opposite are recorded. **Nothing in increments 1–9 needs an answer.**
   - **The app relay's topology (A in-process vs B separate process).** The ruling settles the **role**; it does not
     settle the process count. I chose (A) — one endpoint in the app server, page store and routing file written in
     the same request — and labelled it **OUR CHOICE** with the (B) costs, because (B) puts a second process on the
     write path and introduces a projection lag. Presenting (A) as the ruling would have been false.
2. **The `Widget` block type is deliberately not specified.** The five dynamic blocks already reference the widget
   layer by `type` (`storefrontPage.ts:293-306`), so **the page schema does not change** (W11 asserts an empty diff
   under `sdk/commerce/storefront/`). A generic block for non-built-in widgets is the extension point, and it would
   need a props-validation story the server cannot provide — so it is deferred, and the plan's NOT list says so.
3. **The ingest endpoint has zero precedent on either side.** The relay is WebSocket-only (`main.go:92-106` **[S]**)
   and the app has no event-POST handler. So "POST-like endpoint" is built, not adapted, and no test can be
   inherited from the relay's policy code. Recorded in increment 1's cost note.
4. **A pre-existing inconsistency I noticed and did not fix**: `STOREFRONT_BLOCK_TYPES` (`storefrontPage.ts:311-321`)
   lists **9** of the union's **12** members (`ProductRow`, `Search`, `Categories` are missing), although the plan's
   "12 types" claim is about the union (`:293-306`) and is correct. The registry must seed from the **union**, not
   from that const, or three widgets silently vanish. Flagged here because increment 9 is where it would bite; fixing
   the const is a source change and out of scope for a read-only run.
5. **The relay's memory-pressure claim is still `[U]`.** Nothing in this revision needed it and I did not
   re-litigate it: it remains a documented ops symptom (`deploy-simple/RELAY_DEPLOY.md:212-216`), not a measurement
   of OOM under write load, and the document still names a service (`orly`) that suggests it predates this app.
6. **`report-consolidation.md` and `report-revision-2.md` were not edited.** Their rows that this refinement
   invalidates (notably R2's option table and R2's "no relay needed for ingest") are superseded **in place** in the
   two live documents, with the superseded text quoted in the revision tables. Editing history would have hidden the
   change, which is the opposite of what these tables are for.

---

## 6. Verification status of this revision

| check | status |
|---|---|
| every invalidated passage enumerated | **12** rows in `ARCHITECTURE.md` §R3.1, **12** in `IMPLEMENTATION-PLAN.md` §REVISION 3; each has a body rewrite |
| every code claim carries `file:line` | yes; new claims measured this session are in §2, and three pre-existing line numbers were **corrected** while re-reading them (`runtime.ts:20` → `:19`, `build.ts:129-131` → `:138-140`, `buildServer.ts:52-54` → `:41`/`:54`) |
| every number has its command | yes; §2 shows the command beside each count |
| measured / read / judged separated | `[M]` `[S]` `[J]` `[U]` on every new claim; the three new design choices are labelled **OUR CHOICE** (endpoint path name, topology A, light DOM + reuse of `ui/` components inside elements) |
| 64-hex key-shaped literals | `grep -nE '[0-9a-f]{64}' ARCHITECTURE.md IMPLEMENTATION-PLAN.md` → **0** |
| settled items re-opened | no — `§R3.3` restates the three confirmations as settled, and `§R3.2` lists what is **not** changed |
| our choice presented as a ruling | no — every inference is labelled, and `O-8` / topology / block-extension are recorded as open or ours |
| increments in dependency order | yes — 1 → 2 → 4 → 8 sequential track unchanged; 9 added as a leaf on 1 + 3, parallel with 2/4/5 |
| typecheck / tests / build run | **none** — read-only base, no branch, no build, no deploy |
| relays reached | **none** |
| `git status` on the repo | unchanged by me; the only writes are the three files in `runs/2026-11-13-admin-routes/` |