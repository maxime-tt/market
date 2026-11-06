/**
 * platform/web/browse/browseQuery.ts — Data hosts for the Browse shell.
 *
 * Uses `getReadContext()` from platform/web/readContext.ts per the
 * read doctrine (contract rev 2.22):
 * - The results/search list is a **stream** (list/live) — use `stream()`
 * - A single-entity read (product detail by id) may `fetch` with a
 *   one-line justification comment at the call site. When the search hit
 *   recorded the relays it was seen on, that single read is aimed at those
 *   relays (`applesauceIo.fetchEvents`'s `relayUrls`) instead of the app's
 *   own context — still one bounded request for one entity
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
import { applesauceIo, getReadContext, type NostrFilter } from '../readContext'
import type { EventFilter } from '@sdk/core/event-store/filter'
import type { CaughtUpInfo } from '@sdk/core/event-store/read'
import { excludeDeleted } from '@sdk/core/event-store/read'
import type { NostrEventLike } from '@sdk/core/nostr/eventLike'
import { isValidHexKey } from '@sdk/core/utils/utils'
import { filterBlacklistedEvents } from '@sdk/config/blacklist'
import { buildProductListFilter, isProductListed } from '@sdk/commerce/discovery'
// Shared shapes and the canonical kind-30402 mappers (also used by the client).
import { mapProduct, mapProductDetail, type BrowseProduct, type BrowseProductDetail, type BrowseSearchResult } from './browseProductMap'
// Canonical read model: sdk/commerce/discovery/productReadModel.ts
import { getProductCategories, getProductSummary, getProductTitle } from '@sdk/commerce/discovery'
import { rabbitholeSearch } from './rabbitholeClient'

// Re-exported so existing consumers (`BrowseIndexHost`) keep their imports.
export type { BrowseProduct, BrowseProductDetail, BrowseSearchResult }

// ---------------------------------------------------------------------------
// Query key factory
// ---------------------------------------------------------------------------

export const browseKeys = {
	all: ['browse'] as const,
	/** Stream filter for kind-30402 products matching a query/tag (per provider). */
	search: (filters: { query: string; tag?: string; limit?: number; provider: BrowseSearchProvider }) =>
		[...browseKeys.all, 'search', filters] as const,
	/** Single product detail by event id (fetch, not stream), scoped to the relays it was seen on. */
	detail: (id: string, relays?: readonly string[]) => [...browseKeys.all, 'detail', id, relays ?? null] as const,
	/** A seller's own listings (the seller-profile screen's list stream). */
	sellerListings: (pubkey: string, limit: number) => [...browseKeys.all, 'seller-listings', pubkey, limit] as const,
} as const

// ---------------------------------------------------------------------------
// Search provider switch — one config point, defaulting to the local stream
// ---------------------------------------------------------------------------

/** Which search provider answers the browse search list. */
export type BrowseSearchProvider = 'local' | 'rabbithole'

export interface BrowseSearchConfig {
	/** The search provider. Omitting it keeps the current value (default `local`). */
	provider?: BrowseSearchProvider
	/**
	 * The API base the client POSTs to, e.g. `/api/browse-search` on the app's own
	 * origin. Omitting it keeps the current value (the RabbitHole client's own
	 * default, `http://127.0.0.1:7711`) — which only works when the browser IS on
	 * the service's box, so a deployed instance always sets this.
	 */
	baseUrl?: string
}

interface ResolvedBrowseSearchConfig {
	provider: BrowseSearchProvider
	baseUrl?: string
}

let browseSearchConfig: ResolvedBrowseSearchConfig = { provider: 'local' }

/**
 * Choose the browse search provider as configuration rather than import.
 * Merges into the current config. The default is `local`, so nothing changes
 * until this is called with `rabbithole`.
 */
export function configureBrowseSearch(config: BrowseSearchConfig): void {
	browseSearchConfig = {
		provider: config.provider ?? browseSearchConfig.provider,
		baseUrl: config.baseUrl ?? browseSearchConfig.baseUrl,
	}
}

/** The configured browse search provider (read at query time, per request). */
export function getBrowseSearchProvider(): BrowseSearchProvider {
	return browseSearchConfig.provider
}

/** The configured API base, or `undefined` to let the client use its loopback default. */
export function getBrowseSearchBaseUrl(): string | undefined {
	return browseSearchConfig.baseUrl
}

