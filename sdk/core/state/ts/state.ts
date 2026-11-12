/**
 * state/ts/state.ts — the primitive: an observable container with an optional write-through storage seam.
 *
 * The factory is the generic form of what each store in the app hand-rolls: hold a `T`, hand it out, notify
 * on change, and — when a storage port is injected — keep a serialised copy in step. It names no domain, holds
 * no key and implements no policy; the host supplies the state, the port and the key, or nothing at all.
 *
 * Design choices the caller can rely on:
 *   - Equality is referential (`Object.is`). `set` with the current reference — or a functional updater that
 *     returns its own argument — is a no-op: no listener runs and nothing is written. A host that wants a
 *     value-equal state to suppress a notify must compare before calling `set`.
 *   - A listener that throws is isolated: it is caught and the remaining listeners still run, so one broken
 *     subscriber cannot stop the others. The error is swallowed, matching the house degrade-don't-tear-down
 *     pattern for non-critical paths.
 *   - Persistence is write-through on every effective change; a failed auto-write is swallowed, never
 *     surfaced to a caller. `persist()` writes explicitly. `restore()` reads back and leaves in-memory state
 *     untouched when the payload is absent or does not parse — a corrupt or foreign value under the key is a
 *     host concern, not a reason to lose the state already in memory.
 */
import { StateError } from './errors'
import type { PersistentStateStore, StateStoreOptions } from './types'

/** The default serialiser: the plain JSON form of the state. */
const defaultSerialize = <T>(state: T): string => JSON.stringify(state)

/**
 * The default deserialiser: parse the raw string, or return `null` for an absent or unparseable payload so
 * the caller keeps what it has. A stored `null` parses to `null`, which also means "keep what you have".
 */
const defaultDeserialize = <T>(raw: string | null): T | null => {
	if (raw === null) return null
	try {
		const parsed = JSON.parse(raw) as T | null
		return parsed ?? null
	} catch {
		return null
	}
}

/**
 * createStateStore — the factory. It takes the host's initial state and, optionally, a storage port and the
 * key to write under. With no port it works entirely in memory; with one it serialises on every change and
 * restores on demand. A port without a key is refused fail-closed (`StateError`), because the primitive owns
 * no key.
 */
export function createStateStore<T>(options: StateStoreOptions<T>): PersistentStateStore<T> {
	const storage = options.storage
	const storageKey = options.storageKey
	const serialize = options.serialize ?? defaultSerialize<T>
	const deserialize = options.deserialize ?? defaultDeserialize<T>

	if (storage && !storageKey) {
		throw new StateError('state_configuration', 'a storage key is required when a storage port is injected')
	}

	let current = options.initial
	const listeners = new Set<(state: T) => void>()

	const write = (): Promise<void> => {
		if (!storage || !storageKey) return Promise.resolve()
		return storage.set(storageKey, serialize(current))
	}

	const emit = (): void => {
		for (const listener of [...listeners]) {
			try {
				listener(current)
			} catch {
				// A broken listener is isolated: the remaining listeners still run. Swallowed by design.
			}
		}
	}

	const set = (next: T | ((previous: T) => T)): void => {
		const resolved = typeof next === 'function' ? (next as (previous: T) => T)(current) : next
		if (Object.is(resolved, current)) return
		current = resolved
		emit()
		void write().catch(() => undefined)
	}

	const subscribe = (listener: (state: T) => void): (() => void) => {
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
		const restored = deserialize(await storage.get(storageKey))
		if (restored === null) return
		current = restored
		emit()
	}

	return { get: () => current, set, subscribe, persist, restore }
}
