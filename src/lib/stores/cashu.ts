/**
 * src/lib/stores/cashu.ts -- the shim: `src/`'s view of the cashu wallet store (Wave D walletOps drain S0).
 *
 * The assembly (`createCashuStore`) and the `@tanstack/store` adapter moved to
 * `platform/web/wallet/cashuStore.ts` so the wallet action surface can live on the platform side without a
 * `platform -> src` edge. Existing call sites keep importing this path unchanged, including the nine
 * `useStore(cashuStore)` components and the eleven test files that write `cashuStore.setState(...)`.
 * Deleted in E1b.
 */
export * from '@platform/web/wallet/cashuStore'
