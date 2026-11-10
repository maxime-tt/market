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

import { queryOptions, useQuery, keepPreviousData } from '@tanstack/react-query'
import { useCallback, useSyncExternalStore } from 'react'
import { applesauceIo, getReadContext, type NostrFilter } from '../readContext'
import type { EventFilter } from '@sdk/core/event-store/filter'
import type { CaughtUpInfo } from '@sdk/core/event-store/read'
import { excludeDeleted } from '@sdk/core/event-store/read'
import type { NostrEventLike } from '@sdk/core/nostr/eventLike'
import { isValidHexKey } from '@sdk/core/utils/utils'
import { getCoordsFromATag, isValidATag, type AddressableEventCoordinate } from '@sdk/core/utils/coords'
import { filterBlacklistedEvents } from '@sdk/config/blacklist'
import { buildProductListFilter, isProductListed } from '@sdk/commerce/discovery'
import { parseProductAddress, prepareProductFamilyCatalog } from '@sdk/commerce/discovery'
// Shared shapes and the canonical kind-30402 mappers (also used by the client).
import {
	collapseProductFamilyEvents,
	mapProductDetail,
	mapProductFamilyChildren,
	type BrowseFamilyChildren,
	type BrowseFacet,
	type BrowseProduct,
	type BrowseProductDetail,
	type BrowseSearchResult,
} from './browseProductMap'
// Canonical read model: sdk/commerce/discovery/productReadModel.ts
import { getProductCategories, getProductSummary, getProductTitle } from '@sdk/commerce/discovery'
import { rabbitholeSearch, RabbitHoleError } from './rabbitholeClient'

// Re-exported so existing consumers (`BrowseIndexHost`) keep their imports.
export type { BrowseProduct, BrowseProductDetail, BrowseSearchResult }

// ---------------------------------------------------------------------------
// Query key factory
// ---------------------------------------------------------------------------

