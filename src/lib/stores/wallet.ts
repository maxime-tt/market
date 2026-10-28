/**
 * src/lib/stores/wallet.ts — the shim: `src/`'s view of the SDK wallet module (Wave E adapter drain
 * W-E3.7). The temporary bidirectional `@tanstack/store` `walletStore` adapter and the reactive
 * `useWallets` hook moved to `platform/web/config/walletStore.ts`; existing call sites (including the
 * `walletStore.setState` writers in `src/lib/stores/ndk.ts`) keep importing this path unchanged.
 * Deleted in E1b when the last `src/` importer retires.
 */
export * from '@platform/web/config/walletStore'
