/**
 * platform/web/browse/browseQuery.ts — Data hosts for the Browse shell.
 *
 * Uses `getReadContext()` from platform/web/readContext.ts per the
 * read doctrine (contract rev 2.22):
 * - The results/search list is a **stream** (list/live) — use `stream()`
 * - A single-entity read (product detail by id) may `fetch` with a
 *   one-line justification comment at the call site
 * - Never `fetch` a list
 */

import { queryOptions, useQuery } from '@tanstack/react-query'
import { getReadContext } from '../readContext'
import type { CaughtUpInfo, EventFilter } from '@sdk/core/event-store/filter'
import type { NostrEventLike } from '@sdk/core/nostr/eventLike'
// Canonical read model: sdk/commerce/discovery/productReadModel.ts
import {
	getProductCategories,
	getProductImages,
	getProductPrice,
	getProductId,
	getProductPubkey,
	getProductStock,
	getProductSummary,
	getProductTitle,
} from '@sdk/commerce/discovery'

// ---------------------------------------------------------------------------
// Query key factory
// ---------------------------------------------------------------------------

export const browseKeys = {
	all: ['browse'] as const,
	/** Stream filter for kind-30402 products matching a query/tag. */
	search: (filters: { query: string; tag?: string; limit?: number }) => [...browseKeys.all, 'search', filters] as const,
	/** Single product detail by event id (fetch, not stream). */
	detail: (id: string) => [...browseKeys.all, 'detail', id] as const,
} as const

// ---------------------------------------------------------------------------
// BrowseProduct shape — consumed by @ui/browse/product-card
// ---------------------------------------------------------------------------

/** The minimal product shape the Browse UI expects. */
export interface BrowseProduct {
	id: string
	pubkey: string
	title: string
	price?: number
	stock?: string
	image?: string
	categories: string[]
}

/** Return shape for the browse search stream — products plus relay status. */
export interface BrowseSearchResult {
	/** Filtered products from the stream. */
	products: BrowseProduct[]
	/** Relays that reached EOSE (answered) before the caught-up marker. */
	eose: string[]
	/** Relays that did not reach EOSE (still pending). */
	pending: string[]
}

/**
 * Map a kind-30402 NostrEventLike into a BrowseProduct using the canonical
 * discovery read model (sdk/commerce/discovery/productReadModel.ts).
 * Exactly as ui/products/product-card-view.tsx does: getProductId,
 * getProductTitle, getProductPrice, getProductImages, getProductStock,
 * getProductCategories — each over ProductReadEvent.
 */
function mapProduct(event: NostrEventLike): BrowseProduct | undefined {
	const title = getProductTitle(event)
	const priceTag = getProductPrice(event)
	const price = priceTag ? Number(priceTag[1]) || undefined : undefined
	const stockTag = getProductStock(event)
	const stock = stockTag?.[1]
	const images = getProductImages(event)
	const image = images.length > 0 ? images[0][1] : undefined
	const categories = getProductCategories(event).map((t) => t[1])
	const pubkey = getProductPubkey(event)
	const id = getProductId(event) || event.id

	if (!title && !id) return undefined

	return {
		id,
		pubkey,
		title: title || 'Untitled',
		price,
		stock,
		image,
		categories,
	}
}

// ---------------------------------------------------------------------------
// Search/results stream
// ---------------------------------------------------------------------------

/**
 * Query options for the browse search/results stream.
 * Uses `stream()` — never `fetch` for lists.
 * Mirrors platform/web/products/productQuery.ts fetchProductsBySearch:
 * kind 30402, NIP-50 free-text search string, optional #t tag filter.
 */
export function browseSearchQueryOptions(query: string, tag?: string, limit = 100) {
	return queryOptions({
		queryKey: browseKeys.search({ query, tag, limit }),
		queryFn: async () => {
			if (!query?.trim()) return { products: [], eose: [], pending: [] }

			const ctx = getReadContext()
			// The sdk read seam's EventFilter has no NIP-50 `search` field yet, so Browse
			// v1 reads a bounded kind-30402 set and matches the query locally — the interim
			// shape the plan records (`search-v2-fast-index` owns its replacement).
			const filter: EventFilter = { kinds: [30402], limit }
			if (tag) {
				filter['#t'] = [tag]
			}

			const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
			const products: BrowseProduct[] = []
			let caughtUpInfo: CaughtUpInfo | null = null
			for await (const item of ctx.stream([filter])) {
				if (item.type === 'event') {
					const product = mapProduct(item.event)
					if (product) {
						const haystack =
							`${getProductTitle(item.event)} ${getProductSummary(item.event) ?? ''} ${(getProductCategories(item.event) ?? []).flat().join(' ')}`.toLowerCase()
						if (terms.every((term) => haystack.includes(term))) products.push(product)
					}
				}
				if (item.type === 'caught-up') {
					caughtUpInfo = item.info
					break
				}
			}
			return { products, eose: caughtUpInfo?.eose ?? [], pending: caughtUpInfo?.pending ?? [] }
		},
		enabled: !!query?.trim(),
	})
}

export function useBrowseSearch(query: string, tag?: string, limit?: number) {
	return useQuery(browseSearchQueryOptions(query, tag, limit))
}

// ---------------------------------------------------------------------------
// Product detail — fetch (single entity, bounded)
// ---------------------------------------------------------------------------

/**
 * Fetch a single product by event id. Uses `fetch()` (bounded stream, not
 * `stream()`) because this is a single-entity read by coordinate.
 */
export function browseProductDetailQueryOptions(id: string | undefined) {
	return queryOptions({
		queryKey: browseKeys.detail(id ?? ''),
		queryFn: async () => {
			if (!id) return []
			const ctx = getReadContext()
			// Bounded fetch for single product detail (not a list)
			const events = await ctx.fetch([{ ids: [id], kinds: [30402] }])
			return events.map(mapProduct).filter(Boolean) as BrowseProduct[]
		},
		enabled: Boolean(id),
	})
}

export function useBrowseProductDetail(id: string | undefined) {
	return useQuery(browseProductDetailQueryOptions(id))
}
