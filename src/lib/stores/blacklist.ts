/**
 * src/lib/stores/blacklist.ts — the shim: `src/`'s view of the SDK blacklist module (Wave E adapter
 * drain W-E3.2). The temporary `@tanstack/store` adapter and the `useBlacklist` accessor moved to
 * `platform/web/config/blacklistStore.ts`; existing call sites keep importing this path unchanged.
 * Deleted in E1b when the last `src/` importer retires.
 */
export * from '@platform/web/config/blacklistStore'
