/**
 * browse/skeleton-grid.tsx — Loading skeleton for the results grid.
 *
 * Frame `TbNMXxJ2Zc__state-loading-skeleton-grid-1440.html`:
 * - Shimmering skeleton placeholders for each card in the grid
 * - Each card: shot (gradient shimmer), seller bar, title bar, price bar
 * - Facet badges hidden during loading
 * - Animated shimmer: `background-position: 130% → -130%` over 1.6s linear infinite
 * - Skeleton avatars: grey circles with per-card tinted hues
 * - 3-column grid (1440), 2-col (tablet), 1-col (mobile)
 */

import type { FC } from 'react'
import { cn } from '../utils/cn'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SkeletonGridProps {
	/** Number of skeleton rows (cards) to render. */
	rows?: number
	/** Grid columns. Defaults to 3. */
	columns?: number
	/** Extra classes for the root. */
	className?: string
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Results grid skeleton — shimmering placeholders that keep the card layout.
 *
 * Each skeleton card:
 * 1. Shot placeholder (gradient shimmer, aspect-3/2, rounded-6)
 * 2. Seller row placeholder (grey circle + bar)
 * 3. Title placeholder (bar)
 * 4. Price row placeholder (two bars)
 */
export const SkeletonGrid: FC<SkeletonGridProps> = ({ rows = 8, columns = 3, className }) => {
	return (
		<div className={cn('max-w-[1120px] mx-auto', className)}>
			{/* Facets hidden during loading */}
			<div className="visibility-hidden mb-4" aria-hidden="true" />

			<div
				className={cn(
					'grid',
					columns === 1 && 'grid-cols-1',
					columns === 2 && 'grid-cols-2',
					columns === 3 && 'grid-cols-3',
					columns === 4 && 'grid-cols-4',
					'gap-[20px]',
					'mt-4',
				)}
			>
				{Array.from({ length: rows }, (_, i) => (
					<SkeletonCard key={i} cardIndex={i} />
				))}
			</div>
		</div>
	)
}

// ---------------------------------------------------------------------------
// Skeleton card — single card placeholder
// ---------------------------------------------------------------------------

const SkeletonCard: FC<{ cardIndex: number }> = ({ cardIndex }) => {
	// Per-card tinted circle hue — matches frame pattern
	const circleHues = ['oklch(0.72 0.06 60)', 'oklch(0.7 0.06 200)', 'oklch(0.74 0.07 320)', 'oklch(0.7 0.05 150)']
	const circleHue = circleHues[cardIndex % circleHues.length]

	return (
		<div
			data-slot="skeleton-card"
			data-testid={`widget-skeleton-card-${cardIndex}`}
			className={cn('border-t border-border-strong', 'pt-3')}
		>
			{/* Shot placeholder — shimmer gradient */}
			<div
				data-slot="skeleton-shot"
				className={cn(
					'relative',
					'aspect-[3/2]',
					'rounded-[6px]',
					'overflow-hidden',
					'border',
					'border-border-default',
					'animate-skeleton-shimmer',
				)}
			/>

			{/* Seller row — tinted circle + name bar */}
			<div className="mt-[11px] flex items-center gap-1.5">
				<div
					className={cn('size-3.5', 'rounded-full', 'shrink-0', 'bg-surface-sunken')}
					style={{ backgroundColor: circleHue }}
					aria-hidden="true"
				/>
				<div
					data-slot="skeleton-seller-bar"
					className={cn('h-[9px]', 'rounded', 'w-[38%]', 'flex-1', 'bg-surface-sunken', 'animate-skeleton-shimmer')}
				/>
			</div>

			{/* Title placeholder */}
			<div
				data-slot="skeleton-title"
				className={cn('mt-[5px]', 'h-[13px]', 'rounded', 'w-[74%]', 'bg-surface-sunken', 'animate-skeleton-shimmer')}
			/>

			{/* Price row — sats + stock */}
			<div className="mt-[10px] flex items-center justify-between gap-2.5 pt-2.5 border-t border-border-default">
				<div
					data-slot="skeleton-price"
					className={cn('h-[11px]', 'rounded', 'w-[66px]', 'bg-surface-sunken', 'animate-skeleton-shimmer')}
				/>
				<div
					data-slot="skeleton-stock"
					className={cn('h-[11px]', 'rounded', 'w-[50px]', 'bg-surface-sunken', 'animate-skeleton-shimmer')}
				/>
			</div>
		</div>
	)
}
