import { describe, expect, test } from 'bun:test'
import type { NostrEventLike } from '../nostr/eventLike'
import { matchesFilter, type EventFilter } from './filter'
import { createEventAccess } from './eventAccess'
import { createMemoryEventStore } from './memoryEventStore'
import { createEventReadContext, streamFromFetch, type EventReadContext } from './read'

let counter = 0
const event = (overrides: Partial<NostrEventLike>): NostrEventLike => ({
	id: `id-${++counter}`,
	pubkey: 'seller',
	kind: 30402,
	created_at: 100,
	content: '',
	tags: [['d', 'mug']],
	...overrides,
})

/** Fake relay: answers every filter from a fixed event list and records requests. */
function createContext(relayEvents: NostrEventLike[]): EventReadContext & { requests: EventFilter[][] } {
	const requests: EventFilter[][] = []
	const store = createMemoryEventStore()
	const stream = streamFromFetch(store, async (filters) => {
		requests.push([...filters])
		return relayEvents.filter((candidate) => filters.some((filter) => matchesFilter(candidate, filter)))
	})
	return { ...createEventReadContext({ store, stream }), requests }
}

describe('createEventAccess', () => {
	test('read() merges fetched events into the store and drops a listing the author deleted even when the relay still serves it', async () => {
		const kept = event({})
		const deleted = event({ tags: [['d', 'gone']] })
		const deletion = event({ kind: 5, created_at: 200, tags: [['a', '30402:seller:gone']] })
		const context = createContext([kept, deleted, deletion])
		const access = createEventAccess(context)

		expect((await access.read([{ kinds: [30402] }])).map((e) => e.id)).toEqual([kept.id])
		expect(await access.store.get(kept.id)).toBe(kept)
		expect(await access.store.get(deleted.id)).toBeUndefined()

		// the relay still serves the deleted listing; a re-read keeps it out of the answer
		expect((await access.read([{ kinds: [30402] }])).map((e) => e.id)).toEqual([kept.id])
		expect(await access.store.get(deleted.id)).toBeUndefined()
	})

	test('query() is local-only: it answers from the store without calling fetch', async () => {
		const listing = event({})
		const context = createContext([listing])
		const access = createEventAccess(context)

		// the event is in the store only because read() merged it there
		await access.read([{ kinds: [30402] }])
		const fetchCallsAfterRead = context.requests.length

		expect((await access.query({ kinds: [30402] })).map((e) => e.id)).toEqual([listing.id])
		expect((await access.query([{ kinds: [30402] }, { authors: ['seller'] }])).map((e) => e.id)).toEqual([listing.id])
		// unknown kinds stay absent — nothing is fetched to fill the store
		expect(await access.query({ kinds: [9999] })).toEqual([])
		expect(context.requests).toHaveLength(fetchCallsAfterRead)
	})

	test('subscribe() fires for each event that becomes current and stops after unsubscribe', async () => {
		const first = event({})
		const second = event({ created_at: 150 })
		const context = createContext([first, second])
		const access = createEventAccess(context)
		const seen: string[] = []
		const stop = access.subscribe({ kinds: [30402] }, (e) => seen.push(e.id))

		await access.read([{ kinds: [30402] }])
		expect(seen).toEqual([first.id, second.id])

		stop()
		await access.store.add(event({ created_at: 300 }))
		expect(seen).toEqual([first.id, second.id])
	})

	test('stream() delivers events then the caught-up marker', async () => {
		const listing = event({})
		const context = createContext([listing])
		const access = createEventAccess(context)

		const items: string[] = []
		for await (const item of access.stream([{ kinds: [30402] }])) {
			items.push(item.type === 'event' ? `event:${item.event.id}` : 'caught-up')
		}
		expect(items).toEqual([`event:${listing.id}`, 'caught-up'])
	})

	test('read() preserves the deletion lookup request shape', async () => {
		const listing = event({})
		const note = event({ kind: 1, tags: [] })
		const context = createContext([listing, note])
		const access = createEventAccess(context)

		await access.read([{ kinds: [1, 30402] }])

		expect(context.requests[1]).toEqual([
			{ kinds: [5], authors: ['seller'], '#a': ['30402:seller:mug'] },
			{ kinds: [5], authors: ['seller'], '#e': [note.id] },
		])
	})
})
