/**
 * sdk/config/blacklist.ts — the blacklist state and the actions over it, on the generic state primitive.
 *
 * This is the first module the src/ drain moves onto `sdk/core/state`: the state is one `createStateStore`
 * instance and every action reads or replaces it through `get`/`set`. The public surface the app already
 * imports is unchanged — `BlacklistState` and `blacklistActions` keep every method and the same semantics —
 * so a consumer sees no difference; only the mechanism underneath is now shared rather than hand-rolled.
 *
 * The store is memory-only: the blacklist is synced from the app's settings query on every load
 * (`src/hooks/useBlacklistSync.ts`), so it injects no storage port. The primitive supports persistence
 * (write-through through a `KeyValueStoragePort`), and a future host that wants the blacklist cached across
 * reloads can inject one here without touching the actions.
 */
import { createStateStore } from '../core/state'
import type { StateStore } from '../core/state'

export interface BlacklistState {
	// Raw blacklist data
	blacklistedPubkeys: string[]
	blacklistedProducts: string[]
	blacklistedCollections: string[]

	// Regex patterns for efficient matching
	pubkeyRegex: RegExp | null
	productRegex: RegExp | null
	collectionRegex: RegExp | null

	// Metadata
	lastUpdated: number
	isLoaded: boolean
}

const initialState: BlacklistState = {
	blacklistedPubkeys: [],
	blacklistedProducts: [],
	blacklistedCollections: [],
	pubkeyRegex: null,
	productRegex: null,
	collectionRegex: null,
	lastUpdated: 0,
	isLoaded: false,
}

/**
 * The blacklist state, on the generic primitive. Exposed so a host can bridge it to its own reactivity
 * (`platform/web/config/blacklistBinding.ts`) or seed it. Reactivation is the host's: this module holds no
 * React and no `@tanstack/*`.
 */
export const blacklistState: StateStore<BlacklistState> = createStateStore<BlacklistState>({ initial: initialState })

/**
 * Helper function to escape regex special characters
 */
const escapeRegex = (str: string): string => {
	return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Build a regex pattern from an array of strings
 * Returns null if array is empty
 */
const buildRegexPattern = (items: string[]): RegExp | null => {
	if (items.length === 0) return null

	// Escape each item and join with OR operator
	const pattern = items.map((item) => `^${escapeRegex(item)}$`).join('|')
	return new RegExp(pattern, 'i') // Case-insensitive
}

export const blacklistActions = {
	/**
	 * Update the blacklist with new data
	 */
	setBlacklist: (data: {
		blacklistedPubkeys: string[]
		blacklistedProducts: string[]
		blacklistedCollections: string[]
		lastUpdated?: number
	}) => {
		const pubkeyRegex = buildRegexPattern(data.blacklistedPubkeys)
		const productRegex = buildRegexPattern(data.blacklistedProducts)
		const collectionRegex = buildRegexPattern(data.blacklistedCollections)

		blacklistState.set((state) => ({
			...state,
			blacklistedPubkeys: data.blacklistedPubkeys,
			blacklistedProducts: data.blacklistedProducts,
			blacklistedCollections: data.blacklistedCollections,
			pubkeyRegex,
			productRegex,
			collectionRegex,
			lastUpdated: data.lastUpdated || Date.now(),
			isLoaded: true,
		}))
	},

	/**
	 * Clear all blacklist data
	 */
	clearBlacklist: () => {
		blacklistState.set({ ...initialState })
	},

	/**
	 * Check if a pubkey is blacklisted
	 */
	isPubkeyBlacklisted: (pubkey: string): boolean => {
		const { pubkeyRegex, blacklistedPubkeys } = blacklistState.get()

		if (blacklistedPubkeys.length === 0) return false

		// Use regex for performance if available, otherwise fall back to array includes
		if (pubkeyRegex) {
			return pubkeyRegex.test(pubkey)
		}

		return blacklistedPubkeys.includes(pubkey)
	},

	/**
	 * Check if a product coordinate is blacklisted
	 */
	isProductBlacklisted: (productCoords: string): boolean => {
		const { productRegex, blacklistedProducts } = blacklistState.get()

		if (blacklistedProducts.length === 0) return false

		// Use regex for performance if available, otherwise fall back to array includes
		if (productRegex) {
			return productRegex.test(productCoords)
		}

		return blacklistedProducts.includes(productCoords)
	},

	/**
	 * Check if a collection coordinate is blacklisted
	 */
	isCollectionBlacklisted: (collectionCoords: string): boolean => {
		const { collectionRegex, blacklistedCollections } = blacklistState.get()

		if (blacklistedCollections.length === 0) return false

		// Use regex for performance if available, otherwise fall back to array includes
		if (collectionRegex) {
			return collectionRegex.test(collectionCoords)
		}

		return blacklistedCollections.includes(collectionCoords)
	},

	/**
	 * Get all blacklisted items
	 */
	getBlacklist: () => {
		const { blacklistedPubkeys, blacklistedProducts, blacklistedCollections } = blacklistState.get()
		return {
			pubkeys: blacklistedPubkeys,
			products: blacklistedProducts,
			collections: blacklistedCollections,
		}
	},

	/**
	 * Get regex patterns (useful for advanced filtering)
	 */
	getRegexPatterns: () => {
		const { pubkeyRegex, productRegex, collectionRegex } = blacklistState.get()
		return {
			pubkeyRegex,
			productRegex,
			collectionRegex,
		}
	},

	/**
	 * Check if blacklist is loaded
	 */
	isBlacklistLoaded: (): boolean => {
		return blacklistState.get().isLoaded
	},

	/**
	 * Get last update timestamp
	 */
	getLastUpdated: (): number => {
		return blacklistState.get().lastUpdated
	},
}
