# ADR-0030: Page Editor Flow and Desktop Canvas

## Status

Accepted — Plebeian Reckless test instance

## Date

2026-11-20

## Related

- ADR-0019: Unified storefront identity and page builder
- ADR-0029: Zine home page
- `platform/web/storefront/StorefrontBuilder.tsx`, `StorefrontSetupWizard.tsx`, `storefrontCms.tsx`
- `platform/web/storefront/fields/ThemePickerField.tsx`
- `styles/admin-theme.css`

## Context

Testing the page editor turned up four problems:

- Hovering any block filled it with a solid accent colour.
- The canvas was about 650px wide, so pages showed their phone layout.
- Colours were split across two lists (looks, then colourways) with long descriptions.
- The setup wizard said "Choose a theme" while its first section read "1 · Pick a layout".

The solid hover came from the CSS build. lightningcss, through the Tailwind plugin, writes an `@supports` copy of only the first `color-mix` custom property in a rule. Every later one is reduced to the bare `var()` it mixes, so Puck's 12% hover tint became the full accent colour.

## Decision

- **One mixed colour per rule.** Every custom property built with `color-mix` in `admin-theme.css` sits in a rule of its own. A comment there explains why.
- **Desktop canvas.** Puck renders the canvas in its own frame (`iframe.enabled`) with Desktop 1280, Tablet 768 and Phone 390 viewports. Puck picks the one closest to the window and scales it to fit, so authors see the desktop layout and can switch with the buttons above the canvas. This replaces the inline canvas from ADR-0019. Styles are copied into the frame, and React context still reaches the blocks through Puck's portal.
- **Slimmer columns.** The block list is 200px and the settings column 272px. Dragging a sidebar edge still overrides.
- **Three steps everywhere.**
  1. **Choose layout**: the page template.
  2. **Choose colours**: one list of every look and colourway, name and swatches only. Single-colourway looks share a "Classic" group, and the rest are grouped under their look.
  3. **Make it yours**: the six tune sliders.

  The wizard follows these steps, with a desktop-width preview scaled to fit. The editor's settings column shows the same Colours list and Make it yours panel. Picking a colour writes the look and colourway together, and resets the tuning only when the look changes.

- **Phone editing.** Below Puck's 638px breakpoint the editor grows with the page and the canvas takes 75% of the screen height. Without this the publish header filled Puck's fixed box and the framed canvas collapsed to nothing.
- **No repeated colours.** Brutalist and Neon are listed once, under Plebeian, instead of under every look. The Concrete look is retired: `brut` stays in the schema so old pages still parse, and it renders as Plebeian.
- **Home default.** Change template on the home page starts on On the block.

## Consequences

- Blocks that use media queries now respond to the frame width, so Phone and Tablet previews show the real mobile layout.
- The palette has no field of its own in the sidebar. The Colours field writes it.
- `ThemeStudio`, `ThemeLayoutGallery` and `ThemePaletteStrip` are gone. `ThemeColourList` replaces them.
