# AGENTS.md — ui/wrappers

This directory follows `ui/AGENTS.md` (the tree contract) and repo-level `AGENTS.md`.

## Context

`wrappers/` holds the project's thin adapters around `primitives/`: a single
Radix/Shadcn element plus project styling or behaviour. They are the **only
sanctioned way** for the rest of `ui/` to reach a primitive with custom
behaviour, and the layer routes must consume instead of importing
`@ui/primitives/*` directly (ADR-0007 §1d).

## Import rules

- May import: `primitives/`, `utils/`.
- Must not import: anything from a higher `ui/` layer (`shared/`, `nostr/`,
  `layout/`, `nav/`, `dialogs/`, feature dirs), `@/`, `@platform/`,
  `@tanstack/`, `@nostr-dev-kit/`, `applesauce-*`, `nostr-tools`.
- Props-only: `className` + `cn()`, ref-as-prop, `onX` callbacks.

## What belongs here

- `tooltip-button` — button + tooltip + `disabledTooltip` reason.
- `tooltip-toggle-group-item`, `selectable-badge`, `info-tooltip`,
  `collection-select-field`, `editor-fields`.

## What does not

- Domain components (those belong in `shared/`, `nostr/`, or a feature dir).
- Components that fetch data or read a store (fix the abstraction instead).
