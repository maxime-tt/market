/**
 * notifications/ts/notifications.ts — the mechanism: the active queue, the passive ledger, a subscription and
 * the storage seam, composed into one instance.
 *
 * The factory returns an object whose `queue` generalises the auction-win queue (enqueue with de-duplication,
 * dismiss-active, remove-by-predicate, clear, retain-matching), whose `ledger` generalises the app's scoped
 * unseen counts and last-seen marks, and which exposes a `subscribe` matching the event store's style so the
 * host can bridge it to its own reactivity. It names no domain: it holds `TType`/`TPayload` the host chose and
 * counts under opaque scope keys.
 */
import { NotificationsError } from './errors'
import { restoreNotifications, serializeNotifications } from './persistence'
import type {
	LedgerSnapshot,
	Notification,
	NotificationInput,
	NotificationQueue,
	Notifications,
	NotificationsOptions,
	NotificationsSnapshot,
	PassiveLedger,
} from './types'

/** Build a record from an input, defaulting the record's own state (`read`, `dismissed`) to false. */
export function createNotification<TType extends string, TPayload>(
	input: NotificationInput<TType, TPayload>,
): Notification<TType, TPayload> {
	return {
		id: input.id,
		type: input.type,
		payload: input.payload,
		scope: input.scope,
		createdAt: input.createdAt,
		read: input.read ?? false,
		dismissed: input.dismissed ?? false,
	}
}

/**
 * createNotifications — the factory. It takes the host's optional storage port and clock and returns the
 * composed mechanism. With no storage port it works in memory and persists nothing; with one it serialises on
 * every change and restores on demand, under the key the host supplies.
 */
export function createNotifications<TType extends string = string, TPayload = unknown>(
	options: NotificationsOptions<TType, TPayload> = {},
): Notifications<TType, TPayload> {
	const clock = options.now ?? (() => Date.now())
	const storage = options.storage
	const storageKey = options.storageKey

	if (storage && !storageKey) {
		throw new NotificationsError('notifications_configuration', 'a storage key is required when a storage port is injected')
	}

	const active: Notification<TType, TPayload>[] = []
	const counts = new Map<string, number>()
	const lastSeenByScope = new Map<string, number>()
	let globalLastSeen = 0
	const listeners = new Set<(snapshot: NotificationsSnapshot<TType, TPayload>) => void>()

	const copy = (notification: Notification<TType, TPayload>): Notification<TType, TPayload> => ({ ...notification })

	const ledgerSnapshot = (): LedgerSnapshot => ({
		globalLastSeen,
		counts: Object.fromEntries(counts),
		lastSeenByScope: Object.fromEntries(lastSeenByScope),
	})

	const snapshot = (): NotificationsSnapshot<TType, TPayload> => ({
		active: active.map(copy),
		ledger: ledgerSnapshot(),
	})

	/** The plain write: serialise the current state to the injected storage. Resolves with no port. */
	const write = (): Promise<void> => {
		if (!storage || !storageKey) return Promise.resolve()
		return storage.set(
			storageKey,
			serializeNotifications<TType, TPayload>({
				active,
				globalLastSeen,
				counts: Object.fromEntries(counts),
				lastSeenByScope: Object.fromEntries(lastSeenByScope),
			}),
		)
	}

	const emit = (): void => {
		const current = snapshot()
		for (const listener of listeners) listener(current)
	}

	/** Every mutation notifies subscribers, then writes through — a failed auto-write never surfaces to a caller. */
	const changed = (): void => {
		emit()
		void write().catch(() => undefined)
	}

	const queue: NotificationQueue<TType, TPayload> = {
		enqueue(notification) {
			if (active.some((queued) => queued.id === notification.id)) return false
			active.push(copy(notification))
			changed()
			return true
		},
		active: () => active.map(copy),
		dismissActive() {
			const head = active.shift()
			if (!head) return undefined
			changed()
			return copy(head)
		},
		remove(match) {
			const kept = active.filter((notification) => !match(notification))
			const removed = active.length - kept.length
			if (removed === 0) return 0
			active.length = 0
			active.push(...kept)
			changed()
			return removed
		},
		retain(match) {
			const kept = active.filter((notification) => match(notification))
			const removed = active.length - kept.length
			if (removed === 0) return 0
			active.length = 0
			active.push(...kept)
			changed()
			return removed
		},
		clear() {
			if (active.length === 0) return
			active.length = 0
			changed()
		},
		markRead(id) {
			const index = active.findIndex((notification) => notification.id === id)
			if (index === -1) return false
			const current = active[index]
			active[index] = { ...current, read: true }
			changed()
			return true
		},
	}

	const ledger: PassiveLedger = {
		increment(scope, by = 1) {
			if (by <= 0) return
			counts.set(scope, (counts.get(scope) ?? 0) + by)
			changed()
		},
		reconcile(next) {
			counts.clear()
			for (const [scope, count] of Object.entries(next)) {
				if (count > 0) counts.set(scope, count)
			}
			changed()
		},
		markSeen(scope, at) {
			counts.set(scope, 0)
			lastSeenByScope.set(scope, at ?? clock())
			changed()
		},
		markAllSeen(at) {
			const stamp = at ?? clock()
			counts.clear()
			globalLastSeen = Math.max(globalLastSeen, stamp)
			changed()
		},
		unseenCount: (scope) => counts.get(scope) ?? 0,
		totalUnseen: () => [...counts.values()].reduce((sum, count) => sum + Math.max(0, count), 0),
		lastSeen: (scope) => Math.max(globalLastSeen, lastSeenByScope.get(scope) ?? 0),
		scopes: () => [...new Set([...counts.keys(), ...lastSeenByScope.keys()])],
	}

	const subscribe = (listener: (snapshot: NotificationsSnapshot<TType, TPayload>) => void): (() => void) => {
		listeners.add(listener)
		return () => {
			listeners.delete(listener)
		}
	}

	const persist = async (): Promise<void> => {
		await write()
	}

	const restore = async (): Promise<void> => {
		if (!storage || !storageKey) return
		const parsed = restoreNotifications<TType, TPayload>(await storage.get(storageKey))
		if (!parsed) return
		active.length = 0
		for (const notification of parsed.active) active.push(copy(notification))
		globalLastSeen = typeof parsed.globalLastSeen === 'number' ? parsed.globalLastSeen : 0
		counts.clear()
		for (const [scope, count] of Object.entries(parsed.counts ?? {})) counts.set(scope, count)
		lastSeenByScope.clear()
		for (const [scope, stamp] of Object.entries(parsed.lastSeenByScope ?? {})) lastSeenByScope.set(scope, stamp)
		emit()
	}

	return { queue, ledger, snapshot, subscribe, persist, restore }
}
