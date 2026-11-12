/**
 * notifications/ts/index.ts — the entry: the factory, the record helper, the rule seam's dispatch, the storage
 * seam and the vocabulary.
 *
 * The mechanism is domain-free: `TType` and `TPayload` are the host's, scopes are opaque keys, and no auction,
 * order or message appears here. The platform supplies the type union, the localStorage key and the modal
 * policy; this module supplies only the mechanism those are configured against.
 */
export { createNotification, createNotifications } from './notifications'
export { deriveFromRules } from './rules'
export { createMemoryStorage, restoreNotifications, serializeNotifications } from './persistence'
export { NotificationsError } from './errors'
export type { PersistedNotifications } from './persistence'
export type {
	LedgerSnapshot,
	Notification,
	NotificationInput,
	NotificationQueue,
	NotificationRule,
	Notifications,
	NotificationsOptions,
	NotificationsSnapshot,
	PassiveLedger,
} from './types'
