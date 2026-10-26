/**
 * Shim — the relay-preferences read binding moved to `platform/web/relays/relayPreferences.ts`
 * (store drain D1, slice 1).
 *
 * The framework-free read model (`readRelayPreferencesWorkflow`) and the query keys live in
 * `sdk/core/relays/relayListRead.ts`; the React binding (fetch helper, read hook, publish
 * hook, invalidation) lives in the Platform feature file and resolves its port from
 * `platform/web/ndkReadContext.ts` / `platform/web/ndkPublishContext.ts` instead of
 * `@/lib/stores/ndk`. Vacated path kept as a re-export so no call site breaks;
 * deleted in E1.
 */
export * from '@platform/web/relays/relayPreferences'
