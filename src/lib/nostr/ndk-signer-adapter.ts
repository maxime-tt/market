/**
 * src/lib/nostr/ndk-signer-adapter.ts — the shim: `src/`'s view of the NDK signer adapter
 * (Wave F slice W-E5a). The implementation moved to `platform/web/auth/ndkSignerAdapter.ts`;
 * existing call sites (`src/lib/stores/auth.ts`) keep importing this path unchanged.
 * Deleted in E1b once the last `src/` importer retires.
 */
export * from '@platform/web/auth/ndkSignerAdapter'
