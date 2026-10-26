/**
 * Shim — the cart-snapshot read binding moved to `platform/web/cart/cartQuery.ts`
 * (store drain D1, slice 5).
 *
 * The framework-free read (`readLatestCartSnapshotWorkflow`) and the snapshot selection live in
 * `@sdk/commerce/cart/cartRead`; the React binding keeps the query options and resolves its relay port
 * from `platform/web/ndkReadContext.ts`. The store's `fetchLatestCartSnapshot` keeps the same
 * `cartKeys.byPubkey` target. Vacated path kept as a re-export so no call site breaks; deleted in E1.
 */
export * from '@platform/web/cart/cartQuery'
