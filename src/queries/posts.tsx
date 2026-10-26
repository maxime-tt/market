/**
 * Shim — the post read binding moved to `platform/web/messaging/postQuery.ts`
 * (store drain D1, slice 2).
 *
 * The framework-free read models (`readRecentPostsWorkflow`, `readPostWorkflow`) live in
 * `sdk/commerce/messaging/postRead.ts`; the React binding (fetch helpers, query options) lives in
 * the Platform feature file and resolves its port from `platform/web/ndkReadContext.ts` instead of
 * `@/lib/stores/ndk`. Vacated path kept as a re-export so no call site breaks; deleted in E1.
 */
export * from '@platform/web/messaging/postQuery'
