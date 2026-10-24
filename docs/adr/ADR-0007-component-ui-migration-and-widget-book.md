# ADR-0007: Component UI Migration & Widget Book

## Status

Proposed

**Amendment 2026-10-20 (PR #1420 target architecture).** Component ownership
moves from `src/components/` to `ui/`; `platform/web/` is an assembler-only
layer that composes components and must not define them; `src/` is the legacy
host. See §1b (structure and layer roles), §1d (import convention), §1e
(widget book as a sibling client), and §1a-bis (dynamic theme configuration).
Where this amendment and the original text disagree, this amendment wins.

**Clarification 2026-10-24.** §2a's `Extract` "individual files" means _out of the monolith /
not in-line_, never one component per file; cluster files are permitted and precedented, with
per-component widget-book entries and per-library spec files unchanged. See `ui/AGENTS.md`
§ Cluster files.

## Date

2026-08-05

## Related

- Issue: #1153 (original upstream ADR — this ADR formalizes it)
- Issue: c03rad0r/market#20 (staged refinement copy)
- ADR-0001 (AGENTS.md / ADR governance model — enforcement mechanism)
- ADR-0002 (NDK → Applesauce migration — data layer dependency)
- ADR-0006 (Nostr-Native Page Building System / CMS — primary consumer of migrated components)
- PR: `franchovy/pr1/foundation-styles-review-fixes` (original foundation work — philosophy adopted, branch not depended on)
- ADR Proposal: `docs/adr/proposals/v4v-ui-agnostic-audit-and-plan.md` (first migration slice applying this ADR's philosophy)

## Context

The codebase has grown to span multiple domains, resulting in a fragmented UI layer where components are scattered, duplicated, and inconsistent. There are no fixed rules governing component location, styling, or API contracts, leading to hardcoded colors bypassing the CSS variable system, business logic embedded in presentational components, and component-specific styling mixed with global theme definitions. Dark mode lacks coherence with the light theme, and while Shadcn/UI primitives exist, there is no standardized wrapper layer, no shared directory for domain-specific UI, and no enforcement mechanism preventing new ad-hoc components from being created in arbitrary locations.

**Why slice-by-slice migration rather than a big-bang cutover:** The codebase is
actively developed with frequent UI changes — freezing the UI for a
big-bang migration on a long-lived branch would create merge conflicts, block
feature delivery, and make partial progress unshippable. Slice-by-slice
migration via DOM-scoped CSS custom properties allows new and old UI to
coexist on the same page, lets each migration PR ship independently, and
provides a self-documenting progress tracker (migrated subtrees are visibly
wrapped in `.theme-new`).

## Decision

### Part 1: Foundation (Target Specification)

**1a. Stylesheet: Scoped Theme + Slice-by-Slice Migration**
The app should define a new theme under a `.theme-new { ... }` class scope (in a dedicated `styles/globals-new.css`, imported after the existing `styles/globals.css`), rather than on `:root`. Scoping the new token system to a class — applied to migrated subtrees via a `ThemeMigrationWrapper` component — is what enables **slice-by-slice migration**: new and old UI can coexist on the same page without one clobbering the other, because CSS custom properties are DOM-scoped rather than layer-scoped. The legacy `globals.css` `:root` tokens remain the default for unmigrated UI and are removed only when the whole app is wrapped and no legacy consumers remain.

- Define a clean token system inside `.theme-new` (with `.dark .theme-new`
  for dark mode, and `@theme inline` consuming the scoped variables) modeled
  on standard Shadcn conventions (e.g., `primary`, `secondary`, `muted`,
  `accent`). See an example here: https://ui.shadcn.com/docs/theming
  - **`@theme inline` registration:** Tailwind v4 does not support `@theme`
    inside a class selector. The `@theme inline` block must be at the top
    level. New utility registrations for scoped tokens (`info`/`warning`/
    `error`/`success`, `font-body`/`font-header`, `neo-blue`/`neo-gray`, etc.)
    are added to the **existing** `@theme inline` block in `globals.css`,
    not duplicated in `globals-new.css`. The `var()` references resolve to
    scoped custom properties when used inside a `.theme-new` subtree and to
    `:root` defaults outside it.
  - **Dark mode selector:** Use `.dark .theme-new` (ancestor selector) so
    that dark mode applies when the `.dark` class is on an ancestor element
    (e.g. `html.dark`), mirroring the legacy `globals.css` pattern. This is
    an ancestor selector, not a nested `& .dark` descendant selector.
- **Color standard:** Tokens should be defined using **`oklch`**, the preferred color standard for this stylesheet.
- Change the font specification from `font-serif` and `font-sans` to `font-body` and `font-header`. This is more semantic, usage-based definition that more widely applies to all websites and web-apps.
- Extend this with specific **UX state tokens** (`info`, `warning`, `error`, `success`) for cards (including foreground, background, border) for semantic/ux-based styling. This should more or less map onto the colours: **blue** for info, **orange** for warning, **red** for error and **green** for success.
- `.theme-new` may scope not only the custom-property token block but also
  `@layer base` and `@layer utilities`, so that base resets and utility classes
  defined for the new theme apply only within migrated subtrees.
  :`@import 'tailwindcss'`, `@theme inline`, and `@custom-variant` remain
  defined once in `globals.css` and are not duplicated in `globals-new.css`.

**1a-bis. Dynamic theme configuration (normative).**
The migration wrapper is also the app's **dynamic theme** primitive, not only a
one-way migration flag. `ThemeMigrationWrapper` lives in `ui/theme/` and accepts
an optional `theme` prop: a record of CSS custom-property names to values
(`{ '--primary': 'oklch(...)', '--card': 'oklch(...)' }`). The wrapper:

1. applies the `.theme-new` class (the baseline token scope), and
2. writes the supplied custom properties as inline styles on the wrapper
   element, and **mirrors the same properties onto the portal host** so that
   portalled dialogs/popovers resolve the same tokens (see Portal handling).

An `applyThemeTokens(element, tokens)` helper performs the same application
imperatively for runtime theme switching. Tokens are the only supported theme
input — the wrapper never reads theme files, fetches CSS, or knows about any
particular instance. This is the same mechanism ADR-0006 §3c uses for CMS
themes: the CMS supplies the token record, the wrapper applies it.

### Portal handling

Radix UI portals (used by Shadcn dialogs, popovers, tooltips) render their
content to `document.body` by default, which is **outside** the `.theme-new`
DOM scope. Portalled content therefore does not inherit the scoped CSS custom
properties and falls back to the legacy `:root` tokens.

`ThemeMigrationWrapper` addresses this by mounting a hidden container element
(carrying the `theme-new` class) appended to `document.body`. Portalled
components use the `useThemePortal()` hook to obtain this container and pass
it to their Radix `Portal`'s `container` prop:

```tsx
const portalContainer = useThemePortal()
<DialogPortal container={portalContainer}>
```

This automatically scopes portalled content to the new token system — no
manual class application needed on each portalled component. When the entire
app is eventually wrapped, the portal container becomes redundant because all
content — portalled or not — will be inside the global `.theme-new` scope.

When a dynamic theme supplies token overrides (§1a-bis), the wrapper **must
mirror those overrides onto the portal container as well**. Applying only the
`theme-new` class is insufficient: portalled content would otherwise resolve
the baseline `.theme-new` tokens while the subtree resolves the overridden
ones — a silent theme split between the page and its dialogs.

The current app styles need to be refactored and redefined within the new
stylesheet, and this is done in the migration guide section 2b.

**1b. Component Directory Structure**

```
ui/
  primitives/      ← Shadcn primitives (generated, unmodified)
  wrappers/        ← Wrappers around primitives/ with custom styling/behavior
  shared/          ← General-purpose reusable components (non-domain-specific)
  nostr/           ← Nostr-domain presentational components (users, products, auctions, profiles)
  layout/          ← Structural components (Header, Footer, Sidebar, AppShell, PageLayout)
  nav/             ← Navigation model types + renderers (SidebarNav, Breadcrumbs, BackButton)
  dialogs/         ← Dialog compositions built on primitives/dialog
  theme/           ← ThemeMigrationWrapper + dynamic theme token application
  <feature>/       ← Feature view modules (checkout, orders, wallet, dashboard, …)
...More component subdirectories can be added per-feature or per specification ruleset.

platform/web/      ← ASSEMBLER ONLY
  routes/          ← TanStack file-based routes; compose ui/ components with data
  app/             ← providers, monitors, overlays, bootstrap wiring (no components)

src/               ← LEGACY HOST (pre-ADR-0021); not a migration target
```

**Layer roles (normative).**

- **`ui/` owns every component.** All new and migrated presentational
  components live under `ui/`. This tree is the standardized component set.
- **`platform/web/` is an assembler.** Routes and `platform/web/app/` may
  compose `ui/` components, supply data via props, and wire providers and
  overlays. They must NOT define components, layout, navigation, or
  presentation markup. A route that needs new UI adds it to `ui/` instead.
- **`src/` is the legacy host.** It is retained for compatibility during the
  ADR-0021 split and is progressively retired; it is never the destination for
  migrated UI.

The import hierarchy applies to **new and migrated code only**. Existing
legacy components that violate these rules are tracked as migration debt and
will be addressed during their respective slice migrations (see §2a).

For new and migrated code, components may only import from directories below
them in the hierarchy (e.g., `primitives` → `wrappers` → `shared`). New UI
components must be placed in `ui/`.

**`ui/` does not own data access or the app framework.** The enforced boundary
(`ui/boundary.test.ts`) forbids importing `@/`, `@platform/`, `@tanstack/`,
`@nostr-dev-kit/`, `applesauce-*`, and `nostr-tools` from `ui/`. SDK type and
workflow imports through `@sdk/` remain permitted. Data, routing state, and
actions enter components through explicit props or through a
platform-supplied provider context. The former `nostr/` exception for
consuming `@/queries` hooks is **withdrawn** for `ui/`: `ui/nostr/` holds
presentational components only, and the platform/assembler invokes data
adapters and passes results down as props. This keeps `ui/` portable to the
widget book and to future clients.

**1c. Standardized Parameters**
For all **migrated** components in the standardized component set, they should accept and implement the following parameters:

- **Ref exposure (React 19 ref-as-prop):** Components must expose `ref` to
  their root DOM element. **Prefer React 19 ref-as-prop** (accept `ref` as a
  regular prop and pass it through). **Use `forwardRef` only where a
  dependency still requires it** (e.g., a library HOC that expects a
  `forwardRef`-wrapped component). Existing components using `forwardRef`
  do not need to be rewritten — the contract is about ref exposure, not the
  mechanism.
- **`cn()` className merging:** Accept `className` prop, merge with internal styles via `cn()`.
- **Callbacks** for actions instead of in-file hooks or otherwise.
- **Additional Standardized Parameters:** Variants (`variant`), density (`compact`), and other props are defined and enforced per-directory in AGENTS.md files, not globally in this ADR.
- Although not strictly a parameter in the react props sense, components are expected to surface the styles they are exposed to from their parent, following the standards of the `globals.css` file.

Standardized parameters should apply especially to reusable components. Purpose- or feature-specific components (such as ones found in `checkout/`) should be more relaxed on these rules.

**1d. Import Convention**
Canonical alias: `@ui/{directory}/{component}` (the `@ui/*` tsconfig path maps
to `ui/*`). Barrel exports per directory are allowed through `ui/index.ts`.
Routes and `platform/web/` must import UI exclusively from `@ui/...`; they must
not import `ui/primitives/**` directly. Primitives are consumed through
`ui/wrappers/` or `ui/shared/` components.

**1e. Widget Book Test Harness**
A modular test harness (`widget-book/`) will be established to serve as a unified host for both manual browsing and automated testing.

- **Location:** `widget-book/` is a **sibling directory** at the repository root — a separate client, alongside `ui/`, `platform/`, and `sdk/`. It is not part of the platform app and has its own entry point, dev server, and test run.
- **Architecture:** A Bun-based server serving a single application that dynamically loads component "libraries" from `ui/` (mapping to `wrappers`, `shared`, `nostr`, `layout`, `nav`, `dialogs`, and feature modules).
- **Boundary:** The widget book may import `ui/` and `sdk/` only. It must never import `platform/` or `src/`. This is the enforcement test for §1b: a component that cannot render in the widget book is not a `ui/` component.
- **Launch Modes:** The harness can be launched with `LIBRARY=*` for full manual review or scoped to a single library (e.g., `LIBRARY=nostr`) for focused automated testing of a specific slice.
- **Testing Strategy:** Automated tests are written in **Playwright** spec files. Mock data and behavioral assertions are defined directly within these spec files, avoiding the need for an intermediate JSON interpreter. Tests verify rendering, interactivity, and visual consistency across variants and states.

### Part 2: Migration (Execution Strategy)

**2a. Migration Model: Foundation + Opportunistic Slices**

> **Clarification added 2026-10-24 (owner ruling).** The `Extract` strategy's "individual files"
> has always meant _out of the monolith / not in-line_ (the contrast at line 211: "as individual
> files **and defined in-line**"). It never meant one component per file. Cluster files — one
> module holding several closely related presentational views of one concept — are permitted and
> precedented (`ui/products/product-editor-tabs.tsx`, `ui/checkout/payment-views.tsx`,
> `ui/orders/order-detail-sections.tsx`). Per-component obligations are unchanged: each exported
> component owes its own widget-book entry and its own unit test, and the widget-book Playwright
> spec stays one file per library. This clarification is not a new revision; it records the reading
> the code has always followed. See `ui/AGENTS.md` § Cluster files.

Slice defines a set of UI components (as individual files and defined in-line) which migrate according to the **Classification System**:

- **Keep:** Components already compliant or trivially fixable. Migrate styles to tokens, enforce API contracts.
- **Modify:** Valuable but non-compliant. Refactor to implement contracts, migrate styles, and fix structure.
- **Extract:** Components containing trapped sub-components. Decompose into individual files in appropriate directories, then apply Keep/Modify rules to each piece. **"Individual files" means _out of the monolith / not in-line_ — the contrast stated at §2a line 211 — never one component per file.** Several closely related presentational views of one concept may share a cluster file (e.g. `ui/products/product-editor-tabs.tsx`, `ui/checkout/payment-views.tsx`, `ui/orders/order-detail-sections.tsx`). Every exported component of a cluster still owes its own widget-book entry and its own unit test; the Playwright spec file is per library. See `ui/AGENTS.md` § Cluster files.
- **Replace:** Redundant or superseded components. Swap all consumers to the compliant replacement, then delete the original.

For example, an inline component used in `routes/` such as `renderHomepageHero()` might be marked as **Extract** while a card redefinition in another might be marked as **Replace** (with `components/ui/card.tsx`). Each migration PR should include the extent of UI created or modified and how the updated UI fits into the classification system.

**2b. Component styles migration**

The foundation creates a new stylesheet pattern, but for backwards compatibility the old styles need to be kept accessible by unmigrated components. When performing a migration, the UI in the target slice should:

- Be wrapped in `ThemeMigrationWrapper` (or have an existing wrapper moved up the tree to cover it), opting the slice into the `.theme-new` token scope.
- If the slice contains portalled components (dialogs, popovers, tooltips),
  wire their Radix `Portal` `container` prop to the theme portal container via
  `useThemePortal()` so portalled content inherits scoped tokens.
- Replace the now-deprecated patterns with the new stylesheet definition, repointing hardcoded colors/fonts/radii to the scoped semantic tokens.
- Not define any custom styles that may conflict with the new stylesheet definition, such as colours, fonts, border radiuses, and so on.
- When a legacy utility in `globals.css` has zero remaining _unwrapped_ references, it is deleted.
  The migration is complete when `ThemeMigrationWrapper` covers the entire app and the legacy `:root` token block plus all legacy utilities have been removed from `globals.css`.

The expected outcome is a clean stylesheet containing only tokens and generic utilities, with all component-specific styling moved into component files. The `.theme-new` scope and `ThemeMigrationWrapper` placement serve as the migration tracker: as components migrate, their corresponding legacy utilities are extracted into component files using `cn()` + semantic tokens.

**2c. Compliance and Maintenance**
In order to keep the work of each PR over time, every migrated or created component must satisfy the following conditions before being considered complete:

1. **Standardization:** It must adhere to the API contracts and prop standards defined in its parent subdirectory's AGENTS.md and the root `src/components/AGENTS.md`.
2. **Test Coverage:** It must have corresponding test coverage in the automated widget book harness, verifying its different behaviors, variants, and appearances.

**Note:** PR 1 (foundation) contains no migrated components, so the §2c
compliance gate does not apply. Coverage begins with the first migration PR
(PR 3+) per §1e/§2c.

### Part 3: CMS Coherence (Cross-ADR with ADR-0006)

> **Amendment added 2026-08-03.** This section defines how the migration interfaces with ADR-0006 (CMS). It is normative for both ADRs. The CMS (ADR-0006) builds on top of this ADR's foundation — it does not create a parallel component set or a parallel theme system.

#### 3a. The Component Contract

Every migrated component that enters the CMS component registry must additionally declare:

- **CMS metadata** (data contract): A declarative description of what Nostr data the component needs — e.g., "kind 30402 feed with optional `#t` filter" — attached as a sidecar file or co-located export, not embedded in the component's render logic.
- **Puck field schema**: The set of configurable props the CMS editor exposes for this component, mapped to Puck field types (text, select, custom).
- **Data binding interface**: The component must accept data via props and never fetch internally. The CMS runtime (and any route assembler) executes the query and passes results as props. There is no `nostr/` fetch exception under the `ui/` boundary (§1b).

This means each CMS-eligible component has three layers:

```
ui/nostr/ProductCard.tsx                      ← migrated, standardized (this ADR)
ui/nostr/ProductCard.cms.tsx                  ← CMS metadata: data contract + Puck fields (ADR-0006)
widget-book/nostr/ProductCard.spec.ts         ← test coverage (this ADR)
```

The `.cms.tsx` sidecar is the **only** CMS-specific code. The base component is unaware of the CMS.

#### 3b. Sequencing Rule

This ADR's PR 1 (Foundation: Styles) and PR 2 (Foundation: Test Harness) **must land before** CMS component work resumes. The existing Puck components on `feat/plebeian-cms-puck` are re-integrated on top of the new foundation — not merged as-is.

Migration slices that overlap with CMS needs (PR 3: Home Page & User Profile) are prioritized. Each migrated component in these slices gets its CMS sidecar as part of the same PR, so the CMS registry grows as the migration progresses.

#### 3c. Theme Integration with CMS

The CMS theme system **overrides the standard token names** (`--primary`, `--card`, `--background`, `--foreground`, etc.) on a wrapper element. This is the correct design — components are agnostic to whether they're in the main app or inside a custom-themed CMS page. They use the same token-based classes (`text-primary`, `bg-card`, `text-muted-foreground`) everywhere, and the browser resolves the CSS custom property cascade from whichever ancestor defines the values.

**The `ThemeMigrationWrapper` (§1a) is NOT part of the CMS theme system.** It is the app's migration mechanism for transitioning from legacy `:root` tokens to new `.theme-new` tokens. CMS theming is independent — it overrides the same token names at a wrapper element, and components resolve the cascade regardless of where the default values come from.

**How it works:**

1. **CMS themes override the same standard token names.** A CMS theme file (e.g., `public/themes/caffeine.css`) defines the same tokens (`--primary`, `--card`, `--background`, etc.) using `oklch` values, plus `.dark` variants. It does not define a parallel variable set — it overrides the existing token names.

2. **The mechanism is a wrapper element with inline CSS variables.** The CMS fetches the theme CSS, parses the variables, and sets them as inline styles on a wrapper div. Because CSS custom properties cascade through the DOM, all child components pick up the overridden values automatically:

   ```
   <div ref={themeRoot} style="--primary: oklch(...); --card: oklch(...); ...">
     <ProductCard ... />            ← reads --primary, --card from nearest scope
     <ProductGrid ... />           ← same — agnostic to where tokens are defined
   </div>
   ```

3. **Components are agnostic.** A migrated component uses `text-primary`, `bg-card`, etc. It doesn't know whether `--primary` is defined at `:root` (pre-migration), at `.theme-new` (post-migration), or as an inline style on a CMS wrapper div. The browser resolves the cascade — the closest ancestor wins.

4. **This works before and after the migration.** Before ADR-0007's foundation lands, CMS themes override the legacy `:root` tokens. After the migration, CMS themes override the `.theme-new` tokens. In both cases, the CMS override takes precedence at a closer DOM scope. No coordination between `ThemeMigrationWrapper` and the CMS theme system is required.

5. **Dark mode is preserved.** CMS theme files include `.dark` variants. The `applyLocalTheme` mechanism (or its evolved equivalent) applies both light and dark token sets, scoped to the wrapper element.

The existing Puck branch's `src/lib/utils/theme.ts` and `public/themes/*.css` already implement this pattern correctly. The theme files use `oklch` (matching this ADR's color standard) and define the same token names. The `applyLocalTheme` function is the right mechanism — it may be simplified during integration, but the core approach (override standard tokens on a wrapper element) stays.

## Consequences

- The stylesheet evolves from a mixed token/override file to a clean token-only definition, with component-specific styling isolated in component files.
- AGENTS.md files define variant standards, import rules, and review checklists per directory, providing context for creating and reviewing agents.
- The widget book harness provides visual regression testing and a browsable component gallery, ensuring migrated components are verified.
- The `nostr/` directory resolves the tension between "no business logic" and
  necessary data access patterns via narrowly-scoped, named read-only data
  adapters (not broad hook/store access).
- The `ThemeMigrationWrapper` portal container ensures portalled content
  (dialogs, popovers, tooltips) inherits scoped tokens, making subtree
  isolation effective for all UI, not just non-portalled content.
- Enforcement is lean: CI catches structural violations, while AGENTS.md handles nuanced judgment calls.
- The `.theme-new` scope + `ThemeMigrationWrapper` placement creates a self-documenting migration progress indicator: migrated subtrees are visibly opted into the new theme, and the legacy `globals.css` shrinks as consumers migrate.
- **CMS integration:** The component architecture defined here is the foundation ADR-0006's CMS component registry builds on. CMS themes override the same standard token names on a wrapper element — components are agnostic to whether they're in the main app or a CMS page. Without this ADR's foundation PRs landing first, CMS component work would create a parallel, non-compliant component set that would need to be migrated again.

## PR Strategy

A suggested PR strategy is as follows:

- **PR 1 - Foundation - Styles:** Defines the new `.theme-new` scoped stylesheet (`styles/globals-new.css`) and the `ThemeMigrationWrapper` component in `ui/theme/` (including dynamic token application and the portal container for portalled content), wiring it in without yet opting in any subtree. Creates new directories and AGENTS.md files where appropriate, such as `ui/wrappers`, `ui/shared`, `ui/nostr`, `ui/layout`, `ui/nav`, `ui/dialogs`, and `ui/theme`. This PR is **foundation-only** — example components from the _"Modify"_ strategy of 2a are intentionally deferred to the first migration PR (PR 3) to keep the foundation review focused. Validation of the `.theme-new` scope will come with the first migration that wraps a real component.
  - **CMS cross-ref:** Creates the `cms/` directory (empty, with AGENTS.md defining CMS sidecar conventions). Does not populate it yet.

- **PR 2 - Foundation - Test Harness:** Implement the test harness app that can run on modular widget libraries. Include the ability to run on all libs (LIBRARY=\*) or on specific ones only. Include the Playwright configuration to define and run tests on specific components, and provide test coverage for the existing components in the newly migrated subdirectories.
  - **CMS cross-ref:** Adds `LIBRARY=cms` mode (renders CMS sidecar-wrapped components with mock data). Empty on landing — populated as migration slices add CMS sidecars.

- **PR 3 - Migration: Home Page & User Profile Components:** - Create a migration for components found in the home page. This coincides with the CMS work which will use many of the same components.
  - **CMS cross-ref:** This is the first PR that populates the CMS component registry. Each migrated component gets its `.cms.tsx` sidecar in the same PR. After this PR, the CMS editor can offer Hero, Product Grid, Product Card, Author Bio, and Feature Banner blocks.

- **PR 4 - Migration: Layout Components:** - Create a migration for the commonly used app layout components (header, footer, sidebar) to ensure they are compliant with the new styling.
  - **CMS cross-ref:** Adds CMS sidecars for Header, Footer, and Grid layout blocks.

- **PR 5 - Migration: UX Components:** - Ensure UX components such as forms, dialogs, and other interactive pieces of the app UX are compliant with the new guidelines.
  - **CMS cross-ref:** Adds CMS sidecars for form and dialog components that the CMS editor itself uses (Puck field widgets migrate to `ui-wrappers/`).

- **PR 6 - Migration: Dashboard Components:** - Move remaining dashboard components to the new guidelines.

  ...A few more migrations will be needed for specific features, such as: Wallet, Checkout, etc., which can be taken on at this point.
