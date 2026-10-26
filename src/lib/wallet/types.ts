/**
 * src/lib/wallet/types.ts — the shim: `src/`'s view of the SDK cashu-wallet types module.
 *
 * The proof / pending-token vocabulary (`ProofInfo`, `PendingToken`, `PendingTokenContext`,
 * `AuctionBidPendingTokenContext`, `ProofEntry`) moved to
 * `@sdk/commerce/payments/wallet/types` as part of the `src/lib/wallet/` drain (increment B4b,
 * stage 1). Every existing call site keeps importing `@/lib/wallet/types` (and the
 * `@/lib/wallet` barrel re-exports it) unchanged: the module is pure types, so a plain
 * `export *` re-exports the whole surface and no adapter is needed.
 */
export * from '@sdk/commerce/payments/wallet/types'
