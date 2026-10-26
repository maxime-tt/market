/**
 * Shim — the profile publish binding moved to `platform/web/profiles/profilePublish.ts`
 * (store drain D2, slice 3).
 *
 * The binding resolves the app NDK/signer through the Platform publish bridge instead of
 * importing `@/lib/stores/ndk`, so a Platform host module can consume it without a counted
 * `platform -> src` edge. Vacated path kept as a re-export so no call site breaks; deleted in E1.
 */
export * from '@platform/web/profiles/profilePublish'
