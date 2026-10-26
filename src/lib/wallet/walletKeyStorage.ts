/**
 * src/lib/wallet/walletKeyStorage.ts — the shim: `src/`'s view of the SDK wallet-key storage binding.
 *
 * The app's binding for `WalletKeyStore`'s two ports (`createAppWalletKeyStorage`,
 * `createAppWalletKeyStore`) moved to `@sdk/commerce/payments/wallet/walletKeyStorage` as part of
 * the `src/lib/wallet/` drain (increment B4d). Every existing call site keeps importing
 * `@/lib/wallet/walletKeyStorage` (and the `@/lib/wallet` barrel re-exports it) unchanged: the
 * module's public surface is unchanged, so a plain `export *` re-exports it and no adapter is
 * needed.
 */
export * from '@sdk/commerce/payments/wallet/walletKeyStorage'
