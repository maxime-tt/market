import type { NostrEventLike } from '../nostr/eventLike'
import type { EventFilter } from './filter'
import { DELETION_REQUEST_KIND, getReplaceableKey, isAddressableKind } from './mergeRules'
import type { EventStorePort } from './port'

/**
 * One item on a read stream: an admitted event, or the caught-up (EOSE) marker that closes a bounded read.
 * The stream opens **synchronously** and delivers **asynchronously** (contract rev 2.21).
 */
export type EventStreamItem<E extends NostrEventLike = NostrEventLike> =
	| { type: 'event'; event: E }
	| { type: 'caught-up'; info: CaughtUpInfo }

/** Which relays reached EOSE before the caught-up marker, and which did not. */
export interface CaughtUpInfo {
	eose: string[]
	pending: string[]
	/** True when the stream was a bounded read (the relay source closed after the marker). */
	complete: boolean
}

export interface EventStreamOptions {
	/** Fetch from relays as part of the stream. Default: true (the live read path). */
	live?: boolean
	/**
	 * A bounded read (the derived `fetch`): the source should use a bounded relay request and end at
	 * caught-up, rather than hold a persistent subscription open. Set by `createEventReadContext`'s `fetch`.
	 */
	bounded?: boolean
	/**
	 * Admit emitted events into the store. Default: true for a live `stream` (the store is the single
	 * admission point). The bounded `fetch` passes `false`: a detail/one-off read must not warm or pollute
	 * the shared store (e.g. kind-1 comments/reports must not leak into the kind-1 feed).
	 */
	admit?: boolean
	/** Abort the stream (closes the relay source). */
	signal?: AbortSignal
}

/** Result of a write-through publish. `acceptedRelays` holds only the relays that acknowledged. */
export interface PublishOutcome {
	acceptedRelays: string[]
}

/**
 * Host-bound read dependencies. `stream` is the primary read path: a subscription that opens sync, replays
 * already-stored matches, then delivers live arrivals and a caught-up (EOSE) marker. `fetch` is a **bounded
 * stream** (open → collect to the marker → close), not a second read route (contract rev 2.22). `store` is
 * the single admission/merge point; `publish` (optional) is write-through.
 */
export interface EventReadContext<E extends NostrEventLike = NostrEventLike> {
	store: EventStorePort<E>
	/** Open (sync) an async stream of events that become current, ending with a caught-up marker. */
	stream(filters: readonly EventFilter[], options?: EventStreamOptions): AsyncIterable<EventStreamItem<E>>
	/**
	 * Bounded stream over `stream()`: collect to the caught-up marker, then close. Use for single-entity /
	 * detail reads (profile, product/auction detail, one-off lookup by id/coordinate); prefer `stream` for
	 * list or live reads. Justify each use at the call site.
	 */
	fetch(filters: readonly EventFilter[]): Promise<E[]>
	/** Write-through publish: send the signed event AND admit it to the store. */
	publish?(event: E): Promise<PublishOutcome>
}

/** The injected parts of a read context; `fetch` is derived from `stream`. */
export interface EventReadContextParts<E extends NostrEventLike = NostrEventLike> {
	store: EventStorePort<E>
	stream: EventReadContext<E>['stream']
	publish?: EventReadContext<E>['publish']
}

/** Collect a stream to its caught-up marker (or natural end); returns the events it delivered. */
export async function collectStream<E extends NostrEventLike>(stream: AsyncIterable<EventStreamItem<E>>): Promise<E[]> {
	const events: E[] = []
	for await (const item of stream) {
		if (item.type === 'caught-up') break
		events.push(item.event)
	}
	return events
}

/** Build a read context, deriving the bounded `fetch` from `stream` (contract rev 2.22). */
export function createEventReadContext<E extends NostrEventLike = NostrEventLike>(parts: EventReadContextParts<E>): EventReadContext<E> {
	const { store, stream, publish } = parts
	return {
		store,
		stream,
		publish,
		fetch: (filters) => collectStream(stream(filters, { live: true, admit: false, bounded: true })),
	}
}

/**
 * Adapt a batch fetch into a bounded stream (host/test seam). Each event is admitted into `store` unless the
 * stream is called with `admit: false` (a bounded `fetch`) or the adapter is built with `{ admit: false }` (a
 * deliberately non-merging source, e.g. a report feed that must not pollute the shared store). The caught-up
 * marker closes the read.
 */
export function streamFromFetch<E extends NostrEventLike = NostrEventLike>(
	store: EventStorePort<E>,
	fetch: (filters: readonly EventFilter[]) => Promise<E[]>,
	defaults: { admit?: boolean } = {},
): EventReadContext<E>['stream'] {
	return async function* (filters, options) {
		const admit = options?.admit ?? defaults.admit ?? true
		const events = await fetch(filters)
		for (const event of events) {
			if (admit) await store.add(event)
			yield { type: 'event', event }
		}
		yield { type: 'caught-up', info: { eose: [], pending: [], complete: true } }
	}
}

