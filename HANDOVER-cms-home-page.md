# Handover — the CMS home page and the browse/search follow-ups

**For:** the omp session titled `🛒 BROWSE: Drive doop browse implementation v…` (herdr pane `w2:p1`,
workspace `plebeian-market`, cwd `~/work/market`). A second live pane, `w4:p1` (`🔨 AUC`), is a
different programme — do not mix them.

**Written:** 2026-11-09. Every measurement below was taken on the live instance that day; a
measurement that has not been re-taken is marked as such.

---

## 0. Where the work lives

| what | path | branch |
|---|---|---|
| the union branch the e2e instance runs | `~/work/wt-union-1420` | `unite/1420-all` |
| the deploy worktree the live site serves from | `~/work/wt-e2e` | checks out paths from `unite/1420-all` |
| the search service | `~/work/rabbithole` | — |
| the labeller | `~/work/labeller` | — |

- **Live instance:** `https://market-e2e.playday.it/` — systemd **user** unit `market-e2e.service`
  (port 3460). It serves the *working tree* of `~/work/wt-e2e`, so a deploy is
  `git checkout unite/1420-all -- platform ui sdk` there plus a restart.
- **The e2e instance is the owner's live test surface.** Do not restart it, do not edit
  `~/work/wt-e2e` while he is testing, and do not leave it down — it was found returning 502 once
  because a concurrent task restarted the service.
- `src/` in `wt-union-1420` is the **legacy app** and is not the surface under review. Never edit it.
- Repo style in `wt-union-1420`: **TABS**, no semicolons, single quotes, JSDoc that states **why** a
  rule exists.
- `bun` is not on PATH: use `/home/admin_maxime/.bun/bin/bun`. `node_modules/.bin/tsc` is blocked by
  a command guard — use `bunx tsc --noEmit`, and for the whole repo
  `NODE_OPTIONS=--max-old-space-size=12288 bunx tsc --noEmit` (193 pre-existing errors elsewhere).

---

## 1. THE TASK: make the home page CMS-produced

The owner's directive, verbatim in intent: turn the home page into a CMS-produced page.

1. **Extract the search component and the product rows** into components the CMS can render.
   The rows currently flow left and right on their own query; they must become CMS-usable.
2. **Make the products in a row pickable** — a human chooses which products appear, rather than the
   row being query-driven.
3. **The categories below** become customisable CMS components alongside everything else.
4. This also **unblocks the CMS page route** — build it once the components exist.

**Constraint that scopes all of it:** *the front end needs no parent/child category reasoning.* The
taxonomy is a labeller-side tagging guide and nothing downstream may depend on it. Verified: `sdk/`,
`platform/` and `ui/` reference `category_top`/`category_sub` **nowhere**. If a design needs a
hierarchy on the front end, the design is wrong.

**Also relevant:** the owner explicitly does **not** want over-correction on the
one-seller-dominates problem. The intent is *spread, not suppression* — nothing hidden, nothing
unreachable. The measured concentration is real (one seller = 1,889 listings = 22% of the index;
`health` 1,903, `pharma` 1,629, `steroid` 928), so curation is the chosen answer, not filtering.

---

## 2. Work that is DONE and deployed — do not redo

- `[x]` **Mobile: the search field no longer widens the page.** It was `w-[560px]`, making the page's
  min-content 822px. Measured before: **overflow 447 at 390px, 477 at 360**. After: **0 and 0**.
  Now `w-full max-w-[560px] min-w-0`. Commit `59872b34f`.
- `[x]` **Mobile: the detail is a pushed view below 1024px**, not a side panel. Before: panel
  `x=402 w=101` on a 375px viewport (mostly off-screen) with the list squeezed to 206px. After:
  full-width, panel `w=323`, a 48px back bar, resize handle 0×0. Same commit.
- `[x]` **Mobile: the search pill no longer eats the input** below `sm` (it left the input 9px).
  Same commit.
