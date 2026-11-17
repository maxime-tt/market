import { describe, expect, test } from 'bun:test'
import { computeBidPosition, deltaForPosition, positionForDelta, type AuctionBidRules, type BidInput } from './bidMath'

/**
 * These cases are the ones the handover's §6 names as the trap: a delta misread
 * as a total, and a displaced bidder re-summed from history. Each has a comment
 * with the number a wrong implementation produces, so a regression is obvious.
 */
const leader = 'lead'
const rival = 'rival'
const rules: AuctionBidRules = { startingBid: 1_000, minIncrement: 100 }

describe('bid position arithmetic', () => {
	test('with no bids the floor is the starting bid and the whole thing is the delta', () => {
		const p = computeBidPosition(rules, [], rival)
		expect(p.leaderPubkey).toBeNull()
		expect(p.myPosition).toBe(0)
		expect(p.minNextPosition).toBe(1_000)
		expect(p.minDelta).toBe(1_000)
	})

	test('a non-leader bidding the minimum adds their whole position', () => {
		const bids: BidInput[] = [{ id: 'b1', bidder: leader, amount: 5_000 }]
		const p = computeBidPosition({ ...rules, highBid: 5_000, leaderBidId: 'b1' }, bids, rival)
		expect(p.leaderPosition).toBe(5_000)
		expect(p.myPosition).toBe(0)
		expect(p.minNextPosition).toBe(5_100)
		expect(p.minDelta).toBe(5_100)
	})

	test('the leader raising pays only the increment — NOT the whole total', () => {
		// A wrong implementation that treats `amount` as the new total would emit
		// 5,100 again and the bidder would read "it bid more than I typed".
		const bids: BidInput[] = [{ id: 'b1', bidder: leader, amount: 5_000 }]
		const p = computeBidPosition({ ...rules, highBid: 5_000, leaderBidId: 'b1' }, bids, leader)
		expect(p.myPosition).toBe(5_000)
		expect(p.minNextPosition).toBe(5_100)
		expect(p.minDelta).toBe(100)
	})

	test('a delta added to a position is cumulative, not a replacement', () => {
		// Two bids by the same bidder: 60 then 65 → position 125, which is exactly
		// the "second bid of 65 leaves them at 125" case from §6.
		const bids: BidInput[] = [
			{ id: 'b1', bidder: leader, amount: 60 },
			{ id: 'b2', bidder: leader, amount: 65 },
		]
		// No backend markers: the fallback sums the deltas.
		const p = computeBidPosition(rules, bids, leader)
		expect(p.myPosition).toBe(125)
		expect(p.leaderPosition).toBe(125)
	})

	test('a displaced bidder is read as 0, not as their summed history', () => {
		// The rival bid 4,999 once but the leader is now ahead; the chain returned
		// the rival's sats, so their position is 0 and their next bid must clear the
		// leader. Summing the rival's deltas would report 4,999 and under-bid.
		const bids: BidInput[] = [
			{ id: 'r1', bidder: rival, amount: 4_999 },
			{ id: 'b1', bidder: leader, amount: 5_500 },
		]
		const p = computeBidPosition({ ...rules, highBid: 5_500, leaderBidId: 'b1' }, bids, rival)
		expect(p.myPosition).toBe(0)
		expect(p.minNextPosition).toBe(5_600)
		expect(p.minDelta).toBe(5_600)
	})

	test('deltaForPosition turns a chosen total into the wire delta', () => {
		const bids: BidInput[] = [{ id: 'b1', bidder: leader, amount: 5_000 }]
		const withLeader = { ...rules, highBid: 5_000, leaderBidId: 'b1' }
		// The leader raises themselves to a 6,000 total: the wire delta is 1,000.
		expect(deltaForPosition(6_000, withLeader, bids, leader)).toBe(1_000)
		// A challenger bidding a 6,000 total: the whole 6,000 travels.
		expect(deltaForPosition(6_000, withLeader, bids, rival)).toBe(6_000)
	})

	test('deltaForPosition refuses a bid below the minimum, naming the floor', () => {
		const bids: BidInput[] = [{ id: 'b1', bidder: leader, amount: 5_000 }]
		const withLeader = { ...rules, highBid: 5_000, leaderBidId: 'b1' }
		expect(() => deltaForPosition(5_050, withLeader, bids, rival)).toThrow('Minimum bid is 5100 sats')
		expect(() => deltaForPosition(Number.NaN, withLeader, bids, rival)).toThrow('Enter a bid amount')
	})

	test('positionForDelta is the inverse, for showing the resulting total', () => {
		const bids: BidInput[] = [{ id: 'b1', bidder: leader, amount: 5_000 }]
		const withLeader = { ...rules, highBid: 5_000, leaderBidId: 'b1' }
		expect(positionForDelta(100, withLeader, bids, leader)).toBe(5_100)
		expect(positionForDelta(5_100, withLeader, bids, rival)).toBe(5_100)
	})
})
