/**
 * Data slots for the magazine home blocks (ADR-0028).
 *
 * `ui/storefront/blocks/MagazineBlocks.tsx` is props-only; this is where the
 * reads happen. Every block here reads live — the page document stores what to
 * show and how to title it, never a price, a bid or a copy of a listing.
 *
 *   Ticker / CoverAuction / AuctionList → one shared 1440 auction read
 *   ProductSpread                       → featured products list, or picked `d` tags
 *   CollectionRow                       → featured collections, then newest with an image
 *   CategorySection                     → products by tag (the browse read, test listings excluded)
 */
import { useQuery } from '@tanstack/react-query'
import {
	CategorySectionBlock,
	CollectionRowBlock,
	CoverAuctionBlock,
	ProductSpreadBlock,
	TickerBlock,
	formatCountdown,
	formatSats,
	parseCategoryTags,
	type CategorySectionBlockProps,
	type CollectionRowBlockProps,
	type CoverAuctionBlockProps,
	type MagazineCollection,
	type MagazineProduct,
	type ProductSpreadBlockProps,
	type TickerEntry,
} from '@ui/storefront'
import { getProductImages, getProductPrice, getProductSummary, getProductTitle } from '@sdk/commerce/discovery'
import { getCollectionId, getCollectionImages, getCollectionProductReferences, getCollectionTitle } from '@sdk/commerce/collections'
import { getReadContext } from '@platform/web/readContext'
import { useConfigQuery } from '@platform/web/config/publicConfigQuery'
import { useFeaturedCollections, useFeaturedProducts } from '@platform/web/featured/featuredQueries'
import { productsByTagsQueryOptions, productsQueryOptions } from '@platform/web/products/productQuery'
import { ProductCardHost } from '@platform/web/products/ProductCardHost'
import { PriceDisplayHost } from '@platform/web/products/PriceDisplayHost'
import { collectionsQueryOptions } from '@platform/web/collections/collectionQuery'
import { UserCardHost } from '@platform/web/profiles/userCardHosts'
import { auctionTickerStats, selectCoverAuction, useNowSeconds, useSharedAuctionListRead } from './auctionListRead'

/** A listing event as the card host takes it (the read context's event type). */
type ListingEvent = Parameters<typeof ProductCardHost>[0]['product']

/** The auction route takes the `d` tag (see `StorefrontBlockSlots.auctionHref`). */
export function magazineAuctionHref(coordinate: string): string {
	return `/auctions/${encodeURIComponent(coordinate.split(':').slice(2).join(':'))}`
}

/** `kind:pubkey:d` → its parts, or null for anything else. */
function parseCoordinate(coordinate: string): { kind: number; pubkey: string; d: string } | null {
	const [kind, pubkey, ...rest] = coordinate.split(':')
	const d = rest.join(':')
	if (!kind || !pubkey || !d || !/^[0-9a-f]{64}$/i.test(pubkey)) return null
	return { kind: Number(kind), pubkey: pubkey.toLowerCase(), d }
}

function firstImage(tags: string[][]): string | null {
	return tags.find((tag) => typeof tag[1] === 'string' && tag[1].length > 0)?.[1] ?? null
}

// ---------------------------------------------------------------------------
// Ticker
// ---------------------------------------------------------------------------

export function TickerSlot({ messages, showLiveStats }: { messages: { text: string }[]; showLiveStats: boolean }) {
	const read = useSharedAuctionListRead()
	const now = useNowSeconds()
	const entries: TickerEntry[] = []
	if (showLiveStats && read.snapshot) {
		const stats = auctionTickerStats(read.snapshot, now)
		if (stats.live > 0) entries.push({ label: '', value: `${stats.live} ${stats.live === 1 ? 'LOT' : 'LOTS'} LIVE` })
		if (stats.closingNext) {
			entries.push({
				label: `Closing next: ${stats.closingNext.title?.trim() || stats.closingNext.d}`,
				value: formatCountdown(stats.closingNext.endsAt, now),
			})
		}
		if (stats.bidsToday > 0) entries.push({ label: `${stats.bidsToday} ${stats.bidsToday === 1 ? 'bid' : 'bids'} today` })
		if (stats.topBid !== null) entries.push({ label: 'Top live bid', value: `${formatSats(stats.topBid)} sats` })
	}
	for (const message of messages) if (message.text.trim()) entries.push({ label: message.text.trim() })
	return <TickerBlock entries={entries} />
}

// ---------------------------------------------------------------------------
// Cover auction
// ---------------------------------------------------------------------------

export function CoverAuctionSlot(props: CoverAuctionBlockProps) {
	const read = useSharedAuctionListRead()
	const now = useNowSeconds()
	const cover = read.snapshot ? selectCoverAuction(read.snapshot, { source: props.source, coordinates: props.auctionCoordinates, now }) : null
	// A partial read that has not delivered the lot yet is still loading, not empty.
	const status = !cover && read.status === 'incomplete' ? 'loading' : read.status
	return (
		<CoverAuctionBlock
			{...props}
			item={cover?.item ?? null}
			summary={cover?.description ?? null}
			status={status}
			now={now}
			auctionHref={magazineAuctionHref}
			renderSeller={(pubkey) => <UserCardHost pubkey={pubkey} size="xs" subtitle="none" />}
		/>
	)
}

