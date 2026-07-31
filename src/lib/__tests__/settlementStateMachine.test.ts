import { describe, expect, test } from 'bun:test'
import {
	getAuctionSettlementState,
	getValidatedBidContext,
	checkPathReleaseForTopBid,
	checkReserveMet,
	type SettlementStateInput,
} from '../auction/settlementStateMachine'
import type { ParsedBidEvent, ParsedPathReleaseEvent } from '../auction/events'

// ---------------------------------------------------------------------------
// Helpers — factory functions for test inputs
// ---------------------------------------------------------------------------

const SELLER_PUBKEY = 'a'.repeat(64)
const BUYER_PUBKEY = 'b'.repeat(64)
const OTHER_BIDDER_PUBKEY = 'c'.repeat(64)

function baseInput(overrides: Partial<SettlementStateInput> = {}): SettlementStateInput {
	return {
		isSeller: false,
		isMyBidTop: false,
		isWinner: false,
		ended: true,
		reserveMet: true,
		settlementWindowExpired: false,
		myAlreadyReleased: false,
		hasBidderRecord: true,
		hasLatestSettlement: false,
		settlementStatus: 'unknown',
		hasReserve: false,
		hasPathReleaseForTopBid: false,
		hasMatchedClaimOrder: false,
		settlementLocktimeAt: 0,
		now: 1000,
		...overrides,
	}
}

function makeBid(overrides: Partial<ParsedBidEvent> = {}): ParsedBidEvent {
	return {
		rawEvent: { id: 'bid-1', pubkey: BUYER_PUBKEY, kind: 1024, tags: [], content: '', created_at: 100 },
		id: 'bid-1',
		bidderPubkey: BUYER_PUBKEY,
		createdAt: 100,
		auctionRootEventId: 'auction-root',
		auctionCoordinate: '30408:seller:d-tag',
		sellerPubkey: SELLER_PUBKEY,
		amount: 50000,
		currency: 'SAT',
		mint: 'https://mint.example.com',
		locktime: 200,
		refundPubkey: 'd'.repeat(64),
		childPubkey: 'e'.repeat(64),
		lockSecrets: ['secret-1'],
		proofYs: ['y-1'],
		createdForEndAt: 150,
		bidNonce: 'nonce-1',
		keyScheme: 'hd_p2pk',
		status: 'locked',
		...overrides,
	} as ParsedBidEvent
}

function makePathRelease(overrides: Partial<ParsedPathReleaseEvent> = {}): ParsedPathReleaseEvent {
	return {
		rawEvent: { id: 'pr-1', pubkey: BUYER_PUBKEY, kind: 1025, tags: [], content: '', created_at: 200 },
		id: 'pr-1',
		bidderPubkey: BUYER_PUBKEY,
		createdAt: 200,
		bidEventId: 'bid-1',
		auctionCoordinate: '30408:seller:d-tag',
		sellerPubkey: SELLER_PUBKEY,
		derivationPath: 'm/0/1/2',
		childPubkey: 'e'.repeat(64),
		releaseReason: 'settlement',
		auditorRefs: [],
		content: '',
		...overrides,
	} as ParsedPathReleaseEvent
}

// ---------------------------------------------------------------------------
// State machine tests
// ---------------------------------------------------------------------------

