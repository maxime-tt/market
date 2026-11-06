/**
 * platform/web/browse/browseProductMap.ts — The Browse product/result shapes and
 * the canonical kind-30402 -> BrowseProduct mapper.
 *
 * Shared by the local read path (browseQuery.ts) and the RabbitHole search
 * client (rabbitholeClient.ts). Keeping the mapper in one place means both
 * providers map the same event to the same BrowseProduct, so switching provider
 * never changes what a card renders — the provider is a data-source choice, not
 * a rendering one.
 */

import type { NostrEventLike } from '@sdk/core/nostr/eventLike'
// Canonical read model: sdk/commerce/discovery/productReadModel.ts
import {
	getProductCategories,
	getProductDescription,
	getProductImages,
	getProductPrice,
	getProductId,
	getProductPubkey,
	getProductLocation,
	getProductShippingOptions,
	getProductStock,
	getProductTitle,
} from '@sdk/commerce/discovery'
import { PRODUCT_SYMBOL_IDS, type MaterialClass, type ProductSymbolId } from '@ui/browse/art'

// ---------------------------------------------------------------------------
// BrowseProduct shape — consumed by @ui/browse/product-card
// ---------------------------------------------------------------------------

/** The minimal product shape the Browse UI expects. */
export interface BrowseProduct {
	/** The addressable `d` identifier when present, else the event id. */
	id: string
	/** The event id — the product page addresses a listing by event id. */
	eventId: string
	pubkey: string
	title: string
	price?: number
	/**
	 * The unit the amount is in — the `price` tag's third element
	 * (`["price","53","USD"]` → `USD`), kept rather than dropped so a renderer
	 * never labels a fiat amount "sats". Absent when the tag omits it (a sats
	 * listing may write `SATS`/`SAT` or leave it out).
	 */
	currency?: string
	stock?: string
	image?: string
	categories: string[]
	/** The author's own `location` tag ("ships from"); absent when unset. */
	location?: string
	/**
	 * The relays this listing was actually seen on, from the provider's index
	 * hit (`hits[].relays_seen`). Absent means unknown: the local stream does
	 * not know a listing's relays, so it states none rather than fabricating a
	 * set (and the search-level `eose`/`pending` set is the index's fan-out,
	 * not any one listing's relays).
	 */
	relays?: string[]
}

/**
 * One server-suggested facet: a real, market-scoped count for an index filter.
 * The search service's `search` frame carries these; the count is scoped to the
 * market (not to the loaded window), which is what lets a pill state a number
 * the client cannot derive.
 */
export interface BrowseFacet {
	/** The indexed field, e.g. `category_tags`, `currency`. */
	field: string
	/** The field's value — the pill's label. */
	value: string
	/** How many market listings carry this value. */
	count: number
	/** The share of the market the value covers, when the service states it. */
	coverage?: number
	/** The index filter string to send back for this value, e.g. `category_tags = "pottery"`. */
	filter?: string
}

/**
 * Return shape for the browse search stream — products plus relay status.
 *
 * `eose` / `pending` are the seam's relay vocabulary: relays that answered and
 * relays that did not. The RabbitHole provider maps its `outcome` onto this —
 * `relaysAnswered` -> `eose`, `relaysFailed` -> `pending` — so a `partial`
 * verdict carries its failed relays in `pending` (the relay-failure state) and
 * is never flattened into a plain result.
 */
export interface BrowseSearchResult {
	/** Filtered products from the stream. */
	products: BrowseProduct[]
	/** Relays that reached EOSE (answered) before the caught-up marker. */
	eose: string[]
	/** Relays that did not reach EOSE (still pending, or failed). */
	pending: string[]
	/**
	 * The service's own facet suggestions from the `search` frame, when it
	 * states them. Absent for the local stream, which indexes no facets — the
	 * host then shows no pills rather than counting its loaded window.
	 */
	suggested?: BrowseFacet[]
}

// ---------------------------------------------------------------------------
// kind-30402 -> BrowseProduct mapper
// ---------------------------------------------------------------------------

