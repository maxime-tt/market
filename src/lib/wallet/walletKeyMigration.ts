/**
 * src/lib/wallet/walletKeyMigration.ts — the shim: `src/`'s view of the SDK cashu-wallet module.
 *
 * the NIP-60 → local key-material migration (`migrateWalletKeyMaterial`, `WalletKeyMigrationSource`, the outcome types) moved to
 * `@sdk/commerce/payments/wallet/walletKeyMigration` as part of the `src/lib/wallet/` drain (increment B4b,
 * stage 2). Every existing call site keeps importing `@/lib/wallet/walletKeyMigration` (and the
 * `@/lib/wallet` barrel re-exports it) unchanged: a plain `export *` re-exports the whole
 * surface and no adapter is needed.
 */
export * from '@sdk/commerce/payments/wallet/walletKeyMigration'
