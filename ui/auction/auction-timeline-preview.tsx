import type { Ref } from 'react'
import { cn } from '../utils/cn'
import { formatAbsoluteCompact } from '../utils/duration'

/**
 * Time-axis preview embedded in the anti-snipe card.
 *
 * **Symbolic, NOT proportional x-axis.** Realistic auctions have a
 * 24-hour bidding window and a 30-minute curve — a strictly
 * proportional chart squashes the curve into a sliver. We use fixed
 * segment widths:
 *   - flat phase `[start_at, end_at]`    → 35 % (or 60 % when no window)
 *   - curve phase `[end_at, max_end_at]` → 40 % (collapsed to 0 when window=0)
 *   - locktime phase `[max_end_at, locktime]` → 25 % (or 40 % when no window)
 *
 * The chart is for shape recognition ("there's a steep ramp at the
 * end"), not precise time-magnitude. Absolute times appear inline
 * above the chart at each tick.
 *
 * **Baseline pick** (AUCTIONS.md §6.1 — `top_bid + bid_increment`):
 * the form has no live top bid, so we substitute
 * `previewTopBid = max(reserve, starting_bid)`. Reserve is the
 * seller's own hint at where the auction is expected to land —
 * using it gives a realistic preview (a 10× of a 70 000-sat reserve
 * is 700 010 sats; a 10× of a 10-sat starting bid is a meaningless
 * 100 sats). Falls back to starting_bid when no reserve.
 *
 * T6.3 S3: lifted verbatim out of `ui/components/auction-editor/AuctionEditorTabs.tsx`
 * and given the `className`/`ref` contract from `ui/AGENTS.md`. Markup, classes
 * and geometry are unchanged.
 */

export interface AuctionTimelinePreviewProps {
	startingBid: number
	bidIncrement: number
	reserve: number
	curveShape: 'none' | 'linear' | 'exponential'
	curvePeakMultiplier: number
	startAtSeconds: number
	endAtSeconds: number
	maxEndAtSeconds: number
	settlementGraceSeconds: number
	showCurve: boolean
	className?: string
	ref?: Ref<HTMLDivElement>
}

