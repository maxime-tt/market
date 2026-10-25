/**
 * src/lib/constants.ts — the shim: `src/`'s view of the SDK constants module.
 *
 * The constants moved to `@sdk/config/constants`. Every existing call site keeps importing `@/lib/constants`
 * unchanged: the module is pure data and types, so a plain `export *` re-exports the whole surface and no
 * adapter is needed — every consumer imports named values and types (`CURRENCIES`, `PRODUCT_CATEGORIES`,
 * `Stage`, `PaymentDetailsMethod`, …), never a store or a callable object.
 */
export * from '@sdk/config/constants'
