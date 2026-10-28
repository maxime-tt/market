/**
 * src/lib/stores/ui.ts — the shim: `src/`'s view of the SDK UI module (Wave E adapter drain W-E3.5).
 * The temporary bidirectional `@tanstack/store` adapter moved to `platform/web/app/uiStore.ts`;
 * existing call sites keep importing this path unchanged. Deleted in E1b when the last `src/`
 * importer retires.
 */
export * from '@platform/web/app/uiStore'
