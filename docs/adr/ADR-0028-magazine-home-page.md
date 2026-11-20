# ADR-0028: Magazine Home Page

## Status

Accepted — Plebeian Reckless test instance

## Date

2026-11-20

## Related

- ADR-019: Unified storefront identity and page builder
- ADR-0023: One theme for app chrome and storefront
- ADR-0026: Fast first loads
- `sdk/commerce/storefront/storefrontPage.ts` — block schemas
- `ui/storefront/blocks/MagazineBlocks.tsx`, `ui/storefront/blocks/magazine.css`
- `platform/web/storefront/MagazineBlockSlots.tsx` — data for the new blocks
- `sdk/config/storefront/storefrontTemplates.ts` — `MAGAZINE_HOME_BLOCKS`, the `magazine` template
- `docs/guide/storefront.md`

## Context

The home page opened on a welcome banner and an intro animation, then a search box, one auction row, categories and a product row. We wanted it to read like a magazine: a featured live lot first, auctions before products, collections, a "closing soon" row and products by category. Every part of it should be editable in the page editor, not hard-coded.

## Decision

- Five new page-editor blocks, in a **Magazine** group:
  - **Ticker strip**: a scrolling line of short messages, plus optional live stats (lots live, the next lot to close, bids today).
  - **Cover auction**: one lot, big, with a live countdown, the current bid and a call to action. **Auto** picks the live lot with the most bids (then the highest bid, then the one closing soonest). **Picked** shows the lot you choose.
  - **Featured products spread**: one large product and two smaller ones. It uses the instance's featured products; if there are none, it uses the newest listings with a picture, one per seller.
  - **Collections row**: featured collections first, then the newest ones that have a title and items. Collections with pictures come first.
  - **Category section**: a numbered heading and a row of products matching a list of tags. It shows only listings that have a picture and are in stock, and shows each seller's picture once.
- The **Auction list** block gains a card style (`grid`, `closing` or `tall`), an order (`ending`, `popular` or `newest`) and an optional heading link. Old pages keep the grid style and ending-first order.
- Titles accept `*word*` to set one word in the accent colour and italics.
- All auction blocks on a page share one auction read and one 1-second clock (`useSharedAuctionListRead`, `useNowSeconds`). Five auction blocks still make one relay read.
- Category reads go one tag at a time and merge, so one busy tag can't crowd out the rest. Empty reads try again a few times while the relays connect.
- The new `magazine` template ("Magazine cover", Arena theme) lays these out: ticker, cover lot, closing soon, featured auctions, featured products, collections, then four category sections. The same blocks are the built-in home when no home page is published.
- The welcome banner and the intro overlay are gone from the built-in home. The search box stays in the header.
- Styles live in `magazine.css` and use only theme tokens, so the blocks follow whichever theme the page uses. Layouts respond to the block's own width (container queries), so the editor canvas shows the same layout as the live page. On phones, the category and collection rows scroll sideways. The ticker stops moving when reduced motion is on.
- Images load with `referrerpolicy="no-referrer"` and go through `isSafeMediaSrc`. No third-party fonts or scripts are added.

## Consequences

- The editor opens the `home` page the site actually shows: the newest one by the app key, the owner or an admin. It used to open only the signed-in author's own copy, so an older layout could come back on publish. Local drafts still come first.
- A published home page (kind 30024, `d=home`) still wins over the built-in home. To switch a live instance, open the home page in the editor, choose **Change template → Magazine cover** and publish.
- The server-rendered first paint shows the no-host view of the new blocks until the app takes over. Server-side data for these blocks is a follow-up.
- The intro module (`ui/browse/intro`) is no longer used by the home page. It can be removed later.
- Category sections are only as good as sellers' tags. Sections with no matching listings hide on the live page, and the editor shows a hint instead.
