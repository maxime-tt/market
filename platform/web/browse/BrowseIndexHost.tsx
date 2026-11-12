/**
 * platform/web/browse/BrowseIndexHost.tsx — The Browse index host.
 *
 * Wires the Browse shell to real reads (relay status, search/results stream,
 * facets, product detail). Renders all Phase-2 states:
 * - Idle: full-bleed wall strips above and below the hero
 * - Search results: grid with skeleton shimmer, empty marketplace, relay indicator
 * - Relay error: expanding per-relay detail popover; dead-search error panel
 * - Tag-filtered: the bucket line — tags and sellers, each ADDING its value to
 *   the query; when the index scan was capped, one line disclosing it and the
 *   way past it.
 * - Split view: a clicked card — or a home tile — opens the product panel beside
 *   the page it was clicked on, driven by the route's `?p=` (deep links and
 *   back/forward come for free); the open card's own click, the panel's close
 *   button, or Escape clears it. Exactly one panel is mounted in every state.
 * - The home is progressive: the index feed publishes each stream arrival into
 *   the query cache, so the strips, the measured stats line and the category
 *   rows all fill in as listings land — never in one reveal at the caught-up
 *   marker, and never gated on each other.
 * - Every product surface is a real link: results cards, category-row cards and
 *   strip tiles carry the product's deep link (`?p=<id>` with the current
 *   `q`), and every seller name links to `/profile/<pubkey>`. A plain
 *   left click is intercepted and opens the panel in place; modifier-clicks and
 *   middle-click behave as normal links.
 *
 * One tree, never one branch per state: the nav band and its search field are
 * rendered outside the state branch, so typing cannot unmount the focused input
 * when the first character flips the page. The home's own large field hands its
 * caret to the nav field on that same commit.
 *
 * The product panel's read is the single-entity `useBrowseProductDetail` (a
 * `fetch` by coordinate), aimed at the relays the search hit was seen on and
 * falling back to the app's own read context when the hit recorded none; the
 * grid's read stays the search stream.
 */

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { BrowseNav } from '@ui/browse/browse-nav'
import { SearchField } from '@ui/browse/search-field'
import { ProductCard, type CardPresentation } from '@ui/browse/product-card'
import { BrowseIdle } from '@ui/browse/browse-idle'
import { CategoryRow, CategoryRows } from '@ui/browse/category-rows'
import { SkeletonGrid } from '@ui/browse/skeleton-grid'
import { EmptyStateBrowse } from '@ui/browse/empty-state-browse'
import { ProductArtMount, SKELETON_SHIMMER_CSS } from '@ui/browse/art'
import { RelayIndicator, DeadSearchError, TagFilterBadge } from '@ui/browse/relay-error'
import { SearchBucketLine, ScanTruncationNotice, isBucketActive, type Bucket } from '@ui/browse/search-buckets'
import { SplitView } from '@ui/browse/split-view'
import { ProductDetailPanel, type ProductDetailOption, type ProductDetailPanelState } from '@ui/browse/product-detail-panel'
import { formatPriceUnit } from '@ui/utils/format'
import { recordListingEvent } from '@platform/web/analytics/listingEvents'
import { useBrowseSearch, useBrowseFacets, useBrowseProductDetail, useBrowseFamilyChildren } from '@platform/web/browse/browseQuery'
import { materialForPubkey, readProductPrice, type BrowseFacet, type BrowseProduct } from '@platform/web/browse/browseProductMap'
import { getProductFamilyPriceRange, getVariationDTag, resolveProductVariation } from '@sdk/commerce/discovery'
import { feedStrips, useBrowseIndexFeed } from '@platform/web/browse/browseIndexFeed'
import {
	getNormalizedProfileDisplayName,
	getNormalizedProfilePicture,
	useProfile,
	useProfileNames,
} from '@platform/web/profiles/profileQuery'
import { usePriceDisplay } from '@platform/web/products/PriceDisplayHost'
import { copyToClipboard } from '@platform/web/utils/clipboard'
import { useAuth } from '@platform/web/auth/authStore'
import { npubEncode } from 'nostr-tools/nip19'

/** The Browse URL state the host asks the route to write back. */
export interface BrowseSearchState {
	q: string
	p?: string
}

// ---------------------------------------------------------------------------
// Browse index host props
// ---------------------------------------------------------------------------

interface BrowseIndexHostProps {
	q: string
	/** The open product (the listing's kind-30402 `d` tag) from the route's `?p=`. */
	p: string | undefined
	onNavigate: (search: BrowseSearchState) => void
	onNavigateFeatured: () => void
}

// ---------------------------------------------------------------------------
// The idle index — read, never mocked
// ---------------------------------------------------------------------------

/**
 * How many loaded listings the idle wall shows (split above/below the hero) and
 * how many of them each category row draws. Both are display caps over the
 * *same* bounded feed read (`useBrowseIndexFeed`), not market totals.
 */
const IDLE_WALL_LIMIT = 16
const CATEGORY_ROW_LIMIT = 4

/**
 * How many of the wall's tiles sit above the hero. The wall fills the top strip
 * first and the bottom one after it, so a streaming feed adds a tile to the end
 * and never moves one between the strips — the split is a fixed boundary, not
 * half of whatever has loaded so far.
 */
const IDLE_WALL_ABOVE = Math.ceil(IDLE_WALL_LIMIT / 2)

