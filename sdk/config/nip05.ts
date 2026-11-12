/**
 * sdk/config/nip05.ts — the NIP-05 state and the actions over it, on the generic state primitive.
 *
 * The state moved here from `src/lib/stores/nip05.ts` and is one `createStateStore` instance; every action
 * reads or replaces it through `get`/`set`. The public surface the app already imports is unchanged —
 * `Nip05Entry`, `Nip05State` and `nip05Actions` keep every method and the same semantics — so a consumer
 * sees no difference; only the mechanism underneath is now shared rather than a hand-rolled `@tanstack/store`
 * `Store`. The source module exported no React accessor, and no consumer reads a `Store` here, so nothing but
 * the `export *` is needed in `src/lib/stores/nip05.ts`; this module holds no React and no `@tanstack/*`.
 *
 * The store is memory-only: NIP-05 names are resynced from the app's settings query on every load, so it
 * injects no storage port. The primitive supports persistence (write-through through a `KeyValueStoragePort`);
 * a future host that wants the names cached across reloads can inject one here without touching the actions.
 */
import { createStateStore } from '../core/state'
import type { StateStore } from '../core/state'

export interface Nip05Entry {
	username: string
	pubkey: string
	validUntil: number
}

export interface Nip05State {
	entries: Map<string, Nip05Entry>
	pubkeyToUsername: Map<string, string>
	lastUpdated: number
	isLoaded: boolean
}

const initialState: Nip05State = {
	entries: new Map(),
	pubkeyToUsername: new Map(),
	lastUpdated: 0,
	isLoaded: false,
}

/**
 * The NIP-05 state, on the generic primitive. Exposed so a host can bridge it to its own reactivity
 * (`platform/web/config/nip05Binding.ts`) or seed it. Reactivation is the host's: this module holds no React
 * and no `@tanstack/*`.
 */
export const nip05State: StateStore<Nip05State> = createStateStore<Nip05State>({ initial: initialState })

// Reserved names that cannot be registered (should match server)
const RESERVED_NAMES = new Set([
	'admin',
	'_',
	'root',
	'postmaster',
	'webmaster',
	'hostmaster',
	'abuse',
	'noc',
	'security',
	'info',
	'support',
	'help',
	'noreply',
	'no-reply',
	'app',
	'system',
	'api',
	'bot',
])

export const nip05Actions = {
	/**
	 * Update the nip05 store with new data
	 */
	setNip05: (entries: Nip05Entry[], lastUpdated?: number) => {
		const now = Math.floor(Date.now() / 1000)
		const entriesMap = new Map<string, Nip05Entry>()
		const pubkeyToUsername = new Map<string, string>()

		for (const entry of entries) {
			// Skip expired entries
			if (entry.validUntil < now) {
				continue
			}

			const normalizedName = entry.username.toLowerCase()
			entriesMap.set(normalizedName, entry)
			pubkeyToUsername.set(entry.pubkey, normalizedName)
		}

		nip05State.set((state) => ({
			...state,
			entries: entriesMap,
			pubkeyToUsername,
			lastUpdated: lastUpdated || Date.now(),
			isLoaded: true,
		}))
	},

	/**
	 * Clear all nip05 data
	 */
	clearNip05: () => {
		nip05State.set((state) => ({
			...state,
			...initialState,
		}))
	},

	/**
	 * Resolve a username to a pubkey
	 */
	resolveUsername: (username: string): Nip05Entry | null => {
		const { entries } = nip05State.get()
		const entry = entries.get(username.toLowerCase())

		if (!entry) return null

		// Check if expired
		if (entry.validUntil < Math.floor(Date.now() / 1000)) {
			return null
		}

		return entry
	},

	/**
	 * Check if a username is available
	 */
	isUsernameAvailable: (username: string): boolean => {
		const normalized = username.toLowerCase()

		// Check reserved names
		if (RESERVED_NAMES.has(normalized)) return false

		// Check format validity
		if (!nip05Actions.isValidUsername(normalized)) return false

		const { entries } = nip05State.get()
		const entry = entries.get(normalized)

		if (!entry) return true

		// Available if expired
		return entry.validUntil < Math.floor(Date.now() / 1000)
	},

	/**
	 * Validate username format
	 */
	isValidUsername: (name: string): boolean => {
		// Allow alphanumeric, hyphens, underscores, dots, 1-30 characters
		const regex = /^[a-z0-9][a-z0-9._-]{0,28}[a-z0-9]$|^[a-z0-9]$/
		return regex.test(name.toLowerCase())
	},

	/**
	 * Check if a name is reserved
	 */
	isReservedName: (username: string): boolean => {
		return RESERVED_NAMES.has(username.toLowerCase())
	},

	/**
	 * Get NIP-05 entry for a pubkey
	 */
	getNip05ForPubkey: (pubkey: string): Nip05Entry | null => {
		const { pubkeyToUsername, entries } = nip05State.get()
		const username = pubkeyToUsername.get(pubkey)

		if (!username) return null

		return nip05Actions.resolveUsername(username)
	},

	/**
	 * Get all active nip05 entries
	 */
	getAllNip05Entries: (): Nip05Entry[] => {
		const { entries } = nip05State.get()
		const now = Math.floor(Date.now() / 1000)

		return Array.from(entries.values()).filter((entry) => entry.validUntil > now)
	},

	/**
	 * Check if nip05 store is loaded
	 */
	isNip05Loaded: (): boolean => {
		return nip05State.get().isLoaded
	},

	/**
	 * Get last update timestamp
	 */
	getLastUpdated: (): number => {
		return nip05State.get().lastUpdated
	},
}
