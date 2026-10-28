/**
 * src/lib/stores/testLabels.ts — the shim: `src/`'s view of the SDK test-label module (Wave E adapter
 * drain W-E3.3). The temporary `@tanstack/store` adapter and the `useTestLabelStore` accessor moved to
 * `platform/web/config/testLabelsStore.ts`; existing call sites keep importing this path unchanged.
 * Deleted in E1b when the last `src/` importer retires.
 */
export * from '@platform/web/config/testLabelsStore'