// ---------------------------------------------------------------------------
// Product spread
// ---------------------------------------------------------------------------

function toMagazineProduct(event: ListingEvent): MagazineProduct {
	const price = getProductPrice(event)
	const amount = price ? Number.parseFloat(price[1]) : Number.NaN
	return {
		key: event.id,
		title: getProductTitle(event) || 'Untitled',
		imageUrl: firstImage(getProductImages(event)),
		href: `/products/${event.id}`,
		summary: getProductSummary(event),
		price: Number.isFinite(amount) ? <PriceDisplayHost priceValue={amount} originalCurrency={price?.[2] || 'SATS'} /> : null,
	}
}

export function ProductSpreadSlot(props: ProductSpreadBlockProps) {
	const { data: config } = useConfigQuery()
	const appPubkey = config?.appPublicKey ?? ''
	const featured = useFeaturedProducts(props.source === 'featured' ? appPubkey : '')

	// Picked: the editor's `d` tags, in order. Featured: the instance's list.
	const wanted =
		props.source === 'picked'
			? props.productDTags.map((d) => ({ d, pubkey: null as string | null }))
			: (featured.data?.featuredProducts ?? [])
					.map(parseCoordinate)
					.filter((ref): ref is NonNullable<typeof ref> => ref !== null)
					.slice(0, 3)
					.map((ref) => ({ d: ref.d, pubkey: ref.pubkey as string | null }))
	const key = wanted.map((ref) => `${ref.pubkey ?? ''}:${ref.d}`).join(',')

	const { data, isLoading } = useQuery({
		queryKey: ['storefront', 'product-spread', key],
		enabled: wanted.length > 0,
		staleTime: 60_000,
		queryFn: async () => {
			const events = (await getReadContext().fetch([{ kinds: [30402], '#d': wanted.map((ref) => ref.d) }])) as ListingEvent[]
			const picked: ListingEvent[] = []
			for (const ref of wanted) {
				const matches = events
					.filter((event) => event.tags.some((tag) => tag[0] === 'd' && tag[1] === ref.d) && (!ref.pubkey || event.pubkey === ref.pubkey))
					.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))
				if (matches[0]) picked.push(matches[0])
			}
			return picked
		},
	})

	// No featured list on this instance yet: fall back to the newest listings with a picture,
	// one per seller, so the spread never sits empty on a fresh market.
	// (Also when the list names listings no relay returned.)
	const useNewest = props.source === 'featured' && !featured.isLoading && (wanted.length === 0 || (!isLoading && data?.length === 0))
	// The same read the products page uses, so the two share one cache entry.
	const newest = useQuery({ ...productsQueryOptions(), enabled: useNewest })
	const fallback = useNewest ? pickSpreadFallback((newest.data ?? []) as ListingEvent[]) : null

	const loading = (props.source === 'featured' && featured.isLoading) || (wanted.length > 0 && isLoading) || (useNewest && newest.isLoading)
	const products = fallback ?? data ?? null
	return <ProductSpreadBlock {...props} products={products ? products.map(toMagazineProduct) : null} isLoading={loading} />
}

/** Newest listings with a picture, at most one per seller, three in all. */
export function pickSpreadFallback(events: ListingEvent[]): ListingEvent[] {
	const sellers = new Set<string>()
	const picked: ListingEvent[] = []
	for (const event of [...events].sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))) {
		if (picked.length >= 3) break
		if (sellers.has(event.pubkey) || !firstImage(getProductImages(event))) continue
		sellers.add(event.pubkey)
		picked.push(event)
	}
	return picked
}

// ---------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------

type CollectionEvent = ListingEvent

function hasCollectionContent(event: CollectionEvent): boolean {
	return getCollectionProductReferences(event).length > 0 && getCollectionTitle(event) !== 'Untitled Collection'
}

