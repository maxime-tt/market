/**
 * notifications/ts/persistence.ts — the storage seam: serialise the queue and the ledger to a string, and
 * restore them from one, through the host-injected `KeyValueStoragePort`.
 *
 * The seam is plain. The module owns no key, no encryption and no storage policy — the port's own doc gives
 * all three to the host — so it only turns the state into a string and back. A payload that does not parse
 * leaves the caller's current state untouched rather than throwing: a corrupt or foreign value under the key
 * is a host concern, not a reason to lose the notifications already in memory.
 */
import type { KeyValueStoragePort } from '../../ports/storage'
import type { Notification } from './types'

/** The serialised shape: the active queue and the ledger's three fields, nothing else. */
export interface PersistedNotifications<TType extends string = string, TPayload = unknown> {
	readonly active: readonly Notification<TType, TPayload>[]
	readonly globalLastSeen: number
	readonly counts: Record<string, number>
	readonly lastSeenByScope: Record<string, number>
}

/** Serialise the state to a JSON string. */
export function serializeNotifications<TType extends string, TPayload>(state: PersistedNotifications<TType, TPayload>): string {
	return JSON.stringify(state)
}

/**
 * Restore a serialised state, or return `null` when the payload is absent or does not parse into the expected
 * shape. A `null` result means "keep what you have" — the caller never loses in-memory state to a bad read.
 */
export function restoreNotifications<TType extends string, TPayload>(raw: string | null): PersistedNotifications<TType, TPayload> | null {
	if (raw === null) return null
	try {
		const parsed = JSON.parse(raw) as PersistedNotifications<TType, TPayload> | null
		if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.active)) return null
		return parsed
	} catch {
		return null
	}
}

/**
 * createMemoryStorage — a reference `KeyValueStoragePort` backed by a Map, with no persistence beyond the
 * process and no encryption. Test support, and an in-memory fallback for a host that wants the seam wired but
 * stores nothing durably. A real host injects its own port.
 */
export function createMemoryStorage(): KeyValueStoragePort {
	const values = new Map<string, string>()
	return {
		get: async (key) => values.get(key) ?? null,
		set: async (key, value) => {
			values.set(key, value)
		},
		remove: async (key) => {
			values.delete(key)
		},
	}
}
