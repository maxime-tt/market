/**
 * src/lib/stores/cart.ts -- the shim: `src/`'s view of the cart store (Wave D cart drain S1-S2).
 *
 * The store moved to `platform/web/cart/cartStore.ts`; the `@tanstack/store` `Store` shape is preserved so
 * the `useStore(cartStore)` call sites in `src/components/sheet-contents/**` keep working. The remaining
 * `src/` consumers import this path; the one `platform/web` consumer
 * (`platform/web/routes/products.$productId.tsx`) imports the platform module directly. Deleted in E1b.
 */
export * from '@platform/web/cart/cartStore'
