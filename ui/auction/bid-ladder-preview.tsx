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
				className={cn('rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-4 py-3 text-xs text-zinc-500', className)}
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
		<div ref={ref} className={cn('rounded-lg border border-zinc-200 bg-white px-4 py-4', className)}>
			<p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Bid ladder preview</p>

			<div className="relative mt-3 h-12 rounded-md bg-gradient-to-r from-emerald-100 via-amber-50 to-amber-100">
				{Array.from({ length: tickCount }).map((_, i) => (
					<div key={i} className="absolute top-2 bottom-2 w-px bg-zinc-400/70" style={{ left: `${((i + 1) / (tickCount + 1)) * 100}%` }} />
				))}
				<div className="absolute left-0 top-0 bottom-0 w-1.5 rounded-l-md bg-emerald-500" />
				{hasReserve && <div className="absolute right-0 top-0 bottom-0 w-1.5 rounded-r-md bg-amber-500" />}
			</div>

			<div className="mt-3 flex items-end justify-between gap-4 text-xs">
				<div>
					<p className="font-semibold text-emerald-700">{startingBid.toLocaleString()} sats</p>
					<p className="text-zinc-500">Starting bid</p>
				</div>
				<div className="text-center">
					<p className="font-semibold text-zinc-900">+{bidIncrement.toLocaleString()}</p>
					<p className="text-zinc-500">per bid</p>
				</div>
				{hasReserve ? (
					<div className="text-right">
						<p className="font-semibold text-amber-700">{reserve.toLocaleString()} sats</p>
						<p className="text-zinc-500">Reserve</p>
					</div>
				) : (
					<div className="text-right">
						<p className="font-semibold text-zinc-600">No reserve</p>
						<p className="text-zinc-500">Highest bid wins</p>
					</div>
				)}
			</div>

			{hasReserve && (
				<p className="mt-3 text-xs text-zinc-600">
					<span className="font-semibold text-zinc-900">{bidsToReserve}</span> bid{bidsToReserve === 1 ? '' : 's'} of{' '}
					<span className="font-semibold text-zinc-900">{bidIncrement.toLocaleString()} sats</span> needed to clear the reserve.
				</p>
			)}
		</div>
	)
}
