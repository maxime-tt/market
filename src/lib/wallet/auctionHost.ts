/**
 * src/lib/wallet/auctionHost.ts — the shim: `src/`'s view of the SDK cashu-wallet module.
 *
 * the auction host (`createAuctionHost`, the HD xpub an auction publishes and the pending-token context attach) moved to
 * `@sdk/commerce/payments/wallet/auctionHost` as part of the `src/lib/wallet/` drain (increment B4b,
 * stage 2). Every existing call site keeps importing `@/lib/wallet/auctionHost` (and the
 * `@/lib/wallet` barrel re-exports it) unchanged: a plain `export *` re-exports the whole
 * surface and no adapter is needed.
 */
export * from '@sdk/commerce/payments/wallet/auctionHost'
