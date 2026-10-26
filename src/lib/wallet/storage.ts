/**
 * src/lib/wallet/storage.ts — the shim: `src/`'s view of the SDK user-scoped storage module.
 *
 * The user-scoped localStorage helpers (`loadUserData`, `saveUserData`, `removeUserData`,
 * `SaveUserDataOptions`) moved to `@sdk/commerce/payments/wallet/storage` as part of the
 * `src/lib/wallet/` drain (increment B4d). Every existing call site keeps importing
 * `@/lib/wallet/storage` (and the `@/lib/wallet` barrel re-exports it) unchanged: the module is
 * pure functions and types, so a plain `export *` re-exports the whole surface and no adapter is
 * needed.
 */
export * from '@sdk/commerce/payments/wallet/storage'
