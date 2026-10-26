/**
 * Shim — the profile-identifier validation rule moved to
 * `sdk/core/profile/profileValidation.ts` (store drain D1, slice 4).
 *
 * The rule is pure (nip19 decode + a hex regex) and the framework-free profile read in
 * `sdk/core/profile` needs it to reject a malformed identifier before any relay I/O, so it lives in the
 * SDK. The `src/` path is kept as a re-export so no call site breaks; deleted in E1.
 */
export * from '@sdk/core/profile/profileValidation'
