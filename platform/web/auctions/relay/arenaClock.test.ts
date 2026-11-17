/**
 * Tests for the arena chain clock (`arenaClock.ts`).
 *
 * Pure and deterministic: the wall clock is an argument, so fresh/stale and the
 * monotonic guard are pinned exactly. No network, no relay.
 */
import { describe, expect, test } from 'bun:test'

import { ARENA_CHAIN_CLOCK_STALE_AFTER_SEC, arenaChainClock, type ArenaChainClockCommitment } from './arenaClock'

const NOW = 1_700_000_000

function commitment(over: Partial<ArenaChainClockCommitment> = {}): ArenaChainClockCommitment {
	return { height: 10, appHash: 'aaaa', time: NOW - 5, validatorPubkey: 'validator-1', relays: ['wss://a'], ...over }
}

describe('arenaChainClock — the anchored reading', () => {
	test('no commitment is honestly unknown: no time, no height, no age, never a zero', () => {
		const clock = arenaChainClock({ stateCommitments: [], commitmentForks: [], now: NOW })
		expect(clock.time).toBeNull()
		expect(clock.height).toBeNull()
		expect(clock.ageSec).toBeNull()
		expect(clock.freshness).toBe('unknown')
		expect(clock.rulesTime).toBeNull()
		expect(clock.rulesHeight).toBeNull()
		expect(clock.refusedHeights).toEqual([])
		expect(clock.regressionRefused).toBe(false)
	})

	test('a commitment anchors the clock: time, height, validator and relays, with an age and a fresh state', () => {
		const clock = arenaChainClock({
			stateCommitments: [commitment({ height: 42, time: NOW - 30, validatorPubkey: 'validator-9', relays: ['wss://a', 'wss://b'] })],
			commitmentForks: [],
			now: NOW,
		})
		expect(clock.time).toBe(NOW - 30)
		expect(clock.height).toBe(42)
		expect(clock.validatorPubkey).toBe('validator-9')
		expect(clock.relays).toEqual(['wss://a', 'wss://b'])
		expect(clock.ageSec).toBe(30)
		expect(clock.freshness).toBe('fresh')
		// The rules clock is the same anchored instant, named for the rules consumer.
		expect(clock.rulesTime).toBe(NOW - 30)
		expect(clock.rulesHeight).toBe(42)
	})

	test('the highest height wins, and the newest time at that height wins', () => {
		const clock = arenaChainClock({
			stateCommitments: [
				commitment({ height: 10, appHash: 'aaaa', time: NOW - 5 }),
				commitment({ height: 20, appHash: 'bbbb', time: NOW - 40 }),
				commitment({ height: 20, appHash: 'bbbb', time: NOW - 1 }),
			],
			commitmentForks: [],
			now: NOW,
		})
		expect(clock.height).toBe(20)
		expect(clock.time).toBe(NOW - 1)
		expect(clock.ageSec).toBe(1)
	})

	test('a commitment that states no time is unknown freshness but keeps its height, and the rules time is null', () => {
		const clock = arenaChainClock({ stateCommitments: [commitment({ height: 7, time: null })], commitmentForks: [], now: NOW })
		expect(clock.height).toBe(7)
		expect(clock.time).toBeNull()
		expect(clock.ageSec).toBeNull()
		expect(clock.freshness).toBe('unknown')
		expect(clock.rulesTime).toBeNull()
	})
})

describe('arenaChainClock — freshness thresholds', () => {
	test('at exactly the threshold the clock is still fresh', () => {
		const clock = arenaChainClock({
			stateCommitments: [commitment({ time: NOW - ARENA_CHAIN_CLOCK_STALE_AFTER_SEC })],
			commitmentForks: [],
			now: NOW,
		})
		expect(clock.ageSec).toBe(ARENA_CHAIN_CLOCK_STALE_AFTER_SEC)
		expect(clock.freshness).toBe('fresh')
	})

	test('past the threshold the clock is stale', () => {
		const clock = arenaChainClock({
			stateCommitments: [commitment({ time: NOW - ARENA_CHAIN_CLOCK_STALE_AFTER_SEC - 1 })],
			commitmentForks: [],
			now: NOW,
		})
		expect(clock.freshness).toBe('stale')
	})
})

