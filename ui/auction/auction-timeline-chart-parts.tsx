/**
 * ui/auction/auction-timeline-chart-parts.tsx — the two recharts custom
 * renderers for the auction timeline chart (D4 S5b).
 *
 * Split out of `auction-timeline-chart-view.tsx` so the view stays under the
 * ~250-LOC ceiling (ui/AGENTS.md V3): the view owns composition, these own the
 * `Scatter` shape (the "lollipop" stem+dot) and the `Tooltip` content. Both were
 * moved byte-for-byte from the deleted `src/components/AuctionTimelineChart.tsx`
 * (data-series colours declared in `./auction-timeline-model.ts`).
 */
import type { ReactNode } from 'react'
import type { ScatterShapeProps } from 'recharts'
import { AUCTION_CHART_PALETTE, computeStemBottomY, getPubkeyColor } from './auction-timeline-model'

// ============================================
// CUSTOM SHAPE COMPONENT: "LOLLIPOP BAR"
// Draws a thick vertical line (bar) + a circle (dot) at the top.
// ============================================
export const AuctionTimelineBarShape = (props: ScatterShapeProps) => {
	const { cx, cy, payload } = props
	if (payload?.isGhost) {
		return <g></g>
	}

	const pubkey: string | undefined = payload?.pubkey
	const fill = getPubkeyColor(pubkey ?? '')

	if (!cx || !cy) return null

	// Calculate bottomY based on the actual chart height. Formula to get exact
	// bottom of chart regardless of containerHeight (don't ask why).
	const bottomY = computeStemBottomY(cy, props.y ?? 0, payload?.containerHeight ?? 0)

	return (
		<g>
			{/* The Stem */}
			<line
				x1={cx}
				y1={cy}
				x2={cx}
				y2={bottomY}
				stroke={fill || AUCTION_CHART_PALETTE.defaultPubkey}
				strokeWidth={14}
				strokeLinecap="round"
				opacity={0.9}
			/>
			{/* The Dot */}
			<circle
				cx={cx}
				cy={cy}
				r={6}
				fill={fill || AUCTION_CHART_PALETTE.defaultPubkey}
				stroke={AUCTION_CHART_PALETTE.dotStroke}
				strokeWidth={2}
			/>
		</g>
	)
}

// ============================================
// TOOLTIP
// ============================================
export interface AuctionTimelineTooltipProps {
	active?: boolean
	payload?: Array<{ payload?: { x: number; y: number; pubkey?: string } }>
	renderUserCard: (pubkey: string) => ReactNode
}

export const AuctionTimelineTooltip = ({ active, payload, renderUserCard }: AuctionTimelineTooltipProps) => {
	if (!active || !payload?.length) return null
	const data = payload[0].payload
	if (!data) return null

	const dateStr = new Date(data.x).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })

	return (
		<div className="bg-card border border-border-default rounded-lg shadow-lg p-3 min-w-40 z-50">
			{data.pubkey && <div className="mb-2">{renderUserCard(data.pubkey)}</div>}
			<p className="text-xs text-foreground mb-1">{dateStr}</p>
			<p className="font-semibold text-text-high">{data.y.toLocaleString()} sats</p>
		</div>
	)
}
