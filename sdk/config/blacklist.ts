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
import type { NostrEventLike } from '../core/nostr/eventLike'
import { getATagFromCoords } from '../core/utils/coords'

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

/**
 * Coordinate/pubkey filters over the blacklist state (store drain D1, slice 4).
 *
 * These three lived in `src/lib/utils/blacklistFilters.ts` and read `blacklistActions` through the
 * `src/` store shim; they are the pure projection of the blacklist state onto the featured lists, so
 * they belong next to the state. `src/lib/utils/blacklistFilters.ts` re-exports them, and the featured
 * Platform binding imports them from here directly (keeping its inbound `platform -> src` import count
 * at zero).
 */
export const filterBlacklistedProductCoords = (productCoords: string[]): string[] => {
	return productCoords.filter((coords) => !blacklistActions.isProductBlacklisted(coords))
}

export const filterBlacklistedCollectionCoords = (collectionCoords: string[]): string[] => {
	return collectionCoords.filter((coords) => !blacklistActions.isCollectionBlacklisted(coords))
}

export const filterBlacklistedPubkeys = (pubkeys: string[]): string[] => {
	return pubkeys.filter((pubkey) => !blacklistActions.isPubkeyBlacklisted(pubkey))
}

/**
 * Filter out blacklisted items from an array of events
 */
export const filterBlacklistedEvents = <T extends NostrEventLike>(events: T[]): T[] => {
	if (!blacklistActions.isBlacklistLoaded()) {
		return events // Return all if blacklist not loaded yet
	}

	return events.filter((event) => {
		// Check if author is blacklisted
		if (blacklistActions.isPubkeyBlacklisted(event.pubkey)) {
			return false
		}

		// For products (kind 30402) and collections (kind 30405), check coordinates
		if (event.kind === 30402 || event.kind === 30405) {
			const dTag = event.tags.find((tag) => tag[0] === 'd')?.[1]
			if (dTag) {
				const coords = getATagFromCoords({
					kind: event.kind,
					pubkey: event.pubkey,
					identifier: dTag,
				})

				if (event.kind === 30402 && blacklistActions.isProductBlacklisted(coords)) {
					return false
				}

				if (event.kind === 30405 && blacklistActions.isCollectionBlacklisted(coords)) {
					return false
				}
			}
		}

		return true
	})
}

/**
 * Check if a product event is blacklisted
 */
export const isProductEventBlacklisted = (event: NostrEventLike): boolean => {
	// Check author
	if (blacklistActions.isPubkeyBlacklisted(event.pubkey)) {
		return true
	}

	// Check product coordinates
	if (event.kind === 30402) {
		const dTag = event.tags.find((tag) => tag[0] === 'd')?.[1]
		if (dTag) {
			const coords = getATagFromCoords({
				kind: 30402,
				pubkey: event.pubkey,
				identifier: dTag,
			})
			return blacklistActions.isProductBlacklisted(coords)
		}
	}

	return false
}

/**
 * Check if a collection event is blacklisted
 */
export const isCollectionEventBlacklisted = (event: NostrEventLike): boolean => {
	// Check author
	if (blacklistActions.isPubkeyBlacklisted(event.pubkey)) {
		return true
	}

	// Check collection coordinates
	if (event.kind === 30405) {
		const dTag = event.tags.find((tag) => tag[0] === 'd')?.[1]
		if (dTag) {
			const coords = getATagFromCoords({
				kind: 30405,
				pubkey: event.pubkey,
				identifier: dTag,
			})
			return blacklistActions.isCollectionBlacklisted(coords)
		}
	}

	return false
}

/**
 * React hook that returns filter functions with reactive updates
 * Use this in components that need to react to blacklist changes
 */
export const useBlacklistFilters = () => {
	return {
		filterEvents: filterBlacklistedEvents,
		isProductBlacklisted: isProductEventBlacklisted,
		isCollectionBlacklisted: isCollectionEventBlacklisted,
		filterProductCoords: filterBlacklistedProductCoords,
		filterCollectionCoords: filterBlacklistedCollectionCoords,
		filterPubkeys: filterBlacklistedPubkeys,
	}
}
