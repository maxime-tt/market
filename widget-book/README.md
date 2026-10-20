# Widget book

A separate client for browsing and testing the `ui/` component library. It is a
sibling of `ui/`, `platform/`, and `sdk/` — not part of the platform app.

Per ADR-0007 §1e, the widget book is the enforcement test for the component
boundary: **it may import `ui/` and `sdk/` only.** If a component needs
`platform/` or `src/` to render, it is not a `ui/` component.

## Run

```bash
bun run widget-book:dev                 # all libraries, http://localhost:3100
LIBRARY=atoms bun run widget-book:dev   # one library
bun run widget-book:test                # Playwright specs in widget-book/tests
```

The selection can also be changed at runtime with `?library=atoms`.

`WIDGET_BOOK_PORT` overrides the default port (3100).

## Add a library

1. Create `widget-book/libraries/<name>.tsx` exporting a `WidgetLibrary`.
2. Export one entry per component **state worth seeing** — variants, loading,
   empty, error, disabled-with-reason, destructive confirmation.
3. Register it in `widget-book/libraries.ts`.
4. Add a Playwright spec under `widget-book/tests/` that asserts the states.

Mock data lives in the spec/library files; there is no intermediate JSON
interpreter.

## Current libraries

| Library | Contents                                                   |
| ------- | ---------------------------------------------------------- |
| `atoms` | `SelectableBadge`, `ProgressBar`, `InfoTooltip`, `Pattern` |
