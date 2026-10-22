import type { Ref } from 'react'
import { cn } from '../utils/cn'

/**
 * Auction overview presentations, lifted out of the dashboard auctions route
 * (`platform/web/routes/_dashboard-layout/dashboard/products/auctions.tsx`).
 *
 * The route is an assembler and must not define components. This module holds
 * the presentational pieces the overview needs; anything that acquires data (the
 * store selector and the comments/live-chat/claim-order queries) stays in the
 * host and arrives as props.
 *
 * Declared visible changes: raw `pink-600` becomes `text-primary` for the "N New"
 * highlight, and the host's `STATUS_BADGE_STYLES` map is replaced by the shared
 * `AuctionStatusBadge` tone map.
 */

export interface AuctionActivityRowProps {
	/** Row label, e.g. "Bids". */
	header: string
	/** Singular unit; the plural is derived (`1 Bid` / `2 Bids`). */
	unit: string
	count: number
	/** Items seen since the last visit; renders a "N New" highlight when positive. */
	newCount: number
	className?: string
	ref?: Ref<HTMLDivElement>
}

/** One line of the auction's activity summary (bids, comments, live chat). */
export function AuctionActivityRow({ header, unit, count, newCount, className, ref }: AuctionActivityRowProps) {
	return (
		<div ref={ref} data-slot="auction-activity-row" className={cn('space-y-0.5', className)}>
			<p className="text-xs text-muted-foreground">{header}</p>
			<p className="text-sm">
				<span className="font-semibold">
					{count} {count === 1 ? unit : `${unit}s`}
				</span>
				{newCount > 0 && <span className="ml-2 font-semibold text-primary">{newCount} New</span>}
			</p>
		</div>
	)
}
