/**
 * User-scoped localStorage for the wallet's records.
 *
 * The signed-in identity is an explicit **parameter** here, never read ambiently
 * (the owner's ruling: a resolved pubkey is passed as a parameter to a read,
 * gated where the app reads the signer rather than derived by the read itself).
 * A caller that is a host or component reads the signer once and passes the
 * resolved pubkey in; a caller with no user passes `null`.
 */

/**
 * Get a user-scoped storage key.
 * @param prefix The base key prefix
 * @param pubkey The resolved user pubkey, or null to scope to no user
 * @returns The full storage key, or null if user not authenticated
 */
function getUserScopedKey(prefix: string, pubkey: string | null): string | null {
	if (!pubkey) return null
	return `${prefix}_${pubkey.slice(0, 8)}`
}

/**
 * Load JSON data from user-scoped localStorage.
 * @param prefix The base key prefix
 * @param defaultValue Default value if not found or parse fails
 * @param pubkey The resolved user pubkey, or null when there is no user
 */
export function loadUserData<T>(prefix: string, defaultValue: T, pubkey: string | null): T {
	try {
		const key = getUserScopedKey(prefix, pubkey)
		if (!key) return defaultValue

		const stored = localStorage.getItem(key)
		return stored ? JSON.parse(stored) : defaultValue
	} catch {
		return defaultValue
	}
}

/**
 * Options for {@link saveUserData}.
 */
export interface SaveUserDataOptions {
	/**
	 * #1235 follow-up (fail-closed bidder records): when true, storage
	 * failures (disabled storage, quota exceeded, serialization errors)
	 * RETHROW instead of being logged-and-swallowed, and a missing
	 * authenticated user scope is treated as a failure rather than a
	 * silent skip.
	 *
	 * Only use this for writes whose silent loss is unrecoverable — e.g. the
	 * bidder record holding the ONLY durable copy of a locked leg's refund
	 * private key. Every other caller keeps the default swallow behavior
	 * (their loss is cosmetic/refreshable, not fund-loss).
	 */
	strict?: boolean
}

/**
 * Save JSON data to user-scoped localStorage.
 * @param prefix The base key prefix
 * @param data The data to save
 * @param pubkey The resolved user pubkey, or null when there is no user
 * @param options Pass `{ strict: true }` for fail-closed writes — see
 *   {@link SaveUserDataOptions.strict}. Default (strict: false) preserves
 *   the historical behavior: storage failures are logged and swallowed.
 */
export function saveUserData<T>(prefix: string, data: T, pubkey: string | null, options?: SaveUserDataOptions): void {
	try {
		const key = getUserScopedKey(prefix, pubkey)
		if (!key) {
			// A strict write with no user scope is NOT persisted — failing
			// closed beats silently skipping an unrecoverable record.
			if (options?.strict) {
				throw new Error(`[wallet/storage] Refusing to silently skip strict save of ${prefix}: no authenticated user scope`)
			}
			return
		}

		localStorage.setItem(key, JSON.stringify(data))
	} catch (e) {
		if (options?.strict) throw e
		console.error(`[wallet/storage] Failed to save ${prefix}:`, e)
	}
}

/**
 * Remove user-scoped data from localStorage.
 * @param prefix The base key prefix
 * @param pubkey The resolved user pubkey, or null when there is no user
 */
export function removeUserData(prefix: string, pubkey: string | null): void {
	try {
		const key = getUserScopedKey(prefix, pubkey)
		if (!key) return

		localStorage.removeItem(key)
	} catch {
		// Silently ignore removal errors
	}
}
