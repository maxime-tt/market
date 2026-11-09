import { isProductInStock } from './productAvailability'
import { getProductImages } from './productReadModel'

/**
 * Minimal relay-event shape this module groups. It stays structural, like the
 * other discovery read models, so hosts can pass applesauce events, NDK
 * wrappers, or plain fixtures without this module taking a relay-client
 * dependency.
 */
export interface ProductFamilyEvent {
	tags: string[][]
	kind?: number
	pubkey?: string
	created_at?: number
	id?: string
}

/** Known `type` tag values; any other relay value passes through unchanged. */
export type ProductEventType = 'simple' | 'variable' | 'variation'

export interface VariationSpec {
	key: string
	value: string
}

export interface ParsedProductAddress {
	address: string
	pubkey: string
	dTag: string
}

export interface ProductFamilyVariation<E extends ProductFamilyEvent> {
	product: E
	address: string
	label: string
	available: boolean
}

export interface ProductFamily<E extends ProductFamilyEvent> {
	parent: E
	address: string
	variations: ProductFamilyVariation<E>[]
	availableVariations: ProductFamilyVariation<E>[]
}

export type ProductCatalogItem<E extends ProductFamilyEvent> =
	| { kind: 'family'; product: E; family: ProductFamily<E> }
	| { kind: 'unresolved-variation'; product: E }
	| { kind: 'simple'; product: E }

export interface ProductFamilyCatalog<E extends ProductFamilyEvent> {
	items: ProductCatalogItem<E>[]
	families: ProductFamily<E>[]
	unresolvedVariations: E[]
}

export interface ProductFamilyCatalogOptions {
	/** Locale for the numeric-aware variation collator; the runtime default when omitted. */
	locale?: string
}

export interface ProductFamilyPrice {
	min: number
	max: number
	currency: string
}

const PRODUCT_LISTING_KIND = 30402
const HEX_PUBKEY = /^[0-9a-f]{64}$/
const PRODUCT_ADDRESS = /^30402:([0-9a-f]{64}):(.+)$/
const OPTION_FALLBACK_LABEL = 'Option'

/**
 * A listing is published as a family because its `type` tag says so. Absent or
 * empty means `simple`; every other relay value is returned verbatim rather
 * than coerced, so an unknown future type is not silently misfiled as simple.
 */
export function getProductEventType(event: ProductFamilyEvent | null): ProductEventType | (string & {}) {
	const type = event?.tags.find((tag) => tag[0] === 'type')?.[1]
	return type || 'simple'
}

/**
 * The addressable coordinate of a product listing. Refuses to produce one when
 * the identity is not unambiguous: a missing/duplicate `d` tag or a pubkey that
 * is not 64 hex chars would each let two distinct products share a coordinate.
 */
export function getProductAddress(event: ProductFamilyEvent | null): string | null {
	if (!event || event.kind !== PRODUCT_LISTING_KIND) return null

	const dTags = event.tags.filter((tag) => tag[0] === 'd')
	if (dTags.length !== 1) return null

	const dTag = dTags[0][1]
	if (!dTag) return null

	const pubkey = event.pubkey?.toLowerCase()
	if (!pubkey || !HEX_PUBKEY.test(pubkey)) return null

	return `${PRODUCT_LISTING_KIND}:${pubkey}:${dTag}`
}

/** Accepts only `30402:<64hex>:<d-tag>`; anything else is a foreign coordinate. */
export function parseProductAddress(address: string): ParsedProductAddress | null {
	const match = PRODUCT_ADDRESS.exec(address)
	if (!match) return null
	return { address, pubkey: match[1], dTag: match[2] }
}

/**
 * The parent coordinate of a variation, or null. Every ambiguous case is
 * refused rather than guessed — a variation with a missing, duplicated or
 * malformed parent tag, or one authored by a different pubkey than the parent
 * it names, would otherwise be attached to a fabricated product.
 */
export function getVariationParentAddress(event: ProductFamilyEvent | null): string | null {
	if (!event || getProductEventType(event) !== 'variation') return null

	const parentTags = event.tags.filter((tag) => tag[0] === 'a' && tag[1]?.startsWith(`${PRODUCT_LISTING_KIND}:`))
	if (parentTags.length !== 1) return null

	const parsed = parseProductAddress(parentTags[0][1] ?? '')
	if (!parsed) return null

	const author = event.pubkey?.toLowerCase()
	if (!author || author !== parsed.pubkey) return null

	return parsed.address
}

/** Spec tags as key/value pairs; `sku` is an internal identifier, not a display option. */
export function getVariationSpecs(event: ProductFamilyEvent | null): VariationSpec[] {
	if (!event) return []
	return event.tags
		.filter((tag) => tag[0] === 'spec' && !!tag[1])
		.filter((tag) => tag[1].toLowerCase() !== 'sku')
		.map((tag) => ({ key: tag[1], value: tag[2] ?? '' }))
}

