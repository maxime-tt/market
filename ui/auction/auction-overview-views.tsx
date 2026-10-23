import type { Ref } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../primitives/select'
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
			<p className="text-xs text-text-mid">{header}</p>
			<p className="text-sm">
				<span className="font-semibold">
					{count} {count === 1 ? unit : `${unit}s`}
				</span>
				{newCount > 0 && <span className="ml-2 font-semibold text-primary">{newCount} New</span>}
			</p>
		</div>
	)
}

export interface AuctionSortOptionItem {
	value: string
	label: string
}

export interface AuctionSortSelectProps {
	/** Currently selected option value. */
	value: string
	onValueChange: (value: string) => void
	/** Options in render order; the host derives them from the domain helper. */
	options: AuctionSortOptionItem[]
	/** The header instance is `w-56`, the mobile block `w-full`. */
	triggerClassName?: string
	placeholder?: string
	className?: string
	ref?: Ref<HTMLButtonElement>
}

/**
 * The list's ordering control. Lifted out of the dashboard auctions route, which
 * may not import `@ui/primitives/*`; the option list arrives as props so the
 * domain helper that names them stays in the host.
 */
export function AuctionSortSelect({
	value,
	onValueChange,
	options,
	triggerClassName,
	placeholder = 'Order By',
	className,
	ref,
}: AuctionSortSelectProps) {
	return (
		<Select value={value} onValueChange={onValueChange}>
			<SelectTrigger ref={ref} className={cn(triggerClassName, className)}>
				<SelectValue placeholder={placeholder} />
			</SelectTrigger>
			<SelectContent>
				{options.map((option) => (
					<SelectItem key={option.value} value={option.value}>
						{option.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	)
}