describe('getAuctionSettlementState', () => {
	describe('auction not ended', () => {
		test('returns auction-not-ended when ended is false', () => {
			const result = getAuctionSettlementState(baseInput({ ended: false }))
			expect(result.stateId).toBe('auction-not-ended')
			expect(result.theme).toBe('default')
		})
	})

	describe('bidder release path', () => {
		test('shows release-path action when bidder is top, ended, reserve met, no release, has record, no settlement', () => {
			const result = getAuctionSettlementState(
				baseInput({
					isMyBidTop: true,
					isSeller: false,
					ended: true,
					reserveMet: true,
					settlementWindowExpired: false,
					myAlreadyReleased: false,
					hasBidderRecord: true,
					hasLatestSettlement: false,
				}),
			)
			expect(result.stateId).toBe('bidder-release-path')
			expect(result.showButton).toBe(true)
			expect(result.buttonTitle).toBe('Release path & settle')
			expect(result.theme).toBe('action')
		})

		test('does not show release-path when settlement window expired', () => {
			const result = getAuctionSettlementState(
				baseInput({
					isMyBidTop: true,
					settlementWindowExpired: true,
				}),
			)
			expect(result.stateId).not.toBe('bidder-release-path')
		})

		test('does not show release-path when already released', () => {
			const result = getAuctionSettlementState(
				baseInput({
					isMyBidTop: true,
					myAlreadyReleased: true,
				}),
			)
			expect(result.stateId).not.toBe('bidder-release-path')
		})

		test('does not show release-path when no bidder record', () => {
			const result = getAuctionSettlementState(
				baseInput({
					isMyBidTop: true,
					hasBidderRecord: false,
				}),
			)
			expect(result.stateId).not.toBe('bidder-release-path')
		})

		test('does not show release-path when settlement already exists', () => {
			const result = getAuctionSettlementState(
				baseInput({
					isMyBidTop: true,
					hasLatestSettlement: true,
					settlementStatus: 'settled',
				}),
			)
			expect(result.stateId).not.toBe('bidder-release-path')
		})

		test('does not show release-path when reserve not met', () => {
			const result = getAuctionSettlementState(
				baseInput({
					isMyBidTop: true,
					reserveMet: false,
				}),
			)
			expect(result.stateId).not.toBe('bidder-release-path')
		})
	})

	describe('bidder path released', () => {
		test('shows path-released waiting state when bidder has released and not settled', () => {
			const result = getAuctionSettlementState(
				baseInput({
					isMyBidTop: true,
					myAlreadyReleased: true,
					settlementStatus: 'unknown',
					hasLatestSettlement: false,
				}),
			)
			expect(result.stateId).toBe('bidder-path-released')
			expect(result.showButton).toBe(false)
			expect(result.theme).toBe('waiting')
		})
	})

	describe('winner after settlement', () => {
		test('shows winner-with-order when winner has matched claim order', () => {
			const result = getAuctionSettlementState(
				baseInput({
					isWinner: true,
					settlementStatus: 'settled',
					hasLatestSettlement: true,
					hasMatchedClaimOrder: true,
				}),
			)
			expect(result.stateId).toBe('winner-with-order')
			expect(result.showButton).toBe(true)
			expect(result.buttonTitle).toBe('View Order')
		})

		test('shows winner-claim-dialog when winner has no claim order', () => {
			const result = getAuctionSettlementState(
				baseInput({
					isWinner: true,
					settlementStatus: 'settled',
					hasLatestSettlement: true,
					hasMatchedClaimOrder: false,
				}),
			)
			expect(result.stateId).toBe('winner-claim-dialog')
			expect(result.showButton).toBe(true)
			expect(result.buttonTitle).toBe('Submit Shipping Address')
		})
	})

	describe('seller after settlement', () => {
		test('shows seller-order-received when claim order exists', () => {
			const result = getAuctionSettlementState(
				baseInput({
					isSeller: true,
					settlementStatus: 'settled',
					hasLatestSettlement: true,
					hasMatchedClaimOrder: true,
				}),
			)
			expect(result.stateId).toBe('seller-order-received')
			expect(result.showButton).toBe(true)
			expect(result.buttonTitle).toBe('View Order')
		})

		test('shows seller-awaiting-shipping when no claim order', () => {
			const result = getAuctionSettlementState(
				baseInput({
					isSeller: true,
					settlementStatus: 'settled',
					hasLatestSettlement: true,
					hasMatchedClaimOrder: false,
				}),
			)
			expect(result.stateId).toBe('seller-awaiting-shipping')
			expect(result.showButton).toBe(false)
			expect(result.theme).toBe('waiting')
		})
	})

	describe('reserve not met', () => {
		test('shows refund-ready when locktime has passed', () => {
			const result = getAuctionSettlementState(
				baseInput({
					hasLatestSettlement: true,
					settlementStatus: 'reserve_not_met',
					settlementLocktimeAt: 500,
					now: 600,
				}),
			)
			expect(result.stateId).toBe('reserve-not-met-refund-ready')
			expect(result.showButton).toBe(false)
			expect(result.theme).toBe('completed')
		})

		test('shows refund-pending when locktime has not passed', () => {
			const result = getAuctionSettlementState(
				baseInput({
					hasLatestSettlement: true,
					settlementStatus: 'reserve_not_met',
					settlementLocktimeAt: 500,
					now: 400,
				}),
			)
			expect(result.stateId).toBe('reserve-not-met-refund-pending')
			expect(result.showButton).toBe(false)
			expect(result.theme).toBe('waiting')
		})
	})

	describe('settlement expired', () => {
		test('shows settlement-expired when window expired and no settlement', () => {
			const result = getAuctionSettlementState(
				baseInput({
					settlementWindowExpired: true,
					hasLatestSettlement: false,
					isMyBidTop: false,
					isSeller: false,
					reserveMet: false,
				}),
			)
			expect(result.stateId).toBe('settlement-expired')
			expect(result.showButton).toBe(false)
		})
	})

	describe('seller settlement ready', () => {
		test('shows settlement-ready when seller, ended, no settlement, has path release', () => {
			const result = getAuctionSettlementState(
				baseInput({
					isSeller: true,
					ended: true,
					hasLatestSettlement: false,
					hasPathReleaseForTopBid: true,
					reserveMet: true,
				}),
			)
			expect(result.stateId).toBe('seller-settlement-ready')
			expect(result.showButton).toBe(true)
			expect(result.buttonTitle).toBe('Publish Settlement')
			expect(result.theme).toBe('action')
		})
	})

	describe('seller close auction', () => {
		test('shows Reserve Not Met when reserve configured and not met', () => {
			const result = getAuctionSettlementState(
				baseInput({
					isSeller: true,
					ended: true,
					hasLatestSettlement: false,
					reserveMet: false,
					hasReserve: true,
					hasPathReleaseForTopBid: false,
				}),
			)
			expect(result.stateId).toBe('seller-close-auction')
			expect(result.title).toBe('Reserve Not Met')
			expect(result.showButton).toBe(true)
			expect(result.buttonTitle).toBe('Close Auction')
		})

		test('shows No Bids Received when no reserve configured and no bids', () => {
			const result = getAuctionSettlementState(
				baseInput({
					isSeller: true,
					ended: true,
					hasLatestSettlement: false,
					reserveMet: false,
					hasReserve: false,
					hasPathReleaseForTopBid: false,
				}),
			)
			expect(result.stateId).toBe('seller-close-auction')
			expect(result.title).toBe('No Bids Received')
			expect(result.showButton).toBe(true)
			expect(result.buttonTitle).toBe('Close Auction')
		})
	})

	describe('seller awaiting path release', () => {
		test('shows awaiting-path-release when seller, ended, reserve met, no path release', () => {
			const result = getAuctionSettlementState(
				baseInput({
					isSeller: true,
					ended: true,
					hasLatestSettlement: false,
					hasPathReleaseForTopBid: false,
					reserveMet: true,
				}),
			)
			expect(result.stateId).toBe('seller-awaiting-path-release')
			expect(result.showButton).toBe(false)
			expect(result.theme).toBe('waiting')
		})
	})

	describe('bidder awaiting settlement (merged into bidder-path-released)', () => {
		test('bidder-path-released handles the waiting state', () => {
			const result = getAuctionSettlementState(
				baseInput({
					isMyBidTop: true,
					isSeller: false,
					myAlreadyReleased: true,
					settlementStatus: 'unknown',
					hasLatestSettlement: false,
				}),
			)
			expect(result.stateId).toBe('bidder-path-released')
		})
	})

	describe('bidder local record missing', () => {
		test('shows local-record-missing when bidder is top but has no bidder record', () => {
			const result = getAuctionSettlementState(
				baseInput({
					isMyBidTop: true,
					isSeller: false,
					hasBidderRecord: false,
					ended: true,
					reserveMet: true,
					settlementWindowExpired: false,
					myAlreadyReleased: false,
					hasLatestSettlement: false,
				}),
			)
			// The release-path check requires hasBidderRecord, so it falls through
			// to the path-released check (myAlreadyReleased=false → skip),
			// then winner checks (isWinner=false → skip),
			// then seller checks (isSeller=false → skip),
			// then reserve_not_met (hasLatestSettlement=false → skip),
			// then settlement-expired (settlementWindowExpired=false → skip),
			// then seller-settlement-ready (isSeller=false → skip),
			// then seller-close-auction (isSeller=false → skip),
			// then seller-awaiting-path-release (isSeller=false → skip),
			// then bidder-path-released (myAlreadyReleased=false → skip),
			// then bidder-local-record-missing
			expect(result.stateId).toBe('bidder-local-record-missing')
			expect(result.showButton).toBe(true)
			expect(result.buttonTitle).toBe('Refresh Page')
		})
	})

	describe('no state', () => {
		test('returns no-state when no conditions match', () => {
			const result = getAuctionSettlementState(
				baseInput({
					isSeller: false,
					isMyBidTop: false,
					isWinner: false,
					ended: true,
					reserveMet: false,
					settlementWindowExpired: false,
					myAlreadyReleased: false,
					hasBidderRecord: false,
					hasLatestSettlement: false,
					settlementStatus: 'unknown',
					hasPathReleaseForTopBid: false,
					hasMatchedClaimOrder: false,
				}),
			)
			expect(result.stateId).toBe('no-state')
			expect(result.theme).toBe('default')
		})
	})
})

