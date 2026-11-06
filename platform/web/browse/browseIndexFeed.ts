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
 */

import { queryOptions, useQuery } from '@tanstack/react-query'
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

/** The wall strips: real listings, art assigned the same way the cards assign it. */
export function feedStrips(products: readonly BrowseProduct[], limit: number): StripItem[] {
	return products.slice(0, limit).map((product) => ({
		id: product.id,
		title: product.title,
		seller: product.pubkey.slice(0, 8),
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
 */
export async function fetchBrowseIndexFeed(limit = BROWSE_INDEX_FEED_LIMIT): Promise<BrowseIndexFeed> {
	const context = getReadContext()
	const events: NostrEventLike[] = []
	let caughtUpInfo: CaughtUpInfo | null = null

	for await (const item of context.stream([buildProductListFilter({ limit })])) {
		if (item.type === 'event') events.push(item.event)
		if (item.type === 'caught-up') {
			caughtUpInfo = item.info
			break
		}
	}

	// A listing its author deleted never surfaces, exactly as in the products
	// module's own list read.
	const live = await excludeDeleted(context, events)
	const listed = filterBlacklistedEvents(live).filter((event) => isProductListed(event, 'purchasable'))

	const products = listed.map(mapProduct).filter((product): product is BrowseProduct => product !== undefined)
	const eose = caughtUpInfo?.eose ?? []
	const pending = caughtUpInfo?.pending ?? []

	// The 24h count comes off the events, not the mapped products: `created_at`
	// is the listing's publication time, which the Browse product shape does not
	// carry and the cards do not need.
	const cutoff = Math.floor(Date.now() / 1000) - DAY_SECONDS
	const postedLast24h = listed.filter((event) => (event.created_at ?? 0) >= cutoff).length

	return {
		rows: groupProductsByCategory(products),
		products,
		stats: {
			products: products.length,
			sellers: new Set(products.map((product) => product.pubkey)).size,
			postedLast24h,
			relays: eose.length + pending.length,
		},
		eose,
		pending,
	}
}

export const browseIndexFeedKeys = {
	feed: (limit: number) => ['browse', 'index-feed', limit] as const,
}

export function browseIndexFeedQueryOptions(limit = BROWSE_INDEX_FEED_LIMIT) {
	return queryOptions({
		queryKey: browseIndexFeedKeys.feed(limit),
		queryFn: () => fetchBrowseIndexFeed(limit),
	})
}

export function useBrowseIndexFeed(limit?: number) {
	return useQuery(browseIndexFeedQueryOptions(limit))
}
