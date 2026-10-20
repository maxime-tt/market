# AGENTS.md — ui/nav

This directory follows `ui/AGENTS.md` (the tree contract) and repo-level `AGENTS.md`.

## Context

`nav/` owns the **navigation model** (data) and its renderers. The model is the
single source of truth for sections, items, labels, icons, parents, admin
gating, and badge keys. It is projected from route metadata (`staticData`) by
`platform/web/`, which passes it down as a prop.

## Import rules

- May import: `primitives/`, `wrappers/`, `shared/`, `utils/`; this package's
  own `model.ts`.
- Must **not** import: `@/`, `@platform/`, `@tanstack/`, `@nostr-dev-kit/`,
  `applesauce-*`, `nostr-tools`.
- Renderers receive `navModel`, `pathname`, and `badgeCounts` as props; they do
  not read the router or a store.
- Props-only: `className` + `cn()`, ref-as-prop, `onX` callbacks.

## What belongs here

- `model.ts` — `NavItem`, `NavSection`, `NavModel`, `resolveNav(pathname)`.
- `sidebar-nav`, `breadcrumbs`, `back-button`.

## What does not

- Hardcoded path tables (`backButtonRoutes`, `getBackButtonInfo`,
  `getCurrentEmoji`, `getNotificationCount`) — those are the anti-pattern this
  directory replaces.
- Emoji or per-path branching logic; encode it in the model data instead.
