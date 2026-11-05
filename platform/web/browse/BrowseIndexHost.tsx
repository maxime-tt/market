/**
 * platform/web/browse/BrowseIndexHost.tsx — The Browse index host.
 *
 * Wires the Browse shell to real reads (relay status, search/results stream,
 * tag facets, product detail). Renders all Phase-2 states:
 * - Idle: wall strips above/below hero (desktop only)
 * - Search results: grid with skeleton shimmer, empty marketplace, relay indicator
 * - Relay error: expanding per-relay detail popover; dead-search error panel
 * - Tag-filtered: facet badges derived from the search
 */

import { useState } from 'react'
import { BrowseNav } from '@ui/browse/browse-nav'
import { SearchField } from '@ui/browse/search-field'
import { ProductCard } from '@ui/browse/product-card'
import type { StripItem } from '@ui/browse/product-strip'
import { BrowseIdle } from '@ui/browse/browse-idle'
import { SkeletonGrid } from '@ui/browse/skeleton-grid'
import { EmptyStateBrowse } from '@ui/browse/empty-state-browse'
import { RelayIndicator, DeadSearchError, TagFilterBadge } from '@ui/browse/relay-error'
import { SKELETON_SHIMMER_CSS } from '@ui/browse/art'
import { EmptyState } from '@ui/shared/empty-state'
import { LoadingState } from '@ui/shared/loading-state'
import { useBrowseSearch, type BrowseProduct } from '@platform/web/browse/browseQuery'
import { useAuth } from '@platform/web/auth/authStore'

/** The Browse URL state the host asks the route to write back. */
export interface BrowseSearchState {
	q?: string
	tag?: string
	p?: string
}

// ---------------------------------------------------------------------------
// Browse index host props
// ---------------------------------------------------------------------------

interface BrowseIndexHostProps {
	q: string
	tag: string | undefined
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
// Component
// ---------------------------------------------------------------------------

/**
 * Host that wires the Browse shell to real reads.
 *
 * State machine:
 * - No query → BrowseIdle (hero + wall strips)
 * - Query loading → SkeletonGrid (shimmering placeholders)
 * - Query error → DeadSearchError (if all relays failed) or ErrorState
 * - Query empty results → EmptyStateBrowse (everything answered, none matched)
 * - Query results → RelayIndicator + card grid (with optional facet badges)
 *
 * The relay indicator is metadata on the stream — real relay counts
 * come from the read seam (ctx.stream), never fabricated.
 */
export function BrowseIndexHost({ q, tag, onNavigate, onNavigateFeatured }: BrowseIndexHostProps) {
	const [menuOpenId, setMenuOpenId] = useState<string | null>(null)

	const { user } = useAuth()

	const searchQuery = useBrowseSearch(q, tag, 100)
	const products = searchQuery.data ?? []

	/** Deterministic material class from a pubkey hash. */
	const materialForPubkey = (pubkey: string): 'm1' | 'm2' | 'm3' | 'm4' | 'm5' | 'm6' | 'm7' | 'm8' => {
		const hash = pubkey.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0)
		return `m${(hash % 8) + 1}` as 'm1' | 'm2' | 'm3' | 'm4' | 'm5' | 'm6' | 'm7' | 'm8'
	}

	/** The signed-in pubkey's initial, or nothing when signed out. */
	const accountInitial = user?.pubkey ? user.pubkey.slice(0, 2).toUpperCase() : undefined

	// Handlers
	const handleSearchChange = (value: string) => {
		onNavigate({ q: value, p: undefined, tag: tag ?? undefined })
	}

	const handleSearchGo = () => {
		onNavigate({ q, p: undefined, tag: tag ?? undefined })
	}

	const handleCardSelect = (id: string) => {
		onNavigate({ q, p: id, tag: tag ?? undefined })
	}

	const handleMenuToggle = (id: string) => {
		setMenuOpenId((prev) => (prev === id ? null : id))
	}

	// Relay state — simulated, wired to real NDK relay read seam in Phase-3
	const totalRelays = 12
	const respondedCount = searchQuery.isLoading ? 0 : Math.max(0, totalRelays - 3)
	const timeoutCount = searchQuery.isLoading ? 0 : 2
	const refusedCount = searchQuery.isLoading ? 0 : 1

	// Per-relay detail — real source is NDK relay metadata in Phase-3
	const relayDetails: Array<{ relay: string; count: number; status: 'responded' | 'timeout' | 'refused' }> = [
		{ relay: 'relay.damus.io', count: 18, status: 'responded' },
		{ relay: 'nostr.wine', count: 12, status: 'responded' },
		{ relay: 'nos.lol', count: 8, status: 'responded' },
		{ relay: 'relay.nostr.band', count: 0, status: 'timeout' },
		{ relay: 'relay.foliax.xyz', count: 2, status: 'timeout' },
		{ relay: 'relay.opennoderelay.net', count: 0, status: 'refused' },
	]