export const browseKeys = {
	all: ['browse'] as const,
	/** Stream filter for kind-30402 products matching a query/tag (per provider). */
	search: (filters: { query: string; tag?: string; filter?: string; limit?: number; provider: BrowseSearchProvider }) =>
		[...browseKeys.all, 'search', filters] as const,
	/** The unfiltered facet probe: the term's own market-scoped facet list. */
	facets: (filters: { query: string; provider: BrowseSearchProvider }) => [...browseKeys.all, 'facets', filters] as const,
	/** Single product detail by event id (fetch, not stream), scoped to the relays it was seen on. */
	detail: (id: string, relays?: readonly string[]) => [...browseKeys.all, 'detail', id, relays ?? null] as const,
	/** A family's child options by parent coordinate (fetch, not stream). */
	familyChildren: (parentAddress: string, relays?: readonly string[]) =>
		[...browseKeys.all, 'family-children', parentAddress, relays ?? null] as const,
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
// Progressive delivery — what a still-running read has delivered so far
// ---------------------------------------------------------------------------

/**
 * A snapshot of a search read that is STILL RUNNING: the products the provider
 * has handed over so far, plus the relay counts it can honestly state.
 *
 * `complete` is the literal `false` so a consumer cannot treat one of these as
 * a verdict; the verdict is `BrowseSearchResult`, which is what the query
 * resolves with. A snapshot exists for exactly one reason: the read takes
 * seconds (measured fan-outs of 0.26–4.9 s), and a visitor should see the first
 * cards at ~200 ms instead of a skeleton until the last relay answers.
 */
export interface BrowseSearchProgress {
	/** Products delivered so far, mapped exactly as the settled result maps them (family rows withheld — see the client). */
	products: BrowseProduct[]
	/** Raw event frames the read has accepted so far. */
	eventsDelivered: number
	/** Relays that have answered so far. */
	relaysAnswered: string[]
	/** Every relay the read has seen so far. */
	relaysSeen: string[]
	/** Always `false`: a snapshot from a running read is never a verdict. */
	complete: false
}

/** What a read that has not delivered anything yet says — a stable identity, so `useSyncExternalStore` sees no change. */
const EMPTY_PROGRESS: BrowseSearchProgress = { products: [], eventsDelivered: 0, relaysAnswered: [], relaysSeen: [], complete: false }

/** How many reads keep a snapshot. A key is only created by a running read and is evicted oldest-first. */
const PROGRESS_ENTRY_LIMIT = 8

const progressByKey = new Map<string, BrowseSearchProgress>()
const progressListeners = new Map<string, Set<() => void>>()

/** The store key: the query key itself, so a snapshot and its read are the same identity. */
function progressKey(queryKey: readonly unknown[]): string {
	return JSON.stringify(queryKey)
}

/** Record one snapshot and wake its subscribers. Module-private: only a read publishes. */
function publishBrowseSearchProgress(key: string, progress: BrowseSearchProgress): void {
	// Re-insert so the map's insertion order is recency and eviction drops the
	// stalest read, never the one still streaming.
	progressByKey.delete(key)
	progressByKey.set(key, progress)
	while (progressByKey.size > PROGRESS_ENTRY_LIMIT) {
		const oldest = progressByKey.keys().next().value
		if (oldest === undefined) break
		progressByKey.delete(oldest)
	}
	for (const listener of progressListeners.get(key) ?? []) listener()
}

/** The current snapshot for a query key, or `null` when that read has said nothing yet. */
export function getBrowseSearchProgress(queryKey: readonly unknown[]): BrowseSearchProgress | null {
	return getProgressByKey(progressKey(queryKey))
}

/** Subscribe to a query key's snapshots. Returns the unsubscribe. */
export function subscribeBrowseSearchProgress(queryKey: readonly unknown[], listener: () => void): () => void {
	return subscribeProgressByKey(progressKey(queryKey), listener)
}

function getProgressByKey(key: string): BrowseSearchProgress | null {
	const snapshot = progressByKey.get(key)
	return snapshot && (snapshot.eventsDelivered > 0 || snapshot.relaysSeen.length > 0) ? snapshot : null
}

function subscribeProgressByKey(key: string, listener: () => void): () => void {
	let listeners = progressListeners.get(key)
	if (!listeners) {
		listeners = new Set()
		progressListeners.set(key, listeners)
	}
	listeners.add(listener)
	return () => {
		const current = progressListeners.get(key)
		if (!current) return
		current.delete(listener)
		if (current.size === 0) progressListeners.delete(key)
	}
}

/**
 * Subscribe a component to a read's progressive snapshots.
 *
 * `null` until the read has actually delivered something. The settled result
 * (the query's own `data`) always wins over a snapshot when both exist: a
 * snapshot is a partial, and the caller must never render one as final.
 */
export function useBrowseSearchProgress(queryKey: readonly unknown[]): BrowseSearchProgress | null {
	// The key's STRING is the subscription identity: the array is rebuilt every
	// render, and resubscribing on every render would churn the store.
	const key = progressKey(queryKey)
	const subscribe = useCallback((listener: () => void) => subscribeProgressByKey(key, listener), [key])
	const getSnapshot = useCallback(() => getProgressByKey(key), [key])
	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
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
	const matched: NostrEventLike[] = []
	let caughtUpInfo: CaughtUpInfo | null = null
	for await (const item of ctx.stream([filter])) {
		if (item.type === 'event') {
			const haystack =
				`${getProductTitle(item.event)} ${getProductSummary(item.event) ?? ''} ${(getProductCategories(item.event) ?? []).flat().join(' ')}`.toLowerCase()
			if (terms.every((term) => haystack.includes(term))) matched.push(item.event)
		}
		if (item.type === 'caught-up') {
			caughtUpInfo = item.info
			break
		}
	}
	// Collapse each product family to ONE row before mapping. The term filter
	// above is unchanged — the collapse is presentation grouping on what the
	// query already matched, not a second ranking pass.
	const products = collapseProductFamilyEvents(matched)
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
 *
 * `filter` is a facet's own filter string (from the search frame's `suggested`),
 * sent verbatim in place of the tag-derived `category_tags = "…"` — so a pill
 * sends the exact filter the service proposed for it, not a re-derivation.
 */
export function browseSearchQueryOptions(query: string, tag?: string, limit = 100, openProductId?: string, filter?: string) {
	const queryKey = browseKeys.search({ query, tag, filter, limit, provider: getBrowseSearchProvider() })
	const progressStoreKey = JSON.stringify(queryKey)
	return queryOptions({
		queryKey,
		queryFn: async (context) => {
			const term = query.trim()
			// Nothing to read without a term, a tag, a filter, or an open product.
			if (!term && !tag && !filter && !openProductId) return { products: [], eose: [], pending: [] }

			// The search service indexes queries *and* filters: a tag-only browse
			// (the category row's `See all →`, which carries no term) is a
			// filter-only request the index answers, so it goes to the provider
			// too rather than being special-cased to the local stream.
			if ((term || tag || filter) && getBrowseSearchProvider() === 'rabbithole') {
				// A fresh read for this key starts from nothing: the previous
				// snapshot belonged to the previous read and must not linger into
				// this one (a retry after a timeout, typically).
				publishBrowseSearchProgress(progressStoreKey, EMPTY_PROGRESS)
				try {
					// The facet's own filter when one is given, else the tag as the
					// category filter (the `#t` source).
					const filters = filter ? [filter] : tag ? [`category_tags = "${tag}"`] : undefined
					return await rabbitholeSearch(
						{ q: term, limit, filters },
						{
							signal: context.signal,
							baseUrl: getBrowseSearchBaseUrl(),
							// The read hands over what it has as it arrives. The
							// snapshot is published under this read's own query key,
							// so a different search can never see it.
							onProducts: (products, stats) =>
								publishBrowseSearchProgress(progressStoreKey, {
									products: [...products],
									eventsDelivered: stats.eventsDelivered,
									relaysAnswered: stats.relaysAnswered,
									relaysSeen: stats.relaysSeen,
									complete: false,
								}),
						},
					)
				} catch (err) {
					// A caller abort (react-query cancel) is not a provider failure —
					// propagate it so the query is cancelled, not retried locally.
					if (err instanceof DOMException && err.name === 'AbortError') throw err
					// A read that was CUT while under way (its deadline tripped, or
					// its stream ended without an outcome) is not a provider
					// outage: it delivered real products and reached no verdict.
					// Report it as incomplete — falling back here is what made an
					// 8 s RabbitHole read render the local stream's unrelated
					// "6 relays responded with 0 products" on the live page.
					if (err instanceof RabbitHoleError && (err.code === 'timeout' || err.code === 'truncated')) {
						const partial = err.partial
						const answered = partial?.relaysAnswered ?? []
						const products = partial?.products ?? []
						publishBrowseSearchProgress(progressStoreKey, {
							products,
							eventsDelivered: partial?.eventsDelivered ?? 0,
							relaysAnswered: answered,
							relaysSeen: partial?.relaysSeen ?? [],
							complete: false,
						})
						return {
							products,
							eose: answered,
							// Everything seen but unanswered is the honest pending set —
							// the same relay-failure vocabulary a `partial` verdict uses.
							pending: (partial?.relaysSeen ?? []).filter((relay) => !answered.includes(relay)),
							incomplete: { reason: err.code, eventsDelivered: partial?.eventsDelivered ?? 0 },
						}
					}
					// The provider is down or failed — fall back to the local stream.
					console.warn('[browse] RabbitHole search failed, falling back to the local stream:', err instanceof Error ? err.message : err)
				}
			}

			return searchLocal(query, tag, limit)
		},
		enabled: Boolean(query?.trim()) || Boolean(tag) || Boolean(filter) || Boolean(openProductId),
	})
}

/**
 * The browse search, as the host consumes it: the settled query plus the
 * progressive snapshot of the same read.
 *
 * `progress` is `null` until the provider has delivered something and is only
 * meaningful while `data` is absent — `data` is the verdict and always wins.
 */
export function useBrowseSearch(query: string, tag?: string, limit?: number, openProductId?: string, filter?: string) {
	const options = browseSearchQueryOptions(query, tag, limit, openProductId, filter)
	const queryResult = useQuery(options)
	const progress = useBrowseSearchProgress(options.queryKey)
	return { ...queryResult, progress }
}

// ---------------------------------------------------------------------------
// Facets — the service's own market-scoped counts (the pill source)
// ---------------------------------------------------------------------------

/**
 * The facet probe: the same term with **no filter**, read from the service's
 * index only (`indexOnly`), so the pill list a filtered browse shows cannot
 * rotate as the visitor selects one of its own pills.
 *
 * Only the RabbitHole provider states facets; the local stream indexes none, so
 * it resolves to an empty list rather than to a client-side count of the loaded
 * window (which is what the pills used to show, and which is not a market
 * count). `enabled` is the host's "this is a results state" flag — the idle
 * index asks for no facets.
 */
export function browseFacetsQueryOptions(query: string, enabled: boolean) {
	return queryOptions({
		queryKey: browseKeys.facets({ query, provider: getBrowseSearchProvider() }),
		queryFn: async (context): Promise<BrowseFacet[]> => {
			if (getBrowseSearchProvider() !== 'rabbithole') return []
			const result = await rabbitholeSearch(
				{ q: query.trim(), limit: 1, indexOnly: true },
				{ signal: context.signal, baseUrl: getBrowseSearchBaseUrl() },
			)
			return result.suggested ?? []
		},
		enabled: enabled && getBrowseSearchProvider() === 'rabbithole',
		// Keep the last facet list while the term changes: the pills must not
		// blink out (or briefly show another scope) mid-read.
		placeholderData: keepPreviousData,
	})
}

export function useBrowseFacets(query: string, enabled: boolean) {
	return useQuery(browseFacetsQueryOptions(query, enabled))
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
 * without one. The read is built from that identifier's **shape** — one filter,
 * never a two-filter OR that can put a slug into `ids` (see
 * {@link buildProductDetailFilters} for the invariant).
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
			// Bounded fetch for a single product, shaped by the identifier (not a list)
			const filters = buildProductDetailFilters(id)
			const events = relayTargets ? await fetchFromRelays(filters, relayTargets) : await getReadContext().fetch(filters)
			const newest = [...events].sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))[0]
			return newest ? (mapProductDetail(newest) ?? null) : null
		},
		enabled: Boolean(id),
	})
}

