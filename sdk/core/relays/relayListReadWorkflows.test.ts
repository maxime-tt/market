import { describe, expect, test } from 'bun:test'
import type { EventFilter } from '../event-store/filter'
import { matchesFilter } from '../event-store/filter'
import { createMemoryEventStore } from '../event-store/memoryEventStore'
import type { EventReadContext } from '../event-store/read'
import type { NostrEventLike } from '../nostr/eventLike'
import { readRelayListWorkflow, readRelayPreferencesWorkflow } from './relayListRead'

const ALICE = 'a'.repeat(64)
const PREFERENCES_D_TAG = 'plebeian-market-relay-preferences'

let counter = 0
const event = (overrides: Partial<NostrEventLike>): NostrEventLike => ({
	id: `id-${++counter}`,
	pubkey: ALICE,
	kind: 10002,
	created_at: 100,
	content: '',
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

describe('readRelayListWorkflow', () => {
	test('returns the parsed relay record for a normal event set', async () => {
		const context = createContext([
			event({
				tags: [
					['r', 'wss://both'],
					['r', 'wss://read', 'read'],
					['r', 'wss://write', 'write'],
				],
			}),
		])

		expect(await readRelayListWorkflow(context, ALICE)).toEqual([
			{ url: 'wss://both', read: true, write: true },
			{ url: 'wss://read', read: true, write: false },
			{ url: 'wss://write', read: false, write: true },
		])
	})

	test('two replaceable versions of the same kind: the most recent wins', async () => {
		const older = event({ created_at: 100, tags: [['r', 'wss://old']] })
		const newer = event({ created_at: 200, tags: [['r', 'wss://new']] })
		const context = createContext([older, newer])

		expect(await readRelayListWorkflow(context, ALICE)).toEqual([{ url: 'wss://new', read: true, write: true }])
	})

	test('a NIP-09 kind-5 deletion hides the deleted relay list', async () => {
		const listing = event({ tags: [['r', 'wss://deleted']] })
		const deletion = event({ kind: 5, created_at: 300, tags: [['e', listing.id]] })
		const context = createContext([listing, deletion])

		expect(await readRelayListWorkflow(context, ALICE)).toEqual([])
	})

	test('asks the context for the author filter, then for the deletions of what came back', async () => {
		const listing = event({ tags: [['r', 'wss://x']] })
		const context = createContext([listing])

		await readRelayListWorkflow(context, ALICE)

		expect(context.requests[0]).toEqual([{ kinds: [10002], authors: [ALICE], limit: 1 }])
		expect(context.requests[1]).toEqual([{ kinds: [5], authors: [ALICE], '#e': [listing.id] }])
	})

	test('no event yields an empty list', async () => {
		expect(await readRelayListWorkflow(createContext([]), ALICE)).toEqual([])
	})
})

describe('readRelayPreferencesWorkflow', () => {
	test('returns the parsed settings for a normal event set', async () => {
		const context = createContext([event({ kind: 30078, tags: [['d', PREFERENCES_D_TAG]], content: '{"includeAppDefaults":false}' })])

		expect(await readRelayPreferencesWorkflow(context, ALICE)).toEqual({ includeAppDefaults: false })
	})

	test('two addressable versions of the same d-tag: the most recent wins', async () => {
		const older = event({ kind: 30078, created_at: 100, tags: [['d', PREFERENCES_D_TAG]], content: '{"includeAppDefaults":true}' })
		const newer = event({ kind: 30078, created_at: 200, tags: [['d', PREFERENCES_D_TAG]], content: '{"includeAppDefaults":false}' })
		const context = createContext([older, newer])

		expect(await readRelayPreferencesWorkflow(context, ALICE)).toEqual({ includeAppDefaults: false })
	})

	test('a NIP-09 kind-5 coordinate deletion hides the deleted preferences', async () => {
		const prefs = event({ kind: 30078, tags: [['d', PREFERENCES_D_TAG]], content: '{"includeAppDefaults":false}' })
		const deletion = event({
			kind: 5,
			created_at: 300,
			tags: [['a', `30078:${ALICE}:${PREFERENCES_D_TAG}`]],
		})
		const context = createContext([prefs, deletion])

		expect(await readRelayPreferencesWorkflow(context, ALICE)).toBeNull()
	})

	test('asks the context for the author+d-tag filter, then for the coordinate deletions', async () => {
		const prefs = event({ kind: 30078, tags: [['d', PREFERENCES_D_TAG]], content: '{}' })
		const context = createContext([prefs])

		await readRelayPreferencesWorkflow(context, ALICE)

		expect(context.requests[0]).toEqual([{ kinds: [30078], authors: [ALICE], '#d': [PREFERENCES_D_TAG], limit: 1 }])
		expect(context.requests[1]).toEqual([{ kinds: [5], authors: [ALICE], '#a': [`30078:${ALICE}:${PREFERENCES_D_TAG}`] }])
	})

	test('no event yields null', async () => {
		expect(await readRelayPreferencesWorkflow(createContext([]), ALICE)).toBeNull()
	})

	test('malformed content is treated as absent', async () => {
		const context = createContext([event({ kind: 30078, tags: [['d', PREFERENCES_D_TAG]], content: 'null' })])

		expect(await readRelayPreferencesWorkflow(context, ALICE)).toBeNull()
	})
})
