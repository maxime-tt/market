/**
 * `ui/auction/arena/bid-rules.test.ts` — the bid entry's validation and copy.
 *
 * Pure functions, no renderer: what is under test is the rule (money is integer
 * sats, bids are deltas, every blocking state is a state *before* any amount
 * rule) and the fact that every reason has words.
 *
 * Pubkeys are short and non-hex on purpose — a 64-hex literal in a test file is
 * indistinguishable from a key to the pre-commit scanner.
 */
import { describe, expect, test } from 'bun:test'
import {
	ARENA_BID_ADVISORY,
	ARENA_BIDDER_SIGNED_OUT,
	arenaBidBlock,
	arenaBidDelta,
	arenaBidFloor,
	arenaRequiredRaise,
	bidBlockedCopy,
	checkArenaBid,
	ownArenaPosition,
	parseBidAmountSats,
	type ArenaBidBlockedReason,
	type ArenaBidCheckInput,
	type ArenaBidderState,
} from './bid-rules'
import type { ArenaAuctionDetailModel } from './model'

const SELLER = 'seller-alice'
const BIDDER = 'bidder-bob'
const OTHER = 'bidder-carol'

const SIGNED_IN: ArenaBidderState = { pubkey: BIDDER, wallet: 'ready' }

/** The chain's acceptance of the fixture lot: the fact the gate follows a lot on. */
const ACCEPTED = { accepted: true, acceptedHeight: 4210, admitEventId: 'admit-event-1' } as const

function detail(over: Partial<ArenaAuctionDetailModel> = {}): ArenaAuctionDetailModel {
	return {
		coordinate: `1440:${SELLER}:lot-1`,
		seller: SELLER,
		d: 'lot-1',
		title: 'A handmade mug',
		imageUrl: null,
		startingBid: 1000,
		topBidTotal: null,
		bidCount: 0,
		bidsWithoutAmount: 0,
		endsAt: 4600,
		endSource: 'create-derived',
		createDerivedEndsAt: 4600,
		committedEndHeight: null,
		committedEndOrdinal: null,
		phase: 'open',
		verdict: null,
		verdictCount: 0,
		validatorCount: 0,
		divergent: false,
		relayCount: 2,
		description: null,
		media: [],
		minIncrement: 100,
		minIncrementBps: 200,
		mode: 'fixed',
		windowSec: null,
		durationSec: 3600,
		sellerWallet: null,
		v4vSplit: null,
		versions: 1,
		rootEventId: 'root-event-1',
		canonicalEventId: 'root-event-1',
		rootCreatedAt: 1000,
		bids: [],
		positions: [],
		receipts: [],
		refundsByBidder: {},
		settleReceipt: null,
		createRefusal: null,
		acceptance: ACCEPTED,
		bidRefusals: {},
		admissions: {},
		...over,
	}
}

function input(over: Partial<ArenaBidCheckInput> = {}): ArenaBidCheckInput {
	return { model: detail(), status: 'settled', now: 2000, bidder: SIGNED_IN, raw: '1000', ...over }
}

// =========================================================================
// The money rule: integer sats and nothing else
// =========================================================================

