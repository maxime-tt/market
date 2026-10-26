/**
 * Shim — the product publish binding moved to `platform/web/products/productPublish.ts`
 * (store drain D2, slice 13).
 *
 * The binding resolves the NDK client, signer, event class and publish context through the
 * Platform publish bridge, the client tag through `platform/web/nip89.ts` and the query keys
 * through the framework-free SDK instead of `@/lib/stores/ndk`, `./nip89` and
 * `@/queries/queryKeyFactory` — so a Platform host module consumes it without a counted
 * `platform -> src` edge. Vacated path kept as a re-export so no call site breaks; deleted in E1.
 */
export * from '@platform/web/products/productPublish'
