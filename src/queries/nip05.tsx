/**
 * Shim — the NIP-05 registry read binding moved to `platform/web/config/nip05Binding.ts`
 * (store drain D1, slice 2), beside the NIP-05 state bridge.
 *
 * The framework-free read model (`readNip05SettingsWorkflow`) lives in
 * `sdk/core/profile/nip05.ts`; the React binding (fetch helper, read hook, live invalidation
 * subscription) lives in the Platform config feature file and resolves its port from
 * `platform/web/ndkReadContext.ts` instead of `@/lib/stores/ndk`. Vacated path kept as a
 * re-export so no call site breaks; deleted in E1.
 */
export * from '@platform/web/config/nip05Binding'
