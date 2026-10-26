/**
 * src/lib/wallet/legacyStorage.ts — the shim: `src/`'s view of the SDK legacy user-data keys module.
 *
 * The retired relay-wallet store's user-data keys (`LEGACY_PENDING_TOKENS_KEY`) moved to
 * `@sdk/commerce/payments/wallet/legacyStorage` as part of the `src/lib/wallet/` drain (increment
 * B4b, stage 1). Every existing call site keeps importing `@/lib/wallet/legacyStorage` (and the
 * `@/lib/wallet` barrel re-exports it) unchanged: the module is a single constant, so a plain
 * `export *` re-exports the whole surface and no adapter is needed.
 */
export * from '@sdk/commerce/payments/wallet/legacyStorage'
