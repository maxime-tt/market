/**
 * notifications/ts/types.ts — the notification vocabulary: the record, the rule seam, the active queue, the
 * passive ledger, and the factory's options.
 *
 * The core names no domain. `TType` is an open string the host chooses (never a fixed union here), `TPayload`
 * is the host's own shape, and `scope` is an opaque counting key. Nothing in this file knows of auctions,
 * orders or messages — those are the platform's configuration, layered on top of this mechanism.
 */
import type { KeyValueStoragePort } from '../../ports/storage'

/**
 * Notification — one notification. `type` is a host-supplied string, `payload` is the host's own shape,
 * `scope` is the opaque key passive counting is done under (e.g. a conversation pubkey), and `createdAt` is
 * the value the host's clock returned when the notification was made. `read` and `dismissed` are the record's
 * own state, so a host that persists and rehydrates a notification round-trips them rather than reconstructing
 * them.
 */
export interface Notification<TType extends string = string, TPayload = unknown> {
	/** The notification's identity — unique within the queue, and what de-duplication keys on. */
	readonly id: string
	/** The host's own kind; an open string, so the core states no rule about it. */
	readonly type: TType
	/** The host's own payload; opaque to the core. */
	readonly payload: TPayload
	/** The opaque counting key this notification belongs to, for the passive ledger. */
	readonly scope: string
	/** The value the host's clock returned when the notification was made; the host owns its unit. */
	readonly createdAt: number
	/** Whether the host has marked the notification read. */
	readonly read: boolean
	/** Whether the host has marked the notification dismissed. */
	readonly dismissed: boolean
}

/** What `createNotification` accepts: the record's fields, with `read` and `dismissed` defaulting to false. */
export interface NotificationInput<TType extends string = string, TPayload = unknown> {
	readonly id: string
	readonly type: TType
	readonly payload: TPayload
	readonly scope: string
	readonly createdAt: number
	readonly read?: boolean
	readonly dismissed?: boolean
}

/**
 * NotificationRule — the host-registered rule seam: a stable `id` and a pure `derive` that turns one input
 * into zero or more notifications. The core implements no rule; it carries the host's. This is where the
 * platform declares *what counts as a notification* (an auction win, a new bid, a message), while the core
 * only declares the shape such a rule must have.
 */
export interface NotificationRule<TInput, TType extends string = string, TPayload = unknown> {
	readonly id: string
	derive(input: TInput): readonly Notification<TType, TPayload>[]
}

/** NotificationsSnapshot — what a subscriber is handed: the active queue and the ledger's state, both copied. */
export interface NotificationsSnapshot<TType extends string = string, TPayload = unknown> {
	readonly active: readonly Notification<TType, TPayload>[]
	readonly ledger: LedgerSnapshot
}

/**
 * LedgerSnapshot — the passive ledger's durable state: the global last-seen floor, the per-scope unseen
 * counts, and the per-scope last-seen marks. This is the shape that is serialised and restored.
 */
export interface LedgerSnapshot {
	readonly globalLastSeen: number
	readonly counts: Readonly<Record<string, number>>
	readonly lastSeenByScope: Readonly<Record<string, number>>
}

/**
 * NotificationQueue — the active queue, generalising the auction-win queue's actions so the mechanism serves
 * any active notification, not just a won auction. Notifications are held oldest-first; `dismissActive`
 * removes the head (the notification currently demanding attention), and `remove`/`retain`/`clear` are the
 * generalised forms of the auction queue's per-auction and per-bidder filters.
 */
export interface NotificationQueue<TType extends string = string, TPayload = unknown> {
	/**
	 * Append the notification unless one with the same `id` is already queued. De-duplication is by `id`, so
	 * the host encodes whatever composite identity it needs into that field. Returns true when it was added.
	 */
	enqueue(notification: Notification<TType, TPayload>): boolean
	/** The queued notifications, oldest first, as a copy. */
	active(): readonly Notification<TType, TPayload>[]
	/** Remove and return the head, or undefined when the queue is empty. */
	dismissActive(): Notification<TType, TPayload> | undefined
	/** Remove every notification the predicate matches; returns how many were removed. */
	remove(match: (notification: Notification<TType, TPayload>) => boolean): number
	/** Keep only the notifications the predicate matches; returns how many were removed. */
	retain(match: (notification: Notification<TType, TPayload>) => boolean): number
	/** Empty the queue. */
	clear(): void
	/** Mark the queued notification with this id read; returns true when one was found. */
	markRead(id: string): boolean
}