describe('parseBidAmountSats — money is an integer number of sats', () => {
	test('accepts digits, with paste whitespace', () => {
		expect(parseBidAmountSats('1000')).toBe(1000)
		expect(parseBidAmountSats(' 1,000 '.replace(',', ''))).toBe(1000)
		expect(parseBidAmountSats(2500)).toBe(2500)
	})

	test('refuses a decimal rather than rounding it', () => {
		// parseInt would make this 10 — an amount the bidder never typed.
		expect(parseBidAmountSats('10.9')).toBeNull()
		expect(parseBidAmountSats('10.0')).toBeNull()
	})

	test('refuses the shapes Number() accepts and a bidder never types', () => {
		expect(parseBidAmountSats('')).toBeNull()
		expect(parseBidAmountSats('   ')).toBeNull()
		expect(parseBidAmountSats('1e3')).toBeNull()
		expect(parseBidAmountSats('0x10')).toBeNull()
		expect(parseBidAmountSats('-5')).toBeNull()
		expect(parseBidAmountSats('+5')).toBeNull()
		expect(parseBidAmountSats('1 000')).toBeNull()
		expect(parseBidAmountSats('Infinity')).toBeNull()
		expect(parseBidAmountSats(Number.NaN)).toBeNull()
	})

	test('refuses a number too large to be a safe integer, because it would lose precision exactly when it becomes money', () => {
		expect(parseBidAmountSats('9007199254740993')).toBeNull()
		expect(parseBidAmountSats('9007199254740991')).toBe(9007199254740991)
	})

	test('null and undefined are not zero sats', () => {
		expect(parseBidAmountSats(null)).toBeNull()
		expect(parseBidAmountSats(undefined)).toBeNull()
	})
})

// =========================================================================
// The floor: published terms, and bids are deltas
// =========================================================================

describe('arenaRequiredRaise — the chain’s raise rule, in one place', () => {
	test('2% of the top, rounded up', () => {
		expect(arenaRequiredRaise(1_000, 200)).toBe(20)
		expect(arenaRequiredRaise(101, 200)).toBe(3)
	})

	test('never below one sat, even for a tiny or zero top', () => {
		expect(arenaRequiredRaise(50, 200)).toBe(1)
		expect(arenaRequiredRaise(1, 200)).toBe(1)
		expect(arenaRequiredRaise(0, 0)).toBe(1)
	})
})

describe('arenaBidFloor — the floor comes from the terms, never a guess', () => {
	test('no bids: the opening price is the starting bid', () => {
		expect(arenaBidFloor(detail(), null)).toEqual({ kind: 'first', minimum: 1000, topTotal: null })
	})

	test('a top bid: the next must reach top + the chain’s required raise', () => {
		// top 1000 at 200 bps → raise 20 → 1020.
		expect(arenaBidFloor(detail({ bidCount: 1, topBidTotal: 1000 }), null)).toEqual({
			kind: 'raise',
			minimum: 1020,
			topTotal: 1000,
		})
	})

	test('the raise is the rule, not a static increment: a 50-top raises by 1, a 101-top by 3', () => {
		expect(arenaBidFloor(detail({ bidCount: 1, topBidTotal: 50 }), null)).toEqual({ kind: 'raise', minimum: 51, topTotal: 50 })
		expect(arenaBidFloor(detail({ bidCount: 1, topBidTotal: 101 }), null)).toEqual({ kind: 'raise', minimum: 104, topTotal: 101 })
	})

	test('the lot’s create-time min_increment is not the raise: a different one changes nothing', () => {
		expect(arenaBidFloor(detail({ bidCount: 1, topBidTotal: 1000, minIncrement: 1 }), null)).toEqual({
			kind: 'raise',
			minimum: 1020,
			topTotal: 1000,
		})
		expect(arenaBidFloor(detail({ bidCount: 1, topBidTotal: 1000, minIncrement: 99999 }), null)).toEqual({
			kind: 'raise',
			minimum: 1020,
			topTotal: 1000,
		})
	})

	test('the leader’s own raise is subject to the rule too', () => {
		// The chain no longer exempts a leader’s self-raise: the bidder at the top
		// must still clear it by the required raise, not merely reach it.
		expect(arenaBidFloor(detail({ bidCount: 1, topBidTotal: 1000 }), 1000)).toEqual({
			kind: 'raise',
			minimum: 1020,
			topTotal: 1000,
		})
	})

	test('params unread (bps null) with a top: no invented floor', () => {
		expect(arenaBidFloor(detail({ bidCount: 1, topBidTotal: 1000, minIncrementBps: null }), null)).toEqual({
			kind: 'unknown',
			minimum: null,
			topTotal: 1000,
		})
	})

	test('an unstated starting_bid gives no floor at all — not zero', () => {
		expect(arenaBidFloor(detail({ startingBid: null }), null)).toEqual({ kind: 'unknown', minimum: null, topTotal: null })
	})

	test('bids with no readable amount make the top unknown, so the raise floor is unknown', () => {
		expect(arenaBidFloor(detail({ bidCount: 1, topBidTotal: null, bidsWithoutAmount: 1 }), null)).toEqual({
			kind: 'unknown',
			minimum: null,
			topTotal: null,
		})
	})
})

