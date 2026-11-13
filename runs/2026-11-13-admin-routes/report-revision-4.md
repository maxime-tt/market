# Report — REVISION 4 of run A (admin-routes), a scope cut

**Role:** targeted reviser, fourth pass · **Base:** `/home/admin_maxime/work/market`, `master`, HEAD `fee719957` ·
**State:** read-only. No source change, no branch, no build, no deploy. **Wrote exactly three files**, all under
`runs/2026-11-13-admin-routes/`:

- `ARCHITECTURE.md` (updated in place: new `§REVISION 4` with R4.1–R4.6; §1, §3.1, §5.2, §5.5, §5.5.2, §5.5.3, §5.7,
  §6, §10 O-7/O-8, §11 heading, §13)
- `IMPLEMENTATION-PLAN.md` (updated in place: new `§REVISION 4` with R4.1–R4.4; §1.1, §1.4.2, §1.4.3, §1.5, §1.7,
  §1.8, §2, §2.1, §2.2, §4, §6, §9b, §11 R-1/R-4, §12)
- `report-revision-4.md` (this file)

Not touched: any worktree, any source file, `report-revision-2.md`, `report-revision-3.md`, and the sibling run
`runs/2026-11-13-auctions-ui/`.

**Authority used.** `ruling-react-components-and-deferred-widgets.md` (owner, 2026-11-13) — a **scope cut**, not a
correction of facts — plus one **owner correction delivered mid-revision** (quoted in §4 below) that makes the scope
**three-way** instead of in/out. Nothing REVISION 2 or REVISION 3 established about the **serving model**, the relay
split, the single ingest endpoint, the ACL or leases was re-litigated.

---

## 1. What changed, passage by passage

`ARCHITECTURE.md` §R4.1 lists **14** changed passages and `IMPLEMENTATION-PLAN.md` §R4.1 lists **11**; both tables are
complete, and every row has a body rewrite rather than only a table entry.

### 1.1 The widget layer is DEFERRED, not deleted, and the composition model is the CMS's React blocks

- **`§3.1` nouns rewritten.** `PAGE` is "the page DEFINITION … that REFERENCES blocks by **the CMS's existing block
  type**". `WIDGET` and `WIDGET REGISTRY` are no longer nouns of the model: they sit in a clearly-labelled
  **DEFERRED** block in the same place, so the door is visibly open and nothing reads as built.
- **The paragraph that defended the registry** ("A widget registry is not the 'manifest' this section refuses") is
  replaced by one that says the block vocabulary is **code the instance already ships**, reached by `type` through the
  closed union — no lookup table, no registration, no per-block asset.
- **`§5.7` retained in full and bannered DEFERRED** (heading, `STATUS: DEFERRED` blockquote, then §5.7.1–§5.7.5 with
  per-item tense fixes): §5.7.1's fourth constraint marked deferred, §5.7.2's "ingest refuses an unknown widget id"
  converted to "if built, … **not built**", §5.7.3 retitled "How it **would** render", §5.7.4 relabelled as *the reason
  for the deferral*, §5.7.5 retitled "What the deferral leaves true".
- **`§5.5`** lost the stored-page field "its widget ids … so `pageHtml` can emit exactly those script imports" — there
  is no per-block asset to emit.
- **`§5.5.2`** block table: the five data-bound blocks are now "a **placeholder region** … filled in the browser by the
  **existing React slot map** after hydration". The split rule's wording changed from "is a widget" to "is a data-bound
  block"; the rule itself is unchanged.
- **`§5.5.3`** dispatch lost `widget ids resolve` and the second ingest refusal; **one** page refusal remains (a page
  that cannot render is never stored).
- **`§13`** diagram and invariant 5 lost the widget vocabulary: "a PLACEHOLDER, filled … by the existing React slot map
  **after** hydration", and "*if it server-renders a page's dynamic content, or lets a page introduce code, it is
  wrong*".
- **Plan:** §1.1 back to **13** new files, §1.4.2 table and the registry paragraph replaced, §1.4.3 no `<script>` per
  block, §1.5 step `4c` removed and steps renumbered, §1.8 "no widget layer at all", §2 graph box removed, §2.1 row 9
  struck, §2.2 Track II reduced to `3 → 5`, §9b bannered deferred with W1–W13 marked *not run*, R-4 relabelled as a
  deferred risk.

### 1.2 The serving model is untouched — stated, not assumed

