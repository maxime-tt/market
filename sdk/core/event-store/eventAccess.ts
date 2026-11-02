import type { NostrEventLike } from '../nostr/eventLike'
import type { EventFilter } from './filter'
import type { EventStorePort } from './port'
import { readThroughStore, type EventReadContext } from './read'

/**
 * The event-access capability: read-through (fetch → admit → NIP-09 deletion lookup → answer from
 * the store) plus local filter queries over the composed store. Transport is host-supplied via
 * `EventReadContext.fetch` (targets, timeout); this capability owns no relay/pool/WebSocket.
 */
export interface EventAccess<E extends NostrEventLike = NostrEventLike> {
	/** The composed port behind `read`/`query`/`subscribe`. */
	readonly store: EventStorePort<E>
	/** Read-through: fetch, merge into the store, then answer from the store. */
	read(filters: readonly EventFilter[]): Promise<E[]>
	/** Local-only filter query against the store; never fetches. */
	query(filters: EventFilter | readonly EventFilter[]): E[]
	/** Called with each event that becomes current; returns an unsubscribe function. */
	subscribe(filters: EventFilter | readonly EventFilter[], listener: (event: E) => void): () => void
}

/** Composes `EventStorePort` with the injected fetch port into the event-access capability. */
export function createEventAccess<E extends NostrEventLike = NostrEventLike>(context: EventReadContext<E>): EventAccess<E> {
	return {
		store: context.store,
		read: (filters) => readThroughStore(context, filters),
		query: (filters) => context.store.query(filters),
		subscribe: (filters, listener) => context.store.subscribe(filters, listener),
	}
}
