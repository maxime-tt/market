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
- `auction-detail-views` — the operator-side detail presentations:
  - `AuctionStatusBadge` / `AuctionSettlementBadge` — the auction's lifecycle
    and settlement chips. The status → tone maps live here (next to the view),
    not as raw style maps in the route, and render through `shared/status-badge`.
  - `AuctionDetailCard` — a bordered card wrapping `shared/detail-field`
    (`align="start"`). It is a **composition**, not a second field
    implementation: the field itself is still `shared/detail-field`.
  - `AuctionPartyCard` — one party (seller, winner). The avatar and display name
    arrive as an injected node, because resolving a pubkey to a profile is host
    work.
  - `AuctionTechnicalRow` — a labelled technical value with an optional copy
    control. The control is `shared/copy-button`; a failed write is reported
    through `onCopyError`, so the host keeps its own error surface.
- `auction-overview-views` — the dashboard list surface's presentational
  pieces. Today that is `AuctionActivityRow` (one line of the bids / comments /
  live-chat activity summary, with the "N New" highlight).

## What does not

- Anything that calls `useQuery`/`useStore`/`fetch`, formats protocol data, or
  resolves tags. Those stay in the route; pass the resolved values in.
- A second implementation of a `shared/` atom. A card that only adds a border
  and a spacing rhythm around a `shared/` atom is a composition and belongs
  here; a row that re-implements the atom's own label/value/helper structure
  does not — use `shared/detail-field` or `shared/stat-card` at the call site.