**One accuracy correction the ruling's own wording forced.** The ruling's list of "the EXISTING CMS widget definitions"
names `ProductStrips`, `BrowseStats`, `BrowseFeed` and `AuctionList` beside the real ones — and **those four do not exist
in the tree** (`for n in ProductStrips BrowseStats BrowseFeed AuctionList; do grep -rl "'$n'" sdk/ platform/ ui/; done` →
no output **[M]**). The block union the CMS actually edits is
**12 types** (`sdk/commerce/storefront/storefrontPage.ts:293-306`, registered at
`platform/web/storefront/storefrontCms.tsx:196`). Both documents now say a page references **what the union contains**,
and that a block outside it is *new code*, not a new document field — the deferral's consequence stated one step earlier.

`§R4.2` restates the three properties the scope cut must not touch, each with its evidence: no relay round-trip on a
bound page; render once at ingest, store the fragment, hydrate the SAME DOM; data-bound blocks fetch their own data
after hydration — and the third is coherent **because the existing CMS blocks already behave that way**
(`platform/web/storefront/StorefrontBlockSlots.tsx:48-56` → `ui/storefront/blocks/ProductGridBlock.tsx:67,90`) **[S]**.

### 1.3 The render mechanism is named and priced (revision 3's own best correction, carried forward)

Revision 2 cited `renderToStaticMarkup` in 102 files as evidence of server rendering; revision 3 measured that all 102
are tests. Revision 4 **names the mechanism** and **prices it**, and both documents now say so at §R4.3 / §R4.4 and in
`§1.4.2`/`§11 R-1`. Details in §2 below.

### 1.4 Scope is three-way, not in/out (owner correction)

The first draft of this revision wrote a binary IN/OUT table that put **modular sub-apps** and **list management** in
the OUT column. The owner corrected it mid-revision:

> *"modular subapps, and list management I would both like in - but perhaps after we can get our current todo list
> done."*

So `§R4.4` and plan `§R4.2` now carry **three tiers** (below), and a new `§R4.6` **checks** rather than assumes that the
architecture leaves room for tier 2. Nothing was promoted into an increment, per the owner's instruction.

---

## 2. What renders a fragment at ingest, and what it costs

**All measured at `fee719957`, read-only.** Labels: **[M]** measured · **[S]** read from source · **[J]** judgement.

### 2.1 Is `react-dom/server` available, and is it used in non-test code?

**Available: yes. Used in non-test code: no — zero.** **[M]**

```bash
$ grep -rl renderToStaticMarkup --include=*.ts --include=*.tsx . --exclude-dir=node_modules --exclude-dir=.git | wc -l
102
$ ... | sed 's|^\./||' | cut -d/ -f1 | sort | uniq -c
      8 platform
     94 ui
$ ... | grep -vE '\.(test|spec)\.(ts|tsx)$' | wc -l
0
$ grep -n '"react-dom"' package.json          →  :92  "react-dom": "^19.2.6"
$ node -e "…require('./node_modules/react-dom/package.json').version"  →  19.2.6   (react 19.2.6)
```

Ten files under `platform/` import `react-dom/server`; all ten are `*.test.*`, and two of them use `renderToString`
rather than `renderToStaticMarkup`. `grep -rl "react-dom/server"` finds **104 files** (94 `ui/`, 10 `platform/`), all
tests — the 114 figure is the *occurrence* count (`grep -rn … | wc -l`), not the file count, and neither has a non-test
user.

### 2.2 Is there any precedent for rendering to a string in `platform/server/`?

**No.** **[M]** / **[S]**

```bash
$ grep -rn "react" platform/server/ --include=*.ts | wc -l                    →  0
$ grep -rn "from '@ui/" platform/server/ --include=*.ts | wc -l               →  0
```

The only HTML the server emits today is **string concatenation**: `sdk/commerce/products/ogTags.ts:301-306` builds the
`og:`/`twitter:` `<meta>` block with `escapeHtmlAttribute` (`:233`), injected into a shell it fetches from itself
(`platform/server/http/og.ts:27-31`, `platform/server/ogMeta.ts:198-215`). So "the server can emit crawler-visible
`<head>`" is true; "the server can emit a body" is not, today.

### 2.3 Does the mechanism actually work where it must — a Bun process with no DOM?

**Yes, measured.** I rendered the **real** `ui/storefront` block components to a string under Bun:

```bash
$ cd <scratch>/sr-probe && ln -s /home/admin_maxime/work/market/node_modules node_modules
$ /home/admin_maxime/.bun/bin/bun probe.tsx
window: undefined document: undefined
LEN 1054
<div data-testid="storefront-hero" …><section …><h1 …>Title</h1></section></div>
<section …><p …><span>hello </span><strong><span>world</span></strong></p></section>
<section …><h2 …>Shop</h2><p data-testid="storefront-product-grid-empty" …>No products yet.</p></section>
```

Three things that were **unknown before this measurement**, now known:

