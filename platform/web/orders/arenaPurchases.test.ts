/**
 * The buyer's auction wins as purchase rows — the projection's honesty rules.
 *
 * These cases pin what a purchase row may say: a verdict is a claim, a receipt
 * is money that moved, a missing receipt is "no receipt read" (never "unpaid"),
 * and a refunded bid reads refunded rather than locked.
 */
import { describe, expect, test } from 'bun:test'
import type { ArenaAuctionView, ArenaBidView } from '@platform/web/auctions/relay/arenaAuctionRead'
import type { ParsedArenaReceipt } from '@platform/web/auctions/relay/arenaReceiptsRead'
import { arenaPurchaseRowFor, arenaPurchaseRows } from './arenaPurchases'
import { arenaPurchaseStatus } from './arenaPurchaseColumns'

const BUYER = 'bb'.repeat(32)
const SELLER = 'aa'.repeat(32)

function bid(eventId: string, bidder: string, amount: number, createdAt = 1_000): ArenaBidView {
	return { eventId, bidder, createdAt, amount, relays: ['wss://relay.playday.it'] }
}

function receipt(outcome: 'refund' | 'settle', bidId: string, height: number, total: number): ParsedArenaReceipt {
	return {
		eventId: `ev-${outcome}-${bidId}`,
		signerPubkey: 'dd'.repeat(32),
		kind: outcome === 'refund' ? 1443 : 1444,
		auctionId: `1440:${SELLER}:lot-1`,
		bidId,
		outcome,
		height,
		blockHash: 'AB'.repeat(32),
		settledAt: 1_700_000_000,
		paramsVersion: '71ca57eb',
		outputs: [{ recipient: BUYER, amount: total, id: 'ks', secret: 'secret', C: 'C', dleq: null }],
		total,
		outputsWithoutAmount: 0,
	}
}

function view(over: Partial<ArenaAuctionView> = {}): ArenaAuctionView {
	const bids = over.bids ?? [bid('b1', BUYER, 100)]
	return {
		coordinate: `1440:${SELLER}:lot-1`,
		seller: SELLER,
		d: 'lot-1',
		rootEventId: 'r'.repeat(64),
		canonicalEventId: 'c'.repeat(64),
		createdAt: 1_000,
		rootCreatedAt: 900,
		content: { auctionId: 'lot-1', title: 'A lot', image: null } as ArenaAuctionView['content'],
		versions: 1,
		bids,
		positions: { [BUYER]: 100 },
		topBid: { bidder: BUYER, total: 100 },
		bidsWithoutAmount: 0,
		verdicts: [],
		receipts: [],
		refundForBid: {},
		settleForBid: {},
		settleReceipt: null,
		committedEnd: null,
		committedEnds: [],
		createRefusal: null,
		bidRefusals: [],
		relays: ['wss://relay.playday.it'],
		...over,
	}
}

describe('an arena win is a purchase row', () => {
	test('a winning bid with its settle receipt says won and carries the receipt', () => {
		const settle = receipt('settle', 'b1', 1283, 100)
		const row = arenaPurchaseRowFor(
			view({
				verdicts: [{ eventId: 'v1', bidId: 'b1', outcome: 'winner', height: 1282 } as never],
				settleForBid: { b1: settle },
				receipts: [settle],
			}),
			BUYER,
		)
		expect(row?.state).toBe('won')
		expect(row?.settle?.height).toBe(1283)
		expect(row?.verdictHeight).toBe(1282)
		expect(row?.amount).toBe(100)
	})

	test('a win with no settle receipt read carries no receipt, and the words say so — not "unpaid"', () => {
		const row = arenaPurchaseRowFor(view({ verdicts: [{ eventId: 'v1', bidId: 'b1', outcome: 'winner', height: 1282 } as never] }), BUYER)
		expect(row?.state).toBe('won')
		expect(row?.settle).toBeNull()
		const status = arenaPurchaseStatus(row!)
		expect(status.word).toBe('Won')
		expect(status.detail).toBe('no receipt read')
		expect(status.detail).not.toContain('unpaid')
	})

	test('an outbid bid whose refund receipt was read says refunded, not locked', () => {
		const refund = receipt('refund', 'b1', 1276, 64)
		const row = arenaPurchaseRowFor(view({ refundForBid: { b1: refund }, receipts: [refund] }), BUYER)
		expect(row?.state).toBe('refunded')
		expect(arenaPurchaseStatus(row!).detail).toBe('refunded at height 1276')
	})

	test('a bid that is merely leading states no money moved', () => {
		const row = arenaPurchaseRowFor(view(), BUYER)
		expect(row?.state).toBe('leading')
		expect(arenaPurchaseStatus(row!).detail).toContain('no money has moved')
	})

	test('a buyer with two bids on one lot gets ONE row, and the winning bid wins it', () => {
		const refund = receipt('refund', 'b-old', 1200, 64)
		const settle = receipt('settle', 'b-new', 1300, 110)
		const row = arenaPurchaseRowFor(
			view({
				bids: [bid('b-old', BUYER, 64, 1_000), bid('b-new', BUYER, 110, 2_000)],
				positions: { [BUYER]: 110 },
				verdicts: [{ eventId: 'v1', bidId: 'b-new', outcome: 'winner', height: 1299 } as never],
				refundForBid: { 'b-old': refund },
				settleForBid: { 'b-new': settle },
			}),
			BUYER,
		)
		expect(row?.state).toBe('won')
		expect(row?.bidEventId).toBe('b-new')
		expect(row?.settle?.total).toBe(110)
	})

	test('a buyer who took no part in a lot gets no row', () => {
		expect(arenaPurchaseRowFor(view({ bids: [bid('b1', 'cc'.repeat(32), 100)] }), BUYER)).toBeNull()
		expect(arenaPurchaseRows([view()], '')).toEqual([])
	})

	test('the lot link is the coordinate the app opens lots by', () => {
		const row = arenaPurchaseRowFor(view(), BUYER)
		expect(row?.lotHref).toBe(`/auctions/lot-1?seller=${SELLER}`)
	})
})
