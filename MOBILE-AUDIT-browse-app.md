# Mobile audit — the new browse app (market-e2e.playday.it)

Build measured: the deploy worktree `~/work/wt-e2e` at `5bd8927e0` plus the deployed
`unite/1420-all` paths (family + streaming + crash fix). Measured in a real browser over CDP,
`Emulation.setDeviceMetricsOverride` with `mobile=False` so the width is the CSS width.

Readiness rule: wait until `document.body.innerText.length > 300` **and** a route-specific marker
(`main article` for the grid), then settle 2 s. An early read of this app reports a passing page.

## Scope, established first

The new browse/search app is a **single-page experience under `/`**, driven by query parameters —
`?q=` search, `?c=` category, `?p=` detail. The old Plebeian Market app still serves the other
routes (`/products/…`, `/cart`, `/collections`, `/auctions`, `/profile/…`), which is why
`/products/barattolo-3230` answers **"Product Not Found"** with the legacy chrome. Those routes are
therefore **not** the surface under review, and their clean readings below are not a pass for the
new app.

## BLOCKER 1 — the nav search field is a fixed 560px and widens the page to 822px

- Route: `/?q=…`, and any state that shows the nav search field, including `/?p=…`
- Viewports: **390 → `clientWidth` 375, `scrollWidth` 822, overflow 447**;
  **360 → `scrollWidth` 822, overflow 477**. The page's content width is **822px at both widths** —
  it does not respond to the viewport at all.
- Offending element: the nav search field, `ui/browse/search-field.tsx` line 72 —
  `root: ['h-10', 'w-[560px]', 'max-w-full', 'pl-4', 'pr-1.5', 'gap-2.5']`.
  Measured cluster `div.flex-1.flex` / `div.relative.flex`, `left 262 → right 822, width 560`;
  the input inside is `w384`, the trailing button sits at `x732 → 815`.
- Why `max-w-full` does not save it: the field's flex parent `div[data-slot="search-slot"]`
  (`flex-1 flex justify-center`, `ui/browse/browse-nav.tsx` line 145) is itself sized by its
  content, so `max-w-full` resolves against 560px, not the viewport. A wrapper sized by its children
  is the classic page-widening shape.
- What a visitor experiences: on a phone the whole page is 822px wide. Everything is squeezed into
  the left 375px, a horizontal scrollbar appears at the bottom, and the search field runs off the
  right edge with its button unreachable.
- Not affected: idle `/` (overflow 0), `?c=` (overflow 0), and **landscape 844×390 (overflow 0)** —
  560px fits in 829, which is the tell that the number, not the layout, is the fault.

## BLOCKER 2 — the detail panel is a split view on a phone

- Route: `/?p=<id>`, and equally by tapping any card in the grid
- Viewport 390 (`clientWidth` 375), panel open:
  `[data-slot="split-detail"]` at **x 375, w 169**;
  `[data-testid="widget-product-detail-panel"]` at **x 402, w 101**, `scrollHeight > clientHeight`
  (it scrolls internally); the list stays at **x 0, w 375**.
- By tap on the same viewport: the list compressed to **206px** and the panel rendered at
  **x 233, w 101** — two independently scrolling columns side by side on a phone.
- Mechanism: `ui/browse/split-view.tsx` positions the detail as
  `absolute inset-y-0 right-0 … overflow-y-auto border-l` with a drag handle
  (`cursor-col-resize`, `touch-none`) — a desktop split. There is no mobile branch.
- What a visitor experiences: tapping a product on a phone yields a ~100px sliver of the detail,
  mostly past the right edge of the screen, beside a list squeezed to two thirds width. There is no
  way to read the title, price or description.
- Intended: **push a full-width view on top** (the user's own words), not a side panel.

## MAJOR 3 — touch targets

- `/?q=…` at 390: **343** interactive elements smaller than 44×44 (`a, button, [role=button], summary`).
  For scale: idle `/` 132, `/auctions` 65, `?c=` and the rest 9–13.
- A raw count is not a verdict — card sub-elements and inline links inflate it. It needs a pass that
  measures the control a finger actually hits (the wrapping label/card), not every descendant.
  Reported as a count to be resolved, not as a finding list.

## Readings across routes (390×844, then 360×780)

- `?q=…` — overflow **447** (390) / **477** (360). BLOCKER 1.
- `/` idle — 0 / 0
- `?c=art-collectibles` — 0
- `?p=barattolo-3230` — **447** (BLOCKER 1 again) and BLOCKER 2's geometry
- `/products/…` — 0, but this is the **legacy app** returning "Product Not Found"
- `/cart`, `/checkout`, `/collections`, `/auctions`, `/profile/…`, `/nostr`, `/search/products` — 0, legacy app
- Landscape 844×390 `?q=…` — 0

## What I could not measure

- **320px and 414px.** The browser connection dropped mid-sweep (360 completed for `?q=`, `/` and
  `/products` only). The 390/360 pair is enough to prove BLOCKER 1 (a fixed width cannot respond),
  but the two extremes are unmeasured.
- **The detail panel at 320 / 414 / landscape.** Measured at 390 only.
- **Contrast.** Not computed for any surface.
- **The dashboard screens** (`/dashboard/…`) — not visited. If they are in scope, they are a separate
  sweep with their own readiness markers.
- **Whether the legacy routes are meant to remain.** That is a product decision, not a measurement.
