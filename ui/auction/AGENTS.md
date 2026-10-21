# AGENTS.md — ui/auction

This directory follows `ui/AGENTS.md` (the tree contract) and repo-level `AGENTS.md`.

## Context

`auction/` holds **presentational** components specific to auctions that are not
general enough for `shared/` and are not Nostr-identity components: shipping
option cards, auction detail rows, bid/verdict panels. They render data; they
never acquire it.

## Import rules

- May import: `primitives/`, `wrappers/`, `shared/`, `nostr/`, `utils/`, and
  `@sdk/*` type/workflow modules. `@sdk/…` is permitted by `ui/boundary.test.ts`.
- Must **not** import: `@/` (queries, stores, hooks), `@platform/`,
  `@tanstack/`, `@nostr-dev-kit/`, `applesauce-*`, `nostr-tools`.
- Data enters as props, and so do host-owned pieces: an avatar or profile-name
  node, a copy callback, or an injected `renderLink`. The route is an assembler
  and must not define components, so anything it used to define inline lands
  here with the host wiring replaced by props.
- Props-only: `className` + `cn()`, ref-as-prop, `onX` callbacks.

## What belongs here

- `shipping-option-views` — `AuctionShippingOptionCard`,
  `AuctionShippingDetailRow`.
- `auction-detail-views` — the operator-side detail rows (`StatCard`- and
  `DetailField`-shaped rows collapsed onto `shared/`; bespoke ones here).

## What does not

- Anything that calls `useQuery`/`useStore`/`fetch`, formats protocol data, or
  resolves tags. Those stay in the route; pass the resolved values in.
- A second implementation of a `shared/` atom. If a row is just
  label/value/helper, use `shared/detail-field` or `shared/stat-card` at the
  call site instead of adding a wrapper here.
