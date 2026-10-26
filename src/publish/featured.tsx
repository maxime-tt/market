/**
 * Shim — the featured-list publish binding moved to `platform/web/featured/featuredPublish.tsx`
 * (store drain D2, slice 11).
 *
 * The binding resolves the NDK client and signer through the Platform publish bridge and its
 * curation helpers through `platform/web/curationContext.ts` instead of `@/lib/stores/ndk` and
 * the `./curationContext` shim — so a Platform host module consumes it without a counted
 * `platform -> src` edge. Vacated path kept as a re-export so no call site breaks; deleted in E1.
 */
export * from '@platform/web/featured/featuredPublish'
