/**
 * ui/auction/auction-timeline-chart-view.tsx — props-only auction timeline
 * scatter chart (D4 S5b).
 *
 * Reproduces `src/components/AuctionTimelineChart.tsx` exactly (deleted in this
 * slice): same recharts composition, same reference areas/lines, same colours.
 * The pure maths/colour/formatting helpers live in
 * `./auction-timeline-model.ts`; the two custom recharts renderers live in
 * `./auction-timeline-chart-parts.tsx` (so this view stays under the ~250-LOC
 * ceiling). The stream/data read and the bidder identity stay in the
 * `platform/` host and arrive through `renderUserCard`.
 *
 * DATA-SERIES COLOURS: every hex literal used by the chart is declared in
 * `AUCTION_CHART_PALETTE` (`auction-timeline-model.ts`) and handed to recharts
 * `stroke`/`fill` props. `check-ui-styles.sh` only flags palette-utility class
 * strings (`bg-…-500`, `bg-[#…]`), never a colour value in a component prop.
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import {
	CartesianGrid,
	Label,
	ReferenceArea,
	ReferenceLine,
	ResponsiveContainer,
	Scatter,
	ScatterChart,
	Tooltip,
	XAxis,
	YAxis,
} from 'recharts'
import {
	getAuctionEndAt,
	getAuctionMaxEndAt,
	getAuctionReserve,
	getAuctionSettlementGrace,
	getAuctionStartAt,
	getAuctionStartingBid,
} from '@sdk/commerce/auctions/auctionRead'
import type { NostrEventLike } from '@sdk/core/nostr/eventLike'
import { cn } from '../utils/cn'
import {
	AUCTION_CHART_PALETTE,
	buildChartDisplayData,
	buildHorizontalMarkers,
	buildVerticalMarkers,
	computeXDomain,
	formatXAxisTick,
	formatYAxisTick,
	generateXTicks,
	generateYAxisConfig,
	generateYTicks,
	mapBidToChartPoint,
} from './auction-timeline-model'
import { AuctionTimelineBarShape, AuctionTimelineTooltip } from './auction-timeline-chart-parts'

export interface AuctionTimelineChartViewProps {
	bids: NostrEventLike[]
	auction: NostrEventLike | null
	renderUserCard: (pubkey: string) => ReactNode
	className?: string
}

export function AuctionTimelineChartView({ bids, auction, renderUserCard, className }: AuctionTimelineChartViewProps) {
	// Extract auction data
	const startAt = getAuctionStartAt(auction)
	const endAt = getAuctionEndAt(auction)
	const startingBid = getAuctionStartingBid(auction)
	const reserve = getAuctionReserve(auction)
	const maxEndAt = getAuctionMaxEndAt(auction)
	const displayedMaxEndAt = maxEndAt >= endAt ? maxEndAt : endAt
	const refundTime = displayedMaxEndAt + getAuctionSettlementGrace(auction)

	// Transform bids to chart data format
	const chartBids = bids.map(mapBidToChartPoint)

	const displayData = buildChartDisplayData(chartBids, startAt, refundTime, startingBid)

	// State for current time
	const [currentTime, setCurrentTime] = useState(Date.now())

	// Update current time every minute
	useEffect(() => {
		const timer = setInterval(() => {
			setCurrentTime(Date.now())
		}, 60000) // Update every minute

		return () => clearInterval(timer)
	}, [])

	const { xMin, xMax } = computeXDomain(startAt, refundTime)

	// Determine y-axis boundaries based on requirements
	const { yMin, yMax } = generateYAxisConfig(startingBid, reserve, chartBids)

	// Generate Y-axis ticks
	const yTicks = generateYTicks(yMin, yMax, 12)

	const hasAntiSnipeWindow = maxEndAt > endAt

	// Build vertical/horizontal markers
	const verticalMarkers = buildVerticalMarkers({
		startAt,
		refundTime,
		endAt,
		maxEndAt,
		displayedMaxEndAt,
		currentTime,
		xMin,
		xMax,
	})
	const horizontalMarkers = buildHorizontalMarkers(startingBid, reserve)

	const settlementStart = displayedMaxEndAt * 1000
	const settlementEnd = refundTime * 1000

	return (
		<div data-slot="auction-timeline-chart-view" className={cn('w-full h-125', className)}>
			<ResponsiveContainer width="100%" height="100%">
				<ScatterChart margin={{ top: 20, right: 30, left: 10, bottom: 20 }}>
					<CartesianGrid strokeDasharray="3 3" stroke={AUCTION_CHART_PALETTE.grid} />

					<XAxis
						type="number"
						dataKey="x"
						domain={[xMin, xMax]}
						ticks={generateXTicks(startAt, refundTime)}
						tickFormatter={(ts) => formatXAxisTick(ts, startAt * 1000, refundTime * 1000)}
						angle={-45}
						textAnchor="end"
						height={70}
						tick={{ fontSize: 11, fill: AUCTION_CHART_PALETTE.axisTick }}
					/>

					<YAxis
						type="number"
						domain={[yMin, yMax]}
						ticks={yTicks}
						tickFormatter={formatYAxisTick}
						width={70}
						tick={{ fontSize: 11, fill: AUCTION_CHART_PALETTE.axisTick }}
						unit=" sats"
					/>

					{/* SCATTER WITH CUSTOM SHAPE */}
					<Scatter
						name="Bids"
						data={displayData}
						dataKey="y"
						shape={AuctionTimelineBarShape}
						fill={AUCTION_CHART_PALETTE.defaultPubkey}
						isAnimationActive={false}
						animationDuration={800}
					/>

					{/* 2. Conditionally Render the "No bids yet" text */}
					{chartBids.length === 0 && <Label position="center">No bids yet</Label>}

					{/* Anti-snipe Window Area */}
					{hasAntiSnipeWindow && (
						<ReferenceArea
							x1={endAt * 1000}
							x2={maxEndAt * 1000}
							fill={AUCTION_CHART_PALETTE.antiSnipeArea}
							fillOpacity={0.15}
							stroke={AUCTION_CHART_PALETTE.antiSnipeArea}
							strokeDasharray="4 4"
							label={{
								position: 'center',
								value: 'Anti-snipe Window',
								fill: AUCTION_CHART_PALETTE.antiSnipeArea,
								fontSize: 11,
								fontWeight: 600,
								angle: 45,
							}}
						/>
					)}

					{/* Settlement Window Area */}
					<ReferenceArea
						x1={settlementStart}
						x2={settlementEnd}
						fill={AUCTION_CHART_PALETTE.settlementArea}
						fillOpacity={0.15}
						stroke={AUCTION_CHART_PALETTE.settlementArea}
						strokeDasharray="4 4"
						label={{
							position: 'center',
							value: 'Settlement Window',
							fill: AUCTION_CHART_PALETTE.settlementAreaLabel,
							fontSize: 11,
							fontWeight: 600,
							angle: 45,
						}}
					/>

					{/* Vertical Lines */}
					{verticalMarkers.map((m, i) => (
						<ReferenceLine
							key={`v-${i}`}
							x={m.ts}
							stroke={m.color}
							strokeDasharray="4 4"
							label={{ position: m.position ?? 'insideTopLeft', value: m.label, fill: m.color, fontSize: 11, fontWeight: 600 }}
						/>
					))}

					{/* Horizontal Lines */}
					{horizontalMarkers.map((m, i) => (
						<ReferenceLine
							key={`h-${i}`}
							y={m.val}
							stroke={m.color}
							strokeDasharray="4 4"
							label={{ position: m.position ?? 'left', value: m.label, fill: m.color, fontSize: 11, fontWeight: 600 }}
						/>
					))}

					<Tooltip
						content={<AuctionTimelineTooltip renderUserCard={renderUserCard} />}
						cursor={{ stroke: AUCTION_CHART_PALETTE.tooltipCursor, strokeDasharray: '3 3' }}
						wrapperStyle={{ outline: 'none' }}
						isAnimationActive={false}
					/>
				</ScatterChart>
			</ResponsiveContainer>
		</div>
	)
}
