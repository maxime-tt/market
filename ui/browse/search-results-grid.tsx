/**
 * browse/search-results-grid.tsx — Search results grid and facet badges.
 *
 * Layout (1440): 3 columns, gap 26px 24px, 320px wide cards.
 * Layout (390): 2 columns, gap 14px 12px.
 *
 * Facet badges sit above the grid; each badge is a pill with label + count.
 * The "All" badge is always first and active when no tag filter is applied.
 */

import type { FC, ReactNode } from 'react'
import { cn } from '../utils/cn'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/** A single facet/tag badge. */
export interface FacetBadge {
	/** Display label. */
	label: string
	/** Product count under this facet. */
	count: number
	/** Whether this badge is the active filter. */
	active?: boolean
}

export interface SearchResultsGridProps {
	/** Facet badges derived from the search results. */
	facets?: readonly FacetBadge[]
	/** React content rendered as the grid body (ProductCard children). */
	children: ReactNode
	/** Extra classes for the root container. */
	className?: string
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Search results grid — facet badges above, grid of ProductCards below.
 *
 * Facet badges: horizontal strip of pills (All, Handmade, Pottery, …).
 * Grid: 3-column on desktop, 2-column on tablet/mobile.
 */
export const SearchResultsGrid: FC<SearchResultsGridProps> = ({ facets, children, className }) => {
	return (
		<div data-slot="search-results" data-testid="widget-search-results" className={cn('max-w-[960px] mx-auto px-4 lg:px-6', className)}>
			{/* Facet badges */}
			{facets && facets.length > 0 && (
				<div data-slot="facet-badges" data-testid="widget-facet-badges" className="mt-3 flex flex-wrap gap-2">
					{facets.map((badge) => (
						<span
							key={badge.label}
							data-slot="facet-badge"
							data-testid={`widget-facet-badge-${badge.label}`}
							data-active={badge.active}
							className={cn(
								'h-7',
								'px-3',
								'rounded-full',
								'flex',
								'items-center',
								'gap-1.75',
								'text-xs',
								'whitespace-nowrap',
								'cursor-default',
								badge.active
									? 'bg-fill-ink border-fill-ink text-on-fill-ink'
									: 'border-border-default text-text-mid',
							)}
						>
							{badge.label}
							<b className="font-normal opacity-60 tabular-nums">{badge.count.toLocaleString()}</b>
						</span>
					))}
				</div>
			)}

			{/* Grid of product cards — 3 cols desktop, 2 cols tablet */}
			<div
				data-slot="results-grid"
				data-testid="widget-results-grid"
				className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 mt-5"
			>
				{children}
			</div>
		</div>
	)
}
