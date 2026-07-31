import { describe, expect, test } from 'bun:test'
import { validateSettlementEventLocalOnly } from '../auction/validation'
import type { ParsedAuctionEvent, ParsedSettlementEvent } from '../auction/events'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SELLER_PUBKEY = 'a'.repeat(64)
const OTHER_PUBKEY = 'b'.repeat(64)
const AUCTION_ROOT = 'auction-root-event-id'
const AUCTION_COORD = `30408:${SELLER_PUBKEY}:d-tag-123`
const AUCTION_MAX_END_AT = 2000

function makeAuction(overrides: Record<string, unknown> = {}): ParsedAuctionEvent {
	return {
		rawEvent: { id: AUCTION_ROOT, pubkey: SELLER_PUBKEY, kind: 30408, tags: [], content: '', created_at: 100 },
		id: AUCTION_ROOT,
		sellerPubkey: SELLER_PUBKEY,
		coordinate: AUCTION_COORD,
		rootEventId: AUCTION_ROOT,
		dTag: 'd-tag-123',
		createdAt: 100,
		startAt: 100,
		endAt: 1500,
		maxEndAt: AUCTION_MAX_END_AT,
		settlementGrace: 7200,
		settlementPolicy: 'cashu_p2pk_path_oracle_v1',
		fallbackDelaySec: 3600,
		status: 'live',
		title: 'Test Auction',
		description: '',
		reservePrice: 50000,
		allowlist: [],
		mints: ['https://mint.example.com'],
		p2pkXpub: 'xpub123',
		...overrides,
	} as unknown as ParsedAuctionEvent
}

function makeSettlement(overrides: Record<string, unknown> = {}): ParsedSettlementEvent {
	return {
		rawEvent: { id: 'settlement-1', pubkey: SELLER_PUBKEY, kind: 1024, tags: [], content: '', created_at: 2100 },
		id: 'settlement-1',
		sellerPubkey: SELLER_PUBKEY,
		createdAt: 2100,
		auctionRootEventId: AUCTION_ROOT,
		auctionCoordinate: AUCTION_COORD,
		status: 'settled',
		closeAt: 2100,
		winningBidId: 'bid-1',
		winnerPubkey: OTHER_PUBKEY,
		finalAmount: 50000,
		payouts: [],
		fallbackChain: [],
		...overrides,
	} as unknown as ParsedSettlementEvent
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('validateSettlementEventLocalOnly', () => {
	describe('settled status', () => {
		test('returns true when seller, refs, winner, and finalAmount are valid', () => {
			const auction = makeAuction()
			const settlement = makeSettlement({ status: 'settled', finalAmount: 50000, winnerPubkey: OTHER_PUBKEY })
			expect(validateSettlementEventLocalOnly(auction, settlement)).toBe(true)
		})

		test('returns false when finalAmount is 0', () => {
			const auction = makeAuction()
			const settlement = makeSettlement({ status: 'settled', finalAmount: 0, winnerPubkey: OTHER_PUBKEY })
			expect(validateSettlementEventLocalOnly(auction, settlement)).toBe(false)
		})

		test('returns false when winnerPubkey is missing', () => {
			const auction = makeAuction()
			const settlement = makeSettlement({ status: 'settled', finalAmount: 50000, winnerPubkey: undefined })
			expect(validateSettlementEventLocalOnly(auction, settlement)).toBe(false)
		})
	})

	describe('reserve_not_met status', () => {
		test('returns true when seller author, refs match, and closeAt >= maxEndAt', () => {
			const auction = makeAuction()
			const settlement = makeSettlement({
				status: 'reserve_not_met',
				closeAt: AUCTION_MAX_END_AT,
				finalAmount: 0,
				winnerPubkey: undefined,
				winningBidId: undefined,
			})
			expect(validateSettlementEventLocalOnly(auction, settlement)).toBe(true)
		})

		test('returns true when closeAt is after maxEndAt', () => {
			const auction = makeAuction()
			const settlement = makeSettlement({
				status: 'reserve_not_met',
				closeAt: AUCTION_MAX_END_AT + 100,
			})
			expect(validateSettlementEventLocalOnly(auction, settlement)).toBe(true)
		})

		test('returns false when closeAt is before maxEndAt', () => {
			const auction = makeAuction()
			const settlement = makeSettlement({
				status: 'reserve_not_met',
				closeAt: AUCTION_MAX_END_AT - 1,
			})
			expect(validateSettlementEventLocalOnly(auction, settlement)).toBe(false)
		})

		test('returns false when seller pubkey does not match auction', () => {
			const auction = makeAuction()
			const settlement = makeSettlement({
				status: 'reserve_not_met',
				sellerPubkey: OTHER_PUBKEY,
			})
			expect(validateSettlementEventLocalOnly(auction, settlement)).toBe(false)
		})

		test('returns false when auction root event id does not match', () => {
			const auction = makeAuction()
			const settlement = makeSettlement({
				status: 'reserve_not_met',
				auctionRootEventId: 'wrong-root',
			})
			expect(validateSettlementEventLocalOnly(auction, settlement)).toBe(false)
		})

		test('returns false when auction coordinate does not match', () => {
			const auction = makeAuction()
			const settlement = makeSettlement({
				status: 'reserve_not_met',
				auctionCoordinate: '30408:wrong:d-tag',
			})
			expect(validateSettlementEventLocalOnly(auction, settlement)).toBe(false)
		})
	})

	describe('cancelled and griefed_no_fallback status', () => {
		test('returns false for cancelled', () => {
			const auction = makeAuction()
			const settlement = makeSettlement({ status: 'cancelled' })
			expect(validateSettlementEventLocalOnly(auction, settlement)).toBe(false)
		})

		test('returns false for griefed_no_fallback', () => {
			const auction = makeAuction()
			const settlement = makeSettlement({ status: 'griefed_no_fallback' })
			expect(validateSettlementEventLocalOnly(auction, settlement)).toBe(false)
		})
	})

	describe('cross-status ref checks', () => {
		test('returns false for settled when seller pubkey does not match', () => {
			const auction = makeAuction()
			const settlement = makeSettlement({ status: 'settled', sellerPubkey: OTHER_PUBKEY })
			expect(validateSettlementEventLocalOnly(auction, settlement)).toBe(false)
		})

		test('returns false for settled when auction root does not match', () => {
			const auction = makeAuction()
			const settlement = makeSettlement({ status: 'settled', auctionRootEventId: 'wrong' })
			expect(validateSettlementEventLocalOnly(auction, settlement)).toBe(false)
		})
	})
})
