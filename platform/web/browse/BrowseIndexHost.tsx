/**
 * platform/web/browse/BrowseIndexHost.tsx — The Browse index host.
 *
 * Wires the Browse shell to real reads (relay status, search/results stream,
 * tag facets, product detail). Renders all Phase-2 states:
 * - Idle: wall strips above/below hero (desktop only)
 * - Search results: grid with skeleton shimmer, empty marketplace, relay indicator
 * - Relay error: expanding per-relay detail popover; dead-search error panel
 * - Tag-filtered: facet badges derived from the search
 * - Split view: a clicked card opens the product panel beside the grid, driven
 *   by the route's `?p=` (deep links and back/forward come for free), and the
 *   open card's own click or Escape clears it
 *
 * The product panel's read is the single-entity `useBrowseProductDetail` (a
 * `fetch` by coordinate); the grid's read stays the search stream.
 */

import { useEffect, useState, type ReactNode } from 'react'
import { BrowseNav } from '@ui/browse/browse-nav'
import { SearchField } from '@ui/browse/search-field'
import { ProductCard } from '@ui/browse/product-card'
import type { StripItem } from '@ui/browse/product-strip'
import { BrowseIdle } from '@ui/browse/browse-idle'
import { SkeletonGrid } from '@ui/browse/skeleton-grid'
import { EmptyStateBrowse } from '@ui/browse/empty-state-browse'
import { ProductArtMount, SKELETON_SHIMMER_CSS } from '@ui/browse/art'
import { RelayIndicator, DeadSearchError, TagFilterBadge } from '@ui/browse/relay-error'
import { SplitView } from '@ui/browse/split-view'
import { ProductDetailPanel, type ProductDetailPanelState } from '@ui/browse/product-detail-panel'
import { useBrowseSearch, useBrowseProductDetail } from '@platform/web/browse/browseQuery'
import { materialForPubkey } from '@platform/web/browse/browseProductMap'
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
// Mock idle wall data — replace with real featured/curated stream
// ---------------------------------------------------------------------------

const IDLE_STrips_ABOVE: StripItem[] = [
	{ id: 'idle-1', title: 'Speckled Bowl, 6 in', seller: 'ATELIER-NORTE', material: 'm1', symbolId: 'p-bowl' },
	{ id: 'idle-2', title: 'Amber Dropper, 30 ml', seller: 'GLASSWORKS', material: 'm2', symbolId: 'p-bottle' },
	{ id: 'idle-3', title: 'Stoneware Mug, 400 ml', seller: 'CLAYHOUSE', material: 'm3', symbolId: 'p-mug' },
	{ id: 'idle-4', title: 'Pendant Lantern', seller: 'FORGE', material: 'm4', symbolId: 'p-lamp' },
	{ id: 'idle-5', title: 'Botanical Print Folio', seller: 'PRESS', material: 'm5', symbolId: 'p-books' },
	{ id: 'idle-6', title: 'Nesting Crates (3)', seller: 'JOINERY', material: 'm6', symbolId: 'p-crate' },
	{ id: 'idle-7', title: 'Hand-thrown Tumbler', seller: 'KILN-AND-CO', material: 'm7', symbolId: 'p-mug' },
	{ id: 'idle-8', title: 'Speckled Dinner Plate', seller: 'TERRA-STUDIO', material: 'm8', symbolId: 'p-bowl' },
]

const IDLE_STrips_BELOW: StripItem[] = [
	{ id: 'idle-9', title: 'Glazed Ramen Bowl, set of 2', seller: 'ATELIER-NORTE', material: 'm1', symbolId: 'p-jar' },
	{ id: 'idle-10', title: 'Wood-fired Tea Bowl', seller: 'KILN-AND-CO', material: 'm6', symbolId: 'p-bowl' },
	{ id: 'idle-11', title: 'Ceramic Honing Rod', seller: 'CAST-AND-CO', material: 'm3', symbolId: 'p-crate' },
	{ id: 'idle-12', title: 'Speckled Dinner Plate, 26 cm', seller: 'TERRA-STUDIO', material: 'm4', symbolId: 'p-books' },
	{ id: 'idle-13', title: 'Ceramic Water Filter', seller: 'MILL-WORKS', material: 'm5', symbolId: 'p-bottle' },
	{ id: 'idle-14', title: 'Stoneware Butter Keeper', seller: 'KILN-AND-CO', material: 'm6', symbolId: 'p-jar' },
	{ id: 'idle-15', title: 'Ceramic Mortar & Pestle', seller: 'TERRA-STUDIO', material: 'm2', symbolId: 'p-crate' },
	{ id: 'idle-16', title: 'Raku Vase, one of one', seller: 'AUCTION', material: 'm1', symbolId: 'p-candle' },
]

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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Host that wires the Browse shell to the read seam.
 *
 * State machine:
 * - No query → BrowseIdle (hero + wall strips)
 * - Query loading → SkeletonGrid (shimmering placeholders)
 * - Query error → DeadSearchError (if no relays responded) or ErrorState
 * - Query empty results → EmptyStateBrowse (everything answered, none matched)
 * - Query results → RelayIndicator + card grid (with optional facet badges)
 * - Results + `?p=` → the same grid as the split view's master pane, with the
 *   product panel in the detail pane
 *
 * Relay data comes from the read seam (ctx.stream caught-up event),
 * never fabricated.
 */
