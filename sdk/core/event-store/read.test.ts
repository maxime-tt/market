import { describe, expect, test } from 'bun:test'
import type { NostrEventLike } from '../nostr/eventLike'
import { matchesFilter, type EventFilter } from './filter'
import { createMemoryEventStore } from './memoryEventStore'
import {
	asAsyncEventStoreActions,
	buildDeletionLookupFilters,
	createEventReadContext,
	createStoreStream,
	excludeDeleted,
	readThroughStore,
	streamFromFetch,
	type EventReadContext,
} from './read'
import { readProductListWorkflow, isProductListed } from '../../commerce/discovery/productRead'

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

describe('readThroughStore', () => {
	test('drops listings the author deleted even when the relay still serves them', async () => {
		const listing = event({})
		const deletion = event({ kind: 5, created_at: 200, tags: [['a', '30402:seller:mug']] })
		const context = createContext([listing, deletion])

		expect(await readThroughStore(context, [{ kinds: [30402] }])).toEqual([])
		expect(context.requests[1]).toEqual([{ kinds: [5], authors: ['seller'], '#a': ['30402:seller:mug'] }])
	})

	test('keeps a listing republished after its deletion', async () => {
		const republished = event({ created_at: 300 })
		const deletion = event({ kind: 5, created_at: 200, tags: [['a', '30402:seller:mug']] })
		const context = createContext([republished, deletion])

		expect((await readThroughStore(context, [{ kinds: [30402] }])).map((e) => e.id)).toEqual([republished.id])
	})

	test('ignores deletions published by someone else', async () => {
		const listing = event({})
		const forged = event({ kind: 5, pubkey: 'attacker', created_at: 200, tags: [['a', '30402:seller:mug']] })
		const context = createContext([listing, forged])

		expect(await readThroughStore(context, [{ kinds: [30402] }])).toHaveLength(1)
	})

	test('later reads see only the newest version across fetches', async () => {
		const context = createContext([event({ created_at: 100 })])
		await readThroughStore(context, [{ kinds: [30402] }])

		const newer = event({ created_at: 150 })
		const later = createEventReadContext({ store: context.store, stream: streamFromFetch(context.store, async () => [newer]) })
		expect((await readThroughStore(later, [{ kinds: [30402] }])).map((e) => e.id)).toEqual([newer.id])
	})
})

describe('excludeDeleted', () => {
	test('filters individually resolved events by their deletions', async () => {
		const kept = event({ tags: [['d', 'cup']] })
		const deleted = event({})
		const context = createContext([event({ kind: 5, created_at: 200, tags: [['a', '30402:seller:mug']] })])

		expect(await excludeDeleted(context, [kept, deleted])).toEqual([kept])
	})

	test('skips the deletion lookup when there is nothing to check', () => {
		expect(buildDeletionLookupFilters([])).toEqual([])
	})
})

describe('product reads', () => {
	test('readProductListWorkflow filters by author, tag and limit', async () => {
		const context = createContext([
			event({
				tags: [
					['d', 'a'],
					['t', 'art'],
				],
			}),
			event({ tags: [['d', 'b']] }),
		])
		const result = await readProductListWorkflow(context, { limit: 10, author: 'seller', tag: 'art' })

		expect(context.requests[0]).toEqual([{ kinds: [30402], limit: 10, authors: ['seller'], '#t': ['art'] }])
		expect(result).toHaveLength(1)
	})

	test('isProductListed separates hidden, out-of-stock and pre-order listings', () => {
		const hidden = { tags: [['visibility', 'hidden']] }
		const soldOut = { tags: [['stock', '0']] }
		const preOrder = { tags: [['visibility', 'pre-order']] }

		expect(isProductListed(hidden, 'all')).toBe(true)
		expect(isProductListed(hidden, 'not-hidden')).toBe(false)
		expect(isProductListed(soldOut, 'not-hidden')).toBe(true)
		expect(isProductListed(soldOut, 'purchasable')).toBe(false)
		expect(isProductListed(preOrder, 'purchasable')).toBe(true)
	})
})

describe('createStoreStream', () => {
	test('replays stored matches first, then forwards the live source and its caught-up marker', async () => {
		const store = createMemoryEventStore()
		const cached = event({ created_at: 100, tags: [['d', 'cached']] })
		await store.add(cached)
		const live = event({ created_at: 200, tags: [['d', 'live']] })

		const stream = createStoreStream({
			store,
			source: async function* () {
				yield { type: 'event', event: live }
				yield { type: 'caught-up', info: { eose: ['wss://relay'], pending: [], complete: false } }
			},
		})

		const items = []
		for await (const item of stream([{ kinds: [30402] }])) items.push(item)

		expect(items.filter((item) => item.type === 'event').map((item) => item.event.id)).toEqual([cached.id, live.id])
		expect(items.at(-1)).toEqual({ type: 'caught-up', info: { eose: ['wss://relay'], pending: [], complete: false } })
	})

	test('admits live arrivals into the store unless admit is false', async () => {
		const store = createMemoryEventStore()
		const live = event({ created_at: 200 })
		const stream = createStoreStream({
			store,
			source: async function* () {
				yield { type: 'event', event: live }
			},
		})

		for await (const _ of stream([{ kinds: [1] }], { admit: false })) {
			/* drain */
		}
		expect(await store.get(live.id)).toBeUndefined()
	})
})

describe('asAsyncEventStoreActions', () => {
	test('admits once and returns null for a duplicate relay delivery', async () => {
		const store = createMemoryEventStore()
		const actions = asAsyncEventStoreActions(store)
		const note = event({ kind: 1 })

		expect(await actions.add(note)).toBe(note)
		expect(await actions.add(note)).toBeNull()
		expect(await store.get(note.id)).toBe(note)
	})
})
