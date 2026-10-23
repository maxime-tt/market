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

## Declared boundary duplicates (`#b22838`)

The method allows a duplicate that must exist across a spec/trust boundary
**only when the shared parent spec declares it with its reason**. Two are
declared here:

1. **`cn()`** — byte-identical in `ui/utils/cn.ts` and `src/lib/utils.ts`.
   Declared because `ui/boundary.test.ts` forbids `@/…`, so `ui/` cannot import
   the legacy copy. This is one spec realised twice across a trust boundary,
   not the same language maintained twice by choice. Do not merge; do not
   "fix" it by importing `@/lib/utils`.
2. **`src/components/*` host → `ui/components/*View` split** — the legacy host
   wires stores/queries and passes props into the presentational view. Declared
   by ADR-0007 §1b/§2a (the legacy host is progressively retired). Not
   duplication.

**Not declared, and therefore a finding to resolve rather than keep:**
`ui/components/Media.tsx` vs `ui/provider/UiProvider.tsx` `UiImage` — one spec
implemented twice inside the same module. Resolve by making `Media` consume the
provider image seam.

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

`ui/components/` is **transitional** and is now drained: it holds only
`auction-editor/`, whose monolithic `AuctionEditorTabs` (200 raw-palette
expressions in one file) is deliberately deferred to T6.3's host/view split —
migrating it in place would mean migrating it twice. Everything else now lives
in the taxonomy above. New and migrated components must not be added there.

## Import convention

Canonical internal path is `@ui/{directory}/{component}` (or a relative import
inside `ui/`). `ui/index.ts` is an outward-facing aggregate for consumers
outside `ui/` (widget-book, future clients) — it is **not** a required internal
import path, and adding a component does not require touching it.

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
   classes through `cn()` from `ui/utils/cn.ts` (import it relatively as
   `../utils/cn`, or as `@ui/utils/cn`). Never import `@/lib/utils` from `ui/`;
   the two copies are a declared boundary duplicate (see above).
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
   (never `font-sans` / `font-heading`). Shadows use the Tailwind scale
   (`shadow-xs/sm/md/lg`), which resolves through the themed
   `--shadow-*-value` tokens; never a raw `box-shadow` value.
7. **Accessibility** — every control has an accessible name; disabled controls
   that need a reason use the shared disabled-with-tooltip pattern; dialogs
   keep focus trapping and `aria` wiring from the primitive.

Purpose-specific feature views may relax 5–6 where a design requires it, but
must document why in the file header.

### Expanded theme dimensions (ADR-0007 §1a-bis)

The stylesheet exposes six theme dimensions. Token defaults are visual no-ops,
so a component can adopt a utility without changing the current rendering.

| Dimension  | Token(s)                                              | Component usage                                                                              |
| ---------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Colour     | `--background`, `--primary`, …                        | semantic utilities only                                                                      |
| Typography | `--font-body`, `--font-header`                        | `font-body` / `font-header` where an override is needed; the base inherits from `.theme-new` |
| Corners    | `--radius`, `--handmade`                              | `rounded-*`; opt into `.rounded-hand` for the irregular treatment                            |
| Shadows    | `--shadow-scale`, `--shadow-tint`, `--shadow-*-value` | `shadow-xs/sm/md/lg` (never raw `box-shadow`)                                                |
| Glass      | `--glass`                                             | `.glass` on surfaces that float (dialogs, popovers, nav, page header) — opt-in               |
| Texture    | `--grain`                                             | `.grain` once on the app shell / harness wrapper, never per component                        |
| Spacing    | `--gap`                                               | `calc(var(--gap)*…)` gaps and padding in layout components only                              |

Surface-like components expose opt-in props rather than hard-coding the
effects: `surface?: 'solid' | 'glass'` and `corners?: 'default' | 'handmade'`
(see `shared/stat-card.tsx`, `shared/entity-list-item.tsx`,
`shared/confirm-dialog.tsx`, `layout/page-header.tsx`).

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

**Kit status (2026-10-20).** Present: `empty-state`, `error-state`,
`loading-state`, `confirm-dialog`, `notice`, `status-badge`, `detail-field`,
`entity-list-item`. Absent (Wave 2): `copy-button` / `use-copy-to-clipboard`,
`invoice-card`, `dialog-shell`. Do not add a second ad-hoc implementation of an
absent component — extend the nearest existing atom and record the gap.

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
- The six dimension defaults live in `:root` (unwrapped legacy host) and
  `.theme-new` (wrapped subtrees). The `--shadow-*-value` tokens are mirrored
  into `.theme-new` so a wrapper-level `--shadow-scale` recomputes instead of
  inheriting a value computed on `:root`.
- `theme/tune.ts` defines the tune settings and their token mapping;
  `theme/tune-panel.tsx` is the props-only control panel the widget book uses
  today and the CMS will reuse.
- Components use the scoped tokens directly; they never branch on theme or
  instance.

## Tokens — which one to use

The palette is three tiers, decided in
`runs/union-1420/TOKEN-ARCHITECTURE-DECISION.md` (the authoritative contract;
`runs/union-1420/proposal-1-decision-architecture.md` is its evidence and is
**superseded on every name**). Enforced by `theme/token-contract.test.ts`.

| tier             | what                                                                                                                                                                                                              | rule                                                                                                                                                                                      |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0 — Identity** | `--brand-pink`                                                                                                                                                                                                    | **Never used by a component** (ruling R5). It is the brand constant; components use the role.                                                                                             |
| **1 — Roles**    | `--bg`, `--surface-{raised,sunken,hover}`, `--fill-{accent,ink,ink-hover}`, `--on-fill-{accent,ink}`, `--on-media`, `--text-{high,mid}`, `--border-{default,strong}`, `--focus-{ring,attention}`, `--radius-pill` | **This is the API.** New and migrated components use these.                                                                                                                               |
| **2 — Compat**   | `--primary`, `--secondary`, `--background`, `--card`, `--sidebar-*`, `--chart-*`, `--neo-*`, …                                                                                                                    | Frozen legacy names so generated `primitives/**` keep resolving. **No design authority** — never use in new code, never hand-edit. It is permanent (ruling R9), not a migration leftover. |

