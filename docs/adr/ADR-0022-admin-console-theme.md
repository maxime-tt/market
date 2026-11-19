# ADR-0022: Admin Console Theme (the "mullet")

## Status

Accepted — Plebeian Reckless test instance

## Date

2026-11-19

## Related

- ADR-019: Unified storefront identity and page builder
- `styles/admin-theme.css` — the console scope and its tokens
- `ui/admin-theme/` — appearance model and the Appearance control
- `platform/web/admin-theme/useAdminAppearance.ts` — per-admin storage

## Context

The dashboard, settings and page editor used the public instance theme. Any
theme an operator chose for their shop (dark, bold, playful) also restyled
their working tools, which made forms and tables hard to read and made every
instance's admin feel different.

## Decision

Business at the front, party at the back:

1. **Public site** keeps the instance theme, unchanged.
2. **Dashboard, admin and settings** render inside `.admin-console`, one fixed
   professional theme, the same on every instance. The first style is
   **Glass**. Solid and Minimal are reserved for later passes and are shown as
   "Coming soon".
3. **Each admin chooses their own appearance**: style, colour and mode. Teal is
   the default colour, light is the default mode, and Auto follows the system
   setting. The choice lives in that admin's browser
   (`localStorage["plebeian_admin_appearance"]`). It is never published to
   Nostr and does not affect other admins or the public site.
4. **The page editor preview keeps the public theme.** Inside
   `[data-storefront-theme]` the console tokens are reset to the `.theme-new`
   public values, so what the editor shows is what visitors see. A unit test
   keeps the reset in step with `styles/globals-new.css`.
5. **The site header is out of scope.** It belongs to Maxime's AppBar work and
   is not restyled by the console.
6. **The wallet popup follows the public theme**, as it is part of the
   shopper's experience.
7. **No third-party assets.** The console uses the bundled InterVariable font
   and lucide icons; nothing is loaded from Google or any other host.

## Consequences

- Dialogs, popovers and menus that render through a portal sit outside
  `.admin-console` and still use the public tokens. They can be brought into
  the console later by giving the portal container the console attributes.
- Legacy hard-coded utility classes (for example `bg-white`, `border-black`,
  `bg-pink-500`) are remapped inside the console only, never inside the
  preview, so older screens follow the console theme without edits.
- Owners may later be allowed to customise the console default. Until then it
  is the same for every instance.