/** The section the `Browse products` CTA scrolls to. */
const CATEGORY_SECTION_ID = 'browse-categories'

/**
 * The results grid's track sizing.
 *
 * The card is a fixed 320px — the frame's own card width — and the grid sizes
 * its tracks, never its children, so opening the panel changes **how many**
 * cards fit and not how wide each one is. `minmax(0, 320px)` caps the track at
 * the card width while letting it follow a viewport narrower than one card
 * (the phone case) instead of overflowing; `justify-content: center` puts the
 * leftover width into the side margins, which is the only thing that shrinks
 * when the split narrows the pane.
 */
const RESULTS_GRID_CLASS = 'grid gap-5 mt-5'
const RESULTS_GRID_STYLE = {
	gridTemplateColumns: 'repeat(auto-fit, minmax(0, 320px))',
	justifyContent: 'center',
} as const

/**
 * How many facet pills the fallback row shows. The service caps `suggested` at
 * eight, so the "more" control reveals at most two more — this cap is display,
 * not a claim about the market.
 *
 * The row itself is a fallback: see `BucketFrameFields` below.
 */
const FACET_PILL_LIMIT = 6

/**
 * The `search` frame's bucket fields, read structurally.
 *
 * `BrowseSearchResult` is being widened to carry `buckets` and `truncated` by the
 * client's own change; this host only needs the two optional fields, and reading
 * them this way says exactly what it reads instead of asserting a shape the type
 * does not carry yet. Delete the cast once the type states them.
 *
 * `scanned` is the reach the scan actually got to (the "first N" the buckets
 * describe); `candidateCount` is what the index said the set was. They differ
 * only when the scan was capped, which is the case the disclosure exists for.
 */
interface BucketFrameFields {
	buckets?: readonly Bucket[]
	truncated?: boolean
	scanned?: number
	candidateCount?: number
}

// ---------------------------------------------------------------------------
// Scroll — the one place the page listens to it
// ---------------------------------------------------------------------------

/**
 * How far the page scrolls before the nav band takes the search over.
 *
 * The idle frame homes the search in the hero's title block; the results frame
 * embeds the compact one in the nav band. The handoff is scroll position, so
 * one pixel past the top is already "scrolled" — the hero field is sticky
 * enough in sight at 8px that nothing appears to jump.
 */
const NAV_SEARCH_HANDOFF_PX = 8

/**
 * Whether the page has scrolled past `threshold`.
 *
 * Read in a passive listener and stored as a boolean, so a scroll burst
 * re-renders nothing once the flag has flipped.
 */
