/**
 * src/lib/wallet/walletKeyStore.ts — the shim: `src/`'s view of the SDK cashu-wallet module.
 *
 * the sealed-at-rest key store (`SealedWalletKeyStore`, `createSignerWalletKeySealer`, `WalletKeySealer`, `WalletKeyStorage`, `WalletKeySigner`) moved to
 * `@sdk/commerce/payments/wallet/walletKeyStore` as part of the `src/lib/wallet/` drain (increment B4b,
 * stage 2). Every existing call site keeps importing `@/lib/wallet/walletKeyStore` (and the
 * `@/lib/wallet` barrel re-exports it) unchanged: a plain `export *` re-exports the whole
 * surface and no adapter is needed.
 */
export * from '@sdk/commerce/payments/wallet/walletKeyStore'
