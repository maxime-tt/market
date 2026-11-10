/**
 * ui/browse/intro-choreography.test.tsx — Unit tests for the intro
 * choreography state machine and counter formatting.
 *
 * These tests exercise the pure logic that drives the GSAP timeline:
 * phase advancement, early-exit conditions, counter ranges, and value
 * interpolation. They fail without the intro-choreography module.
 */

import { describe, expect, test } from 'bun:test'
import {
	PHASES,
	advanceState,
	INITIAL_STATE,
	canPhaseExitEarly,
	counterRanges,
	interpolateCounter,
	formatCounterValue,
	introStatsText,
	type ChoreographyState,
	type CounterRange,
} from './intro-choreography'

// ---------------------------------------------------------------------------
// Phase definitions
// ---------------------------------------------------------------------------

describe('PHASES', () => {
	test('defines all 8 phases in order', () => {
		expect(PHASES.length).toBe(8)
		expect(PHASES.map((p) => p.id)).toEqual([
			'flash',
			'logo-in',
			'wordmark-expand',
			'market-types',
			'title-float',
			'search-fade',
			'stats-scroll',
			'cards-stagger',
		])
	})

	test('each phase has a label and a positive duration', () => {
		for (const phase of PHASES) {
			expect(phase.label.length).toBeGreaterThan(0)
			expect(typeof phase.duration).toBe('number')
			expect(phase.duration).toBeGreaterThan(0)
		}
	})

	test('total choreography duration is approximately 5200 ms', () => {
		const total = PHASES.reduce((sum, p) => sum + p.duration, 0)
		expect(total).toBeGreaterThan(4600)
		expect(total).toBeLessThan(6000)
	})
})

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

describe('advanceState', () => {
	test('starts on flash phase', () => {
		expect(INITIAL_STATE.current).toBe('flash')
		expect(INITIAL_STATE.completed).toBe(false)
	})

	test('advances through all phases in order', () => {
		let state: ChoreographyState = INITIAL_STATE

		for (const phase of PHASES) {
			expect(state.current).toBe(phase.id)
			state = advanceState(state)
		}

		expect(state.completed).toBe(true)
	})

	test('multiple advances progress the phase', () => {
		let state = INITIAL_STATE

		state = advanceState(state)
		expect(state.current).toBe('logo-in')

		state = advanceState(state)
		expect(state.current).toBe('wordmark-expand')

		state = advanceState(state)
		expect(state.current).toBe('market-types')
	})

	test('returns completed when already past the last phase', () => {
		const completedState: ChoreographyState = {
			current: 'cards-stagger',
			completed: true,
			stats: { products: 2, sellers: 2 },
		}

		const next = advanceState(completedState)
		expect(next.completed).toBe(true)
	})

	test('carries stats through advancement', () => {
		const stateWithStats: ChoreographyState = {
			...INITIAL_STATE,
			stats: { products: 5, sellers: 3, postedLast24h: 2, relays: 1 },
		}

		const next = advanceState(stateWithStats)
		expect(next.stats).toEqual({ products: 5, sellers: 3, postedLast24h: 2, relays: 1 })
	})

	test('returns new state object (immutability)', () => {
		const original = INITIAL_STATE
		const next = advanceState(original)
		expect(next).not.toBe(original)
		expect(next.stats).toBe(undefined)
	})
})

// ---------------------------------------------------------------------------
// Early exit conditions
// ---------------------------------------------------------------------------

describe('canPhaseExitEarly', () => {
	const phaseWithEarlyExit = PHASES.find((p) => p.earlyExit)!
	const phaseWithoutEarlyExit = PHASES.find((p) => !p.earlyExit)!

	test('phase without earlyExit cannot exit early even with stats', () => {
		const stats = { products: 10, sellers: 5, postedLast24h: 3, relays: 2 }
		expect(canPhaseExitEarly(phaseWithoutEarlyExit, stats)).toBe(false)
	})

	test('phase with earlyExit cannot exit early without stats', () => {
		expect(canPhaseExitEarly(phaseWithEarlyExit, undefined)).toBe(false)
	})

	test('phase with earlyExit can exit when stats are available', () => {
		const stats = { products: 10, sellers: 5 }
		expect(canPhaseExitEarly(phaseWithEarlyExit, stats)).toBe(true)
	})
})

// ---------------------------------------------------------------------------
// Counter ranges
// ---------------------------------------------------------------------------

describe('counterRanges', () => {
	test('returns empty array when stats is undefined', () => {
		expect(counterRanges(undefined)).toEqual([])
	})

	test('returns empty array when stats is empty', () => {
		expect(counterRanges({})).toEqual([])
	})

	test('extracts all present counter fields', () => {
		const stats = {
			products: 123,
			sellers: 45,
			postedLast24h: 12,
			relays: 3,
		}
		const ranges = counterRanges(stats)
		expect(ranges.length).toBe(4)

		expect(ranges[0]).toEqual({
			field: 'products',
			start: 0,
			end: 123,
			label: 'products',
		})
		expect(ranges[1]).toEqual({
			field: 'sellers',
			start: 0,
			end: 45,
			label: 'sellers',
		})
		expect(ranges[2]).toEqual({
			field: 'postedLast24h',
			start: 0,
			end: 12,
			label: 'posted in last 24h',
		})
		expect(ranges[3]).toEqual({
			field: 'relays',
			start: 0,
			end: 3,
			label: 'relays',
		})
	})

	test('skips absent fields', () => {
		const stats = { products: 100, relays: 5 }
		const ranges = counterRanges(stats)
		expect(ranges.length).toBe(2)
		expect(ranges[0].field).toBe('products')
		expect(ranges[1].field).toBe('relays')
	})

	test('each counter starts from 0', () => {
		const ranges = counterRanges({ products: 999, sellers: 1 })
		for (const range of ranges) {
			expect(range.start).toBe(0)
		}
	})
})

