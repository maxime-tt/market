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
	arenaBidFloor,
	bidBlockedCopy,
	checkArenaBid,
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
		phase: 'open',
		verdict: null,
		verdictCount: 0,
		validatorCount: 0,
		divergent: false,
		relayCount: 2,
		description: null,
		minIncrement: 100,
		reserve: null,
		durationSeconds: 3600,
		lateBidWindowSeconds: null,
		lateBidExtensionSeconds: null,
		maxTotalExtensionSeconds: null,
		locktimeSeconds: null,
		fundingMode: null,
		versions: 1,
		rootEventId: 'root-event-1',
		canonicalEventId: 'root-event-1',
		rootCreatedAt: 1000,
		bids: [],
		positions: [],
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

describe('arenaBidFloor — the floor comes from the create, never a guess', () => {
	test('no bids: the opening price is the starting bid', () => {
		expect(arenaBidFloor(detail(), null)).toEqual({ kind: 'first', minimum: 1000, topTotal: null })
	})

	test('a top bid: the next must reach top + min_increment', () => {
		expect(arenaBidFloor(detail({ bidCount: 1, topBidTotal: 1000 }), null)).toEqual({ kind: 'raise', minimum: 1100, topTotal: 1000 })
	})

	test('an unstated min_increment is not zero: the floor is one sat above the top', () => {
		expect(arenaBidFloor(detail({ bidCount: 1, topBidTotal: 1000, minIncrement: null }), null)).toEqual({
			kind: 'raise',
			minimum: 1001,
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

	test('a bidder already at the top need only reach the top, not outbid themselves', () => {
		expect(arenaBidFloor(detail({ bidCount: 1, topBidTotal: 1000 }), 1000)).toEqual({ kind: 'raise', minimum: 1000, topTotal: 1000 })
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

describe('checkArenaBid — the amount check', () => {
	test('an amount at the floor is allowed', () => {
		const check = checkArenaBid(input({ raw: '1000' }))
		expect(check).toMatchObject({ allowed: true, reason: 'ok', amount: 1000, minimum: 1000, ownPosition: null })
	})

	test('below the floor is refused, and names the floor', () => {
		const check = checkArenaBid(input({ raw: '999' }))
		expect(check).toMatchObject({ allowed: false, reason: 'below-minimum', amount: 999, minimum: 1000 })
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

	test('bids are DELTAS: a bidder at 1000 who bids 100 reaches 1100 and is allowed', () => {
		const model = detail({ bidCount: 1, topBidTotal: 1000, positions: [{ bidder: BIDDER, total: 1000 }] })
		const check = checkArenaBid(input({ model, raw: '100' }))
		// 100 alone is far below the floor; 1000 + 100 is not.
		expect(check).toMatchObject({ allowed: true, reason: 'ok', amount: 100, minimum: 1000, ownPosition: 1000 })
	})

	test('a bidder at 1000 who bids 1 on a 1000 floor is refused — their position would be 1001, below a 1100 raise floor', () => {
		const model = detail({ bidCount: 1, topBidTotal: 1500, positions: [{ bidder: BIDDER, total: 1000 }] })
		const check = checkArenaBid(input({ model, raw: '1' }))
		expect(check).toMatchObject({ allowed: false, reason: 'below-minimum', minimum: 1600, ownPosition: 1000 })
	})

	test('someone else’s position is not the viewer’s', () => {
		const model = detail({ bidCount: 1, topBidTotal: 1000, positions: [{ bidder: OTHER, total: 1000 }] })
		expect(checkArenaBid(input({ model, raw: '100' }))).toMatchObject({ allowed: false, reason: 'below-minimum', ownPosition: null })
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
	]

	test('every reason except "ok" renders a non-empty sentence', () => {
		for (const reason of reasons) {
			expect(bidBlockedCopy(reason, { minimum: 1000, ownPosition: null }).length).toBeGreaterThan(0)
		}
		expect(bidBlockedCopy('ok', { minimum: null, ownPosition: null })).toBe('')
	})

	test('the below-minimum sentence states the floor in sats and says bids are deltas', () => {
		expect(bidBlockedCopy('below-minimum', { minimum: 1600, ownPosition: 1000 })).toContain('1,600 sats')
		expect(bidBlockedCopy('below-minimum', { minimum: 1600, ownPosition: 1000 })).toContain('adds to your position')
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