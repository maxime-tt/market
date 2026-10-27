# AGENTS.md — src/queries

This directory follows the repository-level AGENTS.md and `src/AGENTS.md`.

## Context

`src/queries/` is now a **shims-only** directory. Every path in it is a one-line
`export *` over a platform binding (`platform/web/<feature>/`) or an SDK module;
no query logic lives here any more. New code belongs at the owning destination.

## Where read models live

- Framework-free readers over `EventReadContext` / `EventStorePort` live in `sdk/`.
- The React/query binding over those readers lives in `platform/web/<feature>/`.
- The `src/queries/<name>` path is only a compatibility shim for call sites.

## Constraints

The read-model invariants below apply to the owning module, not to the shim:

- Relay data is untrusted. Validate event kind, tags, author, shape/schema, and
  signature assumptions before treating an event as application state.
- Relay presence is not verified truth. Handle missing, stale, duplicated,
  malformed, deleted, replaced, and conflicting events.
- Addressable identity is `kind:pubkey:d`, not bare `d`.
- Do not collapse payment state into booleans; preserve the lifecycle distinctions.
- Do not put PII, wallet/payment secrets, NWC URIs, or Cashu seed material in
  query keys, logs, or error messages.

## Instructions

- Do not add logic, keys, or types to a shim — import the owning module.
- Keep relay read behavior separate from publish/mutation behavior in
  `src/publish/`.

## Destination

`src/queries/` is deleted in E1, together with the shim strategy. Treat every
file here as temporary: no new call sites, no new tests, no new imports.
