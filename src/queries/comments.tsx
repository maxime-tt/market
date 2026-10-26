/**
 * Shim — the NIP-22 comment read binding moved to `platform/web/messaging/commentQuery.ts`
 * (store drain D1, slice 2).
 *
 * The framework-free read model (`readProductCommentsWorkflow`) lives in
 * `sdk/commerce/messaging/commentRead.ts`; the React binding (fetch helper, thread transform,
 * read hook) lives in the Platform feature file and resolves its port from
 * `platform/web/ndkReadContext.ts` instead of `@/lib/stores/ndk`. The query key stays
 * literal-identical to the publish side's invalidation target in `src/publish/comments.tsx`.
 * Vacated path kept as a re-export so no call site breaks; deleted in E1.
 */
export * from '@platform/web/messaging/commentQuery'
