# Theming guide

A quick tour of how the market gets its look, and where to change it.

## The short version

- **Public site** (home, auctions, products, the header, login and wallet)
  uses the **Arena** theme.
- **Dashboard and admin** use the **admin console** theme: Glass, Solid or
  Minimal, with your own colour (Teal by default) and mode (light by default).
- **Storefront pages** built in the Puck editor use a **storefront theme**
  from the registry.

All fonts are bundled in `styles/fonts.css`. Nothing is loaded from Google
or any other third-party host, and nothing tracks visitors. Please keep it
that way.

## Tokens: the one rule

Write components with role tokens, never raw colours:

| Use                                | For                               |
| ---------------------------------- | --------------------------------- |
| `bg-surface-raised`                | cards, panels                     |
| `bg-surface-sunken`                | wells, inputs, fallbacks          |
| `bg-surface-hover`                 | hover states                      |
| `bg-fill-ink`                      | the main action (pink in Arena)   |
| `bg-fill-accent`                   | admin accent (dashboard)          |
| `text-text-high` / `text-text-mid` | body / secondary text             |
| `border-border-default`            | hairlines                         |
| `font-heading`                     | display titles (Instrument Serif) |

Avoid `bg-white`, `text-gray-*`, `bg-gray-*` and `border-black`. They ignore
the theme and look wrong in dark scopes.

## Scopes

A scope is a class that rebinds token values for everything inside it.

| Scope                     | Where                                   | File                      |
| ------------------------- | --------------------------------------- | ------------------------- |
| `.arena-chrome`           | routes in `usesArenaChrome`             | `styles/arena-chrome.css` |
| `.arena-login`            | portalled login and wallet dialogs      | `styles/arena-chrome.css` |
| `.arena-wallet-dialog`    | wallet deposit and send dialogs         | `styles/arena-chrome.css` |
| `.admin-console`          | dashboard, settings, page editor chrome | `styles/admin-theme.css`  |
| `[data-storefront-theme]` | Puck page preview and public pages      | storefront theme registry |

To move a route onto Arena, add it to `usesArenaChrome` in
`platform/web/layout/appChrome.ts`, swap any raw colours for tokens, add a
test case in `appChrome.test.tsx`, and check it on desktop and phone.

## Storefront themes and Puck

- **Themes** live in `sdk/config/storefront/storefrontThemes.ts`: layouts,
  palettes and six tune axes (radius, shadow, glass, spacing, texture,
  handmade).
- **Blocks** are a closed set of 13 types in
  `sdk/commerce/storefront/storefrontPage.ts`, registered for Puck in
  `platform/web/storefront/storefrontCms.tsx`.
- **Templates** (blank, link-in-bio, shop, showcase) are in
  `sdk/config/storefront/storefrontTemplates.ts`.
- **Pages** are published as Nostr events (kind 30024); drafts stay in the
  browser until you publish.

Blocks never carry colours. They inherit the theme, so one page works with
any theme.

## Where this is heading

ADR-0023 plans one token set for the header, wallet and storefront, with
themes saved as small Nostr events (validated colours, a bundled font,
tune numbers, no raw CSS) and edited in Theme Studio with a contrast check.

## Decisions

- [ADR-0022](adr/ADR-0022-admin-console-theme.md): admin console theme
- [ADR-0023](adr/ADR-0023-one-theme-for-app-chrome-and-storefront.md): one theme for chrome and storefront
- [ADR-0024](adr/ADR-0024-products-pages-in-arena-chrome.md): products pages in Arena
