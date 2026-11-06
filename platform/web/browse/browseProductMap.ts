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
	getProductImages,
	getProductPrice,
	getProductId,
	getProductPubkey,
	getProductStock,
	getProductTitle,
} from '@sdk/commerce/discovery'

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
