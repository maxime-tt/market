# AGENTS.md — widget-book

This directory follows the repository-level `AGENTS.md` and ADR-0007 §1e.

## Context

`widget-book/` is a **separate client** that renders the `ui/` component
library for manual review and Playwright assertions. It is a sibling of `ui/`,
`platform/`, and `sdk/`, with its own entry point and dev server.

## Hard boundary

- May import: `ui/**` (`@ui/...`), `sdk/**` (`@sdk/...`), and its own files.
- Must NOT import: `platform/**`, `src/**`, `@/...`, or any platform runtime
  module.

This boundary is the point of the harness: a component that cannot render here
is not a `ui/` component (ADR-0007 §1b).

## Rules

- One entry per meaningful state, not one per file. Cover variants, loading,
  empty, error, disabled-with-reason, and destructive confirmation.
- Mock data is defined in the library/spec files; do not add a JSON interpreter.
- Do not add application state, providers from `platform/`, or fetches. If a
  widget needs data, pass a literal.
- New libraries are registered in `libraries.ts` and get a Playwright spec.
- Keep the harness dependency-free beyond what the repo already installs.

## Layout

```
widget-book/
  index.html            ← entry document
  main.tsx              ← catalogue renderer (theme wrapper + tooltip provider)
  server.ts             ← Bun server; injects LIBRARY via /config.js
  libraries.ts          ← registry + selection resolution
  libraries/*.tsx       ← one module per library
  tests/*.spec.ts       ← Playwright specs
  playwright.config.ts
```
