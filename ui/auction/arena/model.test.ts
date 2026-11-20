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
	ARENA_CREATE_DERIVED_END_LABEL,
	ARENA_NO_COMMITTED_END_LABEL,
	chainClockLabel,
	committedEndLabel,
	createAcceptanceNotice,
	createRefusalLabel,
	type ArenaChainClockModel,
	type ArenaCreateAcceptanceModel,
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

// =========================================================================
// The committed end and the create refusal — the one sentence each
// =========================================================================

describe('committedEndLabel / createRefusalLabel', () => {
	test('a committed end names the end and the bid height', () => {
		expect(committedEndLabel(1_795_021_627, 1734, null)).toBe('end moved to 2026-11-18T17:07:07.000Z by a bid at height 1734')
	})

	test('with a per-bid ordinal the line says "extension N of this lot", never "extended N times"', () => {
		const line = committedEndLabel(1_795_021_627, 1734, 2)
		expect(line).toContain('extension 2 of this lot')
		expect(line).not.toContain('extended')
	})

	test('a create refusal states the chain’s own reason verbatim, never "not found"', () => {
		const line = createRefusalLabel('title required (max 120 chars)')
		expect(line).toBe('the chain refused this listing: title required (max 120 chars)')
		expect(line).not.toContain('not found')
	})

	test('the labels the surfaces use name the two end sources and the missing committed end', () => {
		expect(ARENA_CREATE_DERIVED_END_LABEL).toBe('create-derived end')
		expect(ARENA_NO_COMMITTED_END_LABEL).toBe('no committed end read')
	})
})

describe('createAcceptanceNotice — the chain’s word on a create, or the absence of one', () => {
	const acceptance = (over: Partial<ArenaCreateAcceptanceModel> = {}): ArenaCreateAcceptanceModel => ({
		accepted: false,
		acceptedHeight: null,
		admitEventId: null,
		...over,
	})
	const refusal = { refusalEventId: 'refusal-1', height: 1749, reason: 'startPrice out of range (1..10000000)' }

	test('accepted names the height the chain accepted at', () => {
		const line = createAcceptanceNotice(acceptance({ accepted: true, acceptedHeight: 4_210, admitEventId: 'admit-1' }), null, 'settled')
		expect(line).toBe('The chain accepted this listing at height 4,210.')
	})

	test('accepted with no height read says so in words, never a number', () => {
		const line = createAcceptanceNotice(acceptance({ accepted: true }), null, 'settled')
		expect(line).toContain('The height it accepted at was not read')
	})

	test('a refusal is the chain’s own words verbatim', () => {
		expect(createAcceptanceNotice(acceptance(), refusal, 'settled')).toBe(
			'the chain refused this listing: startPrice out of range (1..10000000)',
		)
	})

	test('neither fact while the read has not settled: still reading, never accepted and never refused', () => {
		const line = createAcceptanceNotice(acceptance(), null, 'incomplete')
		expect(line).toContain('has not accepted this listing yet')
		expect(line).toContain('has not settled')
		expect(line).not.toContain('accepted this listing at height')
		expect(line).not.toContain('refused')
	})

	test('neither fact once the read settled: no relay carried one, and nothing is followed', () => {
		const line = createAcceptanceNotice(acceptance(), null, 'settled')
		expect(line).toContain('no relay carried a create-admission fact')
		expect(line).toContain('Nothing is followed')
		expect(line).not.toContain('refused')
	})
})
