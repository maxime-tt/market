import { describe, expect, test } from 'bun:test'
import { appUnseenCounts, appUnseenCountsFromLedger, unseenByConversationFromCounts, unseenMessagesFor } from './selectors'
import { notificationScopes } from './types'

describe('appUnseenCounts — the derived reads over a ledger', () => {
	test('reads the three unscoped counters straight off their scope keys', () => {
		const counts = {
			[notificationScopes.orders]: 3,
			[notificationScopes.purchases]: 2,
			[notificationScopes.bidUpdates]: 1,
		}
		const unseen = appUnseenCounts(counts)
		expect(unseen.unseenOrders).toBe(3)
		expect(unseen.unseenPurchases).toBe(2)
		expect(unseen.unseenBidUpdates).toBe(1)
		expect(unseen.unseenTotal).toBe(6)
	})

	test('sums each scoped family, reproducing the legacy global counters', () => {
		const counts = {
			[notificationScopes.messages('alice')]: 2,
			[notificationScopes.messages('bob')]: 1,
			[notificationScopes.auctionBids('a1')]: 4,
			[notificationScopes.auctionBids('a2')]: 1,
			[notificationScopes.auctionComments('a1')]: 2,
			[notificationScopes.auctionThreadComments('a1')]: 5,
			[notificationScopes.productComments('p1')]: 2,
			[notificationScopes.productComments('p2')]: 3,
			[notificationScopes.auctionLive('a3')]: 1,
			[notificationScopes.auctionSettlement('a3')]: 1,
		}
		const unseen = appUnseenCounts(counts)
		expect(unseen.unseenMessages).toBe(3)
		expect(unseen.unseenAuctionBids).toBe(5)
		expect(unseen.unseenAuctionComments).toBe(2)
		expect(unseen.unseenAuctionEventComments).toBe(5)
		// the PRODUCT-COMMENT aggregate — the legacy global counter's value; the per-product grain is read one
		// scope at a time (see `reads.ts`). Summing the family reproduces the OLD global exactly.
		expect(unseen.unseenProductComments).toBe(5)
		expect(unseen.unseenAuctionLive).toBe(1)
		expect(unseen.unseenAuctionSettlementBegins).toBe(1)
		expect(unseen.unseenTotal).toBe(3 + 5 + 2 + 5 + 5 + 1 + 1)
	})

	test('the per-conversation map and single-key read match the legacy indexing', () => {
		const counts = { [notificationScopes.messages('alice')]: 2, [notificationScopes.messages('bob')]: 1 }
		expect(unseenByConversationFromCounts(counts)).toEqual({ alice: 2, bob: 1 })
		expect(unseenMessagesFor(counts, 'alice')).toBe(2)
		expect(unseenMessagesFor(counts, 'carol')).toBe(0)
	})

	test('an empty ledger reads as all zeros (the fail-closed missing key)', () => {
		const unseen = appUnseenCounts({})
		expect(unseen.unseenTotal).toBe(0)
		expect(unseen.unseenByConversation).toEqual({})
	})

	test('does not confuse a family prefix with an unrelated scope key', () => {
		// `auction-bids:` must not swallow a hypothetical `auction-bids-x` key, and `bid-updates` is exact
		const counts = { 'auction-bids-x': 9, [notificationScopes.bidUpdates]: 1 }
		const unseen = appUnseenCounts(counts)
		expect(unseen.unseenAuctionBids).toBe(0)
		expect(unseen.unseenBidUpdates).toBe(1)
	})

	test('appUnseenCountsFromLedger reads a LedgerSnapshot directly', () => {
		const unseen = appUnseenCountsFromLedger({ globalLastSeen: 0, counts: { orders: 7 }, lastSeenByScope: {} })
		expect(unseen.unseenOrders).toBe(7)
	})
})
