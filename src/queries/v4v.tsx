/**
 * Shim — the V4V share read and publish binding moved to `platform/web/v4v/v4vQuery.ts`
 * (store drain D1, slice 5).
 *
 * The framework-free read (`readV4VConfigurationWorkflow`) and the share parsers live in
 * `@sdk/commerce/v4v/v4vRead`; the community-query fixture seam moved to
 * `@sdk/core/query/communityQueryFixtures`. The React binding owns the hooks, the recipient display-name
 * lookup, the share publish and the port resolution from `platform/web/ndkPublishContext.ts`. Vacated path
 * kept as a re-export so no call site breaks (including `src/lib/stores/cart.ts`); deleted in E1.
 */
export * from '@platform/web/v4v/v4vQuery'