- `[x]` **Progressive search results.** The service already streams; the client now maps frames as
  they arrive. Measured: 9 products at 3.0s, 28 at 4.0s, settled at 10.8s. Commit `5ea92a359`.
- `[x]` **The client deadline was inverted** — 8s client against a 12s service deadline
  (`per_relay_timeout_ms: 6000`, `total_deadline_ms: 12000` in `rabbithole.config.json`). Now derived:
  `12_000 + 3_000 = 15_000`, with a test asserting the relationship.
- `[x]` **The pending-chip crash is fixed** — `outcome.relaysFailed` is `[{relay, reason}]` on the
  wire but was declared `string[]`, so the popover rendered an object (React #31). Commit `7d75dd130`.

---

## 3. Work the PARENT session is doing — do not touch these files

The parent (Hermes) owns the search-honesty change set. To avoid two writers on one file:

- `platform/web/browse/browseQuery.ts` — dropping the `category_tags = "${tag}"` filter derivation
- `platform/web/browse/BrowseIndexHost.tsx` — `See all →` and pill clicks navigate to `?q=<value>`
- `rabbithole/src/index/search.ts` — `SUGGESTABLE_FIELDS` → `["all_tags", "has_image"]`
- `rabbithole/src/index/client.ts`, `rabbithole/src/harvest/pointer.ts`,
  `rabbithole/src/harvest/carry-labels.ts`, `rabbithole/src/harvest/taxonomy.ts` — removing the
  derived category fields

If the CMS work needs to change one of those, coordinate rather than editing in parallel.

---

## 4. Findings the CMS work should assume

- **`?tag=` is not a category.** It is the seller's own free-text tag, normalised into
  `category_tags`. So `?tag=Bitcoin` means "any listing where a seller wrote bitcoin", which is why
  it is a grab-bag. The owner has ruled it becomes a **raw keyword search**.
- **The facet pills are global, not scoped.** The pill probe runs with `{"q":"","limit":1,
  "indexOnly":true}` — no term, no filter — so on a tag page it answers over the whole 8,566-listing
  index. That is why `health`/`pharma` appeared on a Bitcoin page.
- **The duplicate pills are a field collision:** `health` from `all_tags` (1,903) *and* from
  `category_top` (1,866); `pharma` from `all_tags` (1,629) *and* `category_sub` (1,627). The UI keys
  on `${field}:${value}`, so both render. Removing the derived fields removes the duplicate.
- **The product grid and the indicator can disagree** — measured 110 products in the indicator
  against 122 cards in the grid on the same result set. Unresolved; treat it as a real defect.
- **`/products/<id>` on the e2e host is the legacy app** and returns "Product Not Found". The new
  browse app is a single-page app under `/` (`?q=`, `?c=`, `?p=`).

---

## 5. Where the written records are

- `~/work/wt-union-1420/NEXT-STEPS.md` — the ordered implementation plan for the search work.
- `~/work/wt-union-1420/TAG-SEARCH-RULINGS.md` — the owner's three rulings, each with the
  measurement that decides it.
- `~/work/wt-union-1420/MOBILE-AUDIT-browse-app.md` — the mobile audit, with the before numbers.
- `~/work/labeller/TAXONOMY.md` — the taxonomy tree and the label mechanism (labeller-side only).

---

## 6. Still to be decided by the owner (do not guess)

- **Ranking.** With the derived fields gone, the labeller's signal is `label_tags` and the seller's
  is `category_tags`; `all_tags` is their union. A rule that says "rank by tags" would silently rank
  by what sellers typed. Options: rank by labeller-label presence / add a labeller-derived score /
  do nothing yet.
- **Umami.** Self-hosted, cookieless; search demand is instrumented in our own service (a client
  script cannot see a term in a POST body) and purchases at the order path. Heatmaps to be tested as
  a starter, an opt-out control on the home page, and the box has no Docker and no Postgres today.
