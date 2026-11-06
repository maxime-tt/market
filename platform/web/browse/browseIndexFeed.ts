/**
 * platform/web/browse/browseIndexFeed.ts — the Browse index's own feed.
 *
 * ONE bounded kind-30402 **stream** (a list never `fetch`es) that feeds the
 * three things the idle index draws from the same data:
 *
 *   - the browse-by-category rows — the loaded listings grouped by the
 *     platform's own NIP-99 categories (`PRODUCT_CATEGORIES`, the taxonomy the
 *     listing form writes; not a parallel one), in taxonomy order so the
 *     section is stable across visits and no ranking is invented;
 *   - the hero's measured facts (loaded items, the sellers among them, postings
 *     inside 24h, relays queried) — the same numbers the relay indicator and
 *     the cards are already derived from, so the hero states a measurement and
 *     never the frame's placeholder copy;
 *   - the idle wall strips.
 *
 * The grouping and the counting are local; the read applies the same rules the
 * products module's own list applies — `purchasable` visibility, the blacklist
 * and NIP-09 deletions — through the same helpers.
 *
 * Every number is scoped to what this read loaded, and the wording the hero
 * builds from {@link BrowseIndexStats} says so. A category with nothing loaded
 * gets no row.
 *
 * The read is progressive: the stream's arrivals are published as they land
 * (see {@link fetchBrowseIndexFeed}'s `onPartial`), so the home paints the
 * strips, the stats and the rows while relays are still answering. Nothing on
 * the page waits for the caught-up marker.
 */

import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { getReadContext } from '../readContext'
import type { CaughtUpInfo } from '@sdk/core/event-store/read'
import { excludeDeleted } from '@sdk/core/event-store/read'
import type { NostrEventLike } from '@sdk/core/nostr/eventLike'
import { filterBlacklistedEvents } from '@sdk/config/blacklist'
import { PRODUCT_CATEGORIES, type ProductCategory } from '@sdk/config/constants'
import { buildProductListFilter, isProductListed } from '@sdk/commerce/discovery'
import { mapProduct, materialForPubkey, symbolForPubkey, type BrowseProduct } from './browseProductMap'
import type { StripItem } from '@ui/browse/product-strip'

/** The bounded read size. One stream, capped — never the whole market. */
export const BROWSE_INDEX_FEED_LIMIT = 200

/** The measured facts the idle hero may state. Fields absent = not measured. */
export interface BrowseIndexStats {
	products?: number
	sellers?: number
	postedLast24h?: number
	relays?: number
}

/** One browse-by-category row: a real platform category and the items loaded for it. */
export interface BrowseCategoryRow {
	category: ProductCategory
	items: BrowseProduct[]
}

export interface BrowseIndexFeed {
	/** Rows in `PRODUCT_CATEGORIES` order; a category with no loaded item is absent. */
	rows: BrowseCategoryRow[]
	/** Every listing the read loaded, newest first as the relay served them. */
	products: BrowseProduct[]
	/** The hero facts, all derived from the loaded set and the relay verdict. */
	stats: BrowseIndexStats
	/** Relays that answered before the caught-up marker. */
	eose: string[]
	/** Relays that did not answer (still pending, or failed). */
	pending: string[]
}

const DAY_SECONDS = 24 * 60 * 60

/**
 * How many admitted listings may gather before a progressive snapshot is
 * published, and how long the stream may sit quiet between paints. Both are
 * paint batching only: the read still ends at the caught-up marker and at
 * `limit`. A slow drip publishes each listing as it lands; a burst paints
 * eight at a time instead of re-rendering the wall once per event.
 */
const PARTIAL_FLUSH_EVENTS = 8
const PARTIAL_FLUSH_MS = 50

/**
 * Group loaded listings into rows by their own `t` categories, keeping only
 * categories the platform taxonomy knows. A listing that carries two known
 * categories appears in both rows — the rows are category views, not a
 * partition of the market.
 */
