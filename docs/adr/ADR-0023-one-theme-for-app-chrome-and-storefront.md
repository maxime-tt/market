# ADR-0023: One Theme for App Chrome and Storefront

## Status

Proposed — Plebeian Reckless test instance

## Date

2026-11-19

## Related

- ADR-0006: Nostr-native page building (CMS)
- ADR-019: Unified storefront identity and page builder
- ADR-0022: Admin console theme (the "mullet")
- ADR-0024: Products pages in the Arena chrome
- `styles/arena-chrome.css` — today's hand-written Arena scope
- `sdk/config/storefront/storefrontThemes.ts` — storefront theme registry
- `platform/web/storefront/storefrontCms.tsx` — Puck block registry

## Context

Right now there are two theme systems side by side:

- **Arena chrome** (`.arena-chrome`, `.arena-login`, `.arena-wallet-dialog`)
  is a fixed set of colours in a CSS file. It styles the header, footer,
  login, wallet and the routes listed in `usesArenaChrome`.
- **Storefront themes** (14 layouts, palettes and 6 tune axes: radius,
  shadow, glass, spacing, texture, handmade) style Puck pages.

So a shop can pick "forest" for its page while the header and wallet around
it stay Arena pink. Users who want their own look have to touch CSS.

## Decision

One token set, one source, every public surface:

1. **One token set.** The public role tokens (`--surface-*`, `--fill-ink`,
   `--text-*`, `--border-*`, fonts, radius) are produced once from the active
   theme. `.arena-chrome`, `.arena-login`, `.arena-wallet-dialog` and the
   storefront all read that set. The header and the wallet always match the
   page they sit on.
2. **One source.** The instance theme is the default. A storefront page may
   pick its own theme from the registry, and the chrome follows it on that
   page. Arena becomes one entry in the registry, not a special CSS file.
3. **Themes are data, not CSS.** A theme is a small Nostr event holding:
   - colours (validated hex),
   - a font choice from the bundled list (`styles/fonts.css`),
   - tune numbers (the 6 axes, clamped to safe ranges).

   No raw CSS, no URLs, no external fonts. Ever. Nothing from Google or any
   other third-party host.

4. **Readability is checked, not hoped for.** Before a theme is saved, text
   and button pairs are checked for contrast (WCAG AA). Failing pairs are
   nudged or the save is refused with a friendly hint.
5. **Theme Studio is the editor.** The Theme Studio (palette, fonts, tune
   sliders, live preview of header, wallet, cards and blocks) writes the
   theme event. Saved Puck sections can be reused across pages; they carry
   block data only and inherit the theme.
6. **The dashboard is unchanged.** ADR-0022 still applies: the admin console
   keeps its own fixed theme.

## Consequences

- `styles/arena-chrome.css` shrinks to a mapping from theme values to role
  tokens; the Arena hex values move into the registry.
- Components must use role tokens only. Hard-coded `bg-white`, `text-gray-*`
  and similar classes are bugs on public routes (see ADR-0024).
- Portalled pop-ups (dialogs, menus) need the theme scope copied onto them,
  as `.arena-login` does today.
- Sharing a theme is just sharing an event; anyone can fork it in the Studio.
- Until this lands, the Arena scope stays hand-written and is the only
  public chrome theme.
