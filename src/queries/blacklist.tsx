/**
 * Shim — the blacklist read binding moved to `platform/web/config/blacklistBinding.ts`
 * (store drain D1, slice 3), beside the blacklist state bridge.
 *
 * The framework-free read model (`readBlacklistSettingsWorkflow`) lives in
 * `sdk/commerce/curation/curationRead.ts`; the React binding (fetch helper, read hook, live
 * invalidation subscription) lives in the Platform config feature file and resolves its port from
 * `platform/web/ndkReadContext.ts` (pinned to the app's main relay) instead of
 * `@/lib/stores/ndk`. Vacated path kept as a re-export so no call site breaks; deleted in E1.
 */
export * from '@platform/web/config/blacklistBinding'
