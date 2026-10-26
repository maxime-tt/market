/**
 * Shim — the author read binding moved to `platform/web/profiles/authorQuery.ts`
 * (store drain D1, slice 2).
 *
 * The framework-free read model (`readAuthorWorkflow`, `isValidProfilePubkey`) lives in
 * `sdk/core/profile/profileRead.ts`; the React binding (fetch helper, query options) lives in the
 * Platform feature file and resolves its port from `platform/web/ndkReadContext.ts` instead of
 * `@/lib/stores/ndk`. Vacated path kept as a re-export so no call site breaks; deleted in E1.
 */
export * from '@platform/web/profiles/authorQuery'
