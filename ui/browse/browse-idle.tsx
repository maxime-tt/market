/**
 * browse/browse-idle.tsx — The Browse idle screen.
 *
 * Frame `Glje8eeQGh__browse-idle-1440.html`:
 * - Hero: "The whole market, **one search**." with MotD and search pill
 * - CTAs: Browse products, Why Plebeian?, Post a listing (handoff stub)
 * - One full-bleed product strip above the title block and one below it, at
 *   full contrast, no veil — the strips are clickable products
 * - The band is full-bleed; the hero inside it is the frame's centred ~800px
 *   column (`.hero-in{ width:800px }`)
 *
 * Frame `ECglgpRxcl__browse-idle-390.html` (mobile):
 * - Compact nav, search + CTAs in a 2-column grid below the field
 * - The strips stay: they are the same full-bleed band, and the loop is what
 *   makes a narrow viewport work
 */

import type { FC, MouseEventHandler } from 'react'
import { cn } from '../utils/cn'
import { BrowseNav } from './browse-nav'
import { SearchField } from './search-field'
import { ProductStrip, type StripItem } from './product-strip'

// ---------------------------------------------------------------------------
// Hero stats — measured facts, never placeholders
// ---------------------------------------------------------------------------

/**
 * What the hero line may state. Every field is optional, and a field that is
 * absent renders nothing at all.
 *
 * These are *not* market totals: the Browse read is a bounded kind-30402 set,
 * so each number describes what this view loaded. The wording built by
 * {@link describeIdleStats} says so ("items loaded") instead of keeping the
 * frame's market-wide placeholder copy over a different fact.
 */
export interface BrowseIdleStats {
	/** Listings the read loaded into this view. */
	products?: number
	/** Distinct authors among those listings. */
	sellers?: number
	/** Listings among them published in the last 24 hours. */
	postedLast24h?: number
	/** Relays the read queried (answered plus still pending). */
	relays?: number
}

/** Thousands-separated count. `en-US` is pinned so the copy is locale-stable. */
export function formatIdleCount(value: number): string {
	return value.toLocaleString('en-US')
}

/**
 * The hero line fragments for a stats record — the headline fragments first,
 * then the relay fragment. Absent values contribute nothing; an empty record
 * yields an empty array and the hero shows no numbers.
 */
