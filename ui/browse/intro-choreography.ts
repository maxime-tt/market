/**
 * ui/browse/intro-choreography.ts — State machine for the intro animation phases.
 *
 * The intro is a linear sequence of phases, each with a duration and a boolean
 * `completed` flag. A phase can be marked complete early if its underlying data
 * is ready before the animation slot ends.
 *
 * The machine is pure — it holds no DOM refs, no GSAP handles. It emits events
 * that the animation consumer (`intro-animation.tsx`) translates into real
 * GSAP calls.
 */

import { describeIdleStats, type BrowseIdleStats } from './browse-idle'
export type { BrowseIdleStats } from './browse-idle'

// ---------------------------------------------------------------------------
// Phase types
// ---------------------------------------------------------------------------

/** The phases the intro plays through, in order. */
export type PhaseId =
	| 'flash'
	| 'logo-in'
	| 'wordmark-expand'
	| 'market-types'
	| 'title-float'
	| 'search-fade'
	| 'stats-scroll'
	| 'cards-stagger'

/** A single phase in the choreography. */
export interface Phase {
	/** Unique identifier for this phase. */
	id: PhaseId
	/** Label rendered in debug mode. */
	label: string
	/** How long this phase occupies in the timeline (ms). */
	duration: number
	/** Whether the phase can finish early when data arrives. */
	earlyExit: boolean
}

// ---------------------------------------------------------------------------
// Phase definitions — the choreography
// ---------------------------------------------------------------------------

/** All phases in execution order. Durations are approximate. */
export const PHASES: Phase[] = [
	{ id: 'flash', label: 'Background flash black → white', duration: 500, earlyExit: false },
	{ id: 'logo-in', label: 'Logo fades in', duration: 500, earlyExit: false },
	{ id: 'wordmark-expand', label: 'Wordmark expands from centre', duration: 500, earlyExit: false },
	{ id: 'market-types', label: '"Market" types in', duration: 400, earlyExit: true },
	{ id: 'title-float', label: 'Title block floats to position', duration: 700, earlyExit: true },
	{ id: 'search-fade', label: 'Search field fades in', duration: 500, earlyExit: true },
	{ id: 'stats-scroll', label: 'Stats counters scroll up', duration: 600, earlyExit: true },
	{ id: 'cards-stagger', label: 'Product cards stagger in', duration: 1000, earlyExit: true },
]

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

/** The current position in the choreography. */
export interface ChoreographyState {
	/** Which phase is currently playing. */
	current: PhaseId
	/** Whether the entire choreography has completed. */
	completed: boolean
	/** Which data stats the choreography is tracking against. */
	stats: BrowseIdleStats | undefined
}

/** Initial state — nothing has started. */
export const INITIAL_STATE: ChoreographyState = {
	current: 'flash',
	completed: false,
	stats: undefined,
}

/**
 * Advance the state machine to the next phase.
 *
 * Returns a new state; the caller decides when to apply it.
 * When `completed` is true the consumer should remove the intro layer.
 */
export function advanceState(state: ChoreographyState): ChoreographyState {
	const currentIndex = PHASES.findIndex((p) => p.id === state.current)

	if (currentIndex < 0 || currentIndex >= PHASES.length - 1) {
		return { ...state, completed: true }
	}

	const nextPhase = PHASES[currentIndex + 1]

	return {
		...state,
		current: nextPhase.id,
		completed: false,
	}
}

/**
 * Whether the choreography can finish early based on data availability.
 *
 * Some phases (`earlyExit: true`) should complete as soon as the underlying
 * data is ready, rather than waiting for their full animation slot.
 */
export function canPhaseExitEarly(phase: Phase, stats: BrowseIdleStats | undefined): boolean {
	if (!phase.earlyExit) return false

	// Stats phases can exit early when stats are available
	if (phase.id === 'stats-scroll') {
		return stats !== undefined && Object.keys(stats).length > 0
	}

	// All early-exit phases can exit when data is ready
	return stats !== undefined
}

/**
 * Get the description text for the stats line during animation.
 *
 * Returns the same fragments `describeIdleStats` produces, so the intro's
 * copy is identical to the hero's — no fabricated counts.
 */
export function introStatsText(stats: BrowseIdleStats | undefined): {
	headline: string[]
	relays?: string
} {
	return describeIdleStats(stats)
}

/**
 * Format a counter value for the scroll animation.
 *
 * Uses the same thousands-separation as `formatIdleCount`, but also returns
 * the start (0) and end values so the animation consumer can interpolate.
 */
export function formatCounterValue(value: number): string {
	return value.toLocaleString('en-US')
}

/**
 * Counter range for animation interpolation.
 *
 * Each counter scrolls from 0 to its final value over the phase duration.
 */
export interface CounterRange {
	/** The stat field name. */
	field: keyof BrowseIdleStats
	/** Value at phase start (always 0 for scroll-in). */
	start: number
	/** Value at phase end (the measured count). */
	end: number
	/** Display label for this counter. */
	label: string
}

/**
 * Extract all counter ranges from the stats record.
 *
 * Returns the three measurable counters: products, sellers, postedLast24h, relays.
 * Absent fields are skipped — the intro states only what was measured.
 */
export function counterRanges(stats: BrowseIdleStats | undefined): CounterRange[] {
	if (!stats) return []

	const ranges: CounterRange[] = []

	if (stats.products !== undefined) {
		ranges.push({ field: 'products', start: 0, end: stats.products, label: 'products' })
	}
	if (stats.sellers !== undefined) {
		ranges.push({ field: 'sellers', start: 0, end: stats.sellers, label: 'sellers' })
	}
	if (stats.postedLast24h !== undefined) {
		ranges.push({
			field: 'postedLast24h',
			start: 0,
			end: stats.postedLast24h,
			label: 'posted in last 24h',
		})
	}
	if (stats.relays !== undefined) {
		ranges.push({ field: 'relays', start: 0, end: stats.relays, label: 'relays' })
	}

	return ranges
}

/**
 * Linear interpolation helper for counter scroll animation.
 *
 * Maps a progress value (0→1) to the interpolated counter value.
 */
export function interpolateCounter(range: CounterRange, progress: number): number {
	const clamped = Math.max(0, Math.min(1, progress))
	return Math.round(range.start + (range.end - range.start) * clamped)
}