// =========================================================================
// The bidder's own position, and the one intent → delta conversion
// =========================================================================

describe('ownArenaPosition — what the bidder already holds, never a guessed zero', () => {
	test('the live leg sum is the position', () => {
		const model = detail({ positions: [{ bidder: BIDDER, total: 100 }] })
		expect(ownArenaPosition(model, BIDDER, 'settled')).toBe(100)
	})

	test('a position the read could not settle is null, not zero', () => {
		const model = detail({ positions: [{ bidder: BIDDER, total: null }] })
		expect(ownArenaPosition(model, BIDDER, 'settled')).toBeNull()
	})

	test('a settled read with no leg for the bidder is a real zero', () => {
		expect(ownArenaPosition(detail(), BIDDER, 'settled')).toBe(0)
	})

	test('an unsettled read with no leg read is null: absence is not evidence of zero', () => {
		for (const status of ['loading', 'incomplete', 'no-relays', 'error'] as const) {
			expect(ownArenaPosition(detail(), BIDDER, status)).toBeNull()
		}
	})

	test('no model or no bidder is unknown', () => {
		expect(ownArenaPosition(null, BIDDER, 'settled')).toBeNull()
		expect(ownArenaPosition(detail(), null, 'settled')).toBeNull()
	})
})

describe('arenaBidDelta — the ONE conversion from an intended position to a chain delta', () => {
	test('the maintainer’s case: a 100-sat position and a 102-sat intent publish 2', () => {
		expect(arenaBidDelta(100, 102)).toBe(2)
	})

	test('a first bidder adds the whole intent', () => {
		expect(arenaBidDelta(0, 102)).toBe(102)
	})

	test('an intent at or below the position is not a raise', () => {
		expect(arenaBidDelta(100, 100)).toBe(0)
		expect(arenaBidDelta(100, 40)).toBe(-60)
	})

	test('an unknown own position yields null, never the whole intent', () => {
		expect(arenaBidDelta(null, 102)).toBeNull()
	})
})

// =========================================================================
// Blocking states outrank amount states
// =========================================================================

