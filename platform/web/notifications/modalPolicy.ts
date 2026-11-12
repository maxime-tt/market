/**
 * platform/web/notifications/modalPolicy.ts — the declarative seam that says which notification types open a
 * modal and which are passive counters.
 *
 * Taken from today's behaviour: the only notification that opens an overlay is the auction win (the
 * `AuctionWonModal` driven by `auctionWonStore`); every other notification is a badge counter read from
 * `notificationStore`. This module states that split as data so the rewire slice can branch on it without
 * re-deriving it, and so a future type's presentation is declared in one place. It renders nothing.
 */
import type { AppNotificationType, NotificationPresentation } from './types'

/**
 * The presentation of every app notification type. Exactly one type is `modal` today; the rest are `passive`.
 * The `Record` is total over `AppNotificationType`, so adding a type to the union without deciding its
 * presentation is a compile error.
 */
export const NOTIFICATION_PRESENTATION: Readonly<Record<AppNotificationType, NotificationPresentation>> = {
	order: 'passive',
	message: 'passive',
	'order-update': 'passive',
	'auction-bid': 'passive',
	'auction-comment': 'passive',
	'auction-thread-comment': 'passive',
	'product-comment': 'passive',
	'auction-live': 'passive',
	'auction-settlement': 'passive',
	'bid-update': 'passive',
	'auction-won': 'modal',
}

/** Every type that opens a modal, in declaration order. Today: `['auction-won']`. */
export const MODAL_NOTIFICATION_TYPES = (Object.keys(NOTIFICATION_PRESENTATION) as AppNotificationType[]).filter(
	(type) => NOTIFICATION_PRESENTATION[type] === 'modal',
)

/** Whether a type opens a modal (an active, attention-demanding notification). */
export function opensModal(type: AppNotificationType): boolean {
	return NOTIFICATION_PRESENTATION[type] === 'modal'
}

/** Whether a type is a passive counter (a badge, not an overlay). */
export function isPassive(type: AppNotificationType): boolean {
	return NOTIFICATION_PRESENTATION[type] === 'passive'
}
