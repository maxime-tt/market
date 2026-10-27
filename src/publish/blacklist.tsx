/**
 * Shim — the blacklist publish binding moved to
 * `platform/web/config/blacklistPublish.ts` (store drain D2, slice 16).
 *
 * The binding resolves the NDK client and signer through the Platform publish bridge, the
 * blacklist read through the same-feature binding and the settings publish context through
 * `@platform/web/curationContext` instead of `@/lib/stores/ndk`, `@/queries/blacklist`,
 * `@/queries/queryKeyFactory` and `./curationContext` — so a Platform host module consumes it
 * without a counted `platform -> src` edge. Vacated path kept as a re-export so no call site
 * breaks; deleted in E1.
 */
export * from '@platform/web/config/blacklistPublish'