export function AuctionTimelinePreview({
	startingBid,
	bidIncrement,
	reserve,
	curveShape,
	curvePeakMultiplier,
	startAtSeconds,
	endAtSeconds,
	maxEndAtSeconds,
	settlementGraceSeconds,
	showCurve,
	className,
	ref,
}: AuctionTimelinePreviewProps) {
	if (!endAtSeconds || !startAtSeconds) {
		return (
			<div
				ref={ref}
				className={cn('mt-3 rounded-md border border-dashed border-zinc-300 bg-zinc-50 px-3 py-2 text-[11px] text-zinc-500', className)}
			>
				Pick an end time to preview the bidding timeline.
			</div>
		)
	}

	// Baseline = (preview top + bid_increment) — see comment block above.
	const hasReserve = reserve > startingBid
	const previewTopBid = hasReserve ? reserve : startingBid
	const baseline = Math.max(1, previewTopBid + bidIncrement)
	const peakMultiplier = showCurve ? curvePeakMultiplier : 1
	const peakFloor = Math.ceil(baseline * peakMultiplier)

	const lockTimeSeconds = maxEndAtSeconds + settlementGraceSeconds
	const hasWindow = maxEndAtSeconds > endAtSeconds

	// Symbolic segment widths (percent of chart width). When no anti-snipe
	// window, the middle segment collapses and the other two grow to fill.
	const flatPct = hasWindow ? 35 : 60
	const curvePct = hasWindow ? 40 : 0
	const lockPct = hasWindow ? 25 : 40
	const endX = flatPct
	const maxEndX = flatPct + curvePct
	const lockX = flatPct + curvePct + lockPct

	// SVG geometry. y-axis: baseline at the bottom (multiplier=1 → y=H-4),
	// peak at the top (multiplier=peak → y=4). Bound denominator to avoid
	// div-by-zero when peak=1; the chart collapses to a single flat line
	// in that case, which is the correct visualisation.
	const W = 100
	const H = 36
	const yScaleMult = (mult: number) => {
		const denom = Math.max(peakMultiplier - 1, 0.0001)
		const t = (mult - 1) / denom
		return H - 4 - t * (H - 8)
	}
	const flatY = yScaleMult(1)
	const peakY = yScaleMult(peakMultiplier)

	// 32-sample curve in [end_at, max_end_at]. `tNorm` walks 0→1 across
	// the SYMBOLIC curve segment (not real time).
	const curveSamples = 32
	const curvePath = (() => {
		if (!showCurve || !hasWindow) return ''
		const segments: string[] = []
		for (let i = 0; i <= curveSamples; i++) {
			const tNorm = i / curveSamples
			let mult = 1
			if (curveShape === 'linear') mult = 1 + (peakMultiplier - 1) * tNorm
			else mult = Math.pow(peakMultiplier, tNorm)
			const x = endX + tNorm * curvePct
			const y = yScaleMult(mult)
			segments.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(3)} ${y.toFixed(3)}`)
		}
		return segments.join(' ')
	})()

	// Inline label config. Each tick: dashed vertical guide in the SVG +
	// two-line text label (bold name on top, mono compact time below)
	// positioned just above the chart and x-aligned by percentage.
	// Anchors are tweaked so edge labels don't overflow the card.
	const ticks: Array<{
		xPct: number
		color: string
		label: string
		sub: string
		anchor: 'start' | 'middle' | 'end'
	}> = [
		{ xPct: 0, color: '#10b981', label: 'start', sub: formatAbsoluteCompact(startAtSeconds), anchor: 'start' },
		{
			xPct: endX,
			color: '#10b981',
			label: hasWindow ? 'ramp begins' : 'auction end',
			sub: formatAbsoluteCompact(endAtSeconds),
			anchor: 'middle',
		},
		...(hasWindow
			? [
					{
						xPct: maxEndX,
						color: '#f59e0b',
						label: 'auction end',
						sub: formatAbsoluteCompact(maxEndAtSeconds),
						anchor: 'middle' as const,
					},
				]
			: []),
		{ xPct: lockX, color: '#6b7280', label: 'locktime', sub: formatAbsoluteCompact(lockTimeSeconds), anchor: 'end' },
	]

	return (
		<div ref={ref} className={cn('mt-3 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-3', className)}>
			<div className="flex items-baseline justify-between gap-2">
				<p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Bidding timeline</p>
				<p className="text-[10px] text-zinc-500">
					Preview top bid <span className="font-mono text-zinc-700">{previewTopBid.toLocaleString()} sats</span>{' '}
					<span className="text-zinc-400">({hasReserve ? 'from reserve' : 'no reserve, using starting bid'})</span>
				</p>
			</div>

			{/* Label strip ABOVE the chart, x-aligned with the SVG below.
			    Two lines per tick: bold name on top, mono compact time
			    below. Anchored to keep edges in-card. */}
			<div className="relative mt-3 h-7 text-[9px]">
				{ticks.map((tick) => {
					const translate = tick.anchor === 'start' ? 'translate-x-0' : tick.anchor === 'end' ? '-translate-x-full' : '-translate-x-1/2'
					return (
						<div key={tick.label} className={`absolute top-0 ${translate} flex flex-col`} style={{ left: `${tick.xPct}%` }}>
							<span className="font-semibold leading-tight" style={{ color: tick.color }}>
								{tick.label}
							</span>
							<span className="font-mono text-[8px] text-zinc-500 leading-tight">{tick.sub}</span>
						</div>
					)
				})}
			</div>

			<svg viewBox={`0 0 ${W} ${H}`} className="mt-1 w-full" preserveAspectRatio="none" height={H * 2}>
				{/* dashed vertical guides at each checkpoint */}
				{ticks.map((tick) => (
					<line
						key={tick.label}
						x1={tick.xPct}
						y1={0}
						x2={tick.xPct}
						y2={H}
						stroke={tick.color}
						strokeWidth="0.3"
						strokeDasharray="0.6 0.6"
					/>
				))}

				{/* Phase 1: flat floor in [start_at, end_at] */}
				<line x1={0} y1={flatY} x2={endX} y2={flatY} stroke="#10b981" strokeWidth="1.4" />

				{/* Phase 2: curve in [end_at, max_end_at] when enabled */}
				{curvePath && <path d={curvePath} fill="none" stroke="#10b981" strokeWidth="1.4" />}
				{!curvePath && hasWindow && <line x1={endX} y1={flatY} x2={maxEndX} y2={flatY} stroke="#10b981" strokeWidth="1.4" />}

				{/* Phase 3: settlement window in [max_end_at, locktime] — dashed at
				    whatever floor was reached. No bids accepted here; only the
				    seller's kind-1024 publish and bidder timelock-refund. */}
				<line
					x1={maxEndX}
					y1={showCurve ? peakY : flatY}
					x2={lockX}
					y2={showCurve ? peakY : flatY}
					stroke="#9ca3af"
					strokeWidth="0.9"
					strokeDasharray="1.2 1.2"
				/>
			</svg>

			<div className="mt-2 flex flex-wrap items-baseline justify-between gap-2 text-[11px] text-zinc-600">
				<p>
					Floor when <span className="font-semibold text-zinc-900">{hasWindow ? 'anti-snipe ramp begins' : 'auction ends'}</span>:{' '}
					<span className="font-semibold">{baseline.toLocaleString()} sats</span>
				</p>
				<p>
					Floor at <span className="font-semibold text-zinc-900">auction end</span>:{' '}
					<span className={`font-semibold ${showCurve ? 'text-emerald-700' : 'text-zinc-700'}`}>{peakFloor.toLocaleString()} sats</span>{' '}
					{showCurve ? (
						<span className="text-zinc-400">
							({curvePeakMultiplier}×, {curveShape})
						</span>
					) : (
						<span className="text-zinc-400">(no curve)</span>
					)}
				</p>
			</div>
			<p className="mt-2 text-[10px] italic text-zinc-400">Times shown on the chart are symbolic — segments aren't to scale.</p>
		</div>
	)
}
