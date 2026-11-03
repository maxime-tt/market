import { describe, expect, test } from 'bun:test'
import type { EventFilter } from '../../core/event-store/filter'
import { matchesFilter } from '../../core/event-store/filter'
import { createMemoryEventStore } from '../../core/event-store/memoryEventStore'
import { createEventReadContext, streamFromFetch, type EventReadContext } from '../../core/event-store/read'
import type { NostrEventLike } from '../../core/nostr/eventLike'
import { readProductCommentsWorkflow } from './commentRead'

const ALICE = 'a'.repeat(64)
const BOB = 'b'.repeat(64)

const PRODUCT: NostrEventLike = { id: 'product-id', pubkey: ALICE, kind: 30402, content: '', tags: [['d', 'shirt']] }
const ADDRESS = `30402:${ALICE}:shirt`

const comment = (overrides: Partial<NostrEventLike>): NostrEventLike => ({
	id: 'comment',
	pubkey: BOB,
	kind: 1111,
	created_at: 100,
	content: 'nice',
	tags: [
		['a', ADDRESS],
		['k', '30402'],
	],
	...overrides,
})

/** Fake relay: answers every filter from a fixed event list and records the requests. */
function createContext(relayEvents: NostrEventLike[]): EventReadContext & { requests: EventFilter[][] } {
	const requests: EventFilter[][] = []
	const store = createMemoryEventStore()
	const stream = streamFromFetch(store, async (filters) => {
		requests.push([...filters])
		return relayEvents.filter((candidate) => filters.some((filter) => matchesFilter(candidate, filter)))
	})
	return { ...createEventReadContext({ store, stream }), requests }
}

describe('readProductCommentsWorkflow', () => {
	test('returns the comments on the target, replies linked to their parent', async () => {
		const context = createContext([
			comment({ id: 'top', created_at: 100 }),
			comment({
				id: 'reply',
				created_at: 200,
				tags: [
					['A', ADDRESS],
					['k', '1111'],
					['e', 'top'],
				],
			}),
		])

		const comments = await readProductCommentsWorkflow(context, PRODUCT)

		expect(comments.map((record) => record.id)).toEqual(['top', 'reply'])
		expect(comments[1].parentId).toBe('top')
		expect(comments[0]).toMatchObject({
			authorPubkey: BOB,
			content: 'nice',
			createdAt: 100,
			targetEventId: 'product-id',
			targetEventPubkey: ALICE,
			targetEventKind: 30402,
			targetEventCoordinates: ADDRESS,
		})
	})

	test('a fallback event that does not reference the target is dropped', async () => {
		const context = createContext([comment({ id: 'top' }), comment({ id: 'unrelated', tags: [['p', ALICE]] })])

		expect((await readProductCommentsWorkflow(context, PRODUCT)).map((record) => record.id)).toEqual(['top'])
	})

	test('asks for the scope, reply and fallback filters of the addressable target', async () => {
		const context = createContext([comment({ id: 'c1' })])

		await readProductCommentsWorkflow(context, PRODUCT)

		expect(context.requests[0]).toEqual([{ kinds: [1111], '#a': [ADDRESS] }])
		expect(context.requests[1]).toEqual([
			{ kinds: [1111], '#A': [ADDRESS] },
			{ kinds: [1111], '#E': [PRODUCT.id] },
		])
		expect(context.requests[2]).toEqual([{ kinds: [1111], limit: 200 }])
	})

	test('fetches plainly: no store writes', async () => {
		const context = createContext([comment({ id: 'c1' })])

		await readProductCommentsWorkflow(context, PRODUCT)

		expect(await context.store.get('c1')).toBeUndefined()
	})

	test('no comment yields an empty list', async () => {
		expect(await readProductCommentsWorkflow(createContext([]), PRODUCT)).toEqual([])
	})
})
