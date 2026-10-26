/**
 * src/lib/wallet/nutzap.ts — the shim: `src/`'s view of the SDK cashu-wallet module.
 *
 * the NIP-61 nutzap family (the whole module surface) moved to
 * `@sdk/commerce/payments/wallet/nutzap` as part of the `src/lib/wallet/` drain (increment B4b,
 * stage 2). Every existing call site keeps importing `@/lib/wallet/nutzap` (and the
 * `@/lib/wallet` barrel re-exports it) unchanged: a plain `export *` re-exports the whole
 * surface and no adapter is needed.
 */
export * from '@sdk/commerce/payments/wallet/nutzap'
