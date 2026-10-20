# AGENTS.md — ui

This directory follows the repository-level `AGENTS.md`, `src/AGENTS.md`, and
ADR-0007 (as amended 2026-10-20), ADR-0021, and ADR-0006.

## Context

`ui/` is the **component library**. It owns every presentational component in
the product: Shadcn primitives, wrappers, atoms, molecules, layout shells,
dialogs, navigation renderers, and feature view modules. It is consumed by
`platform/web/` (the assembler), by `widget-book/` (the component gallery and
test harness), and by future clients.

`platform/web/` composes these components with data. It does **not** define
components, layout, navigation, or presentation markup. `src/` is the legacy
host and is not a destination for migrated UI.

## Hard boundary (enforced)

`ui/boundary.test.ts` fails the build if any file under `ui/` imports:

- `@/…` (the legacy host)
- `@platform/…`
- `@tanstack/…`
- `@nostr-dev-kit/…`
- `applesauce-*`
- `nostr-tools`
- any relative path that escapes `ui/`

`@sdk/…` type and workflow imports are permitted. `@ui/…` and relative imports
inside `ui/` are permitted.

Consequences, stated plainly:

- A component is a **pure function of props**: data in, callbacks out.
- No store subscriptions, no query hooks, no `fetch`, no routing, no signing,
  no publishing, no clipboard side effects hidden in render.
- Data adapters, auth, wallet, cart and payment actions are invoked by the
  platform/assembler and passed down as props.
- If a component needs app state that cannot be expressed as props, the
  abstraction is wrong — add the prop or move the wiring up, do not import it.

## Directory structure

```
ui/
  primitives/   ← Shadcn primitives (generated, unmodified)
  wrappers/     ← Wrappers around primitives/ with custom styling/behavior
  shared/       ← General-purpose reusable components (non-domain-specific)
  nostr/        ← Nostr-domain presentational components
  layout/       ← Structural components (AppShell, Header, Footer, Sidebar, PageLayout)
  nav/          ← Navigation model types + renderers (SidebarNav, Breadcrumbs, BackButton)
  dialogs/      ← Dialog compositions built on primitives/dialog
  theme/        ← ThemeMigrationWrapper + dynamic theme token application
  provider/     ← Provider/context plumbing that carries values into components
  utils/        ← Pure helpers (no React state, no I/O)
  <feature>/    ← Feature view modules (checkout, orders, wallet, dashboard, …)
```

New components go in the narrowest directory that fits. Domain-agnostic
building blocks belong in `shared/`; Nostr-specific presentational components
in `nostr/`; page-section compositions in the matching feature directory.

## Component classes and the props contract

Classify every component before writing it:

| Class            | Definition                                                                          | Examples                                                     |
| ---------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| **Primitive**    | Generated Shadcn wrapper around a Radix element. Do not hand-edit.                  | `primitives/button.tsx`                                      |
| **Wrapper**      | Adds project styling/behavior to one primitive.                                     | `wrappers/tooltip-button.tsx`                                |
| **Atom**         | Single purpose, no composition of peers, no data.                                   | `shared/price-display.tsx`, `shared/status-badge.tsx`        |
| **Molecule**     | Composition of atoms/wrappers around one concept.                                   | `shared/entity-list-item.tsx`, `shared/confirm-dialog.tsx`   |
| **Feature view** | A page section or flow view. May be larger and feature-aware, but still props-only. | `checkout/checkout-view.tsx`, `orders/order-detail-view.tsx` |

### Required for every new or migrated component (ADR-0007 §1c)

1. **`className` + `cn()`** — accept `className?: string`, merge with internal
   classes through `cn()` from `@/lib/utils` (re-exported locally if needed).
2. **Ref exposure** — prefer React 19 ref-as-prop; use `forwardRef` only where
   a dependency requires it. Expose `ref` on the root element.
3. **Callbacks for actions** — `onX` props. Never call stores, queries, or
   mutations directly.
