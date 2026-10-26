/**
 * Shim — the profile read binding moved to `platform/web/profiles/profileQuery.ts`
 * (store drain D1, slice 4).
 *
 * The framework-free identifier rule (`validateProfileIdentifier`) and identifier read
 * (`readProfileWorkflow`) live in `sdk/core/profile`; the React binding keeps the NDK facades (by-npub,
 * by-NIP-05, zaps, NIP-05 validation, WoT) and injects the read port from
 * `platform/web/ndkPublishContext.ts` / `platform/web/ndkReadContext.ts` instead of
 * `@/lib/stores/ndk`. `src/lib/utils/profileValidation.ts` is now a shim over the SDK rule too. Vacated
 * path kept as a re-export so no call site breaks; deleted in E1.
 */
export * from '@platform/web/profiles/profileQuery'