export function BrowseIndexHost({ q, tag, p, onNavigate, onNavigateFeatured }: BrowseIndexHostProps) {
	const [menuOpenId, setMenuOpenId] = useState<string | null>(null)

	const { user } = useAuth()

	const searchQuery = useBrowseSearch(q, tag, 100)
	const result = searchQuery.data ?? null

	const detailQuery = useBrowseProductDetail(p)
	const detail = detailQuery.data ?? null

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

	// Tag facet badges — derived from loaded products' real categories
	const facetSet = (() => {
		if (!result || result.products.length === 0) return { all: 0, facets: [] as { label: string; count: number }[] }
		const counts = new Map<string, number>()
		for (const product of result.products) {
			for (const cat of product.categories ?? []) {
				counts.set(cat, (counts.get(cat) ?? 0) + 1)
			}
		}
		const facets = Array.from(counts.entries())
			.sort((a, b) => b[1] - a[1])
			.slice(0, 6)
			.map(([label, count]) => ({ label, count }))
		return { all: result.products.length, facets }
	})()

	// Empty state hints — real data only
	const EMPTY_HINTS = [{ label: 'local index empty' }]

	/** Whether we're in an idle state (no query active). */
	const isIdle = !q || q.trim() === ''

	const accountSlot = accountInitial ? <AccountChip initial={accountInitial} /> : null

	// Render — State machine
	// No query → idle with wall strips
	if (isIdle) {
		return (
			<>
				<ProductArtMount />
				<BrowseIdle
					query={q}
					onSearchChange={handleSearchChange}
					onSearchGo={handleSearchGo}
					stripsAbove={IDLE_STrips_ABOVE}
					stripsBelow={IDLE_STrips_BELOW}
					active={true}
					onNavigateHome={() => onNavigate({ q: '', p: undefined, tag: undefined })}
					onNavigateFeatured={onNavigateFeatured}
					accountSlot={accountSlot}
				/>
			</>
		)
	}

	const hasResults = !searchQuery.isLoading && (result?.products.length ?? 0) > 0

	// Relay indicator (always present under search when searching)
	const relayIndicator = <RelayIndicator responded={respondedCount} totalProducts={result?.products.length ?? 0} relays={relayDetails} />

	// The result cards — the grid's children in both layouts
	const cards: ReactNode = (result?.products ?? []).map((product) => (
		<ProductCard
			key={product.id}
			id={product.id}
			title={product.title}
			seller={product.pubkey.slice(0, 8)}
			sellerPubkey={product.pubkey}
			price={product.price}
			stockNote={typeof product.stock === 'string' ? product.stock : undefined}
			material={materialForPubkey(product.pubkey)}
			selected={p === product.id}
			onSelect={handleCardSelect}
			onThreeDots={() => handleMenuToggle(product.id)}
			onCopyLink={() => handleCopyLink(product.id)}
			menuOpen={menuOpenId === product.id}
		/>
	))

	/** The panel's read state, from the detail query. */
	const panelState: ProductDetailPanelState = detailQuery.isLoading ? 'loading' : detailQuery.isError ? 'error' : detail ? 'ready' : 'empty'

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

				{/* Tag facet badges — derived from search, narrow the result set */}
				{(result?.products.length ?? 0) > 0 && (
					<div className="mt-3 flex flex-wrap gap-2">
						{facetSet.facets.map((facet) => (
							<TagFilterBadge
								key={facet.label}
								label={facet.label}
								count={facet.count}
								active={tag === facet.label}
								onToggle={() => onNavigate({ q, p: undefined, tag: tag === facet.label ? undefined : facet.label })}
							/>
						))}
						<span className="text-xs text-text-mid ml-1 self-center">more</span>
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
					<EmptyStateBrowse query={q} hints={EMPTY_HINTS} />
				)}

				{/* Results — the plain grid, or the split view when a product is open */}
				{hasResults &&
					(p ? (
						<SplitView
							className="mt-5 h-[calc(100vh-10.5rem)] min-h-[520px]"
							master={<div className="grid grid-cols-1 sm:grid-cols-2 gap-y-5 gap-x-4.5">{cards}</div>}
							detail={
								<ProductDetailPanel
									state={panelState}
									product={
										detail
											? {
													id: detail.id,
													title: detail.title,
													seller: detail.pubkey.slice(0, 8),
													sellerNpub: elideNpub(detail.pubkey),
													location: detail.location,
													price: detail.price,
													stockNote: typeof detail.stock === 'string' ? detail.stock : undefined,
													description: detail.description || undefined,
													shipping: detail.shipping,
													material: materialForPubkey(detail.pubkey),
												}
											: undefined
									}
									menuOpen={menuOpenId === p}
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
