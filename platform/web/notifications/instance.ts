/**
 * platform/web/notifications/instance.ts — the app's `Notifications` instance: the mechanism composed with the
 * host's storage port, the host's storage key and the host's clock.
 *
 * This is the single place the app wires the core mechanism to persistence: the web host's
 * `KeyValueStoragePort` (`createLocalStorageKeyValuePort`) and a key of this instance's own (see
 * `NOTIFICATIONS_STORAGE_KEY` — the legacy store still owns the legacy key, and two writers on one key
 * would clobber each other). The clock is in whole seconds, matching the legacy store's
 * `Math.floor(Date.now() / 1000)` timestamps, so the ledger's last-seen marks stay in the unit the rest
 * of the app already uses.
 */
import { createNotifications } from '@sdk/core'
import type { KeyValueStoragePort, Notifications } from '@sdk/core'
import { createLocalStorageKeyValuePort } from '@platform/web/storage/localStorageKeyValue'
import type { AppNotificationPayload, AppNotificationType } from './types'

/**
 * The key this instance persists under.
 *
 * It is deliberately NOT the legacy key (`'nostr-market:notifications'`,
 * `src/lib/stores/notifications.ts:70`) — yet. The mechanism writes through on **every mutation**
 * (`sdk/core/notifications/ts/notifications.ts:93`), while the legacy store is still live and owns that
 * key. Two writers with two shapes on one key is corruption: the first auction-win enqueue would
 * replace the legacy `{ lastSeenTimestamps }` blob, and on the next load the legacy `isNew*` guards
 * would find no last-seen mark and re-notify the user for old orders, messages, bids and comments —
 * while the instance gains nothing, because no production caller invokes `restore()` yet.
 *
 * So the instance keeps its own key until the legacy store is deleted. The notificationStore
 * migration must then fold the ledger onto the legacy key and **seed it from the legacy
 * `lastSeenTimestamps`**, or users lose their read state across the cutover.
 */
export const NOTIFICATIONS_STORAGE_KEY = 'nostr-market:notifications-core'

/** The app's concrete instance type. */
export type AppNotifications = Notifications<AppNotificationType, AppNotificationPayload>

/** What `createAppNotifications` may override — both default to the app's real port and clock. */
export interface AppNotificationsOptions {
	/** The storage port. Defaults to the web host's localStorage port. */
	readonly storage?: KeyValueStoragePort
	/** The clock, in whole seconds. Defaults to `Math.floor(Date.now() / 1000)`. */
	readonly now?: () => number
}

/**
 * Build a fresh app notifications instance. Exposed so tests (and a future per-user scoping) can supply their
 * own port or clock; the app itself uses the module-level singleton below.
 */
export function createAppNotifications(options: AppNotificationsOptions = {}): AppNotifications {
	return createNotifications<AppNotificationType, AppNotificationPayload>({
		storage: options.storage ?? createLocalStorageKeyValuePort(),
		storageKey: NOTIFICATIONS_STORAGE_KEY,
		now: options.now ?? (() => Math.floor(Date.now() / 1000)),
	})
}

/** The app's notifications instance — one per browser session. */
export const appNotifications: AppNotifications = createAppNotifications()
