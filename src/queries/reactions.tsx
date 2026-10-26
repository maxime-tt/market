/**
 * Shim — the reaction read binding moved to `platform/web/messaging/reactionQuery.ts`
 * (store drain D1, slice 2).
 *
 * The framework-free read model (`readEventReactionsWorkflow`) lives in
 * `sdk/commerce/messaging/reactionRead.ts`; the React binding (transform helpers, read hook)
 * lives in the Platform feature file and resolves its port from
 * `platform/web/ndkReadContext.ts` instead of `@/lib/stores/ndk`. The query key stays
 * literal-identical to the publish side's invalidation target in `src/publish/reactions.tsx`.
 * Vacated path kept as a re-export so no call site breaks; deleted in E1.
 */
export * from '@platform/web/messaging/reactionQuery'