export function describeIdleStats(stats: BrowseIdleStats | undefined): { headline: string[]; relays?: string } {
	if (!stats) return { headline: [] }

	const headline: string[] = []
	const { products, sellers, postedLast24h } = stats
	const items = (n: number) => `${formatIdleCount(n)} item${n === 1 ? '' : 's'}`
	const sellerCount = (n: number) => `${formatIdleCount(n)} seller${n === 1 ? '' : 's'}`

	if (products !== undefined && sellers !== undefined) {
		headline.push(`${items(products)} loaded from ${sellerCount(sellers)}`)
	} else if (products !== undefined) {
		headline.push(`${items(products)} loaded`)
	} else if (sellers !== undefined) {
		headline.push(`${sellerCount(sellers)} in this view`)
	}

	if (postedLast24h !== undefined) {
		headline.push(`${formatIdleCount(postedLast24h)} posted in the last 24 hours`)
	}

	return {
		headline,
		relays: stats.relays !== undefined ? `${formatIdleCount(stats.relays)} relay${stats.relays === 1 ? '' : 's'} queried` : undefined,
	}
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface BrowseIdleProps {
	/**
	 * Measured hero facts (loaded items, sellers among them, 24h postings,
	 * relays queried). Omit a field and its fragment disappears; omit the whole
	 * record and the hero shows no numbers.
	 */
	stats?: BrowseIdleStats
	/** Product strip items above the hero. */
	stripsAbove?: readonly StripItem[]
	/** Product strip items below the hero. */
	stripsBelow?: readonly StripItem[]
	/** Current search query. */
	query: string
	/** Search query change handler. */
	onSearchChange: (value: string) => void
	/** Search submit handler. */
	onSearchGo: () => void
	/** Callback when Browse products is clicked. */
	onBrowseProducts?: () => void
	/**
	 * Callback when an idle-wall tile is clicked — the tile's product id, which
	 * the host resolves into the open product (`?p=`).
	 */
	onSelectProduct?: (id: string) => void
	/** Callback when Why Plebeian? is clicked. */
	onWhyPlebeian?: () => void
	/** Callback when Post a listing is clicked (handoff stub). */
	onPostListing?: () => void
	/** Whether the wordmark link is active. */
	active?: boolean
	/** Callback when wordmark is clicked. */
	onNavigateHome?: () => void
	/** Callback when Featured link is clicked. */
	onNavigateFeatured?: () => void
	/** Account slot (avatar/identity). */
	accountSlot?: React.ReactNode
	/** Extra classes for the root. */
	className?: string
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Browse idle screen — the landing state when no search is active.
 *
 * Layout (1440):
 * 1. Nav bar (wordmark, Featured, search, account)
 * 2. Full-bleed product strip above the title block
 * 3. Hero: title + MotD + search pill + CTAs, in the centred 800px column
 * 4. Full-bleed product strip below the title block
 *
 * Layout (390):
 * 1. Compact nav band
 * 2. The same strips, full-bleed
 * 3. Search field
 * 4. CTAs in 2-column grid
 */
export const BrowseIdle: FC<BrowseIdleProps> = ({
	stats,
	stripsAbove,
	stripsBelow,
	query,
	onSearchChange,
	onSearchGo,
	onBrowseProducts,
	onSelectProduct,
	onWhyPlebeian,
	onPostListing,
	active = true,
	onNavigateHome,
	onNavigateFeatured,
	accountSlot,
	className,
}) => {
	const heroStats = describeIdleStats(stats)
	// Mobile is one short line: the item count when we have it, else the first
	// fragment the desktop line leads with.
	const mobileHeadline = stats?.products !== undefined ? `${formatIdleCount(stats.products)} items` : (heroStats.headline[0] ?? '')

	const handleBrowseClick: MouseEventHandler = (e) => {
		e.preventDefault()
		onBrowseProducts?.()
	}

	const handleWhyClick: MouseEventHandler = (e) => {
		e.preventDefault()
		onWhyPlebeian?.()
	}

	const handlePostClick: MouseEventHandler = (e) => {
		e.preventDefault()
		onPostListing?.()
	}

	return (
		<div className={cn('min-h-screen bg-background', className)}>
			<BrowseNav
				active={active}
				onNavigateHome={onNavigateHome}
				onNavigateFeatured={onNavigateFeatured}
				searchSlot={<SearchField value={query} onChange={onSearchChange} onGo={onSearchGo} />}
				accountSlot={accountSlot}
			/>

			{/*
			 * The band is full-bleed and its content is not: the strips span the
			 * viewport edge to edge (frame `.wall{ inset:0 }`), while the hero keeps
			 * the frame's centred ~800px column (`.hero-in{ width:800px }`).
			 */}
			<main className="w-full py-4">
				{/* Product strip above the title block — full-bleed, drifting left */}
				{stripsAbove && stripsAbove.length > 0 && (
					<section data-slot="browse-strip-above" className="w-full">
						<ProductStrip items={stripsAbove} onSelect={onSelectProduct} />
					</section>
				)}

				{/* Hero section — the frame's centred ~800px column inside the band */}
				<section className="mx-auto flex w-full max-w-[800px] flex-col items-center px-4 py-8 lg:py-12">
					{/* Title — mobile truncates to one line */}
					<h1 className="text-center font-display text-3xl sm:text-4xl lg:text-5xl font-medium leading-tight tracking-tight text-text-high max-w-[600px]">
						The whole market, <span className="text-fill-ink italic">one search</span>.
					</h1>

					{/* MotD — measured facts only; absent stats render no numbers */}
					<div
						data-slot="motd"
						data-testid="widget-browse-idle-motd"
						className="mt-5 flex items-baseline gap-3 text-sm text-text-mid max-w-[720px] text-center"
					>
						{heroStats.headline.length > 0 && (
							<>
								<span className="hidden sm:inline">{heroStats.headline.join(' — ')}</span>
								<span className="sm:hidden text-text-high font-medium">{mobileHeadline}</span>
							</>
						)}
						{heroStats.relays && (
							<span className="ml-auto hidden md:inline-flex items-center gap-1.5 text-xs font-variant-numeric-tabular-nums">
								<svg
									className="size-3 text-text-mid"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
									aria-hidden="true"
								>
									<path d="M12 2v4m0 12v4M2 12h4m12 0h4" strokeLinecap="round" />
								</svg>
								{heroStats.relays}
							</span>
						)}
					</div>

					{/* CTAs — stacked on mobile, inline on desktop */}
					<div data-slot="ctas" data-testid="widget-browse-idle-ctas" className="mt-6 flex flex-wrap justify-center gap-3">
						<button
							type="button"
							data-slot="cta-browse"
							data-testid="widget-browse-idle-cta-browse"
							className={cn(
								'h-11',
								'px-6',
								'rounded',
								'bg-fill-ink',
								'text-on-fill-ink',
								'sm:text-sm',
								'font-medium',
								'flex',
								'items-center',
								'gap-2.5',
								'cursor-pointer',
								'transition-colors',
								'hover:bg-fill-ink-hover',
							)}
							onClick={handleBrowseClick}
						>
							Browse products
							<svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
								<path d="M12 5v14M6 13l6 6 6-6" strokeLinecap="round" />
							</svg>
						</button>
						<button
							type="button"
							data-slot="cta-why"
							data-testid="widget-browse-idle-cta-why"
							className={cn(
								'h-11',
								'px-6',
								'rounded',
								'border',
								'border-border-strong',
								'text-text-high',
								'sm:text-sm',
								'font-medium',
								'cursor-pointer',
								'transition-colors',
								'hover:bg-surface-sunken',
							)}
							onClick={handleWhyClick}
						>
							Why Plebeian?
						</button>
						<button
							type="button"
							data-slot="cta-post"
							data-testid="widget-browse-idle-cta-post"
							className={cn(
								'h-11',
								'px-6',
								'rounded',
								'bg-fill-accent',
								'text-on-fill-accent',
								'sm:text-sm',
								'font-medium',
								'flex',
								'items-center',
								'gap-2.5',
								'cursor-pointer',
								'transition-colors',
							)}
							onClick={handlePostClick}
						>
							Post a listing
							<svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
								<path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" />
							</svg>
						</button>
					</div>
				</section>

				{/* Product strip below the title block — full-bleed, drifting the other way */}
				{stripsBelow && stripsBelow.length > 0 && (
					<section data-slot="browse-strip-below" className="w-full">
						<ProductStrip items={stripsBelow} onSelect={onSelectProduct} reverse />
					</section>
				)}
			</main>
		</div>
	)
}
