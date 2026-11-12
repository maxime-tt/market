import { describe, expect, test } from 'bun:test'
import { INTRO_BEATS, INTRO_DURATION_MS, introCounter } from './intro'

describe('intro counters', () => {
	test('start at zero, end exactly at the measured total, and never run backwards', () => {
		expect(introCounter(108, 0)).toBe(0)
		expect(introCounter(108, 1)).toBe(108)
		const samples = [0, 0.2, 0.4, 0.6, 0.8, 1].map((p) => introCounter(108, p))
		expect(samples).toEqual([...samples].sort((a, b) => a - b))
	})

	test('an absent or zero total states nothing rather than a fabricated number', () => {
		expect(introCounter(undefined, 1)).toBe(0)
		expect(introCounter(0, 1)).toBe(0)
	})

	test('progress outside 0..1 is clamped, never overshooting the total', () => {
		expect(introCounter(50, -1)).toBe(0)
		expect(introCounter(50, 2)).toBe(50)
	})
})

describe('intro storyboard', () => {
	test('the beats are ordered and inside the timeline', () => {
		const values = Object.values(INTRO_BEATS)
		expect(values).toEqual([...values].sort((a, b) => a - b))
		expect(values[0]).toBe(0)
		expect(Math.max(...values)).toBeLessThan(1)
		expect(INTRO_DURATION_MS).toBeGreaterThan(1000)
	})
})
