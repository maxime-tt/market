import { describe, expect, test } from 'bun:test'
import type { EventFilter } from '../../core/event-store/filter'
import { matchesFilter } from '../../core/event-store/filter'
import { createMemoryEventStore } from '../../core/event-store/memoryEventStore'
import type { EventReadContext } from '../../core/event-store/read'
import type { NostrEventLike } from '../../core/nostr/eventLike'
import { readPostWorkflow, readRecentPostsWorkflow } from './postRead'

const ALICE = 'a'.repeat(64)

const note = (overrides: Partial<NostrEventLike>): NostrEventLike => ({
	id: 'note',
	pubkey: ALICE,
	kind: 1,
	created_at: 100,
	content: 'hello',
	tags: [],
	...overrides,
})

/** Fake relay: answers every filter from a fixed event list and records the requests. */
function createContext(relayEvents: NostrEventLike[]): EventReadContext & { requests: EventFilter[][] } {
	const requests: EventFilter[][] = []
	return {
		requests,
		store: createMemoryEventStore(),
		fetch: async (filters) => {
			requests.push([...filters])
			return relayEvents.filter((candidate) => filters.some((filter) => matchesFilter(candidate, filter)))
		},
	}
}

describe('readRecentPostsWorkflow', () => {
	test('returns the parsed posts newest first', async () => {
		const context = createContext([note({ id: 'old', created_at: 100 }), note({ id: 'new', created_at: 300 })])

		const posts = await readRecentPostsWorkflow(context)

		expect(posts.map((post) => post.id)).toEqual(['new', 'old'])
		expect(posts[0]).toEqual({ id: 'new', content: 'hello', author: ALICE, createdAt: 300 })
	})

	test('asks for the recent kind-1 filter, then the deletions of what came back', async () => {
		const context = createContext([note({ id: 'n1' })])

		await readRecentPostsWorkflow(context)

		expect(context.requests[0]).toEqual([{ kinds: [1], limit: 20 }])
		expect(context.requests[1]).toEqual([{ kinds: [5], authors: [ALICE], '#e': ['n1'] }])
	})

	test('a NIP-09 deletion hides the note', async () => {
		const context = createContext([note({ id: 'n1' }), note({ id: 'del', kind: 5, created_at: 300, content: '', tags: [['e', 'n1']] })])

		expect(await readRecentPostsWorkflow(context)).toEqual([])
	})

	test('no note yields an empty list', async () => {
		expect(await readRecentPostsWorkflow(createContext([]))).toEqual([])
	})
})

describe('readPostWorkflow', () => {
	test('returns the parsed post for an id', async () => {
		const context = createContext([note({ id: 'n1' })])

		expect(await readPostWorkflow(context, 'n1')).toEqual({ id: 'n1', content: 'hello', author: ALICE, createdAt: 100 })
		expect(context.requests[0]).toEqual([{ ids: ['n1'] }])
	})

	test('a missing post is an error', async () => {
		await expect(readPostWorkflow(createContext([]), 'missing')).rejects.toThrow('Post not found')
	})

	test('a post its author deleted is an error', async () => {
		const context = createContext([note({ id: 'n1' }), note({ id: 'del', kind: 5, created_at: 300, content: '', tags: [['e', 'n1']] })])

		await expect(readPostWorkflow(context, 'n1')).rejects.toThrow('Post not found')
	})
})
