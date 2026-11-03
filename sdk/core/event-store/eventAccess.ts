import type { NostrEventLike } from '../nostr/eventLike'
import type { EventFilter } from './filter'
import type { EventStorePort } from './port'
import { readThroughStore, type EventReadContext, type EventStreamItem, type EventStreamOptions } from './read'

/**
 * The event-access capability: read-through (the stream collected to caught-up) plus local filter queries
 * over the composed store, and the stream itself for list/live reads. Transport is host-supplied via
 * `EventReadContext.stream`; this capability owns no relay/pool/WebSocket.
 */
export interface EventAccess<E extends NostrEventLike = NostrEventLike> {
	/** The composed port behind `read`/`query`/`subscribe`. */
	readonly store: EventStorePort<E>
	/** Read-through (bounded): collect the stream to caught-up, merge, then answer from the store. */
	read(filters: readonly EventFilter[]): Promise<E[]>
	/** Local-only filter query against the store; never fetches. */
	query(filters: EventFilter | readonly EventFilter[]): Promise<E[]>
	/** The primary read path: the host's live stream (cached replay, then arrivals, then caught-up). */
	stream(filters: readonly EventFilter[], options?: EventStreamOptions): AsyncIterable<EventStreamItem<E>>
	/** Local-only fan-out of events that become current; returns an unsubscribe function. */
	subscribe(filters: EventFilter | readonly EventFilter[], listener: (event: E) => void): () => void
}

/** Composes `EventStorePort` with the injected read context into the event-access capability. */
export function createEventAccess<E extends NostrEventLike = NostrEventLike>(context: EventReadContext<E>): EventAccess<E> {
	return {
		store: context.store,
		read: (filters) => readThroughStore(context, filters),
		query: (filters) => context.store.query(filters),
		stream: (filters, options) => context.stream(filters, options),
		subscribe: (filters, listener) => context.store.subscribe(filters, listener),
	}
}