// ---------------------------------------------------------------------------
// getValidatedBidContext tests
// ---------------------------------------------------------------------------

describe('getValidatedBidContext', () => {
	test('returns null topBid when validatedTopBid is undefined', () => {
		const result = getValidatedBidContext(undefined, undefined, BUYER_PUBKEY)
		expect(result.topBid).toBeNull()
		expect(result.myTopBidEvent).toBeNull()
		expect(result.isMyBidTop).toBe(false)
	})

	test('returns topBid but null myTopBidEvent when user has no bids', () => {
		const bid = makeBid({ bidderPubkey: OTHER_BIDDER_PUBKEY })
		const result = getValidatedBidContext([bid], bid, BUYER_PUBKEY)
		expect(result.topBid).toBe(bid)
		expect(result.myTopBidEvent).toBeNull()
		expect(result.isMyBidTop).toBe(false)
	})

	test('finds the user highest bid from validated bids', () => {
		const bid1 = makeBid({ id: 'bid-1', amount: 30000, bidderPubkey: BUYER_PUBKEY })
		const bid2 = makeBid({ id: 'bid-2', amount: 50000, bidderPubkey: BUYER_PUBKEY })
		const result = getValidatedBidContext([bid1, bid2], bid2, BUYER_PUBKEY)
		expect(result.myTopBidEvent).not.toBeNull()
		expect(result.myTopBidEvent?.id).toBe('bid-2')
		expect(result.isMyBidTop).toBe(true)
	})

	test('isMyBidTop is false when user bid is not the top bid', () => {
		const myBid = makeBid({ id: 'my-bid', amount: 30000, bidderPubkey: BUYER_PUBKEY })
		const otherBid = makeBid({ id: 'other-bid', amount: 50000, bidderPubkey: OTHER_BIDDER_PUBKEY })
		const result = getValidatedBidContext([myBid, otherBid], otherBid, BUYER_PUBKEY)
		expect(result.myTopBidEvent?.id).toBe('my-bid')
		expect(result.isMyBidTop).toBe(false)
	})

	test('returns null when no current user pubkey', () => {
		const bid = makeBid()
		const result = getValidatedBidContext([bid], bid, undefined)
		expect(result.myTopBidEvent).toBeNull()
		expect(result.isMyBidTop).toBe(false)
	})

	test('returns null when validated bids array is empty', () => {
		const result = getValidatedBidContext([], undefined, BUYER_PUBKEY)
		expect(result.myTopBidEvent).toBeNull()
		expect(result.isMyBidTop).toBe(false)
	})

	test('handles rebid chain — picks highest amount, earliest on tie', () => {
		const bid1 = makeBid({ id: 'bid-1', amount: 50000, createdAt: 100, bidderPubkey: BUYER_PUBKEY })
		const bid2 = makeBid({ id: 'bid-2', amount: 50000, createdAt: 90, bidderPubkey: BUYER_PUBKEY })
		const result = getValidatedBidContext([bid1, bid2], bid1, BUYER_PUBKEY)
		// Same amount — earlier createdAt wins
		expect(result.myTopBidEvent?.id).toBe('bid-2')
	})
})