function usePageScrolled(threshold = NAV_SEARCH_HANDOFF_PX): boolean {
	const [scrolled, setScrolled] = useState(false)

	useEffect(() => {
		const read = () => setScrolled(window.scrollY > threshold)
		// A restored scroll position (back/forward) is already past the top on
		// mount, so the first read is not optional.
		read()
		window.addEventListener('scroll', read, { passive: true })
		return () => window.removeEventListener('scroll', read)
	}, [threshold])

	return scrolled
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * The seller's elided npub (`npub1abcd…wxyz`). Returns undefined for a pubkey
 * that is not encodable rather than a placeholder — the panel then shows only
 * the seller it does know.
 */
function elideNpub(pubkey: string): string | undefined {
	try {
		const npub = npubEncode(pubkey)
		return `${npub.slice(0, 10)}…${npub.slice(-4)}`
	} catch {
		return undefined
	}
}

/** The account chip the nav and the idle screen share. */
function AccountChip({ initial }: { initial: string }) {
	return (
		<span data-slot="account-trigger" className="flex items-center gap-2 text-sm text-text-mid" title="Account">
			<span className="size-7 rounded-full bg-fill-ink text-on-fill-ink grid place-items-center text-xs font-bold">{initial}</span>
		</span>
	)
}

/**
 * A listing's price as the app's existing display path resolves it
 * (`usePriceDisplay` — the same resolution `PriceDisplayHost` renders) for an
 * amount that is NOT in sats. A sats- (or absent-) currency listing gets
 * `undefined`: the card renders its own sats line exactly as before, so a sats
 * listing is untouched by this path.
 *
 * A fiat amount renders the path's own figure in the listing's currency (never
 * the "sats" label, which the amount never carried); a BTC amount renders in
 * BTC. No rate is invented, and no unit is assumed.
 */
function useListingPriceDisplay(price?: number, currency?: string): { label: string; unit: string } | undefined {
	const unit = formatPriceUnit(currency)
	const needsDisplay = typeof price === 'number' && unit !== 'sats'
	// The hook itself is unconditional; a zero amount keeps its conversion query
	// off for the listings that do not need one.
	const { price: resolution } = usePriceDisplay(needsDisplay ? (price as number) : 0, currency || 'SATS')
	if (!needsDisplay) return undefined
	if (unit === 'BTC') return { label: (price as number).toLocaleString(undefined, { maximumFractionDigits: 8 }), unit }
	const fiat = resolution.fiatValue
	return {
		label: (fiat?.value ?? (price as number)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
		unit: fiat?.currency ?? unit,
	}
}

interface BrowseResultCardProps {
	product: BrowseProduct
	presentation?: CardPresentation
	selected?: boolean
	menuOpen?: boolean
	/** The product's deep link — the card's real anchor. */
	href: string
	/** The seller's profile link — the card's seller-link target. */
	sellerHref: string
	onSelect: (id: string) => void
	onThreeDots: () => void
	onCopyLink: () => void
}

/**
 * One Browse card: resolves the seller's profile (display name + picture, with
 * the pubkey-derived string and the tinted disc as fallbacks) and the listing's
 * price display through the app's existing seams, then renders the props-only
 * card.
 *
 * It is a component of its own because the profile read is a hook and the grid
 * maps over its products — a hook cannot be called inside that `map`.
 */
function BrowseResultCard({
	product,
	presentation,
	selected,
	menuOpen,
	href,
	sellerHref,
	onSelect,
	onThreeDots,
	onCopyLink,
}: BrowseResultCardProps) {
	const { data: profileData } = useProfile(product.pubkey)
	const sellerName = getNormalizedProfileDisplayName(profileData?.profile) ?? undefined
	const sellerPicture = getNormalizedProfilePicture(profileData?.profile) || undefined
	const price = useListingPriceDisplay(product.price, product.currency)

	return (
		<ProductCard
			id={product.id}
			title={product.title}
			seller={product.pubkey.slice(0, 8)}
			sellerPubkey={product.pubkey}
			sellerName={sellerName}
			sellerPicture={sellerPicture}
			href={href}
			sellerHref={sellerHref}
			image={product.image}
			price={product.price}
			priceCurrency={product.currency}
			priceLabel={price?.label}
			priceUnit={price?.unit}
			priceMin={product.priceMin}
			priceMax={product.priceMax}
			variantLabel={product.variantLabel}
			variantCount={product.variantCount}
			availableVariantCount={product.availableVariantCount}
			specKeys={product.specKeys}
			familyRole={product.familyRole}
			stockNote={typeof product.stock === 'string' ? product.stock : undefined}
			material={materialForPubkey(product.pubkey)}
			presentation={presentation}
			selected={selected}
			menuOpen={menuOpen}
			onSelect={onSelect}
			onThreeDots={onThreeDots}
			onCopyLink={onCopyLink}
		/>
	)
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Host that wires the Browse shell to the read seam.
 *
 * Two base states — the home, or a search's results — and one open product
 * (`?p=`) that never changes which of them you are on:
 * - Home (no term) → BrowseIdle: hero with measured facts, wall strips
 *   from the index feed, and the browse-by-category rows below them; the
 *   `Browse products` CTA scrolls to those rows
 * - Home + `?p=` → the same home as the split view's master pane, with the
 *   product panel beside it: a tile click opens the panel **in place**
 * - Query loading → SkeletonGrid (shimmering placeholders)
 * - Query error → DeadSearchError (if no relays responded) or ErrorState
 * - Query empty results → EmptyStateBrowse (everything answered, none matched)
 * - Query results → RelayIndicator + card grid (with the service's facet pills)
 * - Results + `?p=` → the same grid as the split view's master pane, with the
 *   product panel in the detail pane
 *
 * `?p=` is a property of the *open product*, not of the page: closing the panel
 * clears it and returns whichever base state was underneath.
 *
 * Two reads, one source each: the grid and the panel read the search stream
 * (`useBrowseSearch`, enabled by a term or by an open product alone — a bare
 * `?p=` deep link); the home reads the bounded index feed
 * (`useBrowseIndexFeed`). Relay data comes from the read seam (ctx.stream
 * caught-up event), never fabricated.
 *
 * THERE IS NO TAG FILTER. A category row's `See all →` and a facet pill both
 * write the value as the **keyword**, so the read is always a term. The service
 * searches `all_tags` alongside the title and the body, so a seller's tag is
 * still reachable as a keyword — and relevance ranking orders what an index
 * filter used to narrow. Two things this removes: the empty-term state (which
 * was never a sentence, and which let the facet probe answer over the whole
 * index — the Health/Pharma pills on a Bitcoin page), and the second field a
 * tag could be suggested from.
 *
 * The bucket line is the service's own derivation over the documents it scanned
 * — tags and sellers alike, each with the count measured over the set itself —
 * and choosing one ADDS its value to the term. There is no tag filter:
 * `suggested` facet pills remain only as a one-release fallback for a frame that
 * carries no buckets, because a facet count is computed over a candidate
 * superset and over-reports what the set actually holds.
 */
export function BrowseIndexHost({ q, p, onNavigate, onNavigateFeatured }: BrowseIndexHostProps) {
	const [menuOpenId, setMenuOpenId] = useState<string | null>(null)
	const [facetsExpanded, setFacetsExpanded] = useState(false)
	// The open family's selected option, by the variation's `d` tag. Held here
	// (not in the URL) so picking an option is a state change inside the open
	// panel, never a navigation. `undefined` means "no explicit choice", which
	// the SDK resolves to the first available variation.
	const [selectedVariant, setSelectedVariant] = useState<string | undefined>(undefined)

	/** The nav field's input and the hero's — the two ends of the handoff. */
	const navSearchInput = useRef<HTMLInputElement>(null)
	const heroSearchInput = useRef<HTMLInputElement>(null)
	/** Which field must take the caret on the next commit, set by the other one. */
	const focusTarget = useRef<'nav' | 'hero' | null>(null)

	const scrolled = usePageScrolled()

	const { user } = useAuth()

	// The facet probe: the term with NO filter, so the pill list cannot rotate as
	// the visitor selects one of its pills. It is now always scoped, because
	// there is no empty-term state for it to run against the whole index.
	const facetsQuery = useBrowseFacets(q, Boolean(q.trim()))

	const searchQuery = useBrowseSearch(q, 100, p)
	const result = searchQuery.data ?? null
	/**
	 * What a still-running read has delivered so far. The settled result always
	 * wins: `progress` is a partial (its `complete` is literally `false`) and is
	 * only used while `data` is absent — which is exactly the window in which the
	 * UI used to show a skeleton for seconds.
	 */
	const progress = searchQuery.progress ?? null
	const products: BrowseProduct[] = result ? result.products : progress?.products ?? []
	const isStreamingProducts = !result && products.length > 0

	// The idle index's own feed: one bounded stream that supplies the wall
	// strips, the hero's measured facts and the category rows. It is the same
	// read the grid's cards come from, so nothing here is a second source.
	const feedQuery = useBrowseIndexFeed()
	const feed = feedQuery.data ?? null

	// The wall's sellers, resolved in one batched profile read: a strip tile
	// states the seller's name, not a pubkey prefix. The read is unconditional
	// (hooks cannot be called inside the idle branch) and covers exactly the
	// listings the wall can draw.
	const wallProducts = (feed?.products ?? []).slice(0, IDLE_WALL_LIMIT)
	const wallSellerNames = useProfileNames(wallProducts.map((product) => product.pubkey))

	/**
	 * The open product's row in the results — the hit that opened the panel.
	 * A RabbitHole hit carries the relays it was seen on (`relays_seen`), which
	 * the client records on the product; the detail read goes to those relays
	 * rather than the app's own, which is how a listing on screen stopped
	 * resolving to "not on the relays". Read structurally, so a provider that
	 * records none simply leaves the read on the app's context.
	 */
	const openProduct: (BrowseProduct & { relays?: string[] }) | undefined = products.find((product) => product.id === p)

	const detailQuery = useBrowseProductDetail(p, openProduct?.relays)
	const detail = detailQuery.data ?? null

	// The open product's seller, through the profile seam — the panel's own
	// read is the single-entity one, so one hook here is enough.
	const detailProfile = useProfile(detail?.pubkey)
	const detailSellerName = getNormalizedProfileDisplayName(detailProfile.data?.profile) ?? undefined
	const detailSellerPicture = getNormalizedProfilePicture(detailProfile.data?.profile) || undefined
	const detailPrice = useListingPriceDisplay(detail?.price, detail?.currency)

	/**
	 * The open product's family, when it is a family container. A `parent` row
	 * already states its family address; a deep link that is not in the search
	 * window falls back to the parent's own coordinate from the detail read. The
	 * children read confirms family-ness — a simple listing builds no family and
	 * so renders no picker.
	 */
	const detailCoordinate = detail && detail.pubkey && detail.id ? `30402:${detail.pubkey}:${detail.id}` : undefined

	// Analytics: opening a listing is one per-listing VIEW (owner ruling). Keyed
	// on the coordinate, so re-renders and re-reads do not inflate it.
	useEffect(() => {
		if (detailCoordinate) recordListingEvent('listing_view', detailCoordinate)
	}, [detailCoordinate])
	const familyAddress =
		openProduct && openProduct.familyRole !== 'parent' ? undefined : (openProduct?.familyAddress ?? detailCoordinate)

	const familyQuery = useBrowseFamilyChildren(familyAddress, openProduct?.relays)
	const family = familyQuery.data?.family ?? null
	const familyChildren = familyQuery.data?.children ?? []
	// Resolve the selection with the SDK: an explicit d-tag that has since left
	// the family resolves to null (no silent fallback); no explicit choice
	// resolves to the first AVAILABLE variation, else the first.
	const selectedVariation = family ? resolveProductVariation(family, selectedVariant) : null
	const selectedOptionDTag = selectedVariation ? getVariationDTag(selectedVariation.product) : undefined
	const familyPriceRange = family ? getProductFamilyPriceRange(family, readProductPrice) : null

	/** The picker's options — every non-hidden variation, out-of-stock included. */
	const panelOptions: ProductDetailOption[] | undefined =
		familyChildren.length > 0
			? familyChildren.map((child) => ({
					dTag: child.dTag,
					label: child.label,
					available: child.available,
					price: child.product.price,
					currency: child.product.currency,
					image: child.product.image,
					stockNote: typeof child.product.stock === 'string' ? child.product.stock : undefined,
				}))
			: undefined

	// A new open product starts with no explicit option choice.
	useEffect(() => {
		setSelectedVariant(undefined)
	}, [p])

	/** The signed-in pubkey's initial, or nothing when signed out. */
	const accountInitial = user?.pubkey ? user.pubkey.slice(0, 2).toUpperCase() : undefined

	/**
	 * A product's real deep link on this surface: the route's own `?q=` plus
	 * `p=<id>`. Passing no id is the state a click on the open card writes (the
	 * panel closes), so that card's href is truthful too.
	 *
	 * The anchors use this href, so hover previews, middle-click and
	 * open-in-new-tab land on exactly the location a plain click shows.
	 */
	const browseHref = (productId?: string): string => {
		const params = new URLSearchParams()
		if (q) params.set('q', q)
		if (productId) params.set('p', productId)
		const search = params.toString()
		return search ? `/?${search}` : '/'
	}

	/** A seller's page — the same `/profile/<pubkey>` convention as `ui/nostr/identity.tsx`. */
	const sellerHrefFor = (pubkey: string): string => `/profile/${encodeURIComponent(pubkey)}`

	// Handlers
	/**
	 * The nav field's change. Emptying it returns the idle screen, where this
	 * field is hidden unless the page has scrolled — so the hero's field, the
	 * one actually on screen, takes the caret (see the layout effect below).
	 */
	const handleSearchChange = (value: string) => {
		focusTarget.current = value.trim().length === 0 && !scrolled ? 'hero' : null
		onNavigate({ q: value, p: undefined })
	}

	/**
	 * The hero field's own change. The first character typed there ends the idle
	 * state, and the hero — the input with it — unmounts in the same commit. The
	 * character survives in the URL, but focus does not, so the query would
	 * accept exactly one character per click. The nav field (rendered by this
	 * host, outside every branch) is already mounted; the layout effect below
	 * moves focus into it before the next keystroke.
	 */
	const handleHeroSearchChange = (value: string) => {
		focusTarget.current = value.trim().length > 0 ? 'nav' : null
		onNavigate({ q: value, p: undefined })
	}

	const handleSearchGo = () => {
		onNavigate({ q, p: undefined })
	}

	const handleCardSelect = (id: string) => {
		// The open card's own click is the panel's close affordance (the selected
		// card reads "· open"); any other card opens that product.
		onNavigate({ q, p: p === id ? undefined : id })
	}

	/**
	 * A category row: its `See all →` browses that category **as a keyword**.
	 * The value is the term, not a tag filter — the service searches `all_tags`
	 * alongside the title and the body, so the category's listings are reached
	 * by relevance rather than by an exact-match filter that could only narrow
	 * them. Its cards open the product in the split view in place (below).
	 */
	const handleCategorySeeAll = (category: string) => {
		onNavigate({ q: category, p: undefined })
	}

	/**
	 * A category row's card opens the product **in place**, exactly like a wall
	 * or strip tile: the state it writes is the product alone (`q` empty), so the
	 * home stays the split's master and the panel opens beside it.
	 * Including the row's category here was the defect — that state left the
	 * home and routed to the category's results, which is what `See all →`
	 * alone does.
	 */
	const handleCategoryCardSelect = (id: string) => {
		onNavigate({ q: '', p: id })
	}

	/** The idle wall / hero CTA: the category section is what "Browse products" names. */
	const handleBrowseProducts = () => {
		document.getElementById(CATEGORY_SECTION_ID)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
	}

	const handleMenuToggle = (id: string) => {
		setMenuOpenId((prev) => (prev === id ? null : id))
	}

	const handleCopyLink = (id: string) => {
		const url = new URL(window.location.href)
		url.searchParams.set('p', id)
		void copyToClipboard(url.toString())
		setMenuOpenId(null)
	}

	// The panel closes on Escape so a deep link's open product can be dismissed
	// without hunting for its card in the grid.
	useEffect(() => {
		if (!p) return
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') onNavigate({ q, p: undefined })
		}
		window.addEventListener('keydown', onKeyDown)
		return () => window.removeEventListener('keydown', onKeyDown)
	}, [p, q, onNavigate])

	// Relay state — the settled read's eose/pending arrays, or the running
	// read's own relay frames while it is still going. Both are the same
	// vocabulary (answered / not answered), so the indicator's in-flight counts
	// are the read's counts, not a placeholder.
	const eoseRelays = result ? result.eose : progress?.relaysAnswered ?? []
	const pendingRelays = result
		? result.pending
		: (progress?.relaysSeen ?? []).filter((relay) => !(progress?.relaysAnswered ?? []).includes(relay))
	const totalRelays = eoseRelays.length + pendingRelays.length
	const respondedCount = eoseRelays.length
	const relayDetails: Array<{ relay: string; status: 'responded' | 'pending' }> = [
		...eoseRelays.map((r: string) => ({ relay: r, status: 'responded' as const })),
		...pendingRelays.map((r: string) => ({ relay: r, status: 'pending' as const })),
	]

	// Facet pills — the service's own market-scoped counts, from the unfiltered
	// probe. The results read is never the source: once a filter is selected it
	// would answer with that filter's own facet list, rotating the pills out
	// from under the person who just picked one.
	const facets: BrowseFacet[] = facetsQuery.data ?? []
	const visibleFacets = facetsExpanded ? facets : facets.slice(0, FACET_PILL_LIMIT)

	// Buckets — the narrowing options the service derived from the documents its
	// scan read. Unlike a facet pill's count, a bucket's count is measured over
	// the set itself (the facet is computed over a candidate superset and
	// over-reports by up to 22%), so this line is what the grid's own numbers
	// agree with. Read structurally; see `BucketFrameFields`.
	const frame = result as unknown as BucketFrameFields | null
	const frameBuckets: readonly Bucket[] = frame?.buckets ?? []
	const scanTruncated = frame?.truncated === true

	// A seller bucket narrows by its pubkey but must SHOW the name — resolved
	// through the same batched profile read the cards use (`useProfileNames`,
	// which is `getNormalizedProfileDisplayName` over each profile), so the pill
	// and the card for that seller cannot disagree about who they are. The read
	// is unconditional: hooks cannot be called inside a branch.
	const bucketSellerPubkeys = frameBuckets.filter((bucket) => bucket.dimension === 'seller').map((bucket) => bucket.value)
	const bucketSellerNames = useProfileNames(bucketSellerPubkeys)
	const bucketsWithNames: Bucket[] = frameBuckets.map((bucket) =>
		bucket.dimension === 'seller' && !bucket.label ? { ...bucket, label: bucketSellerNames.get(bucket.value) } : bucket,
	)

	/**
	 * A bucket narrows **in place**: its value is added to the term, never
	 * substituted for it, so choosing one keeps the search the person was in.
	 *
	 * An already-active value is a no-op rather than a toggle. Removing a word
	 * from a free-text query is the field's job, and a pill that deletes text is
	 * a second mechanism — the same reason there is no tag filter here at all.
	 */
	const handleNarrow = (value: string) => {
		if (isBucketActive(q, value)) return
		const term = q.trim()
		onNavigate({ q: term ? `${term} ${value}` : value, p: undefined })
	}

	// The disclosure is NOT conditioned on the buckets: a capped scan with no
	// surviving buckets still has to say so, or a person reads silence as
	// completeness.
	const truncationNotice = (
		<ScanTruncationNotice
			truncated={scanTruncated}
			scanned={frame?.scanned}
			total={frame?.candidateCount}
			// The way past the cap is a narrower query, so the affordance is the
			// field itself — the nav one, which is mounted in every state.
			onRefine={() => navSearchInput.current?.focus()}
		/>
	)

	// Empty state hints — real data only
	const EMPTY_HINTS = [{ label: 'local index empty' }]

	/**
	 * The idle index: no term. The open product (`?p=`) is **not** part of this:
	 * selecting a wall/strip/row tile keeps the home page and opens its panel
	 * beside it, and a `?p=` deep link lands on the same place — never on an
	 * empty results grid. The results state is a *search* state, so only a term
	 * can leave the home.
	 */
	const isIdle = !q.trim()

	/**
	 * Focus handoff across the idle ↔ results change.
	 *
	 * The hero's large field lives on the idle screen and unmounts with it; the
	 * nav's compact field is rendered by this host, outside every branch, so it
	 * is already mounted when the branch flips. Whichever field the visitor was
	 * typing in dies or hides, so the other one takes the caret on the same
	 * commit — before the next keystroke, and with the caret at the end of the
	 * text the character just wrote.
	 */
	useLayoutEffect(() => {
		const target = focusTarget.current
		if (!target) return
		focusTarget.current = null

		const input = target === 'nav' ? navSearchInput.current : heroSearchInput.current
		if (!input || !input.isConnected) return
		input.focus()
		// The caret belongs after the character that got us here, not at 0.
		input.setSelectionRange(input.value.length, input.value.length)
	}, [isIdle, q])

	const accountSlot = accountInitial ? <AccountChip initial={accountInitial} /> : null

	/**
	 * The nav band's compact field, and when it is the one on screen.
	 *
	 * The idle frame homes the search in the hero; the results and split frames
	 * put it in the nav band. So the compact instance shows on every search
	 * state, on the home once the page has scrolled past the hero's field, and
	 * on the home with a product open beside it (the split frame — the hero may
	 * be scrolled out inside the master pane).
	 *
	 * It is rendered unconditionally — hidden, never unmounted — because the
	 * element holding the caret must not be remounted by a state change.
	 */
	const navSearchHidden = isIdle && !scrolled && !p
	const navSearch = (
		<SearchField
			value={q}
			onChange={handleSearchChange}
			onGo={handleSearchGo}
			inputRef={navSearchInput}
			className={navSearchHidden ? 'hidden' : undefined}
		/>
	)

	/**
	 * The hero's placeholder states what this index loaded — the frame's
	 * "Search 3,418 items" is that count, never a market total. Without the read
	 * there is no number to state, so the field keeps the plain copy.
	 */
	const heroPlaceholder =
		feed?.stats?.products !== undefined
			? `Search ${feed.stats.products.toLocaleString('en-US')} items — try “ceramic”, “oak bowl”, or a seller’s npub`
			: undefined

	// The idle wall: the loaded listings, split either side of the hero. Each
	// tile carries its own image, title, price and resolved seller name, and the
	// art is assigned the same way the cards assign it.
	const wall = isIdle ? feedStrips(wallProducts, IDLE_WALL_LIMIT, (pubkey) => wallSellerNames.get(pubkey), browseHref) : []

	const hasResults = products.length > 0

	// Relay indicator — always present, with the read's own fetching state.
	// `loading` covers the whole streamed read (react-query's isLoading is true
	// until the query resolves), so the verdict wording cannot appear while
	// products are still arriving; `incomplete` covers a read that stopped
	// without a verdict.
	const relayIndicator = (
		<RelayIndicator
			responded={respondedCount}
			totalProducts={products.length}
			relays={relayDetails}
			loading={searchQuery.isLoading}
			incomplete={Boolean(result?.incomplete)}
		/>
	)

	// The result cards — the grid's children in both layouts. While the read is
	// still running these are the products delivered so far; the settled result
	// replaces the list wholesale when it lands.
	const cards: ReactNode = products.map((product) => (
		<BrowseResultCard
			key={product.id}
			product={product}
			selected={p === product.id}
			href={browseHref(p === product.id ? undefined : product.id)}
			sellerHref={sellerHrefFor(product.pubkey)}
			onSelect={handleCardSelect}
			onThreeDots={() => handleMenuToggle(product.id)}
			onCopyLink={() => handleCopyLink(product.id)}
			menuOpen={menuOpenId === product.id}
		/>
	))

	/** The panel's read state, from the detail query. */
	const panelState: ProductDetailPanelState = detailQuery.isLoading ? 'loading' : detailQuery.isError ? 'error' : detail ? 'ready' : 'empty'

	/**
	 * Closing the detail is a navigation, not local state: `?p=` is the only
	 * thing that says what is open, so the panel's own close button and — below
	 * `lg` — the pushed view's back bar both clear it. That keeps the browser's
	 * Back button (which pops `?p=` off the history) and these controls on one
	 * mechanism.
	 */
	const closePanel = () => onNavigate({ q, p: undefined })

	// There is no empty-term browse any more, so there is no "nothing under
	// <category>" copy to write: every browse carries a term, and the grid's own
	// empty state names it.
	const emptyCopy = {}

	/**
	 * The open product's panel — one element, rendered by whichever base state is
	 * showing, and by **only** that one. `?p=` says *what is open*, never which
	 * page you are on: the home keeps its wall, hero, strips and rows, and the
	 * results keep their grid. The two base states each own their split; a state
	 * can never render both (the `?q=` empty + `?p=` set case used to: the home's
	 * split and the results split both mounted, stacking two panes).
	 */
	const panel = p ? (
		<ProductDetailPanel
			state={panelState}
			product={
				detail
					? {
							id: detail.id,
							title: detail.title,
							seller: detail.pubkey.slice(0, 8),
							sellerName: detailSellerName,
							sellerPicture: detailSellerPicture,
							sellerNpub: elideNpub(detail.pubkey),
							sellerHref: sellerHrefFor(detail.pubkey),
							location: detail.location,
							image: detail.image,
							price: detail.price,
							currency: detail.currency,
							priceLabel: detailPrice?.label,
							priceUnit: detailPrice?.unit,
							priceMin: familyPriceRange?.min,
							priceMax: familyPriceRange?.max,
							stockNote: typeof detail.stock === 'string' ? detail.stock : undefined,
							description: detail.description || undefined,
							shipping: detail.shipping,
							material: materialForPubkey(detail.pubkey),
						}
					: undefined
			}
			menuOpen={menuOpenId === p}
			options={panelOptions}
			selectedOptionDTag={selectedOptionDTag}
			onSelectOption={(dTag) => setSelectedVariant(dTag)}
			onClose={closePanel}
			onThreeDots={() => handleMenuToggle(p)}
			onCopyLink={() => handleCopyLink(p)}
			onRetry={() => void detailQuery.refetch()}
		/>
	) : null

	/**
	 * The home page: hero (with its large field), the wall strips read from the
	 * feed, and the browse-by-category rows the CTA scrolls to. It is the base
	 * state of the index — a search leaves it, an open product does not.
	 */
	const homeBody = (
		<>
			{/* Idle index: hero (with the large field), wall strips read from the
					    feed, and the browse-by-category rows below them. */}
			<BrowseIdle
				stats={feed?.stats}
				searchSlot={
					<SearchField
						value={q}
						placeholder={heroPlaceholder}
						onChange={handleHeroSearchChange}
						onGo={handleSearchGo}
						inputRef={heroSearchInput}
						size="hero"
					/>
				}
				onSelectProduct={(id) => onNavigate({ q: '', p: id })}
				onBrowseProducts={handleBrowseProducts}
				onWhyPlebeian={onNavigateFeatured}
				stripsAbove={wall.slice(0, IDLE_WALL_ABOVE)}
				stripsBelow={wall.slice(IDLE_WALL_ABOVE)}
			/>

			{/* Browse by category — the rows the `Browse products` CTA scrolls to */}
			<div id={CATEGORY_SECTION_ID} className="max-w-[1120px] mx-auto px-4 lg:px-6 pb-12">
				<CategoryRows isLoading={feedQuery.isLoading && !feed} isError={feedQuery.isError && !feed}>
					{(feed?.rows ?? []).map((row) => (
						<CategoryRow
							key={row.category}
							title={row.category}
							count={row.items.length}
							onSeeAll={() => handleCategorySeeAll(row.category)}
						>
							{row.items.slice(0, CATEGORY_ROW_LIMIT).map((product) => (
								<BrowseResultCard
									key={product.id}
									product={product}
									presentation="row"
									href={browseHref(p === product.id ? undefined : product.id)}
									sellerHref={sellerHrefFor(product.pubkey)}
									onSelect={handleCategoryCardSelect}
									onThreeDots={() => handleMenuToggle(product.id)}
									onCopyLink={() => handleCopyLink(product.id)}
									menuOpen={menuOpenId === product.id}
								/>
							))}
						</CategoryRow>
					))}
				</CategoryRows>
			</div>
		</>
	)

	// Render — one tree, two states
	//
	// The nav band and its search field are rendered once, above the branch.
	// They must not live inside it: `q` changes on every keystroke, so a field
	// nested in a `isIdle ? … : …` branch is unmounted by the first character,
	// which is the bug this structure exists to prevent. The hero's own large
	// field is the only branch-scoped one, and the handoff above covers it.
	return (
		<div className="min-h-screen bg-background">
			{/* Page-level art mount: the SVG sprite + the eight material classes */}
			<ProductArtMount />

			{/* Nav — the same element in every state */}
			<BrowseNav
				active={true}
				onNavigateHome={() => onNavigate({ q: '', p: undefined })}
				onNavigateFeatured={onNavigateFeatured}
				searchSlot={navSearch}
				accountSlot={accountSlot}
			/>

			{isIdle ? (
				panel ? (
					/* Selecting a tile on the home opens the panel beside it: the home is
					   still the base state, and only the pane is added. */
					<SplitView className="h-[calc(100vh-4rem)] min-h-[520px]" master={homeBody} detail={panel} onCloseDetail={closePanel} />
				) : (
					homeBody
				)
			) : (
				<>
					<main className="max-w-[1120px] mx-auto px-4 lg:px-6 py-4">
						{/* Relay indicator — under the search area */}
						{relayIndicator}

						{/* The bucket line — tags and sellers, narrowing in place. It
						    replaces the facet pills whenever the service sends buckets;
						    the pills below are the one-release fallback for a frame
						    that carries only `suggested`. */}
						<div data-slot="browse-buckets">
							<SearchBucketLine buckets={bucketsWithNames} query={q} onNarrow={handleNarrow} />
							{truncationNotice}
						</div>

						{/* Facet pills — the fallback row, kept while the service still
						    sends `suggested` alongside the buckets. */}
						{frameBuckets.length === 0 && facets.length > 0 && (
							<div
								data-slot="browse-facets"
								className={
									facetsExpanded
										? 'mt-3 flex flex-nowrap items-center gap-2 overflow-x-auto pb-1'
										: 'mt-3 flex flex-wrap items-center gap-2'
								}
							>
								{visibleFacets.map((facet) => (
									<TagFilterBadge
										key={`${facet.field}:${facet.value}`}
										label={facet.value}
										count={facet.count}
										// A pill is the term now, so "active" is the term matching it
										// and toggling off is an empty term — the same mechanism
										// as the search field, not a second one.
										active={q.trim().toLowerCase() === facet.value.toLowerCase()}
										onToggle={() =>
											onNavigate({
												q: q.trim().toLowerCase() === facet.value.toLowerCase() ? '' : facet.value,
												p: undefined,
											})
										}
									/>
								))}
								{facets.length > FACET_PILL_LIMIT && (
									<button
										type="button"
										data-slot="browse-facets-more"
										data-testid="widget-browse-facets-more"
										aria-expanded={facetsExpanded}
										className="h-7 shrink-0 px-3 rounded-full border border-border-default text-xs text-text-mid cursor-pointer transition-colors hover:text-text-high"
										onClick={() => setFacetsExpanded((prev) => !prev)}
									>
										{facetsExpanded ? 'less' : 'more'}
									</button>
								)}
							</div>
						)}

						{/* Loading state — skeleton grid only when nothing has arrived
						    yet: once cards stream in, they ARE the loading state. */}
						{searchQuery.isLoading && !isStreamingProducts && <SkeletonGrid rows={8} columns={3} />}

						{/* Error state — dead search (all relays failed) */}
						{searchQuery.isError && respondedCount === 0 && (
							<DeadSearchError
								totalRelays={totalRelays}
								pendingCount={pendingRelays.length}
								message="All relays failed. Check your connection and try again."
								onRetry={() => handleSearchGo()}
							/>
						)}

						{searchQuery.isError && respondedCount > 0 && <EmptyStateBrowse query={q} headline="The search errored." hints={EMPTY_HINTS} />}

						{/* Empty marketplace — every relay answered, none matched. A read
						    that stopped early (`incomplete`) has no verdict, so it never
						    renders this: "nothing matched" would be a claim it cannot make. */}
						{!searchQuery.isLoading && result && result.products.length === 0 && !result.incomplete && !searchQuery.isError && (
							<EmptyStateBrowse query={q} hints={EMPTY_HINTS} {...emptyCopy} />
						)}

						{/* Results — the plain grid. The split view is rendered outside this
					    container (below) so both of its panes reach the viewport edges;
					    with a product open the same grid becomes its master pane. */}
						{hasResults && !panel && (
							<div data-slot="results-grid" className={RESULTS_GRID_CLASS} style={RESULTS_GRID_STYLE}>
								{cards}
							</div>
						)}
					</main>

					{/* The split is full-bleed: the owner's deliberate deviation from the
					    frame's 56px side margins, so both panes take the page's full
					    width. It lives inside this branch — not beside the branch — so
					    exactly one base state owns the panel: the home's split above, or
					    this one, never both. */}
					{hasResults && panel && (
						<SplitView
							className="mt-5 h-[calc(100vh-10.5rem)] min-h-[520px]"
							master={
								<div data-slot="results-grid" className={RESULTS_GRID_CLASS} style={RESULTS_GRID_STYLE}>
									{cards}
								</div>
							}
							detail={panel}
							onCloseDetail={closePanel}
						/>
					)}
				</>
			)}

			{/* Inject shimmer keyframes into DOM (art module CSS) */}
			<style dangerouslySetInnerHTML={{ __html: SKELETON_SHIMMER_CSS }} />
		</div>
	)
}