describe('arenaBidBlock — every reason bidding is not offered', () => {
	test('bidding is open for a signed-in bidder on someone else’s live auction', () => {
		expect(arenaBidBlock(detail(), 'settled', 2000, SIGNED_IN)).toBeNull()
	})

	test('nothing read', () => {
		expect(arenaBidBlock(null, 'settled', 2000, SIGNED_IN)).toBe('auction-not-read')
		expect(arenaBidBlock(null, 'loading', 2000, SIGNED_IN)).toBe('auction-not-read')
	})

	test('a published verdict concludes the auction even before the clock says so', () => {
		expect(arenaBidBlock(detail({ verdict: 'winner' }), 'settled', 2000, SIGNED_IN)).toBe('concluded')
	})

	test('an auction with no stated end has no open window', () => {
		expect(arenaBidBlock(detail({ phase: 'unknown', endsAt: null }), 'settled', 2000, SIGNED_IN)).toBe('end-unknown')
	})

	test('a lot the chain has not accepted is not biddable, whatever its clock says', () => {
		const unaccepted = detail({ phase: 'unaccepted', acceptance: { accepted: false, acceptedHeight: null, admitEventId: null } })
		expect(arenaBidBlock(unaccepted, 'settled', 2000, SIGNED_IN)).toBe('not-accepted')
		// The gate outranks the clock in both directions: an unaccepted lot is not
		// "ended", and its create-derived end can never open it for bidding.
		expect(arenaBidBlock(unaccepted, 'settled', 7000, SIGNED_IN)).toBe('not-accepted')
	})

	test('ended by the clock, and ended by the recorded phase', () => {
		expect(arenaBidBlock(detail(), 'settled', 4600, SIGNED_IN)).toBe('ended')
		expect(arenaBidBlock(detail({ phase: 'ended' }), 'settled', 2000, SIGNED_IN)).toBe('ended')
	})

	test('the seller may not bid on their own auction', () => {
		expect(arenaBidBlock(detail(), 'settled', 2000, { pubkey: SELLER, wallet: 'ready' })).toBe('own-auction')
	})

	test('signed out: no wallet, distinct from a wallet that is not ready', () => {
		expect(arenaBidBlock(detail(), 'settled', 2000, ARENA_BIDDER_SIGNED_OUT)).toBe('no-wallet')
		expect(arenaBidBlock(detail(), 'settled', 2000, { pubkey: BIDDER, wallet: 'unavailable' })).toBe('wallet-unavailable')
		expect(arenaBidBlock(detail(), 'settled', 2000, { pubkey: BIDDER, wallet: 'missing' })).toBe('wallet-unavailable')
	})

	test('the seller-block outranks the wallet check: the seller sees why they cannot bid, not a wallet problem', () => {
		expect(arenaBidBlock(detail(), 'settled', 2000, { pubkey: SELLER, wallet: 'unavailable' })).toBe('own-auction')
	})
})

describe('checkArenaBid — the typed position, and the delta it publishes', () => {
	test('an intent at the floor on a lot with no bids is allowed, and publishes the whole intent', () => {
		const check = checkArenaBid(input({ raw: '1000' }))
		expect(check).toMatchObject({ allowed: true, reason: 'ok', amount: 1000, minimum: 1000, ownPosition: 0 })
	})

	test('the maintainer’s case: own 100, intent 102 → published delta 2, position 102', () => {
		// top 100 at 200 bps → required raise 2 → the floor is 102. The bidder
		// already holds 100 and types 102 (the number the panel showed); the delta
		// the chain is handed is 2, not 102, so their position becomes 102.
		const model = detail({ bidCount: 1, topBidTotal: 100, positions: [{ bidder: BIDDER, total: 100 }] })
		const check = checkArenaBid(input({ model, raw: '102' }))
		expect(check).toMatchObject({ allowed: true, reason: 'ok', amount: 2, minimum: 102, ownPosition: 100 })
		expect(check.ownPosition! + check.amount!).toBe(102)
	})

	test('a non-leader with no position publishes the whole intent as the delta', () => {
		const model = detail({ bidCount: 1, topBidTotal: 100 })
		const check = checkArenaBid(input({ model, raw: '102' }))
		expect(check).toMatchObject({ allowed: true, reason: 'ok', amount: 102, minimum: 102, ownPosition: 0 })
	})

	test('below the floor is refused, and names the floor', () => {
		const check = checkArenaBid(input({ raw: '999' }))
		expect(check).toMatchObject({ allowed: false, reason: 'below-minimum', amount: 999, minimum: 1000 })
	})

	test('an intent at or below the bidder’s own position is refused — nothing to add', () => {
		const model = detail({ bidCount: 1, topBidTotal: 100, positions: [{ bidder: BIDDER, total: 100 }] })
		// The floor is 102; 100 leaves the position where it is and 40 would lower it.
		expect(checkArenaBid(input({ model, raw: '100' }))).toMatchObject({
			allowed: false,
			reason: 'at-or-below-own-position',
			amount: null,
			ownPosition: 100,
		})
		expect(checkArenaBid(input({ model, raw: '40' }))).toMatchObject({
			allowed: false,
			reason: 'at-or-below-own-position',
			amount: null,
			ownPosition: 100,
		})
	})

	test('a delta of zero or negative is never signed: `amount` stays null', () => {
		const model = detail({ bidCount: 1, topBidTotal: 100, positions: [{ bidder: BIDDER, total: 100 }] })
		expect(checkArenaBid(input({ model, raw: '100' })).amount).toBeNull()
		expect(checkArenaBid(input({ model, raw: '1' })).amount).toBeNull()
	})

	test('no amount is allowed on a lot the chain has not accepted', () => {
		// A big number is not the fix for the gate: `not-accepted` outranks every
		// amount rule, so the reason never becomes `ok`.
		const check = checkArenaBid(input({ model: detail({ phase: 'unaccepted' }), raw: '999999' }))
		expect(check).toMatchObject({ allowed: false, reason: 'not-accepted' })
	})

	test('empty, zero and non-integer each have their own reason', () => {
		expect(checkArenaBid(input({ raw: '' })).reason).toBe('empty')
		expect(checkArenaBid(input({ raw: '0' })).reason).toBe('zero')
		expect(checkArenaBid(input({ raw: '1000.5' })).reason).toBe('not-integer-sats')
	})

	test('a blocking reason outranks the amount: an ended auction is ended even with a valid number', () => {
		const check = checkArenaBid(input({ now: 9000, raw: '5000' }))
		expect(check).toMatchObject({ allowed: false, reason: 'ended', amount: 5000 })
	})

	test('an empty box on an ended auction says ended, not empty', () => {
		expect(checkArenaBid(input({ now: 9000, raw: '' })).reason).toBe('ended')
	})

	test('a bidder at 1000 who intends 1001 on a leader at 1500 is refused — that position is below the 1530 floor', () => {
		const model = detail({ bidCount: 1, topBidTotal: 1500, positions: [{ bidder: BIDDER, total: 1000 }] })
		const check = checkArenaBid(input({ model, raw: '1001' }))
		expect(check).toMatchObject({ allowed: false, reason: 'below-minimum', minimum: 1530, ownPosition: 1000, amount: 1 })
	})

	test('a raise one sat below the required raise is refused locally', () => {
		// top 1000 at 200 bps → required raise 20 → the next position must reach 1020.
		const model = detail({ bidCount: 1, topBidTotal: 1000 })
		expect(checkArenaBid(input({ model, raw: '1020' }))).toMatchObject({ allowed: true, reason: 'ok', minimum: 1020 })
		expect(checkArenaBid(input({ model, raw: '1019' }))).toMatchObject({
			allowed: false,
			reason: 'below-minimum',
			minimum: 1020,
		})
	})

	test('the leader’s own raise is held to the same rule: reaching the top is not raising it', () => {
		const model = detail({ bidCount: 1, topBidTotal: 1000, positions: [{ bidder: BIDDER, total: 1000 }] })
		// A self-raise to the top itself has no delta; the chain's 2% raise puts
		// the floor at 1020, so the leader must intend at least that.
		expect(checkArenaBid(input({ model, raw: '1000' }))).toMatchObject({
			allowed: false,
			reason: 'at-or-below-own-position',
			ownPosition: 1000,
		})
		expect(checkArenaBid(input({ model, raw: '1020' }))).toMatchObject({
			allowed: true,
			reason: 'ok',
			amount: 20,
			minimum: 1020,
			ownPosition: 1000,
		})
	})

	test('an unsettled own position is refused, never treated as zero', () => {
		// The bidder’s entry carries `null`: a leg whose liveness the read could
		// not vouch for. The delta cannot be known, so the check refuses rather
		// than publishing the whole intent.
		const model = detail({ bidCount: 1, topBidTotal: 100, positions: [{ bidder: BIDDER, total: null }] })
		expect(checkArenaBid(input({ model, raw: '102' }))).toMatchObject({
			allowed: false,
			reason: 'own-position-unknown',
			amount: null,
			ownPosition: null,
		})
	})

	test('an unsettled read with no leg for the bidder is refused, never a guessed zero', () => {
		expect(checkArenaBid(input({ status: 'incomplete', raw: '102' }))).toMatchObject({
			allowed: false,
			reason: 'own-position-unknown',
			ownPosition: null,
		})
	})

	test('params unread: a raise floor is not invented', () => {
		const model = detail({ bidCount: 1, topBidTotal: 1000, minIncrementBps: null })
		const check = checkArenaBid(input({ model, raw: '5000' }))
		expect(check).toMatchObject({ allowed: false, reason: 'read-incomplete', minimum: null })
	})

	test('someone else’s position is not the viewer’s: a settled read with no leg is a real zero', () => {
		const model = detail({ bidCount: 1, topBidTotal: 1000, positions: [{ bidder: OTHER, total: 1000 }] })
		expect(checkArenaBid(input({ model, raw: '100' }))).toMatchObject({
			allowed: false,
			reason: 'below-minimum',
			ownPosition: 0,
			amount: 100,
		})
	})

	test('no starting_bid: refused as unstated, not as zero', () => {
		const check = checkArenaBid(input({ model: detail({ startingBid: null }), raw: '5000' }))
		expect(check).toMatchObject({ allowed: false, reason: 'no-starting-bid', minimum: null })
	})

	test('an unreadable bid makes the next amount unverifiable rather than allowed', () => {
		const check = checkArenaBid(input({ model: detail({ bidCount: 2, topBidTotal: null, bidsWithoutAmount: 1 }), raw: '5000' }))
		expect(check).toMatchObject({ allowed: false, reason: 'read-incomplete', minimum: null })
	})
})

// =========================================================================
// Every reason has words
// =========================================================================

describe('bidBlockedCopy — no disabled button without a sentence', () => {
	const reasons: ArenaBidBlockedReason[] = [
		'auction-not-read',
		'read-incomplete',
		'end-unknown',
		'ended',
		'not-accepted',
		'not-started',
		'own-auction',
		'no-wallet',
		'wallet-unavailable',
		'concluded',
		'empty',
		'not-integer-sats',
		'zero',
		'no-starting-bid',
		'below-minimum',
		'at-or-below-own-position',
		'own-position-unknown',
	]

	test('every reason except "ok" renders a non-empty sentence', () => {
		for (const reason of reasons) {
			expect(bidBlockedCopy(reason, { minimum: 1000, ownPosition: null }).length).toBeGreaterThan(0)
		}
		expect(bidBlockedCopy('ok', { minimum: null, ownPosition: null })).toBe('')
	})

	test('the below-minimum sentence names the position the bid must reach, and the one held', () => {
		const copy = bidBlockedCopy('below-minimum', { minimum: 1600, ownPosition: 1000 })
		expect(copy).toContain('1,600 sats')
		expect(copy).toContain('1,000 sats')
		expect(copy).toContain('must reach')
	})

	test('the own-position reasons are about the position, and the unknown one refuses to guess', () => {
		expect(bidBlockedCopy('at-or-below-own-position', { minimum: 1600, ownPosition: 1000 })).toContain('1,000 sats')
		expect(bidBlockedCopy('own-position-unknown', { minimum: 1000, ownPosition: null })).toContain('reload')
	})

	test('a decimal is explained, never silently rounded', () => {
		expect(bidBlockedCopy('not-integer-sats', { minimum: null, ownPosition: null })).toContain('whole')
	})

	test('no reason implies acceptance or an outcome', () => {
		for (const reason of reasons) {
			const copy = bidBlockedCopy(reason, { minimum: 1000, ownPosition: null }).toLowerCase()
			expect(copy).not.toContain('you win')
			expect(copy).not.toContain('accepted your bid')
		}
	})

	test('the advisory says the app cannot accept a bid and that no funds move', () => {
		expect(ARENA_BID_ADVISORY).toContain('cannot accept or refuse a bid')
		expect(ARENA_BID_ADVISORY).toContain('No funds move')
	})
})
