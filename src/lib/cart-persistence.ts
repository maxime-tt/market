/**
 * src/lib/cart-persistence.ts -- the shim: the cart persistence adapter moved to
 * `platform/web/cart/cartPersistence.ts` (Wave D cart drain S0). The `NormalizedCart` type now lives in
 * `platform/web/cart/cartModel.ts`. Existing call sites keep importing this path; `src/lib/stores/cart.ts`
 * (the store) still imports this shim, which is a same-tree edge and adds no `platform -> src` counting.
 * Deleted in E1b.
 */
export * from '@platform/web/cart/cartPersistence'