/**
 * A host-provided live source for `createStoreStream`: opens sync (returns an AsyncIterable) and emits relay
 * arrivals plus one `caught-up` marker. The platform adapter implements this over applesauce's RelayGroup; a
 * non-browser host can implement it over any transport.
 */
export type EventStreamSource<E extends NostrEventLike = NostrEventLike> = (
	filters: readonly EventFilter[],
	options?: EventStreamOptions,
) => AsyncIterable<EventStreamItem<E>>

/**
 * The real stream: replay already-stored matches first (local-first), then forward the live source, admitting
 * each arrival into the store unless the caller opted out (`admit: false`, used by the bounded `fetch`).
 * The `caught-up` marker is forwarded from the source; a live stream stays open after it, a bounded `fetch`
 * closes at it.
 */
export function createStoreStream<E extends NostrEventLike = NostrEventLike>(parts: {
	store: EventStorePort<E>
	source: EventStreamSource<E>
}): EventReadContext<E>['stream'] {
	const { store, source } = parts
	return async function* (filters, options) {
		// 1. Live reads replay what the store already has (the local cache). A bounded `fetch` does not:
		// it is a relay answer, and the store still merges the arrivals on admission.
		if (options?.bounded !== true) {
			for (const event of await store.query(filters)) yield { type: 'event', event }
		}
		if (options?.live === false) {
			yield { type: 'caught-up', info: { eose: [], pending: [], complete: true } }
			return
		}
		// 2. Forward the live relay source; the store stays the single admission point.
		const admit = options?.admit ?? true
		for await (const item of source(filters, options)) {
			if (item.type === 'event' && admit) await store.add(item.event)
			yield item
		}
	}
}

/**
 * Adapt `EventStorePort` to applesauce's `IAsyncEventStoreActions` shape so a relay group can deduplicate
 * events against our store (`RelayGroup.subscription/request({ eventStore })`). `add` admits and returns the
 * event only when it was newly added (a duplicate/superseded/deleted/rejected event returns `null`, so the
 * group drops it). The port has no `remove`/`update`, so those are best-effort no-ops.
 */
export function asAsyncEventStoreActions<E extends NostrEventLike = NostrEventLike>(
	store: EventStorePort<E>,
): {
	add(event: E): Promise<E | null>
	remove(event: string | E): Promise<boolean>
	update(event: E): Promise<void>
} {
	return {
		add: async (event) => ((await store.add(event)).status === 'added' ? event : null),
		remove: async () => false,
		update: async () => {},
	}
}

/** NIP-09 lookups for the given events, scoped to their authors. */
export function buildDeletionLookupFilters(events: readonly NostrEventLike[]): EventFilter[] {
	if (events.length === 0) return []
	const authors = [...new Set(events.map((event) => event.pubkey))]
	const coordinates = [...new Set(events.filter((event) => isAddressableKind(event.kind)).map((event) => getReplaceableKey(event)!))]
	const ids = events.filter((event) => !isAddressableKind(event.kind)).map((event) => event.id)

	const filters: EventFilter[] = []
	if (coordinates.length > 0) filters.push({ kinds: [DELETION_REQUEST_KIND], authors, '#a': coordinates })
	if (ids.length > 0) filters.push({ kinds: [DELETION_REQUEST_KIND], authors, '#e': ids })
	return filters
}

async function addDeletionsFor<E extends NostrEventLike>(context: EventReadContext<E>, events: readonly E[]): Promise<void> {
	const filters = buildDeletionLookupFilters(events)
	if (filters.length === 0) return
	for (const deletion of await context.fetch(filters)) await context.store.add(deletion)
}

/**
 * Bounded discovery read: collect the stream to its caught-up marker, look up deletions for what arrived,
 * then answer from the store so superseded and deleted versions never surface.
 */
export async function readThroughStore<E extends NostrEventLike>(
	context: EventReadContext<E>,
	filters: readonly EventFilter[],
): Promise<E[]> {
	const fetched = await context.fetch(filters)
	for (const event of fetched) await context.store.add(event)
	await addDeletionsFor(context, fetched)
	return context.store.query(filters)
}

/** Drops events deleted by their author; for lists assembled outside a single filter (e.g. collection members). */
export async function excludeDeleted<E extends NostrEventLike>(context: EventReadContext<E>, events: readonly E[]): Promise<E[]> {
	for (const event of events) await context.store.add(event)
	await addDeletionsFor(context, events)
	return events.filter((event) => !context.store.isDeleted(event))
}
