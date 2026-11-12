# AGENTS.md — ui/dialogs

This directory follows `ui/AGENTS.md` (the tree contract) and repo-level `AGENTS.md`.

## Context

`dialogs/` holds dialog **compositions** built on `primitives/dialog` and
`primitives/alert-dialog`. They own the header/body/footer arrangement and the
copy for a specific user-facing flow, but not the data or the submit logic.

## Import rules

- May import: `primitives/`, `wrappers/`, `shared/`, `nostr/`, `utils/`.
- Must **not** import: `@/`, `@platform/`, `@tanstack/`, `@nostr-dev-kit/`,
  `applesauce-*`, `nostr-tools`.
- Controlled by props: `open`, `onOpenChange`, `onConfirm`/`onSubmit`, plus
  data already resolved by the assembler. No store reads, no mutations.
- Props-only: `className` + `cn()`, ref-as-prop.

## What belongs here

- `dialog-shell` — the shared title/description/footer frame.
- Flow compositions moved out of `ui/components/dialogs/*`.

## What does not

- `shared/confirm-dialog` (the generic confirmation atom lives in `shared/`).
- Anything that calls a mutation, store, or `fetch`.
