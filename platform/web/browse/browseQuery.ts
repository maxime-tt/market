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
import type { NostrEventLike } from '@sdk/core/nostr/eventLike'
// EventFilter is imported implicitly via getReadContext's return type
// ---------------------------------------------------------------------------
// Query key factory
// ---------------------------------------------------------------------------

export const browseKeys = {
	all: ['browse'] as const,
	/** Stream filter for all products (kind-30405) matching a query/tag. */
	search: (filters: { kind?: number; tag?: string; limit?: number }) =>
		[...browseKeys.all, 'search', filters] as const,
	/** Single product detail by event id (fetch, not stream). */
	detail: (id: string) => [...browseKeys.all, 'detail', id] as const,
	/** Account profile by current pubkey. */
	profile: (pubkey: string) => [...browseKeys.all, 'profile', pubkey] as const,
} as const

// ---------------------------------------------------------------------------
// Search/results stream
// ---------------------------------------------------------------------------

export interface BrowseProduct {
	/** Nostr event id. */
	id: string
	/** Pubkey of the publisher. */
	pubkey: string
	/** Product title. */
	title: string
	/** Price in sats (kind-30405 d-tag). */
	price?: number
	/** Stock note (kind-30405 d-tag or content). */
	stock?: string
	/** Product image URL (kind-30405 d-tag). */
	image?: string
	/** Categories (kind-30405 d-tags). */
	categories?: string[]
}

function extractProduct(event: NostrEventLike): BrowseProduct | undefined {
	const content = typeof event.content === 'string' ? event.content : ''
	const title = event.tags.find((t) => t[0] === 'd' && t[1] === 'title')?.[1] ?? content.split('\n')[0]
	const priceTag = event.tags.find((t) => t[0] === 'd' && t[1] === 'price')?.[1]
	const price = priceTag ? parseInt(priceTag, 10) : undefined
	const stockTag = event.tags.find((t) => t[0] === 'd' && t[1] === 'stock')?.[1]
	const imageTag = event.tags.find((t) => t[0] === 'd' && t[1] === 'image')?.[1]
	const categories = event.tags.filter((t) => t[0] === 'd' && t[1] !== 'title' && t[1] !== 'price' && t[1] !== 'stock' && t[1] !== 'image').map((t) => t[1])

	return {
		id: event.id,
		pubkey: event.pubkey,
		title: title ?? 'Untitled',
		price,
		stock: stockTag,
		image: imageTag,
		categories,
	}
}

/**
 * Query options for the browse search/results stream.
 * Uses `stream()` — never `fetch` for lists.
 */
export function browseSearchQueryOptions(
	query: string,
	tag?: string,
	limit = 100,
) {
	return queryOptions({
		queryKey: browseKeys.search({ kind: 30405, tag, limit }),
		queryFn: async () => {
			const ctx = getReadContext()
			const filters = [
				{ kinds: [30405], search: query ? query.split(/\s+/) : [] },
			]
			const results: NostrEventLike[] = []
			for await (const item of ctx.stream(filters)) {
				if (item.type === 'event') {
					const product = extractProduct(item.event)
					if (product) results.push(item.event as NostrEventLike)
				}
				if (item.type === 'caught-up') break
			}
			return results
		},
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
export function browseProductDetailQueryOptions(id: string) {
	return queryOptions({
		queryKey: browseKeys.detail(id),
		queryFn: async () => {
			const ctx = getReadContext()
			// Bounded fetch for single product detail (not a list)
			const events = await ctx.fetch([{ ids: [id], kinds: [30405] }])
			return events.map(extractProduct).filter(Boolean) as BrowseProduct[]
		},
	})
}

export function useBrowseProductDetail(id: string) {
	return useQuery(browseProductDetailQueryOptions(id))
}