4. **No data fetching.** No `fetch`, no `useQuery`, no `useStore`.
5. **Density/variant naming** — use `variant` and `compact` consistently.
   Do not introduce `isCompact`, `dense`, `small`, or one-off synonyms.
6. **Semantic tokens only** — `text-muted-foreground`, `bg-card`, `border`,
   `text-primary`; never raw hex, `rgb()`, `oklch()` literals, or
   `border-zinc-200` / `bg-white`. Fonts use `font-body` / `font-header`
   (never `font-sans` / `font-heading`).
7. **Accessibility** — every control has an accessible name; disabled controls
   that need a reason use the shared disabled-with-tooltip pattern; dialogs
   keep focus trapping and `aria` wiring from the primitive.

Purpose-specific feature views may relax 5–6 where a design requires it, but
must document why in the file header.

## Shared state kit (single implementation per concern)

Do not create a second implementation of a user-facing concern. When the shared
component exists, use it:

| Concern                                         | Canonical component (create if absent)                              |
| ----------------------------------------------- | ------------------------------------------------------------------- |
| Empty list / no results                         | `shared/empty-state`                                                |
| Error with optional retry                       | `shared/error-state`                                                |
| Loading (spinner / skeleton)                    | `shared/loading-state`, `primitives/spinner`, `primitives/skeleton` |
| Destructive confirmation                        | `shared/confirm-dialog` (never `window.confirm`)                    |
| Notice / banner (info, warning, error, success) | `shared/notice`                                                     |
| Status chip                                     | `shared/status-badge` (status → variant map)                        |
| Label/value row                                 | `shared/detail-field`                                               |
| Entity list item                                | `shared/entity-list-item`                                           |
| Copy to clipboard                               | `shared/copy-button` / `shared/use-copy-to-clipboard`               |
| Invoice + QR                                    | `shared/invoice-card`                                               |
| Dialog shell (header/footer)                    | `shared/dialog-shell`                                               |

**Escalation rule.** The same concern may vary only by escalation level:
modal/dialog for high importance, in-page banner for medium, toast for low.
Two components must not use different escalation levels for the same class of
event.

## Import hierarchy within `ui/`

```
utils        ← leaf
primitives   ← leaf
wrappers     → primitives, utils
shared       → primitives, wrappers, utils
nostr        → primitives, wrappers, shared, utils
layout       → primitives, wrappers, shared, nostr, nav, utils
nav          → primitives, wrappers, shared, utils
dialogs      → primitives, wrappers, shared, nostr, utils
theme        → primitives, utils
provider     → primitives, utils
<feature>    → any `ui/` directory
```

Cycles are prohibited. A lower layer must not import a higher one.

## Navigation model

Nav is data, not router introspection:

- `nav/model.ts` defines `NavItem`, `NavSection`, `NavModel`.
- `platform/web/` supplies the model, projected from route metadata
  (`staticData`) and the current `pathname`.
- `ui/nav/*` renders it (`SidebarNav`, `Breadcrumbs`, `BackButton`).
- No component derives parent paths, titles, emoji, or badges from hardcoded
  path tables.

## Theme

- `theme/theme-migration-wrapper.tsx` is the only token-scope wrapper.
- It applies `.theme-new` plus optional dynamic token overrides, and mirrors
  those overrides onto the portal host so portalled dialogs resolve the same
  tokens.
- Components use the scoped tokens directly; they never branch on theme or
  instance.

## Tests

- Every new atom/molecule gets a `*.test.tsx` beside it (Bun test) covering
  variants, disabled reasons, and empty/error/loading states.
- Every component gets a widget-book Playwright spec under
  `widget-book/<library>/<Component>.spec.ts`.
- A component that cannot render in the widget book (because it needs
  `platform/` or `src/`) is not a `ui/` component — move the wiring out.

## Migration debt

Components currently under `ui/components/` were written before this contract
and are being migrated slice by slice (ADR-0007 §2a: Keep / Modify / Extract /
Replace). Do not rewrite unrelated components while making a change; apply the
contract to the component you touch and record the rest in the slice notes.
