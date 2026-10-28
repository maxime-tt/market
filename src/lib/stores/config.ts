/**
 * src/lib/stores/config.ts — the shim: `src/`'s view of the SDK app-config module (Wave E adapter
 * drain W-E3.6). The temporary bidirectional `@tanstack/store` `configStore` adapter moved to
 * `platform/web/config/appConfigStore.ts`; existing call sites (including the `configStore.setState`
 * writers) keep importing this path unchanged. Deleted in E1b when the last `src/` importer retires.
 */
export * from '@platform/web/config/appConfigStore'
