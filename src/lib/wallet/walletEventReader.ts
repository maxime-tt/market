/**
 * src/lib/wallet/walletEventReader.ts — the shim: `src/`'s view of the SDK cashu-wallet module.
 *
 * the relay event reader over the key-migration source (`createWalletEventReader`, `latestByCreatedAt`) moved to
 * `@sdk/commerce/payments/wallet/walletEventReader` as part of the `src/lib/wallet/` drain (increment B4b,
 * stage 2). Every existing call site keeps importing `@/lib/wallet/walletEventReader` (and the
 * `@/lib/wallet` barrel re-exports it) unchanged: a plain `export *` re-exports the whole
 * surface and no adapter is needed.
 */
export * from '@sdk/commerce/payments/wallet/walletEventReader'
