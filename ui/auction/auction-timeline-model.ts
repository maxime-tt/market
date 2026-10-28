/**
 * ui/auction/auction-timeline-model.ts — pure model for the auction timeline
 * scatter chart (D4 S5b).
 *
 * Extracted verbatim from the 470-LOC `src/components/AuctionTimelineChart.tsx`
 * (deleted in this slice): the pubkey→colour function, the bid→point mapping,
 * the x/y domain and tick computation, the axis formatters, and the
 * vertical/horizontal reference-line builders. No React, no I/O, no `@/` — so
 * every helper is unit-testable in isolation (`auction-timeline-model.test.ts`).
 *
 * DATA-SERIES COLOURS: the hex literals in `AUCTION_CHART_PALETTE` are chart
 * series/marker colours passed to recharts props (`stroke`/`fill`), not Tailwind
 * utility classes. `check-ui-styles.sh` flags `bg-…-500` / `bg-[#…]` class
 * strings, never a colour literal handed to a component prop, so these are
 * declared data visualisation colours rather than token debt. Kept byte-for-byte
 * from the legacy chart.
 */
import { getBidAmount } from '@sdk/commerce/auctions/auctionRead'
import type { NostrEventLike } from '@sdk/core/nostr/eventLike'
import type { LabelPosition } from 'recharts/types/component/Label'

/** Chart series, marker and surface colours — data visualisation, not tokens. */
export const AUCTION_CHART_PALETTE = {
	/** Fallback series colour for a bid with no pubkey. */
	defaultPubkey: '#3b82f6',
	/** Bid dot outline. */
	dotStroke: '#ffffff',
	/** Cartesian grid lines. */
	grid: '#e5e7eb',
	/** Axis tick text. */
	axisTick: '#6b7280',
	/** "Start" vertical marker. */
	startMarker: '#94a3b8',
	/** "Refund" vertical marker. */
	refundMarker: '#22c55e',
	/** "Auction End" / "Anti-snipe begins" vertical markers. */
	endMarker: '#ef4444',
	/** "Now" vertical marker. */
	nowMarker: '#8b5cf6',
	/** "Starting Bid" horizontal marker. */
	startingBidMarker: '#f59e0b',
	/** Anti-snipe window area fill/stroke. */
	antiSnipeArea: '#06b6d4',
	/** Settlement window area fill/stroke. */
	settlementArea: '#8b5cf6',
	/** Settlement window area label. */
	settlementAreaLabel: '#7c3aed',
	/** Tooltip cursor line. */
	tooltipCursor: '#9ca3af',
} as const

/** Fixed chart container geometry, reproduced from the legacy component. */
export const CHART_CONTAINER_HEIGHT = 500
export const CHART_CONTAINER_MARGIN = 25
/** Legacy stem-bottom offset (comment: "don't ask why"). */
export const CHART_STEM_BOTTOM_OFFSET = 52

// Function to generate color from pubkey
export const getPubkeyColor = (pubkey: string): string => {
	if (!pubkey) return AUCTION_CHART_PALETTE.defaultPubkey // default blue
	return '#' + pubkey.slice(0, 6)
}

export interface AuctionChartPoint {
	x: number
	y: number
	pubkey?: string
	id: string
}

export interface AuctionChartDisplayPoint extends AuctionChartPoint {
	isGhost?: boolean
	name?: string
	containerHeight?: number
}

/** Legacy bid → chart point mapping. `created_at || 0` is the legacy contract. */
export const mapBidToChartPoint = (bid: NostrEventLike): AuctionChartPoint => ({
	x: (bid.created_at || 0) * 1000,
	y: getBidAmount(bid),
	pubkey: bid.pubkey,
	id: bid.id,
})

/**
 * Build the scatter data set: real points carry their container height, and an
 * empty bid list injects the centred ghost point the legacy drew.
 */
export const buildChartDisplayData = (
	chartBids: AuctionChartPoint[],
	startAt: number,
	refundTime: number,
	startingBid: number,
): AuctionChartDisplayPoint[] =>
	chartBids.length > 0
		? chartBids.map((data) => ({ ...data, containerHeight: CHART_CONTAINER_HEIGHT - CHART_CONTAINER_MARGIN * 2 }))
		: [
				{
					x: startAt * 1000 + (refundTime * 1000 - startAt * 1000) / 2, // Center time
					y: startingBid,
					id: 'ghost',
					name: 'No Bids Yet',
					isGhost: true, // Custom flag
				},
			]

