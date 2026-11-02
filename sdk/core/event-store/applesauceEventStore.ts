import { EventStore, type IEventDatabase } from 'applesauce-core/event-store'
import type { NostrEvent } from 'nostr-tools'
import type { NostrEventLike } from '../nostr/eventLike'
import { matchesFilter, selectMatching, type EventFilter } from './filter'
import {
	DELETION_REQUEST_KIND,
	getDTag,
	getReplaceableKey,
	isAddressableKind,
	isDeletedBy,
	isNewerVersion,
	readDeletionTargets,
	type DeletionTargets,
} from './mergeRules'
import type { EventAdmission, EventStoreAddResult, EventStorePort } from './port'

/**
 * applesauce-backed `EventStorePort` over `applesauce-core`'s `EventStore`.
 *
 * The `EventStorePort` contract is authoritative over applesauce's own semantics. Adapter decisions and
 * divergences, each deliberate:
 *
 * 1. Kind-5 deletion requests are applied but not stored: applesauce's `DeleteManager` consumes them
 *    (removing already-stored deleted events from its database) and `EventStore.add` never persists a
 *    kind-5 event, so `get`/`query` never surface one. Listeners are still notified.
 * 2. `query` selects candidates through applesauce's index-backed `getByFilters` (with `limit` stripped;
 *    applesauce applies no per-filter limit and returns an unordered set), then re-selects with
 *    `selectMatching` so the port keeps its newest-first ordering and per-filter limit semantics.
 * 3. Signature verification is disabled (`verifyEvent: () => true`): applesauce defaults to nostr-tools
 *    signature checks, which reject the port's synthetic events. Admission is the port's per-kind
 *    `EventAdmission` contract, not a signature gate.
 * 4. Deletion rules follow the port's `mergeRules`, not applesauce: applesauce only removes an
 *    already-stored event when the deletion's `until >= created_at`, while the port's `isDeletedBy`
 *    honours an e-id target regardless of age; applesauce's pointer parsers also silently skip
 *    targets they cannot parse. The adapter therefore keeps its own `DeletionTargets` tracker (fed by
 *    `readDeletionTargets`) and removes already-stored covered events itself, so the port rule wins
 *    for `add` verdicts, `isDeleted` and store contents. The kind-5 event is still handed to
 *    `store.add` so applesauce's DeleteManager bookkeeping stays aligned with the tracker.
 */
export interface ApplesauceEventStoreOptions<E extends NostrEventLike> {
	/** Host-supplied applesauce database (e.g. IndexedDB-backed); defaults to applesauce's in-memory `EventMemory`. */
	database?: IEventDatabase
	/** Per-kind parsers; kinds without an entry are admitted as-is. */
	admission?: Partial<Record<number, EventAdmission<E>>>
}

export function createApplesauceEventStore<E extends NostrEventLike = NostrEventLike>(
	options: ApplesauceEventStoreOptions<E> = {},
): EventStorePort<E> {
	const store = new EventStore({
		database: options.database,
		keepOldVersions: false,
		keepExpired: true,
		verifyEvent: () => true,
	})

	const deletions: DeletionTargets[] = []
	const listeners = new Set<{ filters: readonly EventFilter[]; listener: (event: E) => void }>()

	const isDeleted = (event: E) => deletions.some((deletion) => isDeletedBy(event, deletion))

	/** Removes already-stored events covered by a deletion, per the port's rules (applesauce's own removal is best-effort). */
	const removeDeleted = (deletion: DeletionTargets) => {
		for (const stored of store.getByFilters({}) as unknown as E[]) {
			if (isDeletedBy(stored, deletion)) store.remove(stored.id)
		}
	}

	const notify = (event: E) => {
		for (const { filters, listener } of listeners) {
			if (filters.some((filter) => matchesFilter(event, filter))) listener(event)
		}
	}

	const add = (event: E): EventStoreAddResult => {
		if (store.hasEvent(event.id)) return { status: 'duplicate' }

		const admit = options.admission?.[event.kind]
		const verdict = admit ? admit(event) : true
		if (verdict !== true) return { status: 'rejected', reason: verdict }

		if (event.kind === DELETION_REQUEST_KIND) {
			const deletion = readDeletionTargets(event)
			deletions.push(deletion)
			removeDeleted(deletion)
			store.add(event as unknown as NostrEvent)
			notify(event)
			return { status: 'added' }
		}
		if (isDeleted(event)) return { status: 'deleted' }

		const key = getReplaceableKey(event)
		if (key) {
			const current = store.getReplaceable(event.kind, event.pubkey, isAddressableKind(event.kind) ? getDTag(event) : undefined)
			if (current && !isNewerVersion(event, current)) return { status: 'superseded' }
		}

		store.add(event as unknown as NostrEvent)
		notify(event)
		return { status: 'added' }
	}

	return {
		add,
		get: (id) => store.getEvent(id) as E | undefined,
		getReplaceable: (kind, pubkey, d) => store.getReplaceable(kind, pubkey, d) as E | undefined,
		query: (filters) => {
			const list = Array.isArray(filters) ? filters : [filters as EventFilter]
			const stripped = list.map(({ limit: _limit, ...withoutLimit }) => withoutLimit)
			return selectMatching(store.getByFilters(stripped) as E[], filters)
		},
		subscribe: (filters, listener) => {
			const entry = { filters: Array.isArray(filters) ? filters : [filters as EventFilter], listener }
			listeners.add(entry)
			return () => listeners.delete(entry)
		},
		isDeleted,
	}
}