/**
 * PassiveLedger — the passive ledger: unseen counts and last-seen marks, scoped by an opaque string key. A
 * scope is marked seen without touching another's count or last-seen, so a host can clear one conversation
 * while leaving every other scope intact.
 */
export interface PassiveLedger {
	/** Raise a scope's unseen count; `by` defaults to 1 and a non-positive `by` is ignored. */
	increment(scope: string, by?: number): void
	/**
	 * Overwrite every scope's unseen count with `counts`: the map becomes exactly the entries given (a scope
	 * absent from `counts` drops to zero, a scope present is set to its value, never summed onto). Last-seen
	 * marks are untouched. This is the overwrite a bulk reconciliation needs — re-running it over the same
	 * fetched set leaves the same counts, whereas `increment` would accumulate — so a host that re-synced on
	 * every account change does not double what the user sees.
	 */
	reconcile(counts: Readonly<Record<string, number>>): void
	/** Zero a scope's unseen count and stamp its last-seen; `at` defaults to the injected clock. */
	markSeen(scope: string, at?: number): void
	/**
	 * Stamp a scope's last-seen WITHOUT touching its unseen count, for rehydrating persisted read marks.
	 *
	 * `markSeen` is the user action: it clears the badge and moves the mark together. Rehydration is not a
	 * user action — replaying a stored mark must not clear a count the user has not actually read, so the
	 * two are separate operations. Monotonic: an `at` at or below the current mark is ignored, so replaying
	 * an older stored mark cannot un-read. Emits like any other ledger change.
	 */
	hydrateMark(scope: string, at: number): void
	/** Zero every scope's count and advance the global last-seen floor; `at` defaults to the injected clock. */
	markAllSeen(at?: number): void
	/** A scope's unseen count. */
	unseenCount(scope: string): number
	/** The sum of every scope's unseen count. */
	totalUnseen(): number
	/** A scope's last-seen, floored by the global last-seen. */
	lastSeen(scope: string): number
	/** Every scope that carries a count or a last-seen mark. */
	scopes(): readonly string[]
}

/**
 * NotificationsOptions — what the composing host injects: an optional storage port (no port means the module
 * works in memory only), the key the state is serialised under, and an optional clock. The module owns no key,
 * no encryption and no storage policy — the storage port's own doc gives those to the host.
 */
export interface NotificationsOptions<TType extends string = string, TPayload = unknown> {
	/** Optional persistence. When absent, the module keeps everything in memory and persists nothing. */
	readonly storage?: KeyValueStoragePort
	/** The key the state is serialised under. Required whenever `storage` is given. */
	readonly storageKey?: string
	/** The clock, in the host's unit. Defaults to `Date.now`. */
	readonly now?: () => number
}

/**
 * Notifications — the composed mechanism: the active queue, the passive ledger, a subscription the host can
 * bridge to its own reactivity, and the plain serialise/restore storage seam. It is an instance of the
 * notifications core, not a notification itself.
 */
export interface Notifications<TType extends string = string, TPayload = unknown> {
	readonly queue: NotificationQueue<TType, TPayload>
	readonly ledger: PassiveLedger
	/** A copy of the current state, as a subscriber is handed it. */
	snapshot(): NotificationsSnapshot<TType, TPayload>
	/** Call `listener` on every change; returns an unsubscribe function. Does not fire on subscribe. */
	subscribe(listener: (snapshot: NotificationsSnapshot<TType, TPayload>) => void): () => void
	/** Serialise the current state to the injected storage; a no-op with no port. */
	persist(): Promise<void>
	/** Restore the state from the injected storage; a no-op with no port, and a corrupt payload is ignored. */
	restore(): Promise<void>
}