/** Legacy stem bottom formula: `containerHeight - cy + (y ?? 0) - 52`. */
export const computeStemBottomY = (cy: number, y: number, containerHeight: number): number =>
	containerHeight - cy + (y ?? 0) - CHART_STEM_BOTTOM_OFFSET

/** 5% x-axis margin on each side of the auction span. */
export const computeXDomain = (startAt: number, refundTime: number): { xMin: number; xMax: number } => {
	const totalTimeSpan = refundTime * 1000 - startAt * 1000
	const margin = totalTimeSpan * 0.05
	return { xMin: startAt * 1000 - margin, xMax: refundTime * 1000 + margin }
}

// Function to round to nearest number with 2 significant figures
export const roundToSignificantFigures = (num: number): number => {
	if (num === 0) return 0

	const magnitude = Math.floor(Math.log10(Math.abs(num)))
	const factor = Math.pow(10, 2 - magnitude - 1)
	return Math.round(num * factor) / factor
}

export const formatXAxisTick = (timestamp: number, auctionStart: number, refundTime: number): string => {
	// Only show times within the auction period
	if (timestamp < auctionStart || timestamp > refundTime) return ''

	const date = new Date(timestamp)

	return date.toLocaleTimeString('en-US', {
		hour: '2-digit',
		minute: '2-digit',
		hour12: true,
	})
}

export const formatYAxisTick = (value: number): string => {
	// Round to 2 significant figures first
	const roundedValue = roundToSignificantFigures(value)

	// Format large numbers with K (thousands) or M (millions) suffixes
	if (roundedValue >= 1000000) {
		return `${(roundedValue / 1000000).toFixed(1)}M`
	}
	if (roundedValue >= 1000) {
		return `${(roundedValue / 1000).toFixed(1)}K`
	}

	// For small numbers round to 2 significant figures
	if (roundedValue < 100) {
		return roundToSignificantFigures(roundedValue).toString()
	}

	return roundedValue.toString()
}

export interface YAxisConfig {
	yMin: number
	yMax: number
	hasDefinedRange: boolean
}

// Function to generate nice rounded values for Y axis based on requirements:
// - Starting bid should be at ~5% from bottom
// - Max bid/reserve should be at ~70% of height
// - If no bids/reserve, starting bid should have ~60% above it
export const generateYAxisConfig = (startingBid: number, reserve: number, bids: Array<{ y: number }>): YAxisConfig => {
	const allBidValues = bids.map((b) => b.y)
	const hasBids = allBidValues.length > 0
	const maxBid = hasBids ? Math.max(...allBidValues) : 0
	const maxBidOrReserve = reserve > 0 ? Math.max(reserve, maxBid) : maxBid

	// Ensure we have a minimum range to prevent log10(0) issues
	const minRange = Math.max(5000, startingBid * 0.1) // At least 5000 or 10% of starting bid

	// If we have max bid or reserve, position starting bid at 5% from bottom and max at 70% height
	if (maxBidOrReserve > 0) {
		// Calculate the total range needed to position starting bid at 5% and max at 70%
		const rangeNeeded = Math.max((maxBidOrReserve - startingBid) / 0.65, minRange) // 65% between 5% and 70%
		const actualMin = minRange - rangeNeeded * 0.05 // 5% margin below starting bid
		const actualMax = actualMin + rangeNeeded

		return { yMin: actualMin, yMax: actualMax, hasDefinedRange: true }
	}

	// If no bids/reserve, position starting bid with 60% above it
	const rangeNeeded = Math.max(startingBid / 0.4, minRange) // 40% below to give 60% above, with minimum
	const actualMin = 0
	const actualMax = actualMin + rangeNeeded

	return { yMin: actualMin, yMax: actualMax, hasDefinedRange: false }
}

// Function to generate ticks with 2 significant figures, including below starting bid
export const generateYTicks = (yMin: number, yMax: number, count: number = 12): number[] => {
	const ticks: number[] = []

	// Calculate tick spacing based on the full range
	const range = yMax - yMin
	const tickSpacing = range / (count - 1)

	// Round tick spacing to nice intervals with 2 significant figures
	const magnitude = Math.pow(10, Math.floor(Math.log10(tickSpacing)))
	let tickStep = tickSpacing / magnitude

	// Choose nice step sizes
	if (tickStep <= 1) tickStep = 1
	else if (tickStep <= 2) tickStep = 2
	else if (tickStep <= 5) tickStep = 5
	else tickStep = 10

	tickStep *= magnitude
	const roundedTickStep = roundToSignificantFigures(tickStep)

	// Generate ticks starting from the bottom
	let currentTick = Math.floor(yMin / roundedTickStep) * roundedTickStep

	// Generate ticks across the entire range
	while (currentTick <= yMax && ticks.length < count * 2) {
		// Only add if it's within our domain and not a duplicate
		if (currentTick >= yMin && currentTick <= yMax) {
			const roundedTick = roundToSignificantFigures(currentTick)
			if (!ticks.includes(roundedTick)) {
				ticks.push(roundedTick)
			}
		}
		currentTick += roundedTickStep
	}

	// Sort and limit to count
	return ticks
		.sort((a, b) => a - b)
		.filter((tick, index) => index < count)
		.filter((tick) => tick >= yMin && tick <= yMax)
}

export interface VerticalLineMarker {
	label: string
	ts: number
	color: string
	position?: LabelPosition
}

export interface HorizontalLineMarker {
	label: string
	val: number
	color: string
	position?: LabelPosition
}

export interface VerticalMarkerInput {
	startAt: number
	refundTime: number
	endAt: number
	maxEndAt: number
	displayedMaxEndAt: number
	currentTime: number
	xMin: number
	xMax: number
}

/** Build the vertical reference lines, including the conditional time markers. */
export const buildVerticalMarkers = ({
	startAt,
	refundTime,
	endAt,
	maxEndAt,
	displayedMaxEndAt,
	currentTime,
	xMin,
	xMax,
}: VerticalMarkerInput): VerticalLineMarker[] => {
	const verticalMarkers: VerticalLineMarker[] = [
		{ label: 'Start', ts: startAt * 1000, color: AUCTION_CHART_PALETTE.startMarker, position: 'insideTopRight' },
		{ label: 'Refund', ts: refundTime * 1000, color: AUCTION_CHART_PALETTE.refundMarker },
	]

	// Handle different end timing scenarios:
	// 1. When max_end_at > end_at, end_at starts the anti-snipe ramp and
	//    max_end_at is the fixed auction end.
	// 2. Otherwise, show only one "Auction End" at the bidding cutoff.
	const hasAntiSnipeWindow = maxEndAt > endAt

	if (hasAntiSnipeWindow) {
		verticalMarkers.push({
			label: 'Anti-snipe begins',
			ts: endAt * 1000,
			color: AUCTION_CHART_PALETTE.endMarker,
			position: 'insideTopRight',
		})
		verticalMarkers.push({
			label: 'Auction End',
			ts: maxEndAt * 1000,
			color: AUCTION_CHART_PALETTE.endMarker,
			position: 'insideTopRight',
		})
	} else if (displayedMaxEndAt > 0) {
		verticalMarkers.push({
			label: 'Auction End',
			ts: displayedMaxEndAt * 1000,
			color: AUCTION_CHART_PALETTE.endMarker,
			position: 'insideTopRight',
		})
	}

	// Add current time marker if it's within the auction period
	if (currentTime >= xMin && currentTime <= xMax) {
		verticalMarkers.push({
			label: 'Now',
			ts: currentTime,
			color: AUCTION_CHART_PALETTE.nowMarker,
			position: 'insideLeft',
		})
	}

	return verticalMarkers
}

/** Build the horizontal reference lines — always the starting bid, reserve if set. */
export const buildHorizontalMarkers = (startingBid: number, reserve: number): HorizontalLineMarker[] => {
	const horizontalMarkers: HorizontalLineMarker[] = []

	if (startingBid > 0) {
		horizontalMarkers.push({
			label: `Starting Bid (${startingBid.toLocaleString()} sats)`,
			val: startingBid,
			color: AUCTION_CHART_PALETTE.startingBidMarker,
			position: 'insideBottomLeft',
		})
	}

	// Only add reserve if it exists and is greater than 0
	if (reserve > 0) {
		horizontalMarkers.push({
			label: `Reserve (${reserve.toLocaleString()} sats)`,
			val: reserve,
			color: AUCTION_CHART_PALETTE.endMarker,
			position: 'insideBottomLeft',
		})
	}

	return horizontalMarkers
}

// Generate custom ticks for x-axis
export const generateXTicks = (startAt: number, refundTime: number): number[] => {
	const ticks: number[] = []
	const tickCount = 12 // Number of ticks to display
	const interval = (refundTime * 1000 - startAt * 1000) / (tickCount - 1)

	for (let i = 0; i < tickCount; i++) {
		ticks.push(startAt * 1000 + interval * i)
	}

	// Ensure the last tick is exactly the end time
	ticks[ticks.length - 1] = refundTime * 1000

	return ticks
}
