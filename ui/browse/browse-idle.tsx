/**
 * browse/browse-idle.tsx — The Browse idle screen.
 *
 * Frame `Glje8eeQGh__browse-idle-1440.html`:
 * - Hero: "The whole market, **one search**." with MotD and search pill
 * - CTAs: Browse products, Why Plebeian?, Post a listing (handoff stub)
 * - Two product-strip rows above and below the hero
 * - No veil — strips are clickable products
 *
 * Frame `ECglgpRxcl__browse-idle-390.html` (mobile):
 * - Compact nav, search + CTAs in a 2-column grid below the field
 * - No wall strips on mobile (screen too small)
 */

import type { FC, MouseEventHandler } from 'react'
import { cn } from '../utils/cn'
import { BrowseNav } from './browse-nav'
import { SearchField } from './search-field'
import { ProductStrip, type StripItem } from './product-strip'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface BrowseIdleProps {
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
 * 2. Hero: title + MotD + search pill + CTAs
 * 3. Product strips above and below the hero area
 *
 * Layout (390):
 * 1. Compact nav band
 * 2. Search field
 * 3. CTAs in 2-column grid
 * 4. No wall strips (screen too narrow)
 */
export const BrowseIdle: FC<BrowseIdleProps> = ({
	stripsAbove,
	stripsBelow,
	query,
	onSearchChange,
	onSearchGo,
	onBrowseProducts,
	onWhyPlebeian,
	onPostListing,
	active = true,
	onNavigateHome,
	onNavigateFeatured,
	accountSlot,
	className,
}) => {
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

			<main className="max-w-[1040px] mx-auto px-4 lg:px-6 py-4">
				{/* Hero section */}
				<section className="flex flex-col items-center py-8 lg:py-12">
					{/* Title — mobile truncates to one line */}
					<h1 className="text-center font-display text-3xl sm:text-4xl lg:text-5xl font-medium leading-tight tracking-tight text-text-high max-w-[600px]">
						The whole market, <span className="text-fill-ink italic">one search</span>.
					</h1>

					{/* MotD — mobile shows minimal */}
					<div
						data-slot="motd"
						data-testid="widget-browse-idle-motd"
						className="mt-5 flex items-baseline gap-3 text-sm text-text-mid max-w-[720px] text-center"
					>
						<span className="hidden sm:inline">3,418 items live from 611 sellers — 412 posted in the last 24 hours.</span>
						<span className="sm:hidden text-text-high font-medium">3,418 items</span>
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
							38 relays mirrored, live
						</span>
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

				{/* Product strip above the hero (desktop only) */}
				{stripsAbove && stripsAbove.length > 0 && (
					<section className="mb-6">
						<ProductStrip items={stripsAbove} onSelect={() => {}} />
					</section>
				)}

				{/* Product strip below the hero (desktop only) */}
				{stripsBelow && stripsBelow.length > 0 && (
					<section>
						<ProductStrip items={stripsBelow} onSelect={() => {}} />
					</section>
				)}
			</main>
		</div>
	)
}
