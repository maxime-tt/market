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
	getProductAddress,
	getProductCategories,
	getProductDescription,
	getProductEventType,
	getProductFamilyPriceRange,
	getProductFamilySpecKeys,
	getProductImages,
	getProductPrice,
	getProductId,
	getProductPubkey,
	getProductLocation,
	getProductShippingOptions,
	getProductStock,
	getProductTitle,
	getVariationDTag,
	getVariationLabel,
	getVariationParentAddress,
	groupProductSearchResultsByFamily,
	isProductHidden,
	isProductInStock,
} from '@sdk/commerce/discovery'
// The family container the injected SDK aggregators read from.
import type { ProductFamily, ProductFamilyVariation } from '@sdk/commerce/discovery'
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
	// -----------------------------------------------------------------------
	// Family fields — present only when the row is part of a product family
	// (a `type=variable` parent or a `type=variation` child). A plain listing
	// carries none of these, so a family-oblivious renderer is unaffected.
	// -----------------------------------------------------------------------
	/** The parent coordinate this row's family lives at, when the row is a family. */
	familyAddress?: string
	/** Which side of the family this row is. */
	familyRole?: 'parent' | 'variation'
	/** A variation row's own option label, e.g. `42` or `size: 42 / color: red`. */
	variantLabel?: string
	/** How many options (non-hidden variations) the family offers. */
	variantCount?: number
	/**
	 * How many of those options are currently purchasable. `isProductInStock`
	 * reads a missing `stock` tag as sold out, and most of the real market
	 * carries none, so a renderer must treat `0` as "unknown", not "sold out".
	 */
	availableVariantCount?: number
	/** The family's lowest option price, from the family price range. */
	priceMin?: number
	/** The family's highest option price, from the family price range. */
	priceMax?: number
	/** The distinct option axes (`spec` keys) the family varies over, first-seen order. */
	specKeys?: string[]
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
/**
 * A narrowing option, as it crosses the seam: the service's own bucket shape,
 * restated here so the read layer can carry it without importing from the UI.
 *
 * NOT a facet. A facet is the engine's own count, computed over a candidate
 * superset, and it over-reports — measured on `q=bitcoin`, 1197 against a true
 * 1100 for `bitcoin` and 242 against 199 for `clothing`. `count` is counted over
 * the documents the scan read, so it is the number a renderer may show.
 */
export interface BrowseBucket {
	dimension: 'label_tags' | 'category_tags' | 'seller'
	/** What choosing this adds to the query — a tag, or a seller's pubkey. */
	value: string
	count: number
	share: number
	label?: string
}

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
	/**
	 * Narrowing options the service derived from the FULL result set's own
	 * documents — tags and sellers alike. Present only when the service states
	 * them; the local stream has no full set to scan, so it sends none.
	 */
	buckets?: BrowseBucket[]
	/**
	 * True when the full-set scan could not read the whole set. A renderer must
	 * DISCLOSE this rather than present the buckets as describing everything.
	 */
	truncated?: boolean
	/** How many documents the scan reached — the "first N" a disclosure names. */
	scanned?: number
	/**
	 * Present ONLY when the read stopped before it reached a verdict (its
	 * deadline tripped, or the stream ended without an `outcome` frame). The
	 * products are then what arrived, not a complete answer, so no surface may
	 * summarise them as "N relays responded with M products" — that sentence is
	 * a verdict, and a read that did not finish has none.
	 *
	 * It is deliberately a field rather than a thrown error: a read that
	 * delivered 31 products and then stalled has something worth keeping, and
	 * discarding it (or replacing it with a different provider's answer) is how
	 * a slow relay came to look like a settled empty search.
	 */
	incomplete?: BrowseSearchIncomplete
}

/** Why a search result is not a verdict, plus what had arrived when it stopped. */
export interface BrowseSearchIncomplete {
	/** `timeout` — the read's deadline tripped; `truncated` — the stream ended without its `outcome` frame. */
	reason: 'timeout' | 'truncated'
	/** Raw `event` frames the read had accepted before it stopped. */
	eventsDelivered: number
}

// ---------------------------------------------------------------------------
// kind-30402 -> BrowseProduct mapper
// ---------------------------------------------------------------------------

/**
 * The shared, family-oblivious field mapping — one mapper, so the parent and
 * the plain-listing path can never drift on title/price/stock/images.
 */
