/**
 * Shim — the vanity registry read binding moved to `platform/web/config/vanityBinding.ts`
 * (store drain D1, slice 2), beside the vanity state bridge.
 *
 * The framework-free read model (`readVanitySettingsWorkflow`) lives in
 * `sdk/commerce/curation/vanityRead.ts`; the React binding (fetch helper, read hook, live
 * invalidation subscription) lives in the Platform config feature file and resolves its port from
 * `platform/web/ndkReadContext.ts` instead of `@/lib/stores/ndk`. Vacated path kept as a
 * re-export so no call site breaks; deleted in E1.
 */
export * from '@platform/web/config/vanityBinding'
