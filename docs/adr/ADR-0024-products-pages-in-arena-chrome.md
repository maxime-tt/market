# ADR-0024: Products Pages in the Arena Chrome

## Status

Accepted — Plebeian Reckless test instance

## Date

2026-11-19

## Related

- ADR-0022: Admin console theme (the "mullet")
- ADR-0023: One theme for app chrome and storefront
- `platform/web/layout/appChrome.ts` — `usesArenaChrome`
- `styles/arena-chrome.css` — the Arena token scope

## Context

The Arena look covered only the home page and auction routes. `/products`
and each product page still used the old theme: white cards, grey text,
square black-bordered buttons and a sans-serif title.

## Decision

1. **Routes.** `usesArenaChrome` also matches `/products` and
   `/products/*`, so both render inside `.arena-chrome`. Look-alike paths
   (for example `/productsx`) do not.
2. **Tokens only.** Product cards, the product page, the filter bar, tabs,
   shipping info and social buttons use role tokens (`bg-surface-raised`,
   `bg-surface-sunken`, `text-text-high`, `text-text-mid`,
   `border-border-default`, `bg-fill-ink`). No `bg-white`, `text-gray-*`
   or `bg-gray-*`.
3. **Shapes.** Buttons, quantity controls, tabs and filter chips are pills
   (`rounded-full`). Selected chips and the main action (Add to cart, Start
   Selling) use `fill-ink`, which is Arena pink. Cards are `rounded-2xl` with
   a hairline border.
4. **Type.** Page and product titles use `font-heading` (bundled Instrument
   Serif); body text uses the bundled Plus Jakarta Sans.

## Consequences

- Shared views (`ProductCardHost`, `SelectableBadge`, `SocialButtons`)
  now follow whichever scope they sit in. Outside Arena they fall back to the
  default role tokens, so they still look right elsewhere.
- The rest of the public site followed in ADR-0025.
