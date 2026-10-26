/**
 * Shim — the migrated-product publish binding moved to `platform/web/migration.tsx`
 * (store drain D2, slice 8).
 *
 * The binding resolves the app NDK/signer through the Platform publish bridge instead of
 * importing `@/lib/stores/ndk`, so a Platform host module can consume it without a counted
 * `platform -> src` edge. Vacated path kept as a re-export so no call site breaks; deleted in E1.
 */
export * from '@platform/web/migration'