// ---------------------------------------------------------------------------
// Counter interpolation
// ---------------------------------------------------------------------------

describe('interpolateCounter', () => {
	test('progress 0 returns start value', () => {
		const range: CounterRange = {
			field: 'products',
			start: 0,
			end: 100,
			label: 'products',
		}
		expect(interpolateCounter(range, 0)).toBe(0)
	})

	test('progress 1 returns end value', () => {
		const range: CounterRange = {
			field: 'products',
			start: 0,
			end: 100,
			label: 'products',
		}
		expect(interpolateCounter(range, 1)).toBe(100)
	})

	test('progress 0.5 returns midpoint', () => {
		const range: CounterRange = {
			field: 'products',
			start: 0,
			end: 100,
			label: 'products',
		}
		expect(interpolateCounter(range, 0.5)).toBe(50)
	})

	test('clamps progress below 0', () => {
		const range: CounterRange = {
			field: 'products',
			start: 0,
			end: 100,
			label: 'products',
		}
		expect(interpolateCounter(range, -0.5)).toBe(0)
	})

	test('clamps progress above 1', () => {
		const range: CounterRange = {
			field: 'products',
			start: 0,
			end: 100,
			label: 'products',
		}
		expect(interpolateCounter(range, 1.5)).toBe(100)
	})

	test('works with small ranges', () => {
		const range: CounterRange = {
			field: 'relays',
			start: 0,
			end: 3,
			label: 'relays',
		}
		expect(interpolateCounter(range, 0.33)).toBe(1)
		expect(interpolateCounter(range, 0.66)).toBe(2)
		expect(interpolateCounter(range, 1)).toBe(3)
	})
})

// ---------------------------------------------------------------------------
// Counter formatting
// ---------------------------------------------------------------------------

describe('formatCounterValue', () => {
	test('formats plain numbers', () => {
		expect(formatCounterValue(42)).toBe('42')
	})

	test('adds thousands separator', () => {
		expect(formatCounterValue(1234)).toBe('1,234')
		expect(formatCounterValue(12345)).toBe('12,345')
		expect(formatCounterValue(1234567)).toBe('1,234,567')
	})

	test('pounds single digits', () => {
		expect(formatCounterValue(0)).toBe('0')
		expect(formatCounterValue(1)).toBe('1')
	})
})

// ---------------------------------------------------------------------------
// Stats text (same as describeIdleStats)
// ---------------------------------------------------------------------------

describe('introStatsText', () => {
	test('returns empty headline for undefined stats', () => {
		const result = introStatsText(undefined)
		expect(result.headline).toEqual([])
	})

	test('returns empty headline for empty stats', () => {
		const result = introStatsText({})
		expect(result.headline).toEqual([])
	})

	test('builds headline from products and sellers', () => {
		const result = introStatsText({ products: 2, sellers: 2 })
		expect(result.headline).toContain('2 items loaded from 2 sellers')
	})

	test('includes postedLast24h when present', () => {
		const result = introStatsText({
			products: 10,
			sellers: 3,
			postedLast24h: 5,
		})
		expect(result.headline).toContain('10 items loaded from 3 sellers')
		expect(result.headline).toContain('5 posted in the last 24 hours')
	})

	test('includes relays when present', () => {
		const result = introStatsText({
			products: 10,
			sellers: 3,
			relays: 2,
		})
		expect(result.relays).toBe('2 relays queried')
	})

	test('pins en-US thousands separator', () => {
		const result = introStatsText({ products: 1208, sellers: 42 })
		expect(result.headline[0]).toContain('1,208')
	})
})

// ---------------------------------------------------------------------------
// Edge cases: the state machine must not crash
// ---------------------------------------------------------------------------

describe('edge cases', () => {
	test('advancing from any valid phase returns the next phase', () => {
		for (let i = 0; i < PHASES.length - 1; i++) {
			const state: ChoreographyState = {
				current: PHASES[i].id,
				completed: false,
				stats: undefined,
			}
			const next = advanceState(state)
			expect(next.current).toBe(PHASES[i + 1].id)
			expect(next.completed).toBe(false)
		}
	})

	test('stats remain unchanged through advancement', () => {
		const stats = { products: 7, sellers: 3, postedLast24h: 1, relays: 1 }
		let state: ChoreographyState = {
			...INITIAL_STATE,
			stats,
		}

		for (let i = 0; i < PHASES.length - 1; i++) {
			state = advanceState(state)
			expect(state.stats).toEqual(stats)
		}
	})
})
