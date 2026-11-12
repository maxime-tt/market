/**
 * state/ts/types.ts — the state vocabulary: the observable container, its options and the persistence seam.
 *
 * The primitive names no domain. `T` is the host's own state shape; the container only holds it, hands it
 * out, notifies subscribers and — when a storage port is injected — serialises it. Nothing here knows what
 * the state means, so the same primitive carries a blacklist, an auction queue or a UI flag.
 */
import type { KeyValueStoragePort } from '../../ports/storage'

/**
 * StateStore — the observable container. `get` reads the current state; `set` replaces it (a value or a
 * functional updater); `subscribe` registers a listener and returns an unsubscribe that stops it.
 *
 * Equality is referential (`Object.is`): `set` is a no-op — no emit, no write — when the resolved next state
 * is the very object already held, so the functional form no-ops when the updater returns its own argument.
 * The container never clones `T`: a host that mutates in place will not notify, so a mutation that must be
 * observed must be expressed as a new value.
 */
export interface StateStore<T> {
	/** The current state, by reference. */
	get(): T
	/** Replace the state; a no-op (no notify, no persist) when referentially identical to the current state. */
	set(next: T | ((previous: T) => T)): void
	/** Call `listener` on every change; returns an unsubscribe function. Does not fire on subscribe. */
	subscribe(listener: (state: T) => void): () => void
}

/**
 * StateStoreOptions — what the host injects. `initial` is required; persistence is optional. The primitive
 * owns no key, no encryption and no storage policy — the storage port's own doc gives those to the host — so
 * a port without the key it should write under is refused (see `createStateStore`).
 */
export interface StateStoreOptions<T> {
	/** The state before anything is written or restored. */
	readonly initial: T
	/** Optional persistence. When absent, the store keeps everything in memory and writes nothing. */
	readonly storage?: KeyValueStoragePort
	/** The key the state is serialised under. Required whenever `storage` is given. */
	readonly storageKey?: string
	/** Turn the state into a string; defaults to `JSON.stringify`. */
	readonly serialize?: (state: T) => string
	/** Turn a stored string back into state, or `null` to mean "keep what you have"; defaults to JSON parsing. */
	readonly deserialize?: (raw: string | null) => T | null
}

/**
 * PersistentStateStore — the container the factory returns: the observable surface plus the explicit halves
 * of the storage seam. With no port both are no-ops, so a caller never has to branch on whether persistence
 * is wired.
 */
export interface PersistentStateStore<T> extends StateStore<T> {
	/** Serialise the current state to the injected storage; a no-op with no port. */
	persist(): Promise<void>
	/** Restore the state from the injected storage; a no-op with no port, and a corrupt payload is ignored. */
	restore(): Promise<void>
}
