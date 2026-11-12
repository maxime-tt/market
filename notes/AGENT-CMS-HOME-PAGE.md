# AGENT — CMS home page authoring

## What you need to build

The root route `/` renders a CMS-produced home page — `Search` block, `ProductRow`
block(s), `Categories` block — inside the browse chrome (`BrowseNav`). The
composition is a real authored page document parsed through the same
`parseStorefrontPage` that validated published pages, so there is no second
layout to keep in sync with the CMS.

## Where the home page document lives

`platform/web/storefront/homePage.ts` — exports `HOME_PAGE_DOCUMENT` (the raw
document) and `HOME_PAGE` (the parsed `StorefrontPage`).

`platform/web/routes/index.tsx` — imports `HOME_PAGE` and renders it via
`<StorefrontRenderer page={HOME_PAGE} pubkey={APP_PUBKEY} slots={storefrontBlockSlots} />`
inside `BrowseNav` when there is no `?q=` or `?p=` state (those defer to
`BrowseIndexHost`).

## Document schema

A storefront page is the builder's (Puck) own format — `{ type, props: { id, ... } }`
blocks. The envelope:

```ts
{
  version: STOREFRONT_PAGE_VERSION,  // currently 1 — literal match or rejection
  enabled: true,
  root: { props: { title, theme, palette, tune } },
  content: StorefrontBlock[]  // closed discriminated union
}
```

SDK types and parser at `sdk/commerce/storefront/storefrontPage.ts`.

## Palette and page version — the two traps paid for once each

**The page version** (`STOREFRONT_PAGE_VERSION` = 1): `parseStorefrontPage`
rejects any document whose `version !== 1` before reading a single block. If
the version is wrong, the whole document returns `page: null` and the renderer
gets nothing to draw — the page appears blank/empty. A new schema bump requires
updating this constant.

**The palette id**: the document must name a real palette from the closed set
`STOREFRONT_PALETTE_KEYS`. An empty string means "the layout's default" only
where the theme registry resolves it; the inline authoring path bypasses that
registry, so an empty or unknown palette renders the blocks with no colour
tokens — present in the DOM but invisible. Palette ids are curated colourways
from the Theme Studio at `sdk/commerce/storefront/storefrontPage.ts:363`.

```
STOREFRONT_PALETTE_KEYS = ['concrete', 'acid', 'arcade', 'brutal', ...] // ~35 entries
STOREFRONT_THEME_IDS  = ['default', 'midnight', 'sunset', ...]          // 13 layouts
```

Pick one from both. `theme` picks a layout, `palette` picks one of that
layout's curated colourways. The home uses `theme: 'default'`, `palette: 'concrete'`.

## How a block is picked and configured

Blocks are registered in the Puck editor config at
`platform/web/storefront/storefrontCms.tsx`:

- Every key in `components` is a block `type` in the schema's discriminated union.
- A block with no schema entry cannot render (dropped silently by
  `parseStorefrontPage`). To add a new block type: add its schema to
  `StorefrontBlockSchema` (the `discriminatedUnion`), add its component to
  `ui/storefront/blocks/`, wire the slot in `StorefrontBlockSlots.tsx`, and
  register in the Puck config.
- Category groups: `identity`, `content`, `commerce`, `layout`, `browse`.

Block props are the document-facing configuration (the schema validates them),
not the data (slots resolve data at runtime).

## How a ProductRow picks products

The block stores explicit `d` tags of listings the editor chose:

```ts
productDTags: string[]  // the listing's kind-30402 `d` tag
```

These are **real, published listing `d` tags**. A placeholder or fabricated id
is a row that resolves to nothing — no card renders, which is worse than an
honest empty row because a visitor is told a product exists that does not.

The `ProductRowSlot` (in `StorefrontBlockSlots.tsx`) resolves each `d` tag
through a coordinated `fetch` with `#d: [productDTags]`. It is not
author-anchored (the app key owns no listings), so the read is the explicit
addresses themselves. Resolution is in the order the editor placed them.

## How the route renders the home

`platform/web/routes/index.tsx`:

```
Search state (`?q=`, `?p=`) → BrowseIndexHost (the browse surface)
No search state            → CMS blocks via StorefrontRenderer inside BrowseNav
```

The CMS renderer is the **same** `StorefrontRenderer` used for published pages,
with the platform `storefrontBlockSlots` providing the data wiring (resolves
product reads, wires search navigation, maps category keys to `/?q=<key>`).

## Traps

### No fabricated figures
A CMS block must never render a fabricated number. A literal placeholder id on
a `ProductRow.productDTags` entry IS a fabricated row — it resolves to nothing
and the block renders no card. Worse than absence: a visitor is told a product
exists that does not. Every entry must be a real, published listing `d` tag.

### Parser gates on version
The very first check in `parseStorefrontPage` is `doc.version !== 1`. If it
does not match, the whole page is `null`. No error screen — just an empty root.
Always set `version: STOREFRONT_PAGE_VERSION`.

### A block with no schema entry cannot render
Adding a block component in `ui/` but not adding its schema to the
discriminated union means `parseStorefrontPage` drops it silently. The dropped
block counter increments, but the page renders no element for it. A developer
checking the dropped count in tests catches this.

### Palette must be a real key
An unknown palette string fails the schema refinement and falls back to `''`,
which is the empty string. That string bypasses the theme registry lookup —
blocks render but have no colour tokens. Pick from `STOREFRONT_PALETTE_KEYS`.

### The Categories block is flat
Categories have no parent/child reasoning. Each entry's `key` maps to
`/?q=<key>` at the host. The taxonomy is a labeller-side guide only.

## Future: published-page resolution

The plan (bca37f141) specifies resolving the home page from a published
kind-30024 event via `useStorefrontAddressPage(APP_PUBKEY, 'home')` and
preferring over the inline constant when available. That path was not
implemented because:
1. The app key is not a signing identity a client holds.
2. The staging instance suppresses external publishing (ADR-016).
3. The inline constant was simpler and share the same renderer.

When the app key's own `home` page becomes readable, the route can call
`useStorefrontAddressPage(APP_PUBKEY, 'home')` and fall back to `HOME_PAGE`
when `shouldRenderStorefrontPage` is false.

## Tests

`platform/web/storefront/homePage.test.ts` asserts the document parses with
zero dropped blocks, has the right block types in order, a real palette, and
non-empty product d-tags. Run with:

```
bun test --isolate platform/web/storefront/homePage.test.ts
```

A new block added to the home page must also be asserted here — the test is
the only fast feedback that the version, palette, or a dropped block hasn't
regressed.