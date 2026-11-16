/**
 * platform/web/notifications/arenaMonitorRules.test.ts — the monitor's arena mapping.
 *
 * Two directions are pinned for every branch:
 *
 *   - a **retired** 30408 / 1023 / 1024 event arriving produces nothing at all (no key, no phase, no
 *     position) — the branch is gone, not a no-op that silently keeps a listener alive;
 *   - the equivalent **arena** event produces the path the monitor then acts on.
 */
import { describe, expect, test } from 'bun:test'
import {
	arenaBidBinding,
	arenaBidPositions,
	arenaCreateIdentity,
	arenaNotificationKey,
	arenaPhaseWindow,
	arenaVerdictKey,
	type ArenaEventLike,
	type ArenaPositionBid,
} from './arenaMonitorRules'

const SELLER = 'a'.repeat(64)
const BIDDER = 'b'.repeat(64)
const OTHER_BIDDER = 'c'.repeat(64)
const COORDINATE = `1440:${SELLER}:lot-1`

const event = (overrides: Partial<ArenaEventLike> & { kind: number }): ArenaEventLike => ({
	pubkey: SELLER,
	created_at: 1_700_000_000,
	tags: [],
	content: '',
	...overrides,
})

const create = (overrides: Partial<ArenaEventLike> & { content?: string } = {}): ArenaEventLike =>
	event({
		kind: 1440,
		tags: [['d', 'lot-1']],
		content: JSON.stringify({ auction_id: 'lot-1', startPrice: 1000, durationSec: 3600 }),
		...overrides,
	})

const bid = (bidder: string, amount: number): ArenaEventLike =>
	event({
		kind: 1441,
		pubkey: bidder,
		tags: [
			['e', 'root-event-id'],
			['a', COORDINATE],
		],
		content: JSON.stringify({ auction: COORDINATE, auction_id: 'lot-1', amount }),
	})

const verdict = (auction: string, overrides: Partial<ArenaEventLike> = {}): ArenaEventLike =>
	event({
		kind: 1445,
		pubkey: 'd'.repeat(64),
		tags: [['auction', auction]],
		content: JSON.stringify({ schema: 'arena.verdict.v1', outcome: 'winner', auction_id: auction }),
		...overrides,
	})

// ---------------------------------------------------------------------------
// The retired series: every rule answers "nothing"
// ---------------------------------------------------------------------------

describe('retired 30408-family events produce nothing', () => {
	test('a 30408 listing has no arena identity, key or phase', () => {
		const retired = event({
			kind: 30408,
			tags: [['d', 'lot-1']],
			content: JSON.stringify({ auction_id: 'lot-1', start_at: 1_700_000_000, end_at: 1_700_003_600 }),
		})

		expect(arenaCreateIdentity(retired)).toBeNull()
		expect(arenaNotificationKey(retired)).toBe('')
		expect(arenaPhaseWindow(retired)).toBeNull()
	})

	test('a 1023 bid is not bound to any lot', () => {
		const retiredBid = event({
			kind: 1023,
			pubkey: BIDDER,
			tags: [
				['a', `30408:${SELLER}:lot-1`],
				['e', 'root-event-id'],
			],
			content: JSON.stringify({ amount: 5000 }),
		})

		expect(arenaBidBinding(retiredBid)).toBeNull()
	})

	test('a 1024 settlement is not a verdict for a watched lot', () => {
		const retiredSettlement = event({
			kind: 1024,
			tags: [
				['a', `30408:${SELLER}:lot-1`],
				['auction', 'lot-1'],
			],
			content: JSON.stringify({ outcome: 'winner' }),
		})

		expect(arenaVerdictKey(retiredSettlement, [{ coordinate: COORDINATE, d: 'lot-1' }])).toBe('')
	})
})

// ---------------------------------------------------------------------------
// The arena series: the equivalent path
// ---------------------------------------------------------------------------

describe('arena creates', () => {
	test('a 1440 create keys the lot by its 1440 coordinate', () => {
		expect(arenaCreateIdentity(create())).toEqual({ d: 'lot-1', coordinate: COORDINATE, supersedes: '' })
		expect(arenaNotificationKey(create())).toBe(COORDINATE)
	})

	test('a d / content.auction_id disagreement is refused, never reconciled', () => {
		const mismatched = event({
			kind: 1440,
			tags: [['d', 'lot-1']],
			content: JSON.stringify({ auction_id: 'lot-2' }),
		})

		expect(arenaCreateIdentity(mismatched)).toBeNull()
		expect(arenaNotificationKey(mismatched)).toBe('')
	})

	test('the root create announces the phase window from created_at + durationSec', () => {
		expect(arenaPhaseWindow(create())).toEqual({ startAt: 1_700_000_000, cutoffAt: 1_700_003_600 })
	})

	test('a create with no duration states no cutoff', () => {
		const openEnded = create({ content: JSON.stringify({ auction_id: 'lot-1' }) })
		expect(arenaPhaseWindow(openEnded)).toEqual({ startAt: 1_700_000_000, cutoffAt: null })
	})

	test('a superseding version does not re-announce a start', () => {
		const update = create({
			tags: [
				['d', 'lot-1'],
				['e', 'root-event-id'],
			],
			created_at: 1_700_000_900,
		})

		// still the same lot for routing…
		expect(arenaNotificationKey(update)).toBe(COORDINATE)
		// …but never a phase transition
		expect(arenaPhaseWindow(update)).toBeNull()
	})
})

describe('arena bids', () => {
	test('a 1441 bid binds to its coordinate, root and delta', () => {
		expect(arenaBidBinding(bid(BIDDER, 5_000))).toEqual({
			coordinate: COORDINATE,
			rootEventId: 'root-event-id',
			auctionId: 'lot-1',
			amount: 5_000,
		})
	})

	test('a non-arena `a` tag is not treated as a coordinate', () => {
		const foreign = event({
			kind: 1441,
			tags: [['a', `30408:${SELLER}:lot-1`]],
			content: JSON.stringify({ amount: 1 }),
		})

		expect(arenaBidBinding(foreign)?.coordinate).toBe('')
	})

	test('an unreadable amount binds the bid with no money', () => {
		const noAmount = event({ kind: 1441, tags: [['a', COORDINATE]], content: JSON.stringify({ auction_id: 'lot-1' }) })
		expect(arenaBidBinding(noAmount)?.amount).toBeNull()
	})

	test('positions are summed from deltas, per lot and per bidder', () => {
		const positionBid = (bidder: string, amount: number | null): ArenaPositionBid => ({
			bidder,
			coordinate: COORDINATE,
			rootEventId: 'root-event-id',
			auctionId: 'lot-1',
			amount,
		})
		const bids: ArenaPositionBid[] = [
			positionBid(BIDDER, 5_000),
			positionBid(BIDDER, 2_500),
			positionBid(OTHER_BIDDER, 9_000),
			// an unreadable amount contributes no position
			positionBid(OTHER_BIDDER, null),
			// a bid bound to no lot is not counted anywhere
			{ bidder: OTHER_BIDDER, coordinate: '', rootEventId: '', auctionId: '', amount: 1_000 },
		]

		expect(arenaBidPositions(bids)).toEqual({
			[COORDINATE]: { [BIDDER]: 7_500, [OTHER_BIDDER]: 9_000 },
		})
	})
})

describe('arena verdicts', () => {
	const watched = [{ coordinate: COORDINATE, d: 'lot-1' }]

	test('a verdict naming the watched coordinate binds to the watched lot', () => {
		expect(arenaVerdictKey(verdict(COORDINATE), watched)).toBe(COORDINATE)
	})

	test('a verdict naming only the d binds when exactly one watched lot carries it', () => {
		expect(arenaVerdictKey(verdict('lot-1'), watched)).toBe(COORDINATE)
	})

	test('an ambiguous d binds to nothing', () => {
		const twoLots = [watched[0], { coordinate: `1440:${OTHER_BIDDER}:lot-1`, d: 'lot-1' }]
		expect(arenaVerdictKey(verdict('lot-1'), twoLots)).toBe('')
	})

	test('a verdict for a lot the user does not watch binds to nothing', () => {
		expect(arenaVerdictKey(verdict(`1440:${SELLER}:other-lot`), watched)).toBe('')
	})

	test('a verdict with no auction id at all binds to nothing', () => {
		const anonymous = event({ kind: 1445, tags: [], content: JSON.stringify({ outcome: 'winner' }) })
		expect(arenaVerdictKey(anonymous, watched)).toBe('')
	})
})