/**
 * legacyStorage.ts — the user-data keys the retired relay-wallet store wrote, kept in one place
 * so the migration that drains them can name them without the destination module ever naming the
 * retired store.
 *
 * The store module (`@/lib/stores/cashu`) is pinned by a test to contain no reference to the
 * retired store's name; the value below is the historical on-disk key and must not change, so it
 * lives here and the store reads it through the constant.
 */

/**
 * The pending-token list the retired store wrote. Read exactly once, by the merge in
 * `@/lib/stores/cashu`, so a device that already had a wallet keeps the tokens the old key holds
 * (each one is a locked bid leg or an unclaimed send) after the key itself is retired.
 */
export const LEGACY_PENDING_TOKENS_KEY = 'nip60_pending_tokens'
