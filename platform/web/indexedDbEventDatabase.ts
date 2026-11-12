import { openIndexedDBEventDatabase } from 'applesauce-indexeddb'
import type { IAsyncEventDatabase } from 'applesauce-core/event-store'

/**
 * The browser host's persistent event database (contract rev 2.21 decision 3): `applesauce-indexeddb` over
 * IndexedDB. `openIndexedDBEventDatabase` is async, but `createApplesauceEventStore` is constructed
 * synchronously at module scope, so this wraps it in a **lazy** `IAsyncEventDatabase`: the first read/write
 * awaits the open, every call after that reuses it.
 *
 * Returns `undefined` when IndexedDB is unavailable (SSR / non-browser), so the adapter falls back to its
 * in-memory default. `sdk/` never imports this module — the host injects the database.
 */
export function createIndexedDbEventDatabase(name = 'plebeian-market-events'): IAsyncEventDatabase | undefined {
	if (typeof indexedDB === 'undefined') return undefined

	let opened: Promise<IAsyncEventDatabase> | null = null
	const database = () => {
		if (!opened) opened = openIndexedDBEventDatabase({ name }) as Promise<IAsyncEventDatabase>
		return opened
	}

	return {
		add: async (event) => (await database()).add(event),
		remove: async (event) => (await database()).remove(event),
		removeByFilters: async (filters) => (await database()).removeByFilters(filters),
		hasEvent: async (id) => (await database()).hasEvent(id),
		getEvent: async (id) => (await database()).getEvent(id),
		hasReplaceable: async (kind, pubkey, identifier) => (await database()).hasReplaceable(kind, pubkey, identifier),
		getReplaceable: async (kind, pubkey, identifier) => (await database()).getReplaceable(kind, pubkey, identifier),
		getReplaceableHistory: async (kind, pubkey, identifier) => (await database()).getReplaceableHistory(kind, pubkey, identifier),
		getByFilters: async (filters) => (await database()).getByFilters(filters),
		getTimeline: async (filters) => (await database()).getTimeline(filters),
		update: () => {},
	}
}
