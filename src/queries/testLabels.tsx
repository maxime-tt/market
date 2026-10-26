/**
 * Shim — the test-label read binding moved to `platform/web/config/testLabelsBinding.ts`
 * (store drain D1, slice 3), beside the test-label state bridge.
 *
 * The framework-free read and its module caches (`fetchTestLabelsWorkflow`,
 * `sdk/config/testLabelRead.ts`) hold the reconciliation, the per-coordinate cache and the
 * authorized-labeler cache. The React binding (fetch helpers, read hooks, pipeline filter,
 * authorized-labeler settings loader, live invalidation) lives in the Platform config feature file
 * and keeps the relay access behind a dynamic `@/lib/stores/ndk` import, exactly as the pre-drain
 * file did, so the read model itself imports no NDK. Vacated path kept as a re-export so no call
 * site breaks; deleted in E1.
 */
export * from '@platform/web/config/testLabelsBinding'