export function CollectionRowSlot(props: CollectionRowBlockProps) {
	const { data: config } = useConfigQuery()
	const appPubkey = config?.appPublicKey ?? ''
	const featured = useFeaturedCollections(props.source === 'featured' ? appPubkey : '')
	const newest = useQuery(collectionsQueryOptions)

	const featuredRefs = (featured.data?.featuredCollections ?? []).map(parseCoordinate).filter((ref): ref is NonNullable<typeof ref> => ref !== null)
	const featuredKey = featuredRefs.map((ref) => `${ref.pubkey}:${ref.d}`).join(',')
	const featuredEvents = useQuery({
		queryKey: ['storefront', 'collection-row', 'featured', featuredKey],
		enabled: featuredRefs.length > 0,
		staleTime: 60_000,
		queryFn: async () => {
			const events = (await getReadContext().fetch([{ kinds: [30405], '#d': featuredRefs.map((ref) => ref.d) }])) as CollectionEvent[]
			return featuredRefs
				.map((ref) => events.find((event) => event.pubkey === ref.pubkey && getCollectionId(event) === ref.d))
				.filter((event): event is CollectionEvent => event !== undefined)
		},
	})

	// Featured first, then the newest collections that have a title and items.
	const chosen: CollectionEvent[] = []
	const seen = new Set<string>()
	const take = (event: CollectionEvent) => {
		const id = `${event.pubkey}:${getCollectionId(event)}`
		if (seen.has(id) || chosen.length >= props.limit * 3) return
		seen.add(id)
		chosen.push(event)
	}
	for (const event of featuredEvents.data ?? []) take(event)
	for (const event of (newest.data ?? []) as CollectionEvent[]) if (hasCollectionContent(event)) take(event)

	// The collage: the collection's own image first, then its first products' images.
	const productRefs = chosen.flatMap((event) =>
		getCollectionProductReferences(event)
			.slice(0, 3)
			.map((tag) => parseCoordinate(tag[1]))
			.filter((ref): ref is NonNullable<typeof ref> => ref !== null),
	)
	const productKey = productRefs.map((ref) => ref.d).join(',')
	const productImages = useQuery({
		queryKey: ['storefront', 'collection-row', 'images', productKey],
		enabled: productRefs.length > 0,
		staleTime: 5 * 60_000,
		refetchInterval: (query) => (query.state.data?.size === 0 && query.state.dataUpdateCount < 4 ? 5_000 : false),
		queryFn: async () => {
			const events = (await getReadContext().fetch([{ kinds: [30402], '#d': [...new Set(productRefs.map((ref) => ref.d))] }])) as ListingEvent[]
			const byRef = new Map<string, string>()
			for (const event of events) {
				const d = event.tags.find((tag) => tag[0] === 'd')?.[1]
				const image = firstImage(getProductImages(event))
				if (d && image) byRef.set(`${event.pubkey}:${d}`, image)
			}
			return byRef
		},
	})

	const pool: MagazineCollection[] = chosen.map((event) => {
		const own = getCollectionImages(event)
			.map((tag) => tag[1])
			.filter((url): url is string => typeof url === 'string' && url.length > 0)
		const fromProducts = getCollectionProductReferences(event)
			.map((tag) => parseCoordinate(tag[1]))
			.filter((ref): ref is NonNullable<typeof ref> => ref !== null)
			.map((ref) => productImages.data?.get(`${ref.pubkey}:${ref.d}`))
			.filter((url): url is string => typeof url === 'string')
		return {
			key: `${event.pubkey}:${getCollectionId(event)}`,
			title: getCollectionTitle(event),
			href: `/collection/${encodeURIComponent(getCollectionId(event))}`,
			images: [...new Set([...own, ...fromProducts])].slice(0, 3),
			itemCount: getCollectionProductReferences(event).length,
			curator: <UserCardHost pubkey={event.pubkey} size="xs" subtitle="none" onPress="none" />,
		}
	})

	// Featured ones keep their place; among the rest, collections with pictures come first.
	const featuredCount = (featuredEvents.data ?? []).length
	const collections = [
		...pool.slice(0, featuredCount),
		...pool.slice(featuredCount).sort((a, b) => Number(b.images.length > 0) - Number(a.images.length > 0)),
	].slice(0, props.limit)

	const loading = newest.isLoading || (props.source === 'featured' && (featured.isLoading || featuredEvents.isLoading))
	return <CollectionRowBlock {...props} collections={collections} isLoading={loading} />
}

// ---------------------------------------------------------------------------
// Category section
// ---------------------------------------------------------------------------

/** How many listings to read per tag; the section shows `limit` of the newest. */
const PER_TAG_READ = 24

export function CategorySectionSlot(props: CategorySectionBlockProps) {
	const tags = parseCategoryTags(props.tags)
	const read = useQuery(productsByTagsQueryOptions(PER_TAG_READ, tags))

	const seen = new Set<string>()
	const products: ListingEvent[] = []
	for (const event of (read.data ?? []) as ListingEvent[]) {
		// A magazine row without pictures reads as broken; skip listings with none.
		const image = firstImage(getProductImages(event))
		if (!image) continue
		// Copies and size variants share a seller and a picture; show that picture once.
		const d = event.tags.find((tag) => tag[0] === 'd')?.[1] ?? event.id
		const keys = [event.id, `${event.pubkey}:${d}`, `${event.pubkey}:${image}`]
		if (keys.some((key) => seen.has(key))) continue
		for (const key of keys) seen.add(key)
		products.push(event)
	}

	products.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))

	return (
		<CategorySectionBlock
			{...props}
			products={products.slice(0, props.limit).map((event) => <ProductCardHost key={event.id} product={event} />)}
			isLoading={products.length === 0 && read.isLoading}
			browseHref={tags[0] ? `/?q=${encodeURIComponent(tags[0])}` : '/products'}
		/>
	)
}
