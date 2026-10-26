/**
 * Shim — the NIP-89 handler publish binding moved to `platform/web/nip89.ts`
 * (store drain D2, slice 9).
 *
 * The binding reads the app config through the SDK primitive and resolves NDK types and the
 * publish context through the Platform publish bridge instead of `src/lib` shims — so a
 * Platform host module consumes it without a counted `platform -> src` edge. Vacated path kept
 * as a re-export so no call site breaks; deleted in E1.
 */
export * from '@platform/web/nip89'