/**
 * Map a kind-30402 NostrEventLike into a BrowseProduct using the canonical
 * discovery read model (sdk/commerce/discovery/productReadModel.ts).
 * Exactly as ui/products/product-card-view.tsx does: getProductId,
 * getProductTitle, getProductPrice, getProductImages, getProductStock,
 * getProductCategories — each over ProductReadEvent.
 */
export function mapProduct(event: NostrEventLike): BrowseProduct | undefined {
	const title = getProductTitle(event)
	const priceTag = getProductPrice(event)
	const price = priceTag ? Number(priceTag[1]) || undefined : undefined
	// The tag's own unit, kept alongside the amount: without it a renderer can
	// only guess, and the card's guess was "sats" for every listing.
	const currency = priceTag?.[2]
	const stockTag = getProductStock(event)
	const stock = stockTag?.[1]
	const images = getProductImages(event)
	const image = images.length > 0 ? images[0][1] : undefined
	const categories = getProductCategories(event).map((t) => t[1])
	const pubkey = getProductPubkey(event)
	const id = getProductId(event) || event.id
	const location = getProductLocation(event)

	if (!title && !id) return undefined

	return {
		id,
		eventId: event.id,
		pubkey,
		title: title || 'Untitled',
		price,
		currency: currency || undefined,
		stock,
		image,
		categories,
		location: location || undefined,
	}
}

// ---------------------------------------------------------------------------
// Deterministic art assignment
// ---------------------------------------------------------------------------

/**
 * The material tile for a seller's product: a stable function of the pubkey, so
 * the same seller always draws the same art (the frames' rule). Lives here, with
 * the mapper, so every Browse-shaped surface assigns art the same way instead of
 * re-implementing the hash.
 */
export function materialForPubkey(pubkey: string): MaterialClass {
	const hash = pubkey.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0)
	return `m${(hash % 8) + 1}` as MaterialClass
}

/**
 * The product icon for a seller's tile — the same rule as the material: a
 * stable function of the pubkey, so a real listing that carries no image still
 * draws one of the sprite's eight icons instead of a placeholder. Position-
 * weighted so the icon does not move in lockstep with the material.
 */
export function symbolForPubkey(pubkey: string): ProductSymbolId {
	const hash = pubkey.split('').reduce((acc, ch, i) => acc + ch.charCodeAt(0) * (i + 3), 0)
	return PRODUCT_SYMBOL_IDS[hash % PRODUCT_SYMBOL_IDS.length]
}

// ---------------------------------------------------------------------------
// kind-30402 -> BrowseProductDetail (the split-view panel's single read)
// ---------------------------------------------------------------------------

/**
 * One shipping option's extra cost, from the listing's `shipping_option` tags.
 * The option's own name lives in its kind-30406 event, which this read does not
 * fetch — the panel labels the row generically rather than inventing a name.
 */
export interface BrowseProductShipping {
	/** Extra cost in sats (the tag's third element). */
	costSats: number
}

/**
 * The single-entity product read: {@link BrowseProduct} plus the listing's own
 * description and shipping tags. Location stays `BrowseProduct`'s — the panel
 * and the card read one `location` mapping.
 */
export interface BrowseProductDetail extends BrowseProduct {
	/** Description (`content`). */
	description: string
	/** Shipping options on the listing, when it carries any. */
	shipping: BrowseProductShipping[]
}

/**
 * Map a kind-30402 event into the split-view panel's product, using the same
 * canonical read model as {@link mapProduct} — the panel and the card therefore
 * agree on title, price, stock, categories and location.
 *
 * Only the fields the panel renders are added: the description and the shipping
 * option costs. A listing with no shipping options maps to `[]` (the panel
 * renders no shipping row), never to a made-up default.
 */
export function mapProductDetail(event: NostrEventLike): BrowseProductDetail | undefined {
	const product = mapProduct(event)
	if (!product) return undefined

	const shipping = getProductShippingOptions(event)
		.map((tag) => ({ costSats: Number(tag[2]) }))
		.filter((option) => Number.isFinite(option.costSats))

	return {
		...product,
		description: getProductDescription(event),
		shipping,
	}
}
