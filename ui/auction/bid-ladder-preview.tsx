import type { Ref } from 'react'
import { cn } from '../utils/cn'

/**
 * Bid-ladder preview — sats-only view of the price progression. The
 * companion timeline preview (which includes the anti-snipe curve)
 * now lives inside `AntiSnipeCurveSettings`, since that's the card
 * where its inputs are. Keeping the ladder lean lets sellers reason
 * about the bid-amount mechanics without the timing axis muddling it.
 *
 * T6.3 S3: lifted verbatim out of `ui/components/auction-editor/AuctionEditorTabs.tsx`
 * (where it was `BidLadderViz`) and given the `className`/`ref` contract from
 * `ui/AGENTS.md`. The rename is the only consumer-visible change; no markup,
 * class or behaviour line differs.
 */

export interface BidLadderPreviewProps {
	startingBid: number
	bidIncrement: number
	reserve: number
	className?: string
	ref?: Ref<HTMLDivElement>
}

export function BidLadderPreview({ startingBid, bidIncrement, reserve, className, ref }: BidLadderPreviewProps) {
	const validStart = Number.isFinite(startingBid) && startingBid >= 0
	const validInc = Number.isFinite(bidIncrement) && bidIncrement > 0

	if (!validStart || !validInc) {
		return (
			<div
				ref={ref}
				className={cn('rounded-lg border border-dashed border-border-default bg-surface-sunken px-4 py-3 text-xs text-text-mid', className)}
			>
				Enter a starting bid and bid increment to preview the bid ladder.
			</div>
		)
	}

	const hasReserve = Number.isFinite(reserve) && reserve > startingBid
	const bidsToReserve = hasReserve ? Math.ceil((reserve - startingBid) / bidIncrement) : 0
	const maxTicks = 24
	const tickCount = hasReserve ? Math.min(bidsToReserve, maxTicks) : 0

	return (
		<div ref={ref} className={cn('rounded-lg border border-border-default bg-surface-raised px-4 py-4', className)}>
			<p className="text-2xs font-semibold uppercase tracking-wide text-text-mid">Bid ladder preview</p>

			<div className="relative mt-3 h-12 rounded-md bg-gradient-to-r from-success-muted via-warning-muted to-warning-muted">
				{Array.from({ length: tickCount }).map((_, i) => (
					<div
						key={i}
						className="absolute top-2 bottom-2 w-px bg-surface-hover/70"
						style={{ left: `${((i + 1) / (tickCount + 1)) * 100}%` }}
					/>
				))}
				<div className="absolute left-0 top-0 bottom-0 w-1.5 rounded-l-md bg-success" />
				{hasReserve && <div className="absolute right-0 top-0 bottom-0 w-1.5 rounded-r-md bg-warning" />}
			</div>

			<div className="mt-3 flex items-end justify-between gap-4 text-xs">
				<div>
					<p className="font-semibold text-success-foreground">{startingBid.toLocaleString()} sats</p>
					<p className="text-text-mid">Starting bid</p>
				</div>
				<div className="text-center">
					<p className="font-semibold text-text-high">+{bidIncrement.toLocaleString()}</p>
					<p className="text-text-mid">per bid</p>
				</div>
				{hasReserve ? (
					<div className="text-right">
						<p className="font-semibold text-warning-foreground">{reserve.toLocaleString()} sats</p>
						<p className="text-text-mid">Reserve</p>
					</div>
				) : (
					<div className="text-right">
						<p className="font-semibold text-text-mid">No reserve</p>
						<p className="text-text-mid">Highest bid wins</p>
					</div>
				)}
			</div>

			{hasReserve && (
				<p className="mt-3 text-xs text-text-mid">
					<span className="font-semibold text-text-high">{bidsToReserve}</span> bid{bidsToReserve === 1 ? '' : 's'} of{' '}
					<span className="font-semibold text-text-high">{bidIncrement.toLocaleString()} sats</span> needed to clear the reserve.
				</p>
			)}
		</div>
	)
}
