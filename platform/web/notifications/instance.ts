/**
 * platform/web/notifications/instance.ts — the app's `Notifications` instance: the mechanism composed with the
 * host's storage port, the host's storage key and the host's clock.
 *
 * This is the single place the app wires the core mechanism to persistence. It reuses the key the legacy store
 * wrote (`nostr-market:notifications`) and the web host's `KeyValueStoragePort` (`createLocalStorageKeyValuePort`).
 * The clock is in whole seconds, matching the legacy store's `Math.floor(Date.now() / 1000)` timestamps, so the
 * ledger's last-seen marks stay in the unit the rest of the app already uses.
 *
 * Reusing the legacy key is safe: the mechanism restores only a payload whose `active` is an array
 * (`restoreNotifications`), and the legacy payload is `{ lastSeenTimestamps }`, which has no `active` — so a
 * pre-existing legacy value is ignored, never mis-read.
 */
import { createNotifications } from '@sdk/core'
import type { KeyValueStoragePort, Notifications } from '@sdk/core'
import { createLocalStorageKeyValuePort } from '@platform/web/storage/localStorageKeyValue'
import type { AppNotificationPayload, AppNotificationType } from './types'

/** The storage key the legacy store used (`src/lib/stores/notifications.ts:70`), reused verbatim. */
export const NOTIFICATIONS_STORAGE_KEY = 'nostr-market:notifications'

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