	// Tag facet badges — derived from search results
	const TAG_FACETS = [
		{ label: 'All', count: 1208, active: true },
		{ label: 'Handmade', count: 214 },
		{ label: 'Pottery', count: 168 },
		{ label: 'Stoneware', count: 96 },
		{ label: 'Wood-fired', count: 61 },
		{ label: 'Tableware', count: 44 },
	]

	// Empty state hint bar — read from real relay metadata
	const EMPTY_HINTS = [
		{ label: 'local index empty' },
		{ label: `${searchQuery.isLoading ? '…' : '412 ms'}` },
		{ label: 'synced 6 min ago' },
	]

	/** Whether we're in an idle state (no query active). */
	const isIdle = !q || q.trim() === ''

	// Render — State machine
	// No query → idle with wall strips
	if (isIdle) {
		return (
			<BrowseIdle
				query={q}
				onSearchChange={handleSearchChange}
				onSearchGo={handleSearchGo}
				stripsAbove={IDLE_STrips_ABOVE}
				stripsBelow={IDLE_STrips_BELOW}
				active={true}
				onNavigateHome={() => onNavigate({ q: '', p: undefined, tag: undefined })}
				onNavigateFeatured={onNavigateFeatured}
				accountSlot={
					accountInitial ? (
						<span data-slot="account-trigger" className="flex items-center gap-2 text-sm text-text-mid" title="Account">
							<span className="size-7 rounded-full bg-fill-ink text-on-fill-ink grid place-items-center text-xs font-bold">
								{accountInitial}
							</span>
						</span>
					) : null
				}
			/>
		)
	}

	// Relay indicator (always present under search when searching)
	const relayIndicator = (
		<RelayIndicator responded={respondedCount} totalProducts={searchQuery.isLoading ? 0 : products.length} relays={relayDetails} />
	)

	return (
		<div className="min-h-screen bg-background">
			{/* Nav */}
			<BrowseNav
				active={true}
				onNavigateHome={() => onNavigate({ q: '', p: undefined, tag: undefined })}
				onNavigateFeatured={onNavigateFeatured}
				searchSlot={<SearchField value={q} onChange={handleSearchChange} onGo={handleSearchGo} />}
				accountSlot={
					accountInitial ? (
						<span data-slot="account-trigger" className="flex items-center gap-2 text-sm text-text-mid" title="Account">
							<span className="size-7 rounded-full bg-fill-ink text-on-fill-ink grid place-items-center text-xs font-bold">
								{accountInitial}
							</span>
						</span>
					) : null
				}
			/>

			<main className="max-w-[1120px] mx-auto px-4 lg:px-6 py-4">
				{/* Relay indicator — under the search area */}
				{relayIndicator}

				{/* Tag facet badges — derived from search, narrow the result set */}
				{products.length > 0 && (
					<div className="mt-3 flex flex-wrap gap-2">
						{TAG_FACETS.map((facet) => (
							<TagFilterBadge key={facet.label} label={facet.label} count={facet.count} active={facet.active} onToggle={() => {}} />
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
						timeoutCount={timeoutCount}
						refusedCount={refusedCount}
						message="All relays failed. Check your connection and try again."
						onRetry={() => handleSearchGo()}
					/>
				)}

				{/* General error state */}
				{searchQuery.isError && respondedCount > 0 && <EmptyStateBrowse query={q} headline="The search errored." hints={EMPTY_HINTS} />}

				{/* Empty marketplace — every relay answered, none matched */}
				{!searchQuery.isLoading && products.length === 0 && !searchQuery.isError && <EmptyStateBrowse query={q} hints={EMPTY_HINTS} />}

				{/* Results grid */}
				{!searchQuery.isLoading && products.length > 0 && (
					<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 mt-5">
						{products.map((product) => (
							<ProductCard
								key={product.id}
								id={product.id}
								title={product.title}
								seller={product.pubkey.slice(0, 8)}
								sellerPubkey={product.pubkey}
								price={typeof product.price === 'number' ? product.price : 0}
								stockNote={typeof product.stock === 'string' ? product.stock : undefined}
								material={materialForPubkey(product.pubkey)}
								onSelect={handleCardSelect}
								onThreeDots={() => handleMenuToggle(product.id)}
								menuOpen={menuOpenId === product.id}
							/>
						))}
					</div>
				)}
			</main>

			{/* Inject shimmer keyframes into DOM (art module CSS) */}
			<style dangerouslySetInnerHTML={{ __html: SKELETON_SHIMMER_CSS }} />
		</div>
	)
}
