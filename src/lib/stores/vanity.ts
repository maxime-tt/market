/**
 * src/lib/stores/vanity.ts — the shim: `src/`'s view of the SDK vanity module (Wave E adapter drain
 * W-E3.1). The temporary `@tanstack/store` adapter and the `useVanity` accessor moved to
 * `platform/web/config/vanityStore.ts`; existing call sites keep importing this path unchanged.
 * Deleted in E1b when the last `src/` importer retires.
 */
export * from '@platform/web/config/vanityStore'
