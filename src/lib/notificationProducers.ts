/**
 * src/lib/notificationProducers.ts — the src-side notification seam.
 *
 * WHAT THIS IS (since store-drain C3). Two things, and nothing else:
 *
 *   1. `produceAppNotification(event)` — the one entry point every producer in
 *      `useNotificationMonitor.ts` calls. It hands one app event to the app's rules
 *      (`platform/web/notifications/rules.ts`) and applies what they derive to the shared
 *      `appNotifications` instance. It replaced the legacy `notificationActions.incrementUnseenX(...)`
 *      calls in C1.
 *   2. The read-state surface the C4 cutover reads through — `readMarks` and the ledger snapshot helpers
 *      (`appNotificationsBinding`, `notificationScopes`, `readMarkFamilies`, `scopedLastSeenOf`). Its
 *      consumers (`AuctionListItemHost.tsx`, `ConversationView.tsx`) are still under `src/`, and this
 *      module is already an allowlisted `src -> platform` edge, so routing them here keeps
 *      `platform/boundary.test.ts`'s migration ledger from growing while they wait for D3. The filename is
 *      historical: the producers it once bridged now live on the mechanism.
 *
 * WHAT IT NO LONGER IS. Until C3 it also carried a **legacy mirror**: every derived notification was
 * written a second time into `src/lib/stores/notifications.ts`'s counters, so the store the user saw stayed
 * byte-identical while the producers moved onto the rules. C3 deleted that store, so there is nothing left
 * to mirror — `mirrorToLegacy`, `reconcileLegacyNotificationCounts`, `LegacyRecalculation` and the
 * `notificationActions` import all went with it. A header describing a mirror that no longer exists would be
 * worse than none, so this one describes what the file is now.
 */
import { appNotifications, applyAppNotificationEvent } from '@platform/web/notifications'
import type { AppNotificationEvent } from '@platform/web/notifications'

// The C4 read-state surface, re-exported so its src/ consumers reach it through an already-allowlisted
// `src -> platform` edge rather than adding new ones to the migration ledger.
export { appNotificationsBinding, notificationScopes, readMarkFamilies, readMarks, scopedLastSeenOf } from '@platform/web/notifications'

/** Feed one app notification event to the rules and apply the notification(s) they derive. */
export function produceAppNotification(event: AppNotificationEvent): void {
	applyAppNotificationEvent(appNotifications, event)
}