/**
 * The detail read's filters, built from the identifier's shape.
 *
 * A relay rejects an **entire** REQ when any one of its filters is malformed:
 * `{"kinds":[30402],"ids":["handcrafted-ceramic-ball"]}` is answered with
 * `CLOSED ... bad req: error parsing ids: unexpected character in from_hex`,
 * so a sibling `#d` filter in the same REQ never runs and the read resolves
 * empty — the panel's "This listing is not on the relays". The app's own event
 * store tolerates the malformed filter, so only a real relay (or a shape
 * assertion) can catch it.
 *
 * INVARIANT: a non-hex string MUST NOT appear in an `ids` (or `authors`)
 * filter, and every value placed in one MUST be 64-character hex. The shapes:
 *   - 64-char hex                    (an event id) → `{ kinds: [30402], ids: [id] }`
 *   - NIP-33 coordinate `kind:pubkey:d`            → `{ kinds: [kind], authors: [pubkey], '#d': [d] }`
 *   - anything else — the `?p=` `d`-tag slug       → `{ kinds: [30402], '#d': [id] }`
 */
function buildProductDetailFilters(id: string): EventFilter[] {
	const coordinate = parseAddressCoordinate(id)
	if (coordinate) return [{ kinds: [coordinate.kind], authors: [coordinate.pubkey], '#d': [coordinate.identifier] }]
	// A 64-character hex string is the only thing an `ids` filter may carry.
	if (isValidHexKey(id)) return [{ kinds: [30402], ids: [id] }]
	return [{ kinds: [30402], '#d': [id] }]
}