1. `renderToStaticMarkup` runs in a Bun server process with **`typeof window === 'undefined'` and
   `typeof document === 'undefined'`**.
2. The `./storefront-theme.css` import at `ui/storefront/StorefrontRenderer.tsx:8` **does not break** a server-side
   import under Bun.
3. `ProductGrid` rendered **without any slot** produces its own empty state (`storefront-product-grid-empty`) — so the
   placeholder is not new markup, it is the renderer's documented fallback (`ui/storefront/StorefrontRenderer.tsx:105-136` **[S]**).

### 2.4 The cost, in four items

1. **One module** — `platform/server/routes/pageRender.ts` (document → elements → string). No dependency added, no build
   step: Bun transpiles the imported `.tsx`, and the server entrypoint is already run as
   `bun platform/web/app/entry.tsx` (plan §0.1/E3). **[J]** for size, **[M]** for the dependency.
2. **One boundary-guard amendment — the cost REVISION 3 missed.** `platform/boundary.test.ts:83-88` asserts that no
   module under `platform/server/` imports `react`, `react-dom*` or `@ui/*`, which is exactly what `pageRender.ts`
   needs. **OUR CHOICE:** keep the module where the plan puts it and add **one named file** to that guard's allowlist
   with the reason (it renders React *to a string with no DOM*, as 102 test files already do); the alternative is to
   move the module outside `platform/server/`. Failure if forgotten is loud (`E12`/`S9`), not silent.
3. **One hydration obligation.** The server renders the five data-bound regions **slot-less**; the client's slot passes
   `isLoading` from its query (`StorefrontBlockSlots.tsx:50,56` → `ProductGridBlock.tsx:90`). Rendering the slot map on
   the client's **first** commit therefore hydrates those subtrees as mismatches and React 19 re-renders them. Fix: apply
   the live slot map **after** hydration through the `#__AR_PAGE__` seam. New exit criterion **E10b** asserts the served
   DOM is unchanged across it.
4. **Nothing else** — no streaming (`renderToReadableStream` is not needed for a string written once), no SSR tier, no
   per-request rendering, no style extraction.

**A resolution trap, measured so it is not hit in production.** My first probe ran from a directory with no
`node_modules` and resolved `react-dom@19.3.1` from Bun's global install cache against the repo's `react@19.2.6`,
failing with *"Invalid hook call … more than one copy of React"* **[M]**. Both React packages must resolve from **one
tree**; that is automatic once the module lives in the repo. Recorded in `§R4.3` because it is exactly the kind of
"works in a test, fails in the server" failure this run exists to prevent.

---

## 3. Scope: the three tiers as written

| tier | contents |
|---|---|
| **1 · NOW** | routing file; resolution (3 rungs, 2 binding kinds, longest-prefix, 404); page store; serving from local storage; one ingest endpoint at the app relay's POST surface; ACL (4 levels, `may()`, `grants`); leases (top-level, term, 404 on lapse); series index; management surface; legacy registry retirement |
| **2 · LATER, committed** | **modular sub-apps** (legacy/general pages as modular sub-apps with their own sub-paths: browse, seller dashboard, buyer/orders); **list management** (generalise lists beyond blacklist/featured; a CMS reference meaning "the members of the named list") |
| **3 · DEFERRED** | the **widget/portability layer** (web components, custom elements, script binding, widget compiling, git-repo delivery, third-party blocks) and the **signed lease-confirmation ledger** |

Tier 2 is "already decided, waiting its turn"; tier 3 is "declined for now, needs a new reason". The consequence of tier
3 is stated in the ruling's own words and kept: **a third party cannot ship a page into the instance without the
instance building their block.**

---

## 4. Does the architecture leave room for tier 2? — checked