describe('arenaChainClock — the fork refusal', () => {
	test('a forked height does not advance the rules clock; the next agreed height is used and the fork is named', () => {
		const clock = arenaChainClock({
			stateCommitments: [
				commitment({ height: 30, appHash: 'forked', time: NOW - 1 }),
				commitment({ height: 20, appHash: 'agreed', time: NOW - 10 }),
			],
			commitmentForks: [{ height: 30 }],
			now: NOW,
		})
		expect(clock.height).toBe(20)
		expect(clock.time).toBe(NOW - 10)
		expect(clock.refusedHeights).toEqual([30])
	})

	test('when every commitment is forked there is no agreed anchor, and the forks are named', () => {
		const clock = arenaChainClock({
			stateCommitments: [commitment({ height: 30, appHash: 'forked', time: NOW - 1 })],
			commitmentForks: [{ height: 30 }],
			now: NOW,
		})
		expect(clock.time).toBeNull()
		expect(clock.height).toBeNull()
		expect(clock.freshness).toBe('unknown')
		expect(clock.refusedHeights).toEqual([30])
	})
})

describe('arenaChainClock — the monotonic guard', () => {
	test('a later reading at a lower height is refused: the clock keeps the earlier reading and says so', () => {
		const previous = arenaChainClock({ stateCommitments: [commitment({ height: 50, time: NOW - 5 })], commitmentForks: [], now: NOW })
		const next = arenaChainClock({
			stateCommitments: [commitment({ height: 40, time: NOW + 1 })],
			commitmentForks: [],
			now: NOW + 10,
			previous,
		})
		expect(next.height).toBe(50)
		expect(next.time).toBe(NOW - 5)
		expect(next.ageSec).toBe(15)
		expect(next.regressionRefused).toBe(true)
	})

	test('a later reading at the same height with an older time is refused', () => {
		const previous = arenaChainClock({ stateCommitments: [commitment({ height: 50, time: NOW - 1 })], commitmentForks: [], now: NOW })
		const next = arenaChainClock({
			stateCommitments: [commitment({ height: 50, time: NOW - 5 })],
			commitmentForks: [],
			now: NOW,
			previous,
		})
		expect(next.time).toBe(NOW - 1)
		expect(next.regressionRefused).toBe(true)
	})

	test('a later reading at the same height with a newer time advances (the heartbeat case)', () => {
		const previous = arenaChainClock({ stateCommitments: [commitment({ height: 50, time: NOW - 5 })], commitmentForks: [], now: NOW })
		const next = arenaChainClock({
			stateCommitments: [commitment({ height: 50, time: NOW - 1 })],
			commitmentForks: [],
			now: NOW,
			previous,
		})
		expect(next.time).toBe(NOW - 1)
		expect(next.regressionRefused).toBe(false)
	})

	test('a later reading at a higher height advances', () => {
		const previous = arenaChainClock({ stateCommitments: [commitment({ height: 50, time: NOW - 5 })], commitmentForks: [], now: NOW })
		const next = arenaChainClock({
			stateCommitments: [commitment({ height: 60, time: NOW + 1 })],
			commitmentForks: [],
			now: NOW + 1,
			previous,
		})
		expect(next.height).toBe(60)
		expect(next.regressionRefused).toBe(false)
	})

	test('a reading with no agreed commitment holds the last known anchor rather than blanking it', () => {
		const previous = arenaChainClock({ stateCommitments: [commitment({ height: 50, time: NOW - 5 })], commitmentForks: [], now: NOW })
		const next = arenaChainClock({ stateCommitments: [], commitmentForks: [], now: NOW + 20, previous })
		expect(next.height).toBe(50)
		expect(next.time).toBe(NOW - 5)
		expect(next.ageSec).toBe(25)
		expect(next.regressionRefused).toBe(false)
	})
})
