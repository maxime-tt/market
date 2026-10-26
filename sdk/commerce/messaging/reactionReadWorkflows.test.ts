import { describe, expect, test } from 'bun:test'
import type { EventFilter } from '../../core/event-store/filter'
import { matchesFilter } from '../../core/event-store/filter'
import { createMemoryEventStore } from '../../core/event-store/memoryEventStore'
import type { EventReadContext } from '../../core/event-store/read'
import type { NostrEventLike } from '../../core/nostr/eventLike'
import { readEventReactionsWorkflow } from './reactionRead'

const ALICE = 'a'.repeat(64)
const BOB = 'b'.repeat(64)

const NOTE: NostrEventLike = { id: 'note-id', pubkey: ALICE, kind: 1, content: '', tags: [] }

const reactionEvent = (overrides: Partial<NostrEventLike>): NostrEventLike => ({
	id: 'reaction',
	pubkey: ALICE,
	kind: 7,
	created_at: 100,
	content: '+',
	tags: [
		['e', NOTE.id],
		['p', NOTE.pubkey],
		['k', '1'],
	],
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

describe('readEventReactionsWorkflow', () => {
	test('returns the parsed reactions, newest first', async () => {
		const context = createContext([
			reactionEvent({ id: 'alice-old', created_at: 100, content: '+' }),
			reactionEvent({ id: 'bob-new', pubkey: BOB, created_at: 200, content: '🔥' }),
		])

		const reactions = await readEventReactionsWorkflow(context, NOTE)

		expect(reactions.map((reaction) => [reaction.id, reaction.emoji, reaction.createdAt, reaction.authorPubkey])).toEqual([
			['bob-new', '🔥', 200, BOB],
			['alice-old', '+', 100, ALICE],
		])
		expect(reactions.every((reaction) => reaction.targetEvent === NOTE)).toBe(true)
	})

	test('de-duplicates to the newest reaction per target+author+emoji', async () => {
		const context = createContext([
			reactionEvent({ id: 'old', created_at: 100, content: '+' }),
			reactionEvent({ id: 'new', created_at: 200, content: '+' }),
			reactionEvent({ id: 'other-emoji', created_at: 150, content: '👍' }),
		])

		const reactions = await readEventReactionsWorkflow(context, NOTE)

		expect(reactions.map((reaction) => reaction.id)).toEqual(['new', 'other-emoji'])
	})

	test('a deletion of the newest reaction does not resurrect the older one by the same author', async () => {
		// The historical reader de-duplicates FIRST, then drops author-deleted ids. The older
		// reaction is therefore no longer in the set when the deletion is applied and cannot come
		// back — the exact reason this workflow must not be store-backed.
		const context = createContext([
			reactionEvent({ id: 'older', created_at: 100, content: '+' }),
			reactionEvent({ id: 'newest', created_at: 200, content: '+' }),
			reactionEvent({ id: 'deletion', kind: 5, created_at: 300, content: '', tags: [['e', 'newest']] }),
		])

		const reactions = await readEventReactionsWorkflow(context, NOTE)

		expect(reactions).toEqual([])
		// The deletion lookup carries only the de-duplicated id, proving de-dup ran first.
		expect(context.requests[1]).toEqual([{ kinds: [5], '#e': ['newest'] }])
	})

	test('an author-deleted reaction is dropped while another author’s survives', async () => {
		const context = createContext([
			reactionEvent({ id: 'alice', created_at: 100, content: '+' }),
			reactionEvent({ id: 'bob', pubkey: BOB, created_at: 200, content: '+' }),
			reactionEvent({ id: 'deletion', kind: 5, created_at: 300, content: '', tags: [['e', 'alice']] }),
		])

		const reactions = await readEventReactionsWorkflow(context, NOTE)

		expect(reactions.map((reaction) => reaction.id)).toEqual(['bob'])
	})

	test('asks the context for the reaction filter, then the deletion lookup for what came back', async () => {
		const reaction = reactionEvent({ id: 'r1' })
		const context = createContext([reaction])

		await readEventReactionsWorkflow(context, NOTE)

		expect(context.requests[0]).toEqual([{ kinds: [7], '#k': ['1'], '#p': [ALICE], limit: 100, '#e': [NOTE.id] }])
		expect(context.requests[1]).toEqual([{ kinds: [5], '#e': ['r1'] }])
	})

	test('no reaction yields an empty list', async () => {
		expect(await readEventReactionsWorkflow(createContext([]), NOTE)).toEqual([])
	})
})
