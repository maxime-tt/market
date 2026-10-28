/**
 * src/lib/stores/product.ts — the shim: `src/`'s view of the product form store (Wave C, product drain S1–S3).
 *
 * The store moved to `platform/web/products/productFormStore.ts`; the `@tanstack/store` `Store` shape is
 * preserved so the 8 `useStore(productFormStore)` call sites in `src/components/sheet-contents/products/` keep
 * working. The remaining `src/` consumers import this path; the 5 `platform/web` routes import the platform
 * module directly. Deleted in E1b.
 */
export * from '@platform/web/products/productFormStore'
