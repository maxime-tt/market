import type { NostrEventLike } from '../nostr/eventLike'
import type { EventFilter } from './filter'

/** Why an event was or was not kept. Rejection carries the parser's reason so owner surfaces can explain it. */
export type EventStoreAddResult =
	| { status: 'added' }
	| { status: 'duplicate' }
	| { status: 'superseded' }
	| { status: 'deleted' }
	| { status: 'rejected'; reason: string }

/** Admission gate run before an event is stored; return a reason string to reject. */
export type EventAdmission<E extends NostrEventLike = NostrEventLike> = (event: E) => true | string

/**
 * Holds validated relay events with Nostr replace/delete semantics applied.
 *
 * The mixed sync/async shape is deliberate (contract rev 2.21/2.22): the snapshot methods that touch the
 * backing database are **async** (`add`, `get`, `getReplaceable`, `query`) because a persistent database
 * (applesauce `IAsyncEventDatabase`, IndexedDB) is async; the local predicate `isDeleted` and the
 * local-only `subscribe` fan-out stay **sync** because they read adapter-owned in-memory state and carry
 * no I/O. Hosts supply the instance; SDK workflows only see this port.
 */
export interface EventStorePort<E extends NostrEventLike = NostrEventLike> {
	add(event: E): Promise<EventStoreAddResult>
	get(id: string): Promise<E | undefined>
	/** Latest version of a replaceable (`d` omitted) or addressable event. */
	getReplaceable(kind: number, pubkey: string, d?: string): Promise<E | undefined>
	/** Local snapshot over the store (async: the backing database may be async). */
	query(filters: EventFilter | readonly EventFilter[]): Promise<E[]>
	/** Called with each event that becomes current; returns an unsubscribe function. Local-only, sync. */
	subscribe(filters: EventFilter | readonly EventFilter[], listener: (event: E) => void): () => void
	/** Applied NIP-09 deletion for this event, if any. Local predicate over the adapter's own tracker. */
	isDeleted(event: E): boolean
}
