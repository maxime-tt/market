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
   professional design system, the same on every instance, in three styles:
   **Glass** (translucent panels on a soft colour glow, the default),
   **Solid** (opaque cards on a quietly tinted ground) and **Minimal** (no
   panels, hairlines and white space). All three share the same colour and
   mode controls.
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
   shopper's experience. The panel (`ui/wallet/nip60-wallet-view.tsx`) is
   written in role tokens only and the account menu mounts it inside the
   `.arena-chrome` scope; the four Lightning / Cashu ecash dialogs it opens are
   portalled, so they carry the login dialog's `.arena-login` scope plus
   `.arena-wallet-dialog` (pill buttons, serif title) from
   `styles/arena-chrome.css`. The same look applies on the dashboard, because
   the wallet is never inside `.admin-console`.
7. **No third-party assets.** The console uses the bundled InterVariable font
   and lucide icons; nothing is loaded from Google or any other host.

## Consequences

- Dialogs, popovers, menus and selects render through portals outside
  `.admin-console`. While the dashboard is mounted, each new pop-up whose
  opener sits inside the console (its `aria-controls` trigger, or the element
  focused just before it opened) is tagged `.admin-portal` with the admin's
  attributes and gets the console tokens. Pop-ups opened from the header (the
  account menu, the wallet popup) or from the editor preview keep the public
  theme. Legacy utility remaps do not apply inside portals.
- The site header publishes its measured height as `--app-bar-h`; the
  dashboard's sticky title and full-height panes use it instead of fixed
  offsets. From `xl` the header shows its nav links inline only when the brand
  and the whole list fit its left lane; otherwise the menu button carries them,
  so the instance name is never truncated and no link wraps.
- Legacy hard-coded utility classes (for example `bg-white`, `border-black`,
  `bg-pink-500`) are remapped inside the console only, never inside the
  preview, so older screens follow the console theme without edits.
- Owners may later be allowed to customise the console default. Until then it
  is the same for every instance.
