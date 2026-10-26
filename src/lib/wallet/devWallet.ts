/**
 * src/lib/wallet/devWallet.ts — the shim: `src/`'s view of the SDK dev-wallet affordances module.
 *
 * The dev-only wallet affordances (`DEV_TEST_MINT_URL`, `WALLET_DEV_TEST_MINTS`,
 * `isWalletDevModeEnabled`) moved to `@sdk/commerce/payments/wallet/devWallet` as part of the
 * `src/lib/wallet/` drain (increment B4b, stage 1). Every existing call site keeps importing
 * `@/lib/wallet/devWallet` (and the `@/lib/wallet` barrel re-exports it) unchanged: the module is
 * pure values and one predicate, so a plain `export *` re-exports the whole surface and no adapter
 * is needed.
 */
export * from '@sdk/commerce/payments/wallet/devWallet'
