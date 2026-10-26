import { describe, expect, test } from 'bun:test'
import type { EventFilter } from '../event-store/filter'
import { matchesFilter } from '../event-store/filter'
import { createMemoryEventStore } from '../event-store/memoryEventStore'
import type { EventReadContext } from '../event-store/read'
import type { NostrEventLike } from '../nostr/eventLike'
import { readAuthorWorkflow } from './profileRead'

const ALICE = 'a'.repeat(64)

const metadata = (overrides: Partial<NostrEventLike>): NostrEventLike => ({
	id: 'metadata',
	pubkey: ALICE,
	kind: 0,
	created_at: 100,
	content: '{"name":"alice"}',
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

describe('readAuthorWorkflow', () => {
	test('returns the parsed author for a metadata event', async () => {
		const context = createContext([metadata({ content: '{"name":"alice","about":"hi","picture":"https://img","nip05":"a@b"}' })])

		expect(await readAuthorWorkflow(context, ALICE)).toEqual({
			id: ALICE,
			name: 'alice',
			about: 'hi',
			picture: 'https://img',
			nip05: 'a@b',
		})
	})

	test('a replaceable kind-0: the newest version wins', async () => {
		const context = createContext([
			metadata({ id: 'old', created_at: 100, content: '{"name":"old"}' }),
			metadata({ id: 'new', created_at: 200, content: '{"name":"new"}' }),
		])

		expect((await readAuthorWorkflow(context, ALICE)).name).toBe('new')
	})

	test('a `name` tag wins over the content name', async () => {
		const context = createContext([metadata({ content: '{"name":"content"}', tags: [['name', 'tag']] })])

		expect((await readAuthorWorkflow(context, ALICE)).name).toBe('tag')
	})

	test('a NIP-09 kind-5 deletion hides the metadata (author not found)', async () => {
		const context = createContext([
			metadata({ id: 'metadata' }),
			metadata({ id: 'deletion', kind: 5, created_at: 300, content: '', tags: [['e', 'metadata']] }),
		])

		await expect(readAuthorWorkflow(context, ALICE)).rejects.toThrow('Author not found')
	})

	test('asks for the profile filter, then the deletions of what came back', async () => {
		const context = createContext([metadata({ id: 'm1' })])

		await readAuthorWorkflow(context, ALICE)

		expect(context.requests[0]).toEqual([{ kinds: [0], authors: [ALICE] }])
		expect(context.requests[1]).toEqual([{ kinds: [5], authors: [ALICE], '#e': ['m1'] }])
	})

	test('rejects a malformed pubkey before any relay I/O', async () => {
		const context = createContext([metadata({})])

		await expect(readAuthorWorkflow(context, 'npub1nothex')).rejects.toThrow('Author pubkey is required')
		expect(context.requests).toEqual([])
	})

	test('no metadata is an error', async () => {
		await expect(readAuthorWorkflow(createContext([]), ALICE)).rejects.toThrow('Author not found')
	})
})
