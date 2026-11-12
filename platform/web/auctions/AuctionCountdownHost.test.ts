import { describe, expect, test } from 'bun:test'
import { computePreStartProgress, getUrgency } from './AuctionCountdownHost'

describe('computePreStartProgress', () => {
	test('is 0 when the auction has no start or publish time', () => {
		expect(computePreStartProgress(1000, 0, 1000)).toBe(0)
		expect(computePreStartProgress(1000, 1000, 0)).toBe(0)
	})

	test('is 0 at publish time', () => {
		expect(computePreStartProgress(1000, 2000, 1000)).toBe(0)
	})

	test('is 1 at and after the start time', () => {
		expect(computePreStartProgress(2000, 2000, 1000)).toBe(1)
		expect(computePreStartProgress(3000, 2000, 1000)).toBe(1)
	})

	test('clamps between 0 and 1 inside the publish→start window', () => {
		expect(computePreStartProgress(1500, 2000, 1000)).toBe(0.5)
		// before publish (negative elapsed) clamps to 0
		expect(computePreStartProgress(500, 2000, 1000)).toBe(0)
	})

	test('is 0 when the window is empty or inverted', () => {
		expect(computePreStartProgress(1500, 1000, 1000)).toBe(0)
		expect(computePreStartProgress(1500, 500, 1000)).toBe(0)
	})
})

describe('getUrgency', () => {
	test('maps the boundary seconds to the urgency lane', () => {
		expect(getUrgency(0)).toBe('ended')
		expect(getUrgency(30)).toBe('finalBids')
		expect(getUrgency(3600)).toBe('lastHour')
		expect(getUrgency(86400)).toBe('lastDay')
		expect(getUrgency(86401)).toBe('calm')
	})
})
