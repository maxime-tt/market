/**
 * src/lib/notificationProducers.ts — TEMPORARY: the app's notification producers, expressed through the platform's
 * rule-driven seam, with a legacy compatibility write for as long as the legacy store still backs the consumers.
 *
 * WHAT CHANGED (store drain C1). Every producer that used to call `notificationActions.incrementUnseenX(...)` now
 * calls `produceAppNotification(event)`. The notification is *derived* — the event is fed to the app's rules
 * (`platform/web/notifications/rules.ts`) and applied to the shared `appNotifications` instance (passive → ledger,
 * modal → queue). See `platform/web/notifications/producers.ts`.
 *
 * WHY THE LEGACY WRITE IS STILL HERE. C1 rewires the *producers*; it does not rewire the *consumers* (that is C2)
 * and it does not delete the legacy store (that is C3). Until C2 repoints the consumers — `AcknowledgementHost`,
 * `Header.tsx:213`, `_dashboard-layout.tsx:81`, `ConversationListItem.tsx:24`, `AuctionListItemHost.tsx:97`,
 * `useNotificationMonitor.ts:268` — the legacy store is still what the user actually sees. So each derived
 * notification is ALSO mirrored into the legacy counters with the identical `notificationActions.incrementUnseenX`
 * call the producer made before, and the initial bulk reconciliation keeps using the legacy overwrite
 * (`recalculateFromEvents`) verbatim. The legacy behaviour is therefore byte-identical; the new mechanism receives
 * the same derivations in parallel. **Both this file and the legacy writes it carries are deleted with the legacy
 * store (C3).**
 *
 * The mirror is deliberately dumb: one `incrementUnseenX` per event kind, exactly as before. It is a compatibility
 * shim, not a second policy — the policy lives in the rules.
 */
import { appNotifications, applyAppNotificationEvent } from '@platform/web/notifications'
import type { AppNotificationEvent } from '@platform/web/notifications'
import { notificationActions } from './stores/notifications'

/** The shape `recalculateFromEvents` accepts — the legacy initial-sync payload. */
export type LegacyRecalculation = Parameters<(typeof notificationActions)['recalculateFromEvents']>[0]

/**
 * Produce the notification(s) one incremental app event yields: derive and apply them on the mechanism, and mirror
 * the legacy counter the producer used to write (until C2).
 */
export function produceAppNotification(event: AppNotificationEvent): void {
	applyAppNotificationEvent(appNotifications, event)
	mirrorToLegacy(event)
}

/**
 * The initial sync's bulk reconciliation, kept verbatim: the legacy store overwrites its counters from the fetched
 * events, and the mechanism is fed one derived notification per counted event (the caller loops
 * `applyAppNotificationEvent`). The legacy overwrite is the exact call the producer made before, so a re-run of the
 * initial sync still resets the legacy counters rather than accumulating them.
 */
export function reconcileLegacyNotificationCounts(data: LegacyRecalculation): void {
	notificationActions.recalculateFromEvents(data)
}

/** The legacy counter a producer wrote, per event kind. The auction-win has no legacy increment (it already lives on
 * the mechanism), so it is absent here. */
function mirrorToLegacy(event: AppNotificationEvent): void {
	switch (event.kind) {
		case 'order':
			notificationActions.incrementUnseenOrders()
			break
		case 'message':
			notificationActions.incrementUnseenForConversation(event.pubkey)
			break
		case 'order-update':
			notificationActions.incrementUnseenPurchases()
			break
		case 'auction-bid':
			notificationActions.incrementUnseenAuctionBids(event.auctionKey)
			break
		case 'auction-comment':
			notificationActions.incrementUnseenAuctionComments(event.auctionKey)
			break
		case 'auction-thread-comment':
			notificationActions.incrementUnseenAuctionEventComments(event.auctionKey)
			break
		case 'product-comment':
			// The legacy counter is global while the rule scopes per product (owner ruling, `rules.ts:157`); the
			// mirror reproduces the legacy global counter, the mechanism keeps the per-product grain.
			notificationActions.incrementUnseenProductComments()
			break
		case 'auction-live':
			notificationActions.incrementUnseenAuctionLive(event.auctionKey)
			break
		case 'auction-settlement':
			notificationActions.incrementUnseenAuctionSettlementBegins(event.auctionKey)
			break
		case 'bid-update':
			notificationActions.incrementUnseenBidUpdates()
			break
		case 'auction-won':
			break
	}
}