export function groupProductsByCategory(products: readonly BrowseProduct[]): BrowseCategoryRow[] {
	return PRODUCT_CATEGORIES.map((category) => ({
		category,
		items: products.filter((product) => product.categories.includes(category)),
	})).filter((row) => row.items.length > 0)
}

/**
 * The wall strips: real listings, carrying the same facts the card shows — the
 * listing's own image (the deterministic art is the fallback), its title, its
 * seller and its price — with the art assigned the same way the cards assign
 * it, and each tile a real link to its product.
 *
 * `sellerNameFor` resolves an author's profile display name; a seller with no
 * profile keeps the pubkey prefix, which is the card's own fallback. The
 * resolver is a parameter rather than a read here because this module is the
 * feed, not a React binding: the host owns the profile read.
 *
 * `hrefFor` builds a tile's product deep link; the default is the home's own
 * `?p=` link, which is the only surface the wall renders on. The seller href is
 * the canonical profile path.
 */
export function feedStrips(
	products: readonly BrowseProduct[],
	limit: number,
	sellerNameFor?: (pubkey: string) => string | undefined,
	hrefFor: (id: string) => string = (id) => `/?p=${encodeURIComponent(id)}`,
): StripItem[] {
	return products.slice(0, limit).map((product) => ({
		id: product.id,
		title: product.title,
		seller: sellerNameFor?.(product.pubkey) ?? product.pubkey.slice(0, 8),
		sellerHref: `/profile/${encodeURIComponent(product.pubkey)}`,
		href: hrefFor(product.id),
		image: product.image,
		price: product.price,
		priceCurrency: product.currency,
		material: materialForPubkey(product.pubkey),
		symbolId: symbolForPubkey(product.pubkey),
	}))
}

/**
 * Read the index feed.
 *
 * A list, so `stream()`, broken at the caught-up marker — that break is what
 * bounds the read and what gives the hero and the relay indicator a real relay
 * verdict instead of an assumed one.
 *
 * The read is **progressive**: `onPartial` is called with a snapshot of what
 * the stream has delivered so far, so the home paints the wall strips, the
 * measured stats and the category rows as the listings arrive instead of
 * waiting for the caught-up marker. A snapshot applies the same rules as the
 * final set (the store's known deletions, the blacklist, `purchasable`
 * visibility); the NIP-09 lookup for the read's own arrivals still happens
 * once, at the end, because a deletion fetched after the marker is what the
 * final pass is for.
 */
