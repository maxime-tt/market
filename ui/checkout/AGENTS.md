# AGENTS.md — ui/checkout

This directory follows `ui/AGENTS.md` (the tree contract) and repo-level `AGENTS.md`.

## Context

`checkout/` holds the checkout flow's presentational components: payment
presentation, the shipping address form, order finalisation, and the checkout
sidebar pieces. They render data; they never acquire it.

The older checkout views still live in the transitional `ui/components/checkout/`
pool (`OnChainPaymentView`, `OrderFinalizeView`, `PaymentContentView`,
`PaymentViews`, `ShippingAddressFormView`). Per `ui/AGENTS.md`, new and migrated
components land here instead; the pool drains slice by slice, so expect both
directories until it does.

## Import rules

- May import: `primitives/`, `wrappers/`, `shared/`, `nostr/`, `utils/`, and
  `@sdk/*` type/workflow modules.
- Must **not** import: `@/` (queries, stores, hooks), `@platform/`,
  `@tanstack/`, `@nostr-dev-kit/`, `applesauce-*`, `nostr-tools`.
- Data enters as props, including host-owned pieces such as a router link node
  (`settingsLink`) or a resolved identity node. The route is an assembler and
  must not define components, so anything it used to define inline lands here
  with the host wiring replaced by props.
- Props-only: `className` + `cn()`, ref-as-prop, `onX` callbacks.

## What belongs here

- `checkout-layout-views` — `CheckoutMobileSummaryCard`, `CheckoutMainCard`,
  `CheckoutSidebarCard`: the page's three card frames. They were built inline in
  `platform/web/routes/checkout.tsx`, which imported `@ui/primitives/card` and
  `@ui/primitives/scroll-area` to do it; an assembler may do neither. The frames
  own the layout only — title, toggle state, header controls and every branch of
  content arrive as props or as already-resolved children, and the scroll region
  is opt-in (`scrollable`) because only the cart branch needs one.
- `nwc-wallet-status-view` — `NwcWalletStatusView`: NWC wallet readiness for the
  checkout summaries. It replaced two divergent copies in the checkout route
  (mobile summary + desktop sidebar) that shared a status dot and count but had
  two different footer sentences.

## What does not

- Anything that calls `useQuery`/`useStore`/`fetch` or reads the wallet store.
  Those stay in the host; pass the resolved count and the `connected` flag in.
  The checkout flow's host half is `src/feature/checkout/useCheckout.ts` (with its
  pure transitions in `src/feature/checkout/checkoutFlow.ts`) — the route is an
  assembler that composes these views with that hook's members.
- A second implementation of a `shared/` atom. Use `shared/notice` for
  info/warning/error banners and `shared/error-state` for a retryable failure.
