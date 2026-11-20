# ADR-0025: Every Public Page in the Arena Chrome

## Status

Accepted — Plebeian Reckless test instance

## Date

2026-11-19

## Related

- ADR-0022: Admin console theme (the "mullet")
- ADR-0023: One theme for app chrome and storefront
- ADR-0024: Products pages in the Arena chrome
- `platform/web/layout/appChrome.ts` — `usesArenaChrome`
- `styles/arena-chrome.css` — the Arena scope and the legacy class map

## Context

After ADR-0024, home, auctions and products used the Arena look, but
community, collections, search, posts, profiles, checkout, the cart and setup
still showed the old theme. Moving pages one at a time left the site looking
half-finished.

## Decision

1. **Every public page is Arena.** `usesArenaChrome` is now true for every
   path except `/dashboard` and `/dashboard/*`, which keep the admin console
   theme (ADR-0022). Setup, which has no header, gets the scope too.
2. **Pop-ups too.** While a public page is shown, `<body>` also carries
   `.arena-chrome`, so portalled pop-ups such as the cart sheet, menus and
   dialogs pick up Arena tokens.
3. **Legacy class map.** `styles/arena-chrome.css` maps the old hard-coded
   classes onto Arena values inside the scope: white and grey backgrounds,
   grey text, black and grey borders, `btn-black` and `btn-product-banner`
   (now the pink action), and bare borders. Buttons still on the default
   `rounded-md` corner become pills. Storefront themes and the admin console
   are excluded.
4. **Hand fixes where it shows.** Community, collections, search, posts and
   setup titles use `font-heading`; the cart sheet gets a serif title,
   hairlines, pill buttons and a calm notice; their cards, filter bars and hero
   fallbacks use role tokens; long post text wraps.

## Consequences

- One look across the public site with no per-page opt-in. New pages are
  Arena by default.
- The class map is a bridge, not a licence: new code uses role tokens
  (see `docs/theming.md`), and pages lose their legacy classes as they are
  touched.
- The overlays (cart sheet, dialogs, toasts) sit outside `RouterProvider`
  but are wrapped in `RouterContextProvider`, so router links inside them
  work. Before this, Add to cart crashed the page when the cart sheet opened.
- Messages live in the dashboard, so they follow the console theme.
- When ADR-0023 lands, the Arena values come from the theme registry and the
  same map serves every theme.