// ---------------------------------------------------------------------------
// checkPathReleaseForTopBid tests
// ---------------------------------------------------------------------------

describe('checkPathReleaseForTopBid', () => {
	test('returns true when path release matches top bid id', () => {
		const bid = makeBid({ id: 'bid-1' })
		const release = makePathRelease({ bidEventId: 'bid-1' })
		expect(checkPathReleaseForTopBid([release], bid)).toBe(true)
	})

	test('returns false when path release does not match top bid id', () => {
		const bid = makeBid({ id: 'bid-1' })
		const release = makePathRelease({ bidEventId: 'bid-other' })
		expect(checkPathReleaseForTopBid([release], bid)).toBe(false)
	})

	test('returns false when topBid is null', () => {
		expect(checkPathReleaseForTopBid([], null)).toBe(false)
	})

	test('returns false when pathReleases is undefined', () => {
		const bid = makeBid({ id: 'bid-1' })
		expect(checkPathReleaseForTopBid(undefined, bid)).toBe(false)
	})

	test('returns false when pathReleases is empty', () => {
		const bid = makeBid({ id: 'bid-1' })
		expect(checkPathReleaseForTopBid([], bid)).toBe(false)
	})
})

// ---------------------------------------------------------------------------
// checkReserveMet tests
// ---------------------------------------------------------------------------

describe('checkReserveMet', () => {
	test('returns true when topBid amount equals reserve', () => {
		const bid = makeBid({ amount: 50000 })
		expect(checkReserveMet(bid, 50000)).toBe(true)
	})

	test('returns true when topBid amount exceeds reserve', () => {
		const bid = makeBid({ amount: 60000 })
		expect(checkReserveMet(bid, 50000)).toBe(true)
	})

	test('returns false when topBid amount is below reserve', () => {
		const bid = makeBid({ amount: 40000 })
		expect(checkReserveMet(bid, 50000)).toBe(false)
	})

	test('returns false when topBid is null', () => {
		expect(checkReserveMet(null, 50000)).toBe(false)
	})
})
