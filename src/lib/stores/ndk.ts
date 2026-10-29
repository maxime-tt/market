/**
 * src/lib/stores/ndk.ts — the shim: `src/`'s view of the NDK connection store (Wave E W-E4).
 *
 * The store moved to `platform/web/ndk/ndkStore.ts`; the only substitutions were the two
 * `@/`-free platform imports of the config and wallet store adapters. Every `src/` importer and the
 * `mock.module('@/lib/stores/ndk', ...)` test suites keep resolving this path unchanged. Deleted in
 * E1b when the last `src/` importer retires.
 */
export * from '@platform/web/ndk/ndkStore'
