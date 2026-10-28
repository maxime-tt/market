/**
 * src/lib/utils/productFormStorage.ts — the shim: `src/`'s view of the product draft storage.
 *
 * The storage moved to `platform/web/products/productFormStorage.ts` (Wave C, product drain S0) so it can be
 * consumed from `platform/` without a `platform -> src` edge. Existing call sites keep importing this path:
 * `src/components/sheet-contents/products/ProductFormContent.tsx:13` and
 * `platform/web/routes/_dashboard-layout/dashboard/products/products/$productId.tsx:10` (both use
 * `hasProductFormDraft` only). Deleted in E1b once nothing imports it.
 */
export * from '@platform/web/products/productFormStorage'