function mapProductFields(event: NostrEventLike): BrowseProduct | undefined {
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

/**
 * Map a kind-30402 NostrEventLike into a BrowseProduct using the canonical
 * discovery read model (sdk/commerce/discovery/productReadModel.ts).
 * Exactly as ui/products/product-card-view.tsx does: getProductId,
 * getProductTitle, getProductPrice, getProductImages, getProductStock,
 * getProductCategories — each over ProductReadEvent.
 *
 * This is the family-oblivious case of {@link mapProductWithFamily}: a plain
 * listing carries no family fields.
 */
export function mapProduct(event: NostrEventLike): BrowseProduct | undefined {
	return mapProductWithFamily(event, null)
}

/**
 * The price reader `getProductFamilyPriceRange` injects. One reader, on the
 * same `getProductPrice` call the shared mapper already makes — so the SDK's
 * range aggregation and the card's single price can never parse the tag two
 * different ways. A listing with no price tag (or a non-numeric amount) reads
 * as `null` and is skipped by the aggregator.
 *
 * The currency falls back to the empty string when the tag omits it (the
 * historical sats listing); that keeps a stockless, unit-less family's range
 * real instead of dropping it to `null`.
 */
export function readProductPrice(event: NostrEventLike): { amount: number; currency: string } | null {
	const tag = getProductPrice(event)
	if (!tag) return null
	const amount = Number(tag[1])
	if (!Number.isFinite(amount)) return null
	return { amount, currency: tag[2] ?? '' }
}

/**
 * One ProductFamily per variable parent present in the result set, built from
 * the rows themselves — the parent plus the variations that are actually here.
 *
 * Deliberately NOT `prepareProductFamilyCatalog(...).items`: that projection is
 * availability-filtered (`isProductInStock`), and measured on the real market
 * 82.5% of listings carry no `stock` tag (which reads as sold out), so routing
 * a browse/search surface through it would drop most of the market. The family
 * container here holds every non-hidden variation present, whatever its stock;
 * the availability rule is only consulted for `availableVariantCount`.
 */
function familiesInResult(events: readonly NostrEventLike[]): Map<string, ProductFamily<NostrEventLike>> {
	const parents = new Map<string, NostrEventLike>()
	for (const event of events) {
		if (getProductEventType(event) !== 'variable') continue
		const address = getProductAddress(event)
		if (address) parents.set(address, event)
	}

	const childrenByParent = new Map<string, NostrEventLike[]>()
	for (const event of events) {
		if (getProductEventType(event) !== 'variation') continue
		// The SDK's linking rule: only an unambiguous same-author `a` tag links,
		// and only to a parent that is actually here.
		const parentAddress = getVariationParentAddress(event)
		if (!parentAddress || !parents.has(parentAddress)) continue
		const children = childrenByParent.get(parentAddress) ?? []
		children.push(event)
		childrenByParent.set(parentAddress, children)
	}

	const families = new Map<string, ProductFamily<NostrEventLike>>()
	for (const [address, parent] of parents) {
		const variations: ProductFamilyVariation<NostrEventLike>[] = (childrenByParent.get(address) ?? [])
			.filter((child) => !isProductHidden(child))
			.map((child) => ({
				product: child,
				address: getProductAddress(child) ?? address,
				label: getVariationLabel(child),
				available: isProductInStock(child),
			}))
		families.set(address, {
			parent,
			address,
			variations,
			availableVariations: variations.filter((variation) => variation.available),
		})
	}
	return families
}

/**
 * Map a raw event plus its family (or `null`) into a BrowseProduct.
 *
 * The shared fields are {@link mapProductFields}'s — one mapping, no drift. The
 * family fields are added only where they mean something:
 * - a `variation` states its own role and label, even when its family is absent
 *   from the result set (the option is still showable on its own);
 * - a `variable` parent states the family aggregates only when variations are
 *   actually present (a childless variable parent is a simple product, exactly
 *   as the SDK treats it).
 */
export function mapProductWithFamily(event: NostrEventLike, family: ProductFamily<NostrEventLike> | null): BrowseProduct | undefined {
	const product = mapProductFields(event)
	if (!product) return undefined

	const type = getProductEventType(event)

	if (type === 'variation') {
		product.familyRole = 'variation'
		product.variantLabel = getVariationLabel(event)
	} else if (type === 'variable' && family && family.variations.length > 0) {
		product.familyRole = 'parent'
		product.familyAddress = family.address
		product.variantCount = family.variations.length
		product.availableVariantCount = family.availableVariations.length
		product.specKeys = getProductFamilySpecKeys(family)

		// The range falls back to ALL variations when none is available, so a
		// stockless family still advertises its price (the availability rule
		// never gates the price). Its stated unit fills in only when the parent
		// states none of its own.
		const range = getProductFamilyPriceRange(family, readProductPrice)
		if (range) {
			product.priceMin = range.min
			product.priceMax = range.max
			if (!product.currency && range.currency) product.currency = range.currency
		}
	}

	return product
}

/**
 * Whether an event participates in a product family (a `type=variable` parent
 * or a `type=variation` child).
 *
 * A family row is not a final answer until the read has settled: while the
 * stream is still arriving, the parent may not have been delivered yet, so the
 * row the collapse states for those children is provisional (the first child
 * becomes the row, and is replaced by the parent when it lands). A progressive
 * read therefore withholds family rows from its partial snapshots and states
 * them only in the settled result — see `readRabbitHoleStream`.
 */
export function isProductFamilyEvent(event: NostrEventLike): boolean {
	const type = getProductEventType(event)
	return type === 'variable' || type === 'variation'
}

/**
 * Collapse a browse/search result list to one row per family, then map.
 *
 * The collapse runs on the RAW events, before mapping: a BrowseProduct no
 * longer carries the `type`/`a` tags the grouping needs. `groupProductSearch-
 * ResultsByFamily` is the family-aware collapse the SDK provides for search —
 * it only GROUPS (no stock or visibility filter, order preserved), unlike the
 * availability-filtered shop-catalogue projection.
 *
 * This is presentation grouping, not a second ranking pass: a family is one row
 * because its options are one product, not because anything re-scored the list.
 */
export function collapseProductFamilyEvents(events: readonly NostrEventLike[]): BrowseProduct[] {
	const families = familiesInResult(events)
	return groupProductSearchResultsByFamily(events)
		.map((event) => {
			const address = getProductEventType(event) === 'variable' ? getProductAddress(event) : null
			const family = address ? families.get(address) ?? null : null
			return mapProductWithFamily(event, family)
		})
		.filter((product): product is BrowseProduct => product !== undefined)
}

// ---------------------------------------------------------------------------
// Family children — a family's options, for the detail panel's picker
// ---------------------------------------------------------------------------

/**
 * One option a family offers: its identity (the variation's `d` tag), the label
 * a buyer reads, whether it is currently purchasable, and the child mapped
 * through the shared mapper so a panel row and a list row are the same object.
 */
export interface BrowseFamilyChild {
	/** The variation's `d` tag — the value the picker reports and the selection key. */
	dTag: string
	/** The option label (the variation's `spec` label), never the `d` tag when a label exists. */
	label: string
	/** Whether the option is currently purchasable, by the SDK stock rule. */
	available: boolean
	/** The child mapped through the shared results mapper — identical to a list row for the same event. */
	product: BrowseProduct
}

/** A family's options plus the SDK family container a selection resolves against. */
export interface BrowseFamilyChildren {
	/** The SDK family container `resolveProductVariation` resolves a selection against. */
	family: ProductFamily<NostrEventLike>
	/** The family's options, in the SDK's display order (available-filtering is NOT applied). */
	children: BrowseFamilyChild[]
}

/**
 * Map a family's option list for the detail panel.
 *
 * Every child goes through the SAME per-event mapper a results row uses
 * ({@link mapProduct} → `mapProductWithFamily`), so an option in the panel and
 * the same child in a list cannot disagree on price, stock, image or label. The
 * list is NOT collapsed to one row — unlike a browse result, every option must
 * survive — and the SDK's own `variations` list (hidden excluded, labels and
 * availability resolved, sorted) is the source of order and flags.
 */
export function mapProductFamilyChildren(family: ProductFamily<NostrEventLike>): BrowseFamilyChild[] {
	return family.variations
		.map((variation) => {
			const product = mapProduct(variation.product)
			return product ? { dTag: getVariationDTag(variation.product), label: variation.label, available: variation.available, product } : undefined
		})
		.filter((child): child is BrowseFamilyChild => child !== undefined)
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