/**
 * Split a NIP-33 address (`kind:pubkey:d`) into its parts, or `null` when the
 * identifier is not one. The SDK's a-tag parser splits and validates the kind;
 * its `authors` value is then required to be a real 64-character hex key,
 * because a non-hex pubkey is malformed in exactly the way a bad `ids` value is.
 */
function parseAddressCoordinate(id: string): AddressableEventCoordinate | null {
	if (!isValidATag(id)) return null
	try {
		const coordinate = getCoordsFromATag(id)
		return isValidHexKey(coordinate.pubkey) ? coordinate : null
	} catch {
		return null
	}
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
// Family children — the open family's options (fetch, single family)
// ---------------------------------------------------------------------------

/** The bounded read size for one family's option list. */
const FAMILY_CHILDREN_LIMIT = 200

/**
 * Read a product family's children — its options — by the parent coordinate.
 *
 * `fetch`, not `stream`: this is a single-entity/detail read (one family's own
 * options, whose identity the panel already knows), not a list/live surface,
 * and holding a live subscription per open family is not warranted
 * (`sdk/AGENTS.md`, read API doctrine). The children filter is the products
 * module's own (`buildProductListFilter` with `parentAddress`) — one mechanism,
 * not a second filter builder — and the parent is read alongside it only so the
 * SDK can build the family container `resolveProductVariation` resolves a
 * selection against. Every child is mapped through the shared results mapper
 * (`mapProductFamilyChildren`), so an option in the panel is the same
 * `BrowseProduct` a list row for that child would be.
 *
 * The relays the parent's search hit was seen on are reused when recorded;
 * otherwise the app's own read context answers.
 */
export function browseFamilyChildrenQueryOptions(parentAddress: string | undefined, relays?: readonly string[]) {
	const relayTargets = relays && relays.length > 0 ? [...relays] : undefined
	return queryOptions({
		queryKey: browseKeys.familyChildren(parentAddress ?? '', relayTargets),
		queryFn: async (): Promise<BrowseFamilyChildren | null> => {
			if (!parentAddress) return null
			const coordinate = parseProductAddress(parentAddress)
			if (!coordinate) return null
			// Bounded single-family detail read: the parent plus its child options.
			const filters: EventFilter[] = [
				{ kinds: [30402], authors: [coordinate.pubkey], '#d': [coordinate.dTag] },
				buildProductListFilter({ limit: FAMILY_CHILDREN_LIMIT, parentAddress }),
			]
			const events = relayTargets ? await fetchFromRelays(filters, relayTargets) : await getReadContext().fetch(filters)
			const family = prepareProductFamilyCatalog(events).families.find((candidate) => candidate.address === parentAddress)
			if (!family) return null
			return { family, children: mapProductFamilyChildren(family) }
		},
		enabled: Boolean(parentAddress),
	})
}

export function useBrowseFamilyChildren(parentAddress: string | undefined, relays?: readonly string[]) {
	return useQuery(browseFamilyChildrenQueryOptions(parentAddress, relays))
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
	// Collapse each product family to ONE row (preferring the parent) before
	// mapping — presentation grouping, not a second stock or ranking filter.
	const listings = collapseProductFamilyEvents(filterBlacklistedEvents(live).filter((event) => isProductListed(event, 'purchasable')))

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