/**
 * A human-runnable option label. One spec reads as its value ("42"); several
 * read as `key: value` pairs so a bare value is never ambiguous. Falls back to
 * the title, then the d-tag, then a placeholder so a row is always renderable.
 */
export function getVariationLabel(event: ProductFamilyEvent | null): string {
	const specs = getVariationSpecs(event)
	if (specs.length === 1) return specs[0].value
	if (specs.length > 1) return specs.map((spec) => `${spec.key}: ${spec.value}`).join(' / ')

	const title = event?.tags.find((tag) => tag[0] === 'title')?.[1]
	if (title) return title

	const dTag = event?.tags.find((tag) => tag[0] === 'd')?.[1]
	if (dTag) return dTag

	return OPTION_FALLBACK_LABEL
}

/** Only an exact `visibility=hidden` hides a product; any other value is displayable. */
export function isProductHidden(event: ProductFamilyEvent | null): boolean {
	return event?.tags.find((tag) => tag[0] === 'visibility')?.[1] === 'hidden'
}

/**
 * A variation's own `d` tag — the identity the panel holds when an option is
 * selected, and the value `resolveProductVariation` matches on. Empty when the
 * event carries none, so a caller cannot mistake a missing key for a real one.
 */
export function getVariationDTag(event: ProductFamilyEvent | null): string {
	return event?.tags.find((tag) => tag[0] === 'd')?.[1] ?? ''
}

function isNewerRevision<E extends ProductFamilyEvent>(candidate: E, current: E): boolean {
	const candidateAt = candidate.created_at ?? 0
	const currentAt = current.created_at ?? 0
	if (candidateAt !== currentAt) return candidateAt > currentAt
	return (candidate.id ?? '') < (current.id ?? '')
}

function compareNewestFirst<E extends ProductFamilyEvent>(a: E, b: E): number {
	const delta = (b.created_at ?? 0) - (a.created_at ?? 0)
	if (delta !== 0) return delta
	const aId = a.id ?? ''
	const bId = b.id ?? ''
	return aId < bId ? -1 : aId > bId ? 1 : 0
}

/**
 * Groups listings into product families and returns a browsable catalog.
 *
 * Only the newest revision per address survives: the same address is the same
 * product republished, so an older copy must never appear as a second card.
 */
export function prepareProductFamilyCatalog<E extends ProductFamilyEvent>(
	events: readonly E[],
	options: ProductFamilyCatalogOptions = {},
): ProductFamilyCatalog<E> {
	const newestByAddress = new Map<string, E>()
	for (const event of events) {
		const address = getProductAddress(event)
		if (!address) continue
		const current = newestByAddress.get(address)
		if (!current || isNewerRevision(event, current)) newestByAddress.set(address, event)
	}

	const parentsByAddress = new Map<string, E>()
	for (const [address, event] of newestByAddress) {
		if (getProductEventType(event) === 'variable') parentsByAddress.set(address, event)
	}

	const childrenByParent = new Map<string, E[]>()
	const unresolvedVariations: E[] = []
	const linkedChildren = new Set<E>()
	for (const event of newestByAddress.values()) {
		if (getProductEventType(event) !== 'variation') continue
		const parentAddress = getVariationParentAddress(event)
		if (!parentAddress || !parentsByAddress.has(parentAddress)) {
			unresolvedVariations.push(event)
			continue
		}
		const children = childrenByParent.get(parentAddress) ?? []
		children.push(event)
		childrenByParent.set(parentAddress, children)
		linkedChildren.add(event)
	}

	const collator = new Intl.Collator(options.locale, { numeric: true, sensitivity: 'base' })
	const familiesByAddress = new Map<string, ProductFamily<E>>()
	for (const [address, parent] of parentsByAddress) {
		const variations = (childrenByParent.get(address) ?? [])
			.filter((child) => !isProductHidden(child))
			.map((child) => ({
				product: child,
				address: getProductAddress(child) ?? address,
				label: getVariationLabel(child),
				available: isProductInStock(child),
			}))
			.sort((a, b) => collator.compare(a.label, b.label))
		familiesByAddress.set(address, {
			parent,
			address,
			variations,
			availableVariations: variations.filter((variation) => variation.available),
		})
	}
	const families = [...familiesByAddress.values()]

	const items: ProductCatalogItem<E>[] = []
	const newestFirst = [...newestByAddress.values()].sort(compareNewestFirst)
	for (const event of newestFirst) {
		if (linkedChildren.has(event)) continue
		if (isProductHidden(event)) continue

		const type = getProductEventType(event)
		if (type === 'variable') {
			const address = getProductAddress(event)
			const family = address ? familiesByAddress.get(address) : undefined
			if (family && family.availableVariations.length > 0) {
				items.push({ kind: 'family', product: event, family })
			} else if (isProductInStock(event)) {
				// A variable parent with no purchasable variation is childless here,
				// so it sells like a simple product rather than as a dead family card.
				items.push({ kind: 'simple', product: event })
			}
			continue
		}

		if (!isProductInStock(event)) continue
		if (type === 'variation') {
			// A variation whose parent is absent cannot be folded into a family;
			// it is surfaced on its own so the option is still purchasable.
			items.push({ kind: 'unresolved-variation', product: event })
			continue
		}
		items.push({ kind: 'simple', product: event })
	}

	return { items, families, unresolvedVariations }
}

