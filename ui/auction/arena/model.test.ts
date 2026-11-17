/**
 * Tests for the arena chain-clock read-model and its one formatter
 * (`model.ts`). Plain data, no read: the formatter says the words a surface
 * renders, and every unknown stays a word rather than a `0`.
 */
import { describe, expect, test } from 'bun:test'

import {
	ARENA_CHAIN_CLOCK_REGRESSION_LABEL,
	ARENA_CHAIN_CLOCK_STALE_LABEL,
	ARENA_CHAIN_CLOCK_UNKNOWN_LABEL,
	chainClockLabel,
	type ArenaChainClockModel,
} from './model'

function clock(over: Partial<ArenaChainClockModel> = {}): ArenaChainClockModel {
	return {
		time: 1_700_000_000,
		height: 42,
		validatorPubkey: 'validator-1',
		relays: ['wss://a'],
		ageSec: 7,
		freshness: 'fresh',
		rulesTime: 1_700_000_000,
		rulesHeight: 42,
		refusedHeights: [],
		regressionRefused: false,
		...over,
	}
}

describe('chainClockLabel', () => {
	test('states the anchored time as of its height with its age, never as now', () => {
		expect(chainClockLabel(clock())).toBe('Chain time as of height 42, 7 s ago')
	})

	test('an unknown chain time is the word, not a zero', () => {
		const label = chainClockLabel(
			clock({ time: null, height: null, ageSec: null, freshness: 'unknown', rulesTime: null, rulesHeight: null }),
		)
		expect(label).toBe(ARENA_CHAIN_CLOCK_UNKNOWN_LABEL)
		expect(label).not.toContain('0')
	})

	test('a stale reading says so', () => {
		const label = chainClockLabel(clock({ ageSec: 1000, freshness: 'stale' }))
		expect(label).toContain(ARENA_CHAIN_CLOCK_STALE_LABEL)
	})

	test('a refused forked height is named', () => {
		const label = chainClockLabel(clock({ refusedHeights: [30, 20] }))
		expect(label).toContain('refused forked heights 30, 20')
	})

	test('a refused regression says so', () => {
		const label = chainClockLabel(clock({ regressionRefused: true }))
		expect(label).toContain(ARENA_CHAIN_CLOCK_REGRESSION_LABEL)
	})

	test('a fork plus a regression reads as one honest sentence', () => {
		expect(chainClockLabel(clock({ refusedHeights: [30], regressionRefused: true }))).toBe(
			'Chain time as of height 42, 7 s ago — refused forked height 30 — ' + ARENA_CHAIN_CLOCK_REGRESSION_LABEL,
		)
	})
})
