# AGENTS.md — ui/layout

This directory follows `ui/AGENTS.md` (the tree contract) and repo-level `AGENTS.md`.

## Context

`layout/` holds **structural** components: the app shell, header, footer,
page header, sidebar/dashboard shell, and hero bands. Layout composes other
`ui/` components and arranges slots; it owns no route data.

## Import rules

- May import: `primitives/`, `wrappers/`, `shared/`, `nostr/`, `nav/`, `utils/`.
- Must **not** import: `@/`, `@platform/`, `@tanstack/`, `@nostr-dev-kit/`,
  `applesauce-*`, `nostr-tools`.
- Navigation state arrives as a `NavModel` (from `nav/`) plus `pathname`;
  layout must not read the router itself.
- Props-only: `className` + `cn()`, ref-as-prop, `onX` callbacks.

## What belongs here

- `app-shell` — the `<Header/><main/><Footer/>` frame.
- `header`, `footer`, `mobile-menu` — moved out of legacy `src/components/layout`.
- `page-header` — the sticky desktop/mobile title block currently duplicated in
  several routes.
- `dashboard-shell` — the dashboard chrome currently in
  `platform/web/routes/_dashboard-layout.tsx`.
- `hero` / `hero-carousel` — the home/section hero band.

## What does not

- Route components, data fetching, store reads, or the router.
- Per-page business logic; that stays in the assembler (`platform/web/`).
