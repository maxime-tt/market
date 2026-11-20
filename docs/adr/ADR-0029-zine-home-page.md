# ADR-0029: Zine Home Page ("On the block")

## Status

Accepted — Plebeian Reckless test instance

## Date

2026-11-20

## Related

- ADR-0028: Magazine home page (the blocks, shared auction read and template this builds on)
- `sdk/commerce/storefront/storefrontPage.ts` — `AuctionBento`, `ClosingPicks` and the new `style` props
- `ui/storefront/blocks/ZineBlocks.tsx`, `ui/storefront/blocks/zine.css`
- `platform/web/storefront/MagazineBlockSlots.tsx` — `AuctionBentoSlot`, `ClosingPicksSlot`, `useShowcaseProducts`
- `sdk/config/storefront/storefrontTemplates.ts` — `ZINE_HOME_BLOCKS`, the `zine` template
- `docs/guide/storefront.md`

## Context

We drew three home mockups. The owner picked the "On the block" zine layout: a big headline over a bento of lots, a tilted band, closing soon beside a pinboard of products, colour collection tiles and bento category sections. The magazine cover from ADR-0028 should stay available as a template for anyone who prefers it.

## Decision

- Two new blocks, in a **Zine** group:
  - **Auction bento**: a serif headline (with `*word*` accent), an optional "N live" sticker and an intro, over up to four lots (one big, one wide, two small). **Auto** shows live lots with the most bids first, then fills with other lots that have a picture. **Picked** shows up to four lots in the order chosen. The big lot gets a round sticker with its top bid.
  - **Closing soon + picks**: a numbered list of lots by end time beside a pinboard of product polaroids. Products come from the featured list, or the newest listings with a picture if the list is empty, or up to six picked products.
- Existing blocks gain a `style`, so old pages keep their look:
  - **Ticker**: `strip` (default) or `band`, a big tilted band in the accent colour.
  - **Collections row**: `cards` (default) or `tiles`, colour tiles with a fan of pictures.
  - **Category section**: `row` (default) or `bento`, one big pick beside four small ones, with an optional badge and a "See all" pill.
- The new `zine` template ("On the block", Arena theme) uses these blocks. It is also the built-in home when no home page is published. The `magazine` template ("Magazine cover") stays in the list.
- The newest-listing fallback now fills every slot. It takes one listing per seller first, then more from the same sellers, but never the same picture twice.
- Same rules as ADR-0028: theme tokens only, container queries so the editor matches the live page, reduced motion stops the band, no third-party fonts or scripts, nothing stored about someone else's listing.

## Consequences

- Templates live in code, so every instance gets both layouts with the next deploy. A template is a starting point: once applied, the page is a normal document the author can change.
- A published home page still wins over the built-in one. To switch an instance, open the home page in the editor, choose **Change template → On the block** and publish.
- Saving your own page as a new template is not part of this change. Today a template is added in `storefrontTemplates.ts`.
