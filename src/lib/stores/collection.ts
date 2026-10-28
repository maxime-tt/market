/**
 * Shim — the collection form store moved from `src/lib/stores/collection.ts` to
 * `platform/web/collections/collectionFormStore.ts` (store drain).
 *
 * Kept as a re-export so the six `src/components/sheet-contents/collections/*` consumers stay
 * untouched; deleted in E1b.
 */
export * from '@platform/web/collections/collectionFormStore'
