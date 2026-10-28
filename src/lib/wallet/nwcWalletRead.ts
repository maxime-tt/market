/**
 * src/lib/wallet/nwcWalletRead.ts — the shim: the NDK NWC read adapter moved to
 * `platform/web/wallet/nwcWalletRead.ts` (Wave C, ndk drain S2) because it is NDK-typed and the
 * framework-free `sdk/` layer may not import the NDK packages. Deleted in E1b.
 */
export * from '@platform/web/wallet/nwcWalletRead'
