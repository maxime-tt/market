/**
 * platform/web/notifications/auctionWin.ts — the app's auction-win queue operations: the thin, domain-aware
 * seam the auction-win monitor and the won-auction modal drive the shared instance through.
 *
 * The core's queue is generic: it de-duplicates on `id`, removes/retains by a caller predicate, and dismisses
 * the head. The auction-win feature needs four specific reads/writes on top of that, each preserving the exact
 * semantics of the deleted auction-win store (`auctionWon.ts`), now removed:
 *   - enqueue through `auctionWonRule`, so the composite `auctionRootEventId` + `bidderPubkey` identity the old
 *     store de-duplicated on becomes the queue's `id`;
 *   - drop every win for one auction root (the old `removeForAuction`);
 *   - keep only one bidder's wins (the old `retainForBidder`);
 *   - read the active win's payload off the queue head (what the modal rendered).
 *
 * They live here rather than inside the monitor hook so the monitor, the modal and the tests share one
 * implementation and one predicate each.
 */
import { deriveFromRules } from '@sdk/core'
import { auctionWonRule } from './rules'
import type { AppNotifications } from './instance'
import type { AppNotification, AuctionWonPayload } from './types'

/**
 * The auction-win payload a notification carries, or null when it is not an auction-win notification. The
 * core's `payload` is the app's union, not discriminated by `type`, so the type check is what narrows it.
 */
export function auctionWonPayloadOf(notification: AppNotification | undefined): AuctionWonPayload | null {
	return notification && notification.type === 'auction-won' ? (notification.payload as AuctionWonPayload) : null
}

/**
 * Enqueue one auction win through `auctionWonRule`, so the queue's `id` de-duplication keys on the same composite
 * the old store did — `auctionRootEventId` AND `bidderPubkey` (`auctionWon.ts:19`). Re-delivering the same win
 * is a no-op; a different bidder, or the same bidder on a different auction, gets its own `id` and queues
 * separately. `createdAt` is the value the instance's clock returns, in the unit the instance was configured
 * with (the app uses whole seconds).
 */
export function enqueueAuctionWin(notifications: AppNotifications, win: AuctionWonPayload, createdAt: number): void {
	for (const notification of deriveFromRules([auctionWonRule], { kind: 'auction-won', createdAt, ...win })) {
		notifications.queue.enqueue(notification)
	}
}

/** Drop every auction win for one auction root — the old `removeForAuction` (`auctionWon.ts:29`). */
export function removeAuctionWinsForAuction(notifications: AppNotifications, auctionRootEventId: string): void {
	notifications.queue.remove((notification) => auctionWonPayloadOf(notification)?.auctionRootEventId === auctionRootEventId)
}

/**
 * Keep only the given bidder's auction wins — the old `retainForBidder` (`auctionWon.ts:39`). The old store's
 * queue held wins only, so "keep only this bidder" is also "drop every non-win"; the predicate reproduces that.
 */
export function retainAuctionWinsForBidder(notifications: AppNotifications, bidderPubkey: string): void {
	notifications.queue.retain((notification) => auctionWonPayloadOf(notification)?.bidderPubkey === bidderPubkey)
}
