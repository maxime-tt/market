/**
 * src/lib/wallet/cashuWalletSource.ts — the shim: `src/`'s view of the SDK coco wallet source.
 *
 * The coco-backed wallet object the rails spend through (`createCocoWalletSource`,
 * `CashuProofRepository`, `CashuWalletSource`, `CashuWalletSourcePorts`) moved to
 * `@sdk/commerce/payments/wallet/cashuWalletSource` as part of the `src/lib/wallet/` drain
 * (increment B4d), behind its sibling `./auctionFunds`. Every existing call site keeps importing
 * `@/lib/wallet/cashuWalletSource` (and the `@/lib/wallet` barrel re-exports it) unchanged: the
 * module's public surface is unchanged, so a plain `export *` re-exports it and no adapter is
 * needed.
 */
export * from '@sdk/commerce/payments/wallet/cashuWalletSource'
