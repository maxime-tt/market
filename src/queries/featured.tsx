/**
 * Shim — the featured-list read binding moved to `platform/web/featured/featuredQueries.ts`
 * (store drain D1, slice 4), beside the untouched D2 `featuredPublish.tsx`.
 *
 * The framework-free read (`readFeaturedWorkflow`, `sdk/commerce/curation`) fetches the newest list
 * event once over the app-relay `EventReadContext`, and the React binding parses it with the existing
 * `parseFeatured*` helpers and the blacklist coordinate filters (now in `@sdk/config/blacklist`),
 * resolving its port from `platform/web/ndkReadContext.ts` instead of `@/lib/stores/ndk`. Vacated path
 * kept as a re-export so no call site breaks; deleted in E1.
 */
export * from '@platform/web/featured/featuredQueries'