**(a) Arbitrarily deep sub-app paths.** **Yes, and it was already stated twice, not inferred.** §3.4 restricts **leases**
to top-level paths; §5.2 says *"programmed routes may be arbitrarily deep; only leases are restricted to top level"*;
§3.3's rung 2 is a programmed **PREFIX** with longest-pattern-wins; and the file's `prefixes[].pattern` is `:param`-shaped
(`"item/:eventId"`, `"p/:npub"` — §4.2). The 3–30-character grammar in §8.2 governs a **binding's `path`**, not a prefix
pattern, so nothing forbids `seller/orders/:orderId`. **No revision narrowed it** (R2 widened it, R3 confirmed it, R4
only relabels §5.2's "direction of travel" paragraph as tier 2 — a scope statement, not a ladder change).

**One real gap, reported rather than papered over:** the model permits deep patterns but **specifies no pattern grammar**
— segment count, allowed characters, `:param` placement. Today's patterns are one and two segments, so the gap is
invisible until a sub-app needs three. It is later work (a validator rule plus a test), not a change to the ladder, and
must not be built in tier 1.

**(b) A `list` reference.** **Yes, with the room narrower than the words suggest.** §6 keeps
`{ kind: 'list'; list: string }` *"PARSED, NOT RESOLVED"*, refused by the resolver with a counted
`unsupported-reference` reason. Neither R3 nor R4 touched §6. But:

- `ProductReference` **does not exist in code** — it is the document's model; `grep -rn "ProductReference" sdk/ platform/
  ui/` finds only unrelated collection/product-listing tag schemas **[M]**. So "room" means *nothing forbids it*, not
  *a dormant code path exists*.
- The **code's** list machinery is closed to two keys: `CURATION_LISTS` at `sdk/core/curation/curationLists.ts:7`,
  `CurationListKey = keyof typeof CURATION_LISTS` at `:16` **[S]**.
- Therefore the later work is one resolver branch **plus** a key/tag generalisation — real work, which is why it is tier
  2 and not a switch.

**No conflict was found.** Had either answer been "narrowed", it would be reported here as a conflict; the only shortfall
is the unspecified pattern grammar in (a).

---

## 5. What is unresolved, and what I deliberately did not do

1. **The index of the deferred layer's process question (O-8) is now deferred with it** — not answered, and no longer an
   open question of this build. Kept because it must be answered *before* the layer is built.
2. **The render mechanism's home is a labelled choice**, not a ruling: allowlist one file at
   `platform/boundary.test.ts:83-88`, or move the module out of `platform/server/`. Both are one-line; I picked the
   allowlist and wrote down the other.
3. **E10b is specified, not implemented.** Nothing was built, so the hydration criterion is a *proposal* whose failure
   mode I measured only by reading (`isLoading` branches). It is the one place where "hydrate the same DOM" can quietly
   become "re-render the dynamic regions", and it needs a real browser run to confirm.
4. **HEAD moved under this run.** The documents' headers say base `3a07e7067`; revision 3 measured at `76ace8044`; **I
   measured at `fee719957`**. I did not rewrite the headers (they record the run's original base) — every number in
   `§R4.3`/`§R4.4` carries `fee719957` beside it. Counts happened to be stable (102 files, 0 non-test, 94/8 split).
5. **No typecheck, no tests, no build, no deploy, no relay** — read-only base throughout.
6. **Four block names in the ruling's list do not exist in the tree** (`ProductStrips`, `BrowseStats`, `BrowseFeed`,
   `AuctionList`). I did not treat them as available; both documents name the closed union instead and say that adding one
   is new code. If the owner meant those four to be part of the current vocabulary, that is a **new** work item, not a
   documentation fix — flagged rather than silently dropped.
7. **The `$R4.2`-style cross-reference typo class**: one was introduced and fixed during editing
   (`($R4.2` → `(§R4.2`); a final grep for `§R4` references was run and all resolve to an existing heading.

---

## 6. Verification status of this revision

| check | status |
|---|---|
| every invalidated passage enumerated | **14** rows in `ARCHITECTURE.md` §R4.1, **11** in `IMPLEMENTATION-PLAN.md` §R4.1; each has a body rewrite. Row 14 records the mid-revision owner correction of the scope list |
| every code claim carries `file:line` | yes; the new ones are `platform/boundary.test.ts:83-88`, `package.json:92`, `ogTags.ts:301-306`/`:233`, `StorefrontRenderer.tsx:8`/`:50`/`:103-166`/`:105-136`, `StorefrontBlockSlots.tsx:48-56`/`:192`, `ProductGridBlock.tsx:67,90`, `curationLists.ts:7,16`, `storefrontCms.tsx:46,149,196` |
| every number has its command | yes, §2 above and inside `§R4.3`/`§R4.4` |
| measured / read / judged separated | `[M]` `[S]` `[J]`; the four design choices are labelled **OUR CHOICE** (module location + guard entry, slot-map-after-hydration, 7/5 split retained, placeholder markup) |
| 64-hex key-shaped literals | `grep -nE '[0-9a-f]{64}' ARCHITECTURE.md IMPLEMENTATION-PLAN.md` → **0** |
| settled items re-opened | no — R4 touches only the widget layer and the scope statement; §R4.2 lists what it does not touch |
| our choice presented as a ruling | no — the module location, the hydration seam and the tier-2 "room" reading are labelled; tier 3's consequence is quoted from the ruling |
| increments in dependency order | yes — 1 → 2 → 4 → 8 unchanged; increment 9 struck as deferred, no new increment added |
| tier 2 promoted into an increment | **no** — per the owner: architecture must leave room, and §R4.6 verifies it |