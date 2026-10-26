/**
 * src/lib/wallet/auctionFunds.ts — the shim: `src/`'s view of the SDK auction-funds module.
 *
 * The auction P2PK spend / reclaim / lock family (`receiveTokenIntoWallet`, `createAuctionReclaim`,
 * `createAuctionLock`, `createAuctionReceipt`, `AuctionFundsWallet`, …) moved to
 * `@sdk/commerce/payments/wallet/auctionFunds` as part of the `src/lib/wallet/` drain (increment
 * B4d). Its former shim imports (`@/lib/auctionP2pk`, `@/lib/auction/constants`, `@/lib/cashu/dleq`,
 * `@/lib/utils/cashu`) and its bidder-record import were rewritten to their `@sdk/...` targets, and
 * the cross-subtree `./display` became `@sdk/commerce/payments/display`. Every existing call site
 * keeps importing `@/lib/wallet/auctionFunds` (and the `@/lib/wallet` barrel re-exports it)
 * unchanged: the module's public surface is unchanged, so a plain `export *` re-exports it and no
 * adapter is needed.
 */
export * from '@sdk/commerce/payments/wallet/auctionFunds'