The five rules that follow from it:

1. **Roles, not colours.** `bg-fill-accent` / `text-on-fill-accent`, never
   `bg-brand-pink` and never a raw literal. A colour is only ever a role.
2. **A fill always ships with its label.** `--fill-*` pairs with `--on-fill-*`;
   the state families pair `--info` with `--info-foreground`. Never use a fill
   token as text.
3. **Scheme-stable vs inverting.** `--brand-pink`, `--fill-accent`,
   `--focus-ring` and `--on-media` are the _same value in light and dark_ — they
   carry identity.
   `--bg`, `--fill-ink`, `--text-*`, `--surface-*` **must** differ between modes —
   they carry a role. A token that switches _meaning_ between modes (legacy
   `--primary`: ink in light, pink in dark) is the defect this architecture
   exists to remove. **If you need a colour that survives a mode switch, it needs
   its own scheme-stable token — never borrow an inverting one.**
4. **`--secondary` means nothing.** It is pink in light and grey in dark today.
   Do not reason about it or adopt it; migrate pink intent to `--fill-accent`
   per call site (ruling R3).
5. **Two focus colours, deliberately** (ruling R4): `--focus-ring` (brand pink,
   the ring the primitives use) and `--focus-attention` (the legacy yellow
   `#ffd53d`, an accessibility signal). Do not collapse them.

**Text on something the theme does not own: three different roles.** Picking the
wrong one is the most common mistake in this tree, so state it explicitly:

| the text sits on…                                           | use                   | why                                                                                                                          |
| ----------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| a **brand** fill (`bg-fill-accent`)                         | `text-on-fill-accent` | the fill is a role and it inverts with its label                                                                             |
| a **deliberate ink surface** (`bg-fill-ink`)                | `text-on-fill-ink`    | the ink surface is a role; label and fill invert together                                                                    |
| **imagery, an overlay/scrim, or a caller-supplied surface** | `text-on-media`       | the pixels behind the text do **not** invert, so the ink cannot either — this is the only scheme-stable ink, and it is white |

`text-on-media` is not a general-purpose "light text": reach for it only when the
surface is genuinely outside the theme (a photo, a video thumbnail, a scrim, a
hex prop). A _deliberate_ dark panel is `bg-fill-ink` + `text-on-fill-ink` — if it
gets `text-on-media` it will be unreadable once the theme is dark, because the
panel will have inverted and the ink will not.

**Surfaces the theme deliberately does not own, as of T6.2.** The migration
found three roles with no Tier-1 name, and left the raw utility in place rather
than invent one (R8). They are recorded here so the next author does not have to
rediscover them, and so the T6.4 guard can whitelist them with their reason:

| the surface                       | raw utility still used                                                   | why it has no role                                                                                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a **scrim / overlay** over media  | `bg-black/40`, `/50`, `/60`, `/95`, `from-black/80`, `hover:bg-white/20` | an overlay is not a fill of the layout; no scrim role was ruled                                                                                                     |
| a **scheme-stable black** surface | `bg-black` as an image letterbox                                         | it must **not** invert — a letterbox that lightens with the theme breaks the frame against the image — and Tier 1 has no scheme-stable dark (`--text-high` inverts) |
| a **scheme-stable white** surface | `bg-white` under a QR code                                               | it must stay white to remain scannable; `bg-surface-raised` follows the theme into dark                                                                             |

A fourth, non-token case: an alpha hairline or ring over a **caller-supplied**
surface (a background class passed in as a prop, a className handed to a caller's
render prop) is not the theme's to colour; those stay raw as well.

**Adding a token** (ruling R8): a new Tier-1 token needs (a) a named role that no
current token expresses, (b) the call sites it serves, and (c) a deletion in the
same commit. Budget: **≤ 50 Tier-1 names**, enforced by the contract test. When a
new role seems needed, the answer is usually that the call site wants an existing
role (`--surface-hover`, `--text-mid`) — check before adding.

### Two mistakes this cost us (do not repeat them)

- **Never conclude what a token _is_ from one scope.** The D5 handover claimed
  `.theme-new --primary` was the brand pink by comparing legacy **light**
  `:root` against legacy **dark**; the value it quoted was `.dark --primary`. A
  token has four values during the migration (`:root`, `.dark`, `.theme-new`,
  `.dark .theme-new`) and they can disagree. Grep all four before believing one.
- **An `@font-face` declaration is not a base-font application.** Reading
  `font-family: 'reglisse'` inside a `@font-face` block as "the app's base font"
  produced a wrong conclusion in the same review. The base font comes from
  Tailwind's `--default-font-family: --font-sans` chain; reglisse is applied only
  by the `font-heading`/`font-header` utilities.

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

## Method accounting (`method/`)

`method/checks/check.py` reports `ui/`, `platform/web/`, and `src/components/`
as non-modules (they have `AGENTS.md`, not the `<module>.md` the routine looks
for). This is a **declared opt-out**, not silence (`#11d72f`): the method is
carried in-tree as a declared divergence (`#51692c`), and its `modularization`
accounting level is advisory here during the UI migration. These trees are
governed by this contract instead.

**Exit criterion:** when the migration completes, either add `<module>.md`
front-matter for the settled trees or record a permanent opt-out with its
reason, per `#11d72f`.
