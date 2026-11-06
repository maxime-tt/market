/**
 * platform/web/browse/BrowseIndexHost.tsx — The Browse index host.
 *
 * Wires the Browse shell to real reads (relay status, search/results stream,
 * tag facets, product detail). Renders all Phase-2 states:
 * - Idle: wall strips above/below hero (desktop only)
 * - Search results: grid with skeleton shimmer, empty marketplace, relay indicator
 * - Relay error: expanding per-relay detail popover; dead-search error panel
 * - Tag-filtered: facet badges derived from the search
 * - Split view: a clicked card opens the product panel over the results, driven
 *   by the route's `?p=` (deep links and back/forward come for free), and the
 *   open card's own click, the panel's close button, or Escape clears it
 *
 * The product panel's read is the single-entity `useBrowseProductDetail` (a
 * `fetch` by coordinate), aimed at the relays the search hit was seen on and
 * falling back to the app's own read context when the hit recorded none; the
 * grid's read stays the search stream.
 */

import { useEffect, useState, type ReactNode } from 'react'
import { BrowseNav } from '@ui/browse/browse-nav'
import { SearchField } from '@ui/browse/search-field'
import { ProductCard, type CardPresentation } from '@ui/browse/product-card'
import { BrowseIdle } from '@ui/browse/browse-idle'
import { CategoryRow, CategoryRows } from '@ui/browse/category-rows'
import { SkeletonGrid } from '@ui/browse/skeleton-grid'
import { EmptyStateBrowse } from '@ui/browse/empty-state-browse'
import { ProductArtMount, SKELETON_SHIMMER_CSS } from '@ui/browse/art'
import { RelayIndicator, DeadSearchError, TagFilterBadge } from '@ui/browse/relay-error'
import { SplitView } from '@ui/browse/split-view'
import { ProductDetailPanel, type ProductDetailPanelState } from '@ui/browse/product-detail-panel'
import { formatPriceUnit } from '@ui/utils/format'
import { useBrowseSearch, useBrowseFacets, useBrowseProductDetail } from '@platform/web/browse/browseQuery'
import { materialForPubkey, type BrowseFacet, type BrowseProduct } from '@platform/web/browse/browseProductMap'
import { feedStrips, useBrowseIndexFeed } from '@platform/web/browse/browseIndexFeed'
import { getNormalizedProfileDisplayName, getNormalizedProfilePicture, useProfile } from '@platform/web/profiles/profileQuery'
import { usePriceDisplay } from '@platform/web/products/PriceDisplayHost'
import { copyToClipboard } from '@platform/web/utils/clipboard'
import { useAuth } from '@platform/web/auth/authStore'
import { npubEncode } from 'nostr-tools/nip19'

/** The Browse URL state the host asks the route to write back. */
export interface BrowseSearchState {
	q: string
	tag?: string
	p?: string
}

// ---------------------------------------------------------------------------
// Browse index host props
// ---------------------------------------------------------------------------