/** Reset the switch to its defaults (`local`, no base override), primarily for tests. */
export function resetBrowseSearchConfig(): void {
	browseSearchConfig = { provider: 'local' }
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
 *
 * The read is enabled by a query, a tag, or an open product:
 * - `tag` alone is the category row's `See all →` (browse one category);
 * - `openProductId` alone is `?p=<slug>` with nothing else on the URL — the
 *   click-through contract's own deep link, and the state a strip/row click
 *   lands in, where the panel's master pane is the loaded set.
 * With none of the three there is nothing to read, so the query stays off.
 */
export function browseSearchQueryOptions(query: string, tag?: string, limit = 100, openProductId?: string) {
	return queryOptions({
		queryKey: browseKeys.search({ query, tag, limit, provider: getBrowseSearchProvider() }),
		queryFn: async (context) => {
			const term = query.trim()
			// Nothing to read without a term, a tag, or an open product.
			if (!term && !tag && !openProductId) return { products: [], eose: [], pending: [] }

			// The search service indexes *queries*; a tag-only browse (the category
			// row's `See all →`, which carries no term) reads the local stream
			// instead of POSTing an empty query to it.
			if (term && getBrowseSearchProvider() === 'rabbithole') {
				try {
					// The tag narrows the index to that category (the `#t` source).
					const filters = tag ? [`category_tags = "${tag}"`] : undefined
					return await rabbitholeSearch(
						{ q: query, limit, filters },
						{
							signal: context.signal,
							baseUrl: getBrowseSearchBaseUrl(),
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
		enabled: Boolean(query?.trim()) || Boolean(tag) || Boolean(openProductId),
	})
}

export function useBrowseSearch(query: string, tag?: string, limit?: number, openProductId?: string) {
	return useQuery(browseSearchQueryOptions(query, tag, limit, openProductId))
}

// ---------------------------------------------------------------------------
// Product detail — fetch (single entity, bounded)
// ---------------------------------------------------------------------------

/**
 * Fetch one product by the identifier a card hands out — the split-view panel's
 * single read.
 *
 * That identifier is `mapProduct`'s `id`: the kind-30402 `d` tag (the frame's
 * `?p=handcrafted-ceramic-ball`), falling back to the event id for a listing
 * without one. Both filters are sent as one OR, so either identity resolves.
 *
 * `relays` is where the listing was actually found: a RabbitHole search hit
 * carries the `relays_seen` the client records on the product (`BrowseProduct.relays`),
 * and RabbitHole answers from relays this app is not connected to — reading the
 * detail from the app's own context alone therefore resolved to nothing for a
 * listing visibly on screen. With those relays named, the detail read goes to
 * the relays that served the hit; without them (the local stream, which reads
 * the app's own store, or any provider that records none) it falls back to the
 * app's read context unchanged.
 *
 * Both paths are a bounded single-entity `fetch` — a stream would hold a live
 * subscription open for one listing whose identity the panel already knows.
 * A relay set that does not answer is a read that found nothing, not a failed
 * read: the panel shows its empty state rather than an error.
 *
 * A coordinate can be published by more than one author, so the newest event
 * for it wins — deterministic, and the same event a card would have shown.
 */
export function browseProductDetailQueryOptions(id: string | undefined, relays?: readonly string[]) {
	// A relay set given once and reused by the key and the read.
	const relayTargets = relays && relays.length > 0 ? [...relays] : undefined
	return queryOptions({
		queryKey: browseKeys.detail(id ?? '', relayTargets),
		queryFn: async (): Promise<BrowseProductDetail | null> => {
			if (!id) return null
			// Bounded fetch for a single product by id or coordinate (not a list)
			const filters: EventFilter[] = [
				{ kinds: [30402], '#d': [id] },
				{ kinds: [30402], ids: [id] },
			]
			const events = relayTargets ? await fetchFromRelays(filters, relayTargets) : await getReadContext().fetch(filters)
			const newest = [...events].sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))[0]
			return newest ? (mapProductDetail(newest) ?? null) : null
		},
		enabled: Boolean(id),
	})
}

/**
 * The same bounded single-entity read, aimed at the relays the search hit was
 * seen on. An unreachable relay degrades to no events (the panel's empty
 * state) rather than rejecting the query into its error state.
 */
async function fetchFromRelays(filters: EventFilter[], relays: string[]): Promise<NostrEventLike[]> {
	try {
		return await applesauceIo.fetchEvents(filters as NostrFilter[], { relayUrls: relays })
	} catch (err) {
		console.warn('[browse] the listing’s own relays did not answer; showing the empty state:', err instanceof Error ? err.message : err)
		return []
	}
}

export function useBrowseProductDetail(id: string | undefined, relays?: readonly string[]) {
	return useQuery(browseProductDetailQueryOptions(id, relays))
}

// ---------------------------------------------------------------------------
// Seller listings — the seller-profile screen (frame YcjyRPZbVo)
// ---------------------------------------------------------------------------

/** A seller's listings plus the seam's relay verdict for that read. */
export interface SellerListingsResult {
	/** Current, non-deleted, purchasable listings from this author, newest first. */
	listings: BrowseProduct[]
	/** Relays that answered before the caught-up marker. */
	eose: string[]
	/** Relays that did not answer (still pending, or failed). */
	pending: string[]
}

/**
 * A seller's listings: the SDK read seam's kind-30402 **stream** for this author,
 * built with the products module's own filter (`buildProductListFilter`), under
 * the same rules the seller's product list applies — `purchasable` visibility,
 * the blacklist, and NIP-09 deletions. A list is a stream (never a `fetch`);
 * breaking at the caught-up marker is what bounds it and what gives the
 * seller-profile frame's status line a real relay verdict instead of an assumed
 * one.
 */
export async function fetchSellerListings(pubkey: string, limit = 50): Promise<SellerListingsResult> {
	if (!isValidHexKey(pubkey)) return { listings: [], eose: [], pending: [] }

	const context = getReadContext()
	const events: NostrEventLike[] = []
	let caughtUpInfo: CaughtUpInfo | null = null
	for await (const item of context.stream([buildProductListFilter({ limit, author: pubkey })])) {
		if (item.type === 'event') events.push(item.event)
		if (item.type === 'caught-up') {
			caughtUpInfo = item.info
			break
		}
	}

	// A listing its author deleted never surfaces, exactly as in the products
	// module's own list read.
	const live = await excludeDeleted(context, events)
	const listings = filterBlacklistedEvents(live)
		.filter((event) => isProductListed(event, 'purchasable'))
		.map(mapProduct)
		.filter((product): product is BrowseProduct => product !== undefined)

	return { listings, eose: caughtUpInfo?.eose ?? [], pending: caughtUpInfo?.pending ?? [] }
}

export function sellerListingsQueryOptions(pubkey: string, limit = 50) {
	return queryOptions({
		queryKey: browseKeys.sellerListings(pubkey, limit),
		queryFn: () => fetchSellerListings(pubkey, limit),
		enabled: isValidHexKey(pubkey),
	})
}

export function useSellerListings(pubkey: string, limit?: number) {
	return useQuery(sellerListingsQueryOptions(pubkey, limit))
}