export async function fetchBrowseIndexFeed(
	limit = BROWSE_INDEX_FEED_LIMIT,
	onPartial?: (feed: BrowseIndexFeed) => void,
): Promise<BrowseIndexFeed> {
	const context = getReadContext()
	const events: NostrEventLike[] = []
	const cutoff = Math.floor(Date.now() / 1000) - DAY_SECONDS

	// The progressive set: what has been admitted under the read's rules so far.
	const products: BrowseProduct[] = []
	const seen = new Set<string>()
	const sellers = new Set<string>()
	let postedLast24h = 0
	let sincePaint = 0
	let lastPaint = 0

	const paint = () => {
		cancelPendingPaint()
		if (!onPartial) return
		sincePaint = 0
		lastPaint = Date.now()
		onPartial({
			rows: groupProductsByCategory(products),
			products: [...products],
			stats: { products: products.length, sellers: sellers.size, postedLast24h },
			eose: [],
			pending: [],
		})
	}

	/**
	 * A trailing paint for a partial batch: a stream that delivers three
	 * listings and then goes quiet must not hold them until the marker. The
	 * timer is cancelled the moment a paint happens and again when the read
	 * ends, so a late snapshot can never overwrite the final cache entry.
	 */
	let pendingPaint: ReturnType<typeof setTimeout> | null = null
	const cancelPendingPaint = () => {
		if (pendingPaint === null) return
		clearTimeout(pendingPaint)
		pendingPaint = null
	}
	const schedulePaint = () => {
		if (!onPartial || pendingPaint !== null) return
		pendingPaint = setTimeout(() => {
			pendingPaint = null
			paint()
		}, PARTIAL_FLUSH_MS)
	}

	let caughtUpInfo: CaughtUpInfo | null = null

	try {
		for await (const item of context.stream([buildProductListFilter({ limit })])) {
			if (item.type === 'event') {
				const event = item.event
				events.push(event)
				// A replay of a stored event is not a second listing, and an event the
				// store already knows deleted never surfaces.
				if (seen.has(event.id) || context.store.isDeleted(event)) continue
				if (filterBlacklistedEvents([event]).length === 0) continue
				if (!isProductListed(event, 'purchasable')) continue
				const product = mapProduct(event)
				if (!product) continue

				seen.add(event.id)
				products.push(product)
				sellers.add(product.pubkey)
				if ((event.created_at ?? 0) >= cutoff) postedLast24h += 1

				sincePaint += 1
				const now = Date.now()
				if (sincePaint >= PARTIAL_FLUSH_EVENTS || now - lastPaint >= PARTIAL_FLUSH_MS) paint()
				else schedulePaint()
			}
			if (item.type === 'caught-up') {
				caughtUpInfo = item.info
				break
			}
		}
	} finally {
		cancelPendingPaint()
	}

	// The final set is the whole read through the same rules — this time with
	// the NIP-09 lookups, so a listing its author deleted never surfaces.
	const live = await excludeDeleted(context, events)
	const listed = filterBlacklistedEvents(live).filter((event) => isProductListed(event, 'purchasable'))

	const finalProducts = listed.map(mapProduct).filter((product): product is BrowseProduct => product !== undefined)
	const eose = caughtUpInfo?.eose ?? []
	const pending = caughtUpInfo?.pending ?? []

	// The 24h count comes off the events, not the mapped products: `created_at`
	// is the listing's publication time, which the Browse product shape does not
	// carry and the cards do not need.
	const postedLast24hFinal = listed.filter((event) => (event.created_at ?? 0) >= cutoff).length

	return {
		rows: groupProductsByCategory(finalProducts),
		products: finalProducts,
		stats: {
			products: finalProducts.length,
			sellers: new Set(finalProducts.map((product) => product.pubkey)).size,
			postedLast24h: postedLast24hFinal,
			relays: eose.length + pending.length,
		},
		eose,
		pending,
	}
}

export const browseIndexFeedKeys = {
	feed: (limit: number) => ['browse', 'index-feed', limit] as const,
}

/**
 * The feed's query. `onPartial` is the progressive paint: the streaming read
 * hands each snapshot to it, and {@link useBrowseIndexFeed} writes those
 * snapshots into this query's own cache entry, so every observer renders the
 * partial set while the rest of the stream is still arriving.
 */
export function browseIndexFeedQueryOptions(limit = BROWSE_INDEX_FEED_LIMIT, onPartial?: (feed: BrowseIndexFeed) => void) {
	return queryOptions({
		queryKey: browseIndexFeedKeys.feed(limit),
		queryFn: () => fetchBrowseIndexFeed(limit, onPartial),
	})
}

export function useBrowseIndexFeed(limit?: number) {
	const queryClient = useQueryClient()
	const feedLimit = limit ?? BROWSE_INDEX_FEED_LIMIT
	const onPartial = useCallback(
		(feed: BrowseIndexFeed) => {
			// Writing the snapshot into the query's own entry (rather than a second
			// store) is what makes the home's strips, stats and rows grow with the
			// stream: the observer already reading this key re-renders per paint.
			queryClient.setQueryData(browseIndexFeedKeys.feed(feedLimit), feed)
		},
		[queryClient, feedLimit],
	)

	return useQuery(browseIndexFeedQueryOptions(feedLimit, onPartial))
}
