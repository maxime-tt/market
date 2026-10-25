/**
 * platform/web/notifications/producers.ts — the app's producer seam: turn one app event into the notification(s)
 * the app's rules derive, and apply them to the shared instance.
 *
 * This is the one entry point every producer in the app calls. It replaces the imperative pushes into the legacy
 * store (`notificationActions.incrementUnseenX(...)`, `useNotificationMonitor.ts`) with a derivation: the event
 * is fed to `deriveFromRules(appNotificationRules, event)` (the app's configuration) and each derived
 * notification is applied to the mechanism — a passive one to the ledger, the modal auction-win to the queue.
 *
 * It is domain-free of the legacy store (no `@/…`): the mechanism decides nothing about orders, auctions or
 * messages, and neither does this file — it only routes what the rules derived.
 */
import { deriveFromRules } from '@sdk/core'
import { appNotificationRules } from './rules'
import type { AppNotificationEvent } from './rules'
import type { AppNotifications } from './instance'
import type { AppNotification, AppNotificationPayload, AppNotificationType } from './types'

/** Derive the zero-or-more notifications one app event produces, using the app's rules. */
export function deriveAppNotifications(event: AppNotificationEvent): AppNotification[] {
	return deriveFromRules<AppNotificationEvent, AppNotificationType, AppNotificationPayload>(appNotificationRules, event)
}

/**
 * Apply one derived notification to the instance: the active auction-win goes to the queue (de-duplicated by id),
 * every passive notification raises its ledger scope by one. This is the split the modal policy declares —
 * `passive` types are counted, `modal` types demand attention.
 */
export function applyAppNotification(notifications: AppNotifications, notification: AppNotification): void {
	if (notification.type === 'auction-won') notifications.queue.enqueue(notification)
	else notifications.ledger.increment(notification.scope)
}

/**
 * Derive and apply — the producer entry point. Returns the notifications that were derived, so a caller (or a
 * differential harness) can inspect exactly what an event produced.
 */
export function applyAppNotificationEvent(notifications: AppNotifications, event: AppNotificationEvent): AppNotification[] {
	const derived = deriveAppNotifications(event)
	for (const notification of derived) applyAppNotification(notifications, notification)
	return derived
}

/**
 * Bulk reconciliation, the derivation route: derive every event and OVERWRITE the ledger with the tally of the
 * scopes those derivations carry. This is the mechanism's counterpart to the legacy `recalculateFromEvents` —
 * an overwrite of the counted set, not an accumulation — so a re-sync (the monitor re-runs its initial fetch
 * whenever the account changes) resets the counters instead of doubling them. The active auction-win goes to
 * the queue, never the ledger, so it is excluded from the tally exactly as `applyAppNotification` excludes it.
 */
export function reconcileAppNotificationCounts(notifications: AppNotifications, events: readonly AppNotificationEvent[]): void {
	const tally: Record<string, number> = {}
	for (const event of events) {
		for (const notification of deriveAppNotifications(event)) {
			if (notification.type === 'auction-won') continue
			tally[notification.scope] = (tally[notification.scope] ?? 0) + 1
		}
	}
	notifications.ledger.reconcile(tally)
}
