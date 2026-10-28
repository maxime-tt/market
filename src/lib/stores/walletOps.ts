/**
 * src/lib/stores/walletOps.ts -- the shim: `src/`'s view of the wallet action surface (Wave D walletOps
 * drain S2). The module moved to `platform/web/wallet/walletOps.ts`; the store it acts on moved to
 * `platform/web/wallet/cashuStore.ts` in S0. Three suites intercept this path with `mock.module()`, which
 * is why the vacated path is kept as a re-export for now. Deleted in E1b.
 */
export * from '@platform/web/wallet/walletOps'
