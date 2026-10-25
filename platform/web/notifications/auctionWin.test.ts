import { beforeEach, describe, expect, test } from 'bun:test'
import { createMemoryStorage } from '@sdk/core'
import { enqueueAuctionWin, removeAuctionWinsForAuction, retainAuctionWinsForBidder } from './auctionWin'
import { createAppNotifications } from './instance'
import type { AppNotifications } from './instance'
import type { AuctionWonPayload } from './types'

/**
 * The auction-win queue's behaviour, moved here from the deleted `src/lib/__tests__/auctionWon.test.ts`
 * ("auction win queue") when the auction-win queue left its own store for the shared notifications
 * instance. The core module (`sdk/core/notifications/ts/notifications.test.ts`) already covers the generic
 * primitives — enqueue de-dup by `id`, `dismissActive`, `remove`, `retain`, `clear` — and
 * `rules.test.ts` covers that `auctionWonRule` encodes the composite id. What is unique to this file is the
 * *integration* of those two through the app's operations: that a re-delivered win is a no-op while a
 * different auction or a different bidder is a new entry, and that remove/retain filter on the payload
 * fields the deleted store filtered on.
 */
const AUCTION_ROOT_ID = 'a'.repeat(64)
const OTHER_AUCTION_ROOT_ID = 'b'.repeat(64)
const WINNER_PUBKEY = 'f'.repeat(64)
const OTHER_BIDDER_PUBKEY = '4'.repeat(64)

const win: AuctionWonPayload = {
	bidderPubkey: WINNER_PUBKEY,
	auctionRootEventId: AUCTION_ROOT_ID,
	bidEventId: 'e'.repeat(64),
	bidAmount: 5000,
}

const secondWin: AuctionWonPayload = {
	bidderPubkey: WINNER_PUBKEY,
	auctionRootEventId: OTHER_AUCTION_ROOT_ID,
	bidEventId: '3'.repeat(64),
	bidAmount: 7000,
}

let notifications: AppNotifications
beforeEach(() => {
	notifications = createAppNotifications({ storage: createMemoryStorage(), now: () => 1000 })
})

/** The queued wins' payloads, oldest first — what the old tests read as `auctionWonStore.state.queue`. */
const queuedWins = (): readonly AuctionWonPayload[] =>
	notifications.queue.active().map((notification) => notification.payload as AuctionWonPayload)

describe('the auction-win queue operations', () => {
	test('queues multiple wins in FIFO order and ignores duplicate auctions', () => {
		enqueueAuctionWin(notifications, win, 1)
		enqueueAuctionWin(notifications, secondWin, 2)
		// Same bidder on the same auction: the composite id de-duplicates it, whatever the payload differs in.
		enqueueAuctionWin(notifications, { ...win, bidAmount: 9000 }, 3)

		expect(queuedWins()).toEqual([win, secondWin])
	})

	test('dismisses only the active win so the next queued win can be verified', () => {
		enqueueAuctionWin(notifications, win, 1)
		enqueueAuctionWin(notifications, secondWin, 2)

		notifications.queue.dismissActive()

		expect(queuedWins()).toEqual([secondWin])
	})

	test('removes a superseded auction win without affecting other auctions', () => {
		enqueueAuctionWin(notifications, win, 1)
		enqueueAuctionWin(notifications, secondWin, 2)

		removeAuctionWinsForAuction(notifications, AUCTION_ROOT_ID)

		expect(queuedWins()).toEqual([secondWin])
	})

	test('retains only wins owned by the authenticated bidder', () => {
		const otherBidderWin: AuctionWonPayload = {
			bidderPubkey: OTHER_BIDDER_PUBKEY,
			auctionRootEventId: AUCTION_ROOT_ID,
			bidEventId: '3'.repeat(64),
			bidAmount: 7000,
		}
		enqueueAuctionWin(notifications, win, 1)
		// Same auction, different bidder: distinct id, so both stay queued until the retain below.
		enqueueAuctionWin(notifications, otherBidderWin, 2)

		retainAuctionWinsForBidder(notifications, OTHER_BIDDER_PUBKEY)

		expect(queuedWins()).toEqual([otherBidderWin])
	})

	test('clears every queued win on logout', () => {
		enqueueAuctionWin(notifications, win, 1)

		notifications.queue.clear()

		expect(notifications.queue.active()).toEqual([])
	})
})
