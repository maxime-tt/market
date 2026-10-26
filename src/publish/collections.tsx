/**
 * Shim — the collection publish binding moved to `platform/web/collections/collectionPublish.ts`
 * (store drain D2, slice 12).
 *
 * The binding resolves the NDK client and signer through the Platform publish bridge, the client
 * tag through `platform/web/nip89.ts` and the query keys through the framework-free SDK instead
 * of `@/lib/stores/ndk`, `./nip89` and `@/queries/queryKeyFactory` — so a Platform host module
 * consumes it without a counted `platform -> src` edge. Vacated path kept as a re-export so no
 * call site breaks; deleted in E1.
 */
export * from '@platform/web/collections/collectionPublish'
