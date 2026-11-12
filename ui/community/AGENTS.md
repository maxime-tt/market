# ui/community

Community-surface presentational components. The community page assembles its
collections and merchants feeds from these; the route itself must not define
components or import primitives.

## What belongs here

- Components whose layout is specific to the community page — the collections
  and merchants feeds, their grids, their empty/loading shells.
- Presentational components only: props in, markup out. No `@/queries`,
  `@/lib/stores`, `@tanstack/*`, or relay access. The host resolves data and
  passes results down.

## What does not

- Anything that fetches, resolves a pubkey/profile, or reads a store. Those stay
  in the route; pass the resolved values in.
- A generic list/grid atom. If a component is not community-specific, it belongs
  in `ui/shared/`.

## Tests

Every component here gets a `*.test.tsx` beside it covering its variants and its
empty/loading/error states. `data-testid` values are part of the contract: the
community progressive-loading suite (`e2e/tests/community.progressive-loading.spec.ts`)
asserts on them, so keep them stable when refactoring.