/** The family an event belongs to as parent or variation, for detail routing. */
export function findProductFamily<E extends ProductFamilyEvent>(
	catalog: ProductFamilyCatalog<E>,
	event: E,
): ProductFamily<E> | null {
	const address = getProductAddress(event)
	if (!address) return null
	return (
		catalog.families.find(
			(family) => family.address === address || family.variations.some((variation) => variation.address === address),
		) ?? null
	)
}

/**
 * The variation a UI should show by default or for an explicit selection. An
 * explicit d-tag that is not present returns null: a selected option that has
 * since disappeared must never silently resolve to a different one.
 */
export function resolveProductVariation<E extends ProductFamilyEvent>(
	family: ProductFamily<E>,
	selectedDTag?: string,
): ProductFamilyVariation<E> | null {
	if (selectedDTag !== undefined) {
		return family.variations.find((variation) => getVariationDTag(variation.product) === selectedDTag) ?? null
	}
	return family.availableVariations[0] ?? family.variations[0] ?? null
}

/**
 * Images for the family view: the selected variation's own images override the
 * parent's, so switching options swaps the gallery, while a variation without
 * images inherits the parent gallery instead of showing nothing.
 */
export function getProductFamilyImages<E extends ProductFamilyEvent>(
	parent: E,
	selected: ProductFamilyVariation<E> | null,
): string[][] {
	const selectedImages = selected ? getProductImages(selected.product) : []
	return selectedImages.length > 0 ? selectedImages : getProductImages(parent)
}

/** Distinct spec keys across the family, in first-seen order, for option-axis rendering. */
export function getProductFamilySpecKeys<E extends ProductFamilyEvent>(family: ProductFamily<E>): string[] {
	const keys: string[] = []
	const seen = new Set<string>()
	for (const variation of family.variations) {
		for (const spec of getVariationSpecs(variation.product)) {
			if (seen.has(spec.key)) continue
			seen.add(spec.key)
			keys.push(spec.key)
		}
	}
	return keys
}

/**
 * Price range over the family's available variations, falling back to all of
 * them when none is in stock so a sold-out family still advertises its price.
 * `readPrice` is injected because the read model already owns price-tag
 * parsing; this module only aggregates.
 */
export function getProductFamilyPriceRange<E extends ProductFamilyEvent>(
	family: ProductFamily<E>,
	readPrice: (event: E) => { amount: number; currency: string } | null,
): ProductFamilyPrice | null {
	const source = family.availableVariations.length > 0 ? family.availableVariations : family.variations

	let min: number | undefined
	let max: number | undefined
	let currency: string | undefined
	for (const variation of source) {
		const price = readPrice(variation.product)
		if (!price) continue
		if (currency === undefined) currency = price.currency
		// A single range cannot span two currencies; keep the first one seen.
		else if (price.currency !== currency) continue
		if (min === undefined || price.amount < min) min = price.amount
		if (max === undefined || price.amount > max) max = price.amount
	}

	if (min === undefined || max === undefined || currency === undefined) return null
	return { min, max, currency }
}

/**
 * Collapses a search/browse list to one row per family: the parent when it is
 * present, otherwise the first child seen, with the family's other children
 * dropped. Non-family events pass through untouched and the original order is
 * preserved, so a feed that was family-oblivious no longer shows twelve cards
 * for a twelve-size run.
 */
export function groupProductSearchResultsByFamily<E extends ProductFamilyEvent>(events: readonly E[]): E[] {
	const parentAddresses = new Set<string>()
	for (const event of events) {
		if (getProductEventType(event) !== 'variable') continue
		const address = getProductAddress(event)
		if (address) parentAddresses.add(address)
	}

	const emitted = new Set<string>()
	const result: E[] = []
	for (const event of events) {
		const type = getProductEventType(event)

		if (type === 'variation') {
			const parentAddress = getVariationParentAddress(event)
			// The parent row already represents this family when present; otherwise
			// the first child becomes the row and the siblings are dropped.
			if (parentAddress) {
				if (parentAddresses.has(parentAddress) || emitted.has(parentAddress)) continue
				emitted.add(parentAddress)
			}
			result.push(event)
			continue
		}

		if (type === 'variable') {
			const address = getProductAddress(event)
			if (address) {
				if (emitted.has(address)) continue
				emitted.add(address)
			}
			result.push(event)
			continue
		}

		result.push(event)
	}

	return result
}
