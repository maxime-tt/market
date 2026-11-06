/**
 * platform/web/browse/browseQuery.ts — Data hosts for the Browse shell.
 *
 * Uses `getReadContext()` from platform/web/readContext.ts per the
 * read doctrine (contract rev 2.22):
 * - The results/search list is a **stream** (list/live) — use `stream()`
 * - A single-entity read (product detail by id) may `fetch` with a
 *   one-line justification comment at the call site
 * - Never `fetch` a list
 *
 * The search list has ONE query path (`browseSearchQueryOptions` /
 * `useBrowseSearch`) with a **provider switch**:
 * - `local` (the default) — the SDK event-store stream, matched in memory
 * - `rabbithole` — the RabbitHole search service (streamed NDJSON), which
 *   falls back to the local stream when unreachable or when it fails
 *
 * The switch is one config point ({@link configureBrowseSearch}); the default
 * is `local`, so behaviour is unchanged until it is switched. The switch only
 * chooses the data source — the query's signature, return type, and every
 * downstream state (skeleton, empty, relay-failed, tag-filtered) are unchanged.
 */

import { queryOptions, useQuery } from '@tanstack/react-query'
import { getReadContext } from '../readContext'
import type { EventFilter } from '@sdk/core/event-store/filter'
import type { CaughtUpInfo } from '@sdk/core/event-store/read'
// Shared shapes and the canonical kind-30402 mapper (also used by the client).
import { mapProduct, type BrowseProduct, type BrowseSearchResult } from './browseProductMap'
// Canonical read model: sdk/commerce/discovery/productReadModel.ts
import { getProductCategories, getProductSummary, getProductTitle } from '@sdk/commerce/discovery'
import { rabbitholeSearch } from './rabbitholeClient'

// Re-exported so existing consumers (`BrowseIndexHost`) keep their imports.
export type { BrowseProduct, BrowseSearchResult }

// ---------------------------------------------------------------------------
// Query key factory
// ---------------------------------------------------------------------------

export const browseKeys = {
	all: ['browse'] as const,
	/** Stream filter for kind-30402 products matching a query/tag (per provider). */
	search: (filters: { query: string; tag?: string; limit?: number; provider: BrowseSearchProvider }) =>
		[...browseKeys.all, 'search', filters] as const,
	/** Single product detail by event id (fetch, not stream). */
	detail: (id: string) => [...browseKeys.all, 'detail', id] as const,
} as const

// ---------------------------------------------------------------------------
// Search provider switch — one config point, defaulting to the local stream
// ---------------------------------------------------------------------------

/** Which search provider answers the browse search list. */
export type BrowseSearchProvider = 'local' | 'rabbithole'

export interface BrowseSearchConfig {
	/** The search provider. Omitting it keeps the current value (default `local`). */
	provider?: BrowseSearchProvider
}

interface ResolvedBrowseSearchConfig {
	provider: BrowseSearchProvider
}

let browseSearchConfig: ResolvedBrowseSearchConfig = { provider: 'local' }

/**
 * Choose the browse search provider as configuration rather than import.
 * Merges into the current config. The default is `local`, so nothing changes
 * until this is called with `rabbithole`.
 */
export function configureBrowseSearch(config: BrowseSearchConfig): void {
	browseSearchConfig = { provider: config.provider ?? browseSearchConfig.provider }
}

/** The configured browse search provider (read at query time, per request). */
export function getBrowseSearchProvider(): BrowseSearchProvider {
	return browseSearchConfig.provider
}

// ---------------------------------------------------------------------------
// Search — local provider (the SDK event-store stream)
// ---------------------------------------------------------------------------

/**
 * The local search: the SDK read seam's kind-30402 stream, matched in memory.
 * The sdk read seam's EventFilter has no NIP-50 `search` field yet, so Browse
 * v1 reads a bounded kind-30402 set and matches the query locally — the interim
 * shape the plan records (`search-v2-fast-index` owns its replacement).
 */
async function searchLocal(query: string, tag: string | undefined, limit: number): Promise<BrowseSearchResult> {
	const ctx = getReadContext()
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
}

// ---------------------------------------------------------------------------
// Search/results stream
// ---------------------------------------------------------------------------

/**
 * Query options for the browse search/results stream.
 *
 * The provider choice ({@link getBrowseSearchProvider}) is the only variable:
 * - `local` reads the SDK event-store stream (the list is a **stream**).
 * - `rabbithole` POSTs the query to the search service and reads its one
 *   streamed NDJSON response (also a stream — one request, one response).
 *   When the service is unreachable, times out, or fails, it falls back to the
 *   local stream, so a dead provider degrades Browse to its v1 behaviour
 *   instead of breaking it.
 *
 * The signature and `BrowseSearchResult` return type are unchanged by the
 * switch; a RabbitHole `partial` verdict keeps its failed relays in `pending`
 * (the relay-failure state) and is never flattened into a plain result.
 */
export function browseSearchQueryOptions(query: string, tag?: string, limit = 100) {
	return queryOptions({
		queryKey: browseKeys.search({ query, tag, limit, provider: getBrowseSearchProvider() }),
		queryFn: async (context) => {
			if (!query?.trim()) return { products: [], eose: [], pending: [] }

			if (getBrowseSearchProvider() === 'rabbithole') {
				try {
					// The tag narrows the index to that category (the `#t` source).
					const filters = tag ? [`category_tags = "${tag}"`] : undefined
					return await rabbitholeSearch(
						{ q: query, limit, filters },
						{
							signal: context.signal,
						},
					)
				} catch (err) {
					// A caller abort (react-query cancel) is not a provider failure —
					// propagate it so the query is cancelled, not retried locally.
					if (err instanceof DOMException && err.name === 'AbortError') throw err
					// The provider is down or failed — fall back to the local stream.
					console.warn('[browse] RabbitHole search failed, falling back to the local stream:', err instanceof Error ? err.message : err)
				}
			}

			return searchLocal(query, tag, limit)
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
