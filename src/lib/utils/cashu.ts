/**
 * src/lib/utils/cashu.ts — the shim: `src/`'s view of the SDK cashu module.
 *
 * the P2PK-secret locktime reader (`getP2PKLocktime`) moved to
 * `@sdk/commerce/payments/cashu/p2pkLocktime` as part of the `src/lib/wallet/` drain (increment B4b,
 * stage 3). Every existing call site keeps importing `@/lib/utils/cashu` unchanged: a plain
 * `export *` re-exports the whole surface and no adapter is needed.
 */
export * from '@sdk/commerce/payments/cashu/p2pkLocktime'