interface BrowseIndexHostProps {
	q: string
	tag: string | undefined
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

/** The section the `Browse products` CTA scrolls to. */
const CATEGORY_SECTION_ID = 'browse-categories'

/**
 * How many facet pills the collapsed row shows. The service caps `suggested` at
 * eight, so the "more" control reveals at most two more — this cap is display,
 * not a claim about the market.
 */
const FACET_PILL_LIMIT = 6

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
function BrowseResultCard({ product, presentation, selected, menuOpen, onSelect, onThreeDots, onCopyLink }: BrowseResultCardProps) {
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
			image={product.image}
			price={product.price}
			priceCurrency={product.currency}
			priceLabel={price?.label}
			priceUnit={price?.unit}
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
 * State machine:
 * - Idle (no term, no tag, no open product) → BrowseIdle: hero with measured
 *   facts, wall strips from the index feed, and the browse-by-category rows
 *   below them; the `Browse products` CTA scrolls to those rows
 * - Query loading → SkeletonGrid (shimmering placeholders)
 * - Query error → DeadSearchError (if no relays responded) or ErrorState
 * - Query empty results → EmptyStateBrowse (everything answered, none matched)
 * - Query results → RelayIndicator + card grid (with the service's facet pills)
 * - Results + `?p=` → the same grid as the split view's master pane, with the
 *   product panel in the detail pane
 *
 * Two reads, one source each: the grid and the panel read the search stream
 * (`useBrowseSearch`, also enabled by a tag alone — the category row's
 * `See all →` — or by an open product alone, a bare `?p=` deep link); the idle
 * index reads the bounded index feed (`useBrowseIndexFeed`). Relay data comes
 * from the read seam (ctx.stream caught-up event), never fabricated.
 *
 * The facet pills are the service's own `suggested` list — real market counts —
 * read through `useBrowseFacets`, the unfiltered index probe, so selecting one
 * of its pills cannot rotate the set it was chosen from.
 */
export function BrowseIndexHost({ q, tag, p, onNavigate, onNavigateFeatured }: BrowseIndexHostProps) {
	const [menuOpenId, setMenuOpenId] = useState<string | null>(null)
	const [facetsExpanded, setFacetsExpanded] = useState(false)

	const { user } = useAuth()

	// The facet probe: the same term with NO filter, so the pill list cannot
	// rotate as the visitor selects one of its pills — and, because it is
	// already loaded before a pill is clicked, the click's own filter string is
	// known on the very first request rather than after a round trip.
	const facetsQuery = useBrowseFacets(q, Boolean(q.trim()) || Boolean(tag))
	const activeFilter = tag ? facetsQuery.data?.find((facet) => facet.value === tag)?.filter : undefined

	const searchQuery = useBrowseSearch(q, tag, 100, p, activeFilter)
	const result = searchQuery.data ?? null

	// The idle index's own feed: one bounded stream that supplies the wall
	// strips, the hero's measured facts and the category rows. It is the same
	// read the grid's cards come from, so nothing here is a second source.
	const feedQuery = useBrowseIndexFeed()
	const feed = feedQuery.data ?? null

	/**
	 * The open product's row in the results — the hit that opened the panel.
	 * A RabbitHole hit carries the relays it was seen on (`relays_seen`), which
	 * the client records on the product; the detail read goes to those relays
	 * rather than the app's own, which is how a listing on screen stopped
	 * resolving to "not on the relays". Read structurally, so a provider that
	 * records none simply leaves the read on the app's context.
	 */
	const openProduct: (BrowseProduct & { relays?: string[] }) | undefined = result?.products.find((product) => product.id === p)

	const detailQuery = useBrowseProductDetail(p, openProduct?.relays)
	const detail = detailQuery.data ?? null

	// The open product's seller, through the profile seam — the panel's own
	// read is the single-entity one, so one hook here is enough.
	const detailProfile = useProfile(detail?.pubkey)
	const detailSellerName = getNormalizedProfileDisplayName(detailProfile.data?.profile) ?? undefined
	const detailSellerPicture = getNormalizedProfilePicture(detailProfile.data?.profile) || undefined
	const detailPrice = useListingPriceDisplay(detail?.price, detail?.currency)

	/** The signed-in pubkey's initial, or nothing when signed out. */
	const accountInitial = user?.pubkey ? user.pubkey.slice(0, 2).toUpperCase() : undefined

	// Handlers
	const handleSearchChange = (value: string) => {
		onNavigate({ q: value, p: undefined, tag })
	}

	const handleSearchGo = () => {
		onNavigate({ q, p: undefined, tag })
	}

	const handleCardSelect = (id: string) => {
		// The open card's own click is the panel's close affordance (the selected
		// card reads "· open"); any other card opens that product.
		onNavigate({ q, p: p === id ? undefined : id, tag })
	}

	/**
	 * A category row: its `See all →` browses that one category (a tag-only
	 * read — no term is invented for it), and its cards open the product in the
	 * split view scoped to the row's category, so the pane's master list is the
	 * row the visitor was looking at.
	 */
	const handleCategorySeeAll = (category: string) => {
		onNavigate({ q: '', p: undefined, tag: category })
	}

	const handleCategoryCardSelect = (category: string, id: string) => {
		onNavigate({ q: '', p: id, tag: category })
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
			if (event.key === 'Escape') onNavigate({ q, p: undefined, tag })
		}
		window.addEventListener('keydown', onKeyDown)
		return () => window.removeEventListener('keydown', onKeyDown)
	}, [p, q, tag, onNavigate])

	// Relay state — derived from the read seam's eose/pending arrays
	const eoseRelays = result?.eose ?? []
	const pendingRelays = result?.pending ?? []
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

	// Empty state hints — real data only
	const EMPTY_HINTS = [{ label: 'local index empty' }]

	/**
	 * The idle index: no term, no tag, and no open product. A `?p=` deep link
	 * (or a strip/row click) is a *results* state, not the idle one — its
	 * master pane is the loaded set and its detail pane is the open product.
	 */
	const isIdle = !q.trim() && !tag && !p

	const accountSlot = accountInitial ? <AccountChip initial={accountInitial} /> : null

	// Render — State machine
	// No term, no tag, no open product → the idle index: hero, wall strips read
	// from the feed, and the browse-by-category rows below them.
	if (isIdle) {
		// The wall shows loaded listings, split either side of the hero. Art is
		// assigned the same way the cards assign it.
		const wall = feedStrips(feed?.products ?? [], IDLE_WALL_LIMIT)
		const wallSplit = Math.ceil(wall.length / 2)

		return (
			<>
				<ProductArtMount />
				<BrowseIdle
					stats={feed?.stats}
					query={q}
					onSearchChange={handleSearchChange}
					onSearchGo={handleSearchGo}
					onSelectProduct={(id) => onNavigate({ q: '', tag: undefined, p: id })}
					onBrowseProducts={handleBrowseProducts}
					onWhyPlebeian={onNavigateFeatured}
					stripsAbove={wall.slice(0, wallSplit)}
					stripsBelow={wall.slice(wallSplit)}
					active={true}
					onNavigateHome={() => onNavigate({ q: '', p: undefined, tag: undefined })}
					onNavigateFeatured={onNavigateFeatured}
					accountSlot={accountSlot}
				/>

				{/* Browse by category — the rows the `Browse products` CTA scrolls to */}
				<div id={CATEGORY_SECTION_ID} className="max-w-[1120px] mx-auto px-4 lg:px-6 pb-12">
					<CategoryRows isLoading={feedQuery.isLoading} isError={feedQuery.isError}>
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
										onSelect={(id) => handleCategoryCardSelect(row.category, id)}
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
	}

	const hasResults = !searchQuery.isLoading && (result?.products.length ?? 0) > 0

	// Relay indicator (always present under search when searching)
	const relayIndicator = <RelayIndicator responded={respondedCount} totalProducts={result?.products.length ?? 0} relays={relayDetails} />

	// The result cards — the grid's children in both layouts
	const cards: ReactNode = (result?.products ?? []).map((product) => (
		<BrowseResultCard
			key={product.id}
			product={product}
			selected={p === product.id}
			onSelect={handleCardSelect}
			onThreeDots={() => handleMenuToggle(product.id)}
			onCopyLink={() => handleCopyLink(product.id)}
			menuOpen={menuOpenId === product.id}
		/>
	))

	/** The panel's read state, from the detail query. */
	const panelState: ProductDetailPanelState = detailQuery.isLoading ? 'loading' : detailQuery.isError ? 'error' : detail ? 'ready' : 'empty'

	/**
	 * Empty-state copy for a browse with no term: a tag-only browse (the
	 * category row's `See all →`) names the category it found nothing under,
	 * because `Nothing matched "".` is not a sentence.
	 */
	const emptyCopy = q.trim()
		? {}
		: tag
			? {
					headline: `Nothing listed under “${tag}” yet.`,
					description:
						'Every relay this market mirrors answered — none carried a listing under this category, and none are still in flight. That is the whole result, not an error.',
				}
			: {}

	return (
		<div className="min-h-screen bg-background">
			{/* Page-level art mount: the SVG sprite + the eight material classes */}
			<ProductArtMount />

			{/* Nav */}
			<BrowseNav
				active={true}
				onNavigateHome={() => onNavigate({ q: '', p: undefined, tag: undefined })}
				onNavigateFeatured={onNavigateFeatured}
				searchSlot={<SearchField value={q} onChange={handleSearchChange} onGo={handleSearchGo} />}
				accountSlot={accountSlot}
			/>

			<main className="max-w-[1120px] mx-auto px-4 lg:px-6 py-4">
				{/* Relay indicator — under the search area */}
				{relayIndicator}

				{/* Facet pills — the service's own market-scoped counts and filters */}
				{facets.length > 0 && (
					<div
						data-slot="browse-facets"
						className={
							facetsExpanded ? 'mt-3 flex flex-nowrap items-center gap-2 overflow-x-auto pb-1' : 'mt-3 flex flex-wrap items-center gap-2'
						}
					>
						{visibleFacets.map((facet) => (
							<TagFilterBadge
								key={`${facet.field}:${facet.value}`}
								label={facet.value}
								count={facet.count}
								active={tag === facet.value}
								onToggle={() => onNavigate({ q, p: undefined, tag: tag === facet.value ? undefined : facet.value })}
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

				{/* Loading state — skeleton grid */}
				{searchQuery.isLoading && <SkeletonGrid rows={8} columns={3} />}

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

				{/* Empty marketplace — every relay answered, none matched */}
				{!searchQuery.isLoading && result && result.products.length === 0 && !searchQuery.isError && (
					<EmptyStateBrowse query={q} hints={EMPTY_HINTS} {...emptyCopy} />
				)}

				{/* Results — the plain grid, or the split view when a product is open */}
				{hasResults &&
					(p ? (
						<SplitView
							className="mt-5 h-[calc(100vh-10.5rem)] min-h-[520px]"
							master={<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">{cards}</div>}
							detail={
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
													location: detail.location,
													image: detail.image,
													price: detail.price,
													currency: detail.currency,
													priceLabel: detailPrice?.label,
													priceUnit: detailPrice?.unit,
													stockNote: typeof detail.stock === 'string' ? detail.stock : undefined,
													description: detail.description || undefined,
													shipping: detail.shipping,
													material: materialForPubkey(detail.pubkey),
												}
											: undefined
									}
									menuOpen={menuOpenId === p}
									onClose={() => onNavigate({ q, p: undefined, tag })}
									onThreeDots={() => handleMenuToggle(p)}
									onCopyLink={() => handleCopyLink(p)}
									onRetry={() => void detailQuery.refetch()}
								/>
							}
						/>
					) : (
						<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 mt-5">{cards}</div>
					))}
			</main>

			{/* Inject shimmer keyframes into DOM (art module CSS) */}
			<style dangerouslySetInnerHTML={{ __html: SKELETON_SHIMMER_CSS }} />
		</div>
	)
}
