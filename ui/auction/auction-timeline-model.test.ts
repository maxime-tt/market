import { describe, expect, test } from 'bun:test'
import type { NostrEventLike } from '@sdk/core/nostr/eventLike'
import { generateYAxisConfig, generateYTicks, getPubkeyColor, mapBidToChartPoint, type AuctionChartPoint } from './auction-timeline-model'

const bidFixture = (overrides: Partial<NostrEventLike> = {}): NostrEventLike => ({
	id: 'bid-1',
	pubkey: 'a1b2c3d4e5f6',
	kind: 1024,
	created_at: 1_760_000_000,
	content: '',
	tags: [['amount', '15000']],
	...overrides,
})

describe('getPubkeyColor', () => {
	test('is deterministic for the same pubkey', () => {
		expect(getPubkeyColor('abcdef123456')).toBe(getPubkeyColor('abcdef123456'))
	})

	test('differs for different pubkey prefixes', () => {
		expect(getPubkeyColor('abcdef123456')).not.toBe(getPubkeyColor('fedcba654321'))
	})

	test('derives the series colour from the first six pubkey characters', () => {
		expect(getPubkeyColor('abcdef123456')).toBe('#abcdef')
	})

	test('falls back to the default series colour for an empty pubkey', () => {
		expect(getPubkeyColor('')).toBe('#3b82f6')
	})
})

describe('mapBidToChartPoint', () => {
	test('maps a valid timestamp to milliseconds and the amount to y', () => {
		expect(mapBidToChartPoint(bidFixture())).toEqual({
			x: 1_760_000_000 * 1000,
			y: 15000,
			pubkey: 'a1b2c3d4e5f6',
			id: 'bid-1',
		})
	})

	test('collapses a missing timestamp to x=0, as the legacy chart did', () => {
		const point = mapBidToChartPoint(bidFixture({ created_at: undefined }))
		expect(point.x).toBe(0)
	})

	test('collapses a zero timestamp to x=0, as the legacy chart did', () => {
		const point = mapBidToChartPoint(bidFixture({ created_at: 0 }))
		expect(point.x).toBe(0)
	})
})

describe('Y-axis domain and ticks', () => {
	const withinDomain = (ticks: number[], yMin: number, yMax: number) => ticks.every((tick) => tick >= yMin && tick <= yMax)

	test('handles an empty bid list with a finite domain and ticks', () => {
		const { yMin, yMax, hasDefinedRange } = generateYAxisConfig(10_000, 0, [])
		expect(Number.isFinite(yMin)).toBe(true)
		expect(Number.isFinite(yMax)).toBe(true)
		expect(yMax).toBeGreaterThan(yMin)
		expect(hasDefinedRange).toBe(false)

		const ticks = generateYTicks(yMin, yMax, 12)
		expect(ticks.length).toBeGreaterThan(0)
		expect(withinDomain(ticks, yMin, yMax)).toBe(true)
		expect([...ticks].sort((a, b) => a - b)).toEqual(ticks)
	})

	test('handles a single bid with a finite, ordered tick set inside the domain', () => {
		const bids: AuctionChartPoint[] = [{ x: 0, y: 15_000, pubkey: 'a1b2c3', id: 'bid-1' }]
		const { yMin, yMax, hasDefinedRange } = generateYAxisConfig(10_000, 0, bids)
		expect(Number.isFinite(yMin)).toBe(true)
		expect(Number.isFinite(yMax)).toBe(true)
		expect(yMax).toBeGreaterThan(yMin)
		expect(hasDefinedRange).toBe(true)

		const ticks = generateYTicks(yMin, yMax, 12)
		expect(ticks.length).toBeGreaterThan(0)
		expect(withinDomain(ticks, yMin, yMax)).toBe(true)
		expect([...ticks].sort((a, b) => a - b)).toEqual(ticks)
	})
})
