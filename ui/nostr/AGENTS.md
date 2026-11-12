# AGENTS.md — ui/nostr

This directory follows `ui/AGENTS.md` (the tree contract) and repo-level `AGENTS.md`.

## Context

`nostr/` holds **presentational** components whose subject is Nostr identity and
domain data: user cards, identity rows, verified badges, npub display,
featured-user cards. They render data; they never acquire it.

## Import rules

- May import: `primitives/`, `wrappers/`, `shared/`, `utils/`, and `@sdk/*`
  type/workflow modules. `@sdk/…` is permitted by `ui/boundary.test.ts`.
- Must **not** import: `@/` (queries, stores, hooks), `@platform/`,
  `@tanstack/`, `@nostr-dev-kit/`, `applesauce-*`, `nostr-tools`.
- Data enters as props. The platform/assembler runs the query adapter and
  passes results down (ADR-0007 §1b withdrew the old `nostr/` fetch exception).
- Props-only: `className` + `cn()`, ref-as-prop, `onX` callbacks.

## What belongs here

- `user-card`, `identity`, `verified-badge`, `npub-display`,
  `featured-user-card`, `relay-label`.

## What does not

- Anything that calls `useQuery`/`useStore`/`fetch`, or that imports
  `nip19`/`nostr-tools` for encoding (hoist the pure helper to `@sdk/core` or
  pass the encoded value in as a prop).
