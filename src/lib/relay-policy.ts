/**
 * src/lib/relay-policy.ts — the shim: `src/`'s view of the SDK relay policy (Wave C, ndk drain S1).
 *
 * The policy moved to `sdk/core/relay-policy.ts` and now imports `@sdk/config/constants` directly. Kept so the
 * two policy tests keep a stable path; the ndk store imports `@sdk/core/relay-policy` directly. Deleted in E1b.
 */
export * from '@sdk/core/relay-policy'
