import { describe, expect, test } from 'bun:test'
import type { EventFilter } from '../event-store/filter'
import { matchesFilter } from '../event-store/filter'
import { createMemoryEventStore } from '../event-store/memoryEventStore'
import type { EventReadContext } from '../event-store/read'
import type { NostrEventLike } from '../nostr/eventLike'
import { readNip05SettingsWorkflow } from './nip05'

const APP = 'a'.repeat(64)
const D_TAG = 'nip05-names'

const registry = (overrides: Partial<NostrEventLike>): NostrEventLike => ({
	id: 'registry',
	pubkey: APP,
	kind: 30000,
	created_at: 100,
	content: '',
	tags: [['d', D_TAG]],
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

describe('readNip05SettingsWorkflow', () => {
	test('returns the parsed registry entries', async () => {
		const context = createContext([
			registry({
				tags: [
					['d', D_TAG],
					['nip05', 'Alice', 'b'.repeat(64), '999'],
				],
			}),
		])

		const settings = await readNip05SettingsWorkflow(context, APP)

		expect(settings?.entries).toEqual([{ username: 'alice', pubkey: 'b'.repeat(64), validUntil: 999 }])
		expect(settings?.lastUpdated).toBe(100)
		expect(settings?.event?.id).toBe('registry')
	})

	test('an addressable registry: the newest version wins', async () => {
		const context = createContext([
			registry({
				id: 'old',
				created_at: 100,
				tags: [
					['d', D_TAG],
					['nip05', 'old', 'b'.repeat(64), '1'],
				],
			}),
			registry({
				id: 'new',
				created_at: 200,
				tags: [
					['d', D_TAG],
					['nip05', 'new', 'c'.repeat(64), '1'],
				],
			}),
		])

		expect((await readNip05SettingsWorkflow(context, APP))?.entries.map((entry) => entry.username)).toEqual(['new'])
	})

	test('a NIP-09 coordinate deletion hides the registry', async () => {
		const context = createContext([
			registry({ id: 'registry' }),
			registry({ id: 'deletion', kind: 5, created_at: 300, tags: [['a', `30000:${APP}:${D_TAG}`]] }),
		])

		expect(await readNip05SettingsWorkflow(context, APP)).toEqual({ entries: [], lastUpdated: 0, event: null })
	})

	test('asks for the app+d-tag filter, then the coordinate deletions', async () => {
		const context = createContext([registry({ id: 'r1' })])

		await readNip05SettingsWorkflow(context, APP)

		expect(context.requests[0]).toEqual([{ kinds: [30000], authors: [APP], '#d': [D_TAG], limit: 1 }])
		expect(context.requests[1]).toEqual([{ kinds: [5], authors: [APP], '#a': [`30000:${APP}:${D_TAG}`] }])
	})

	test('rejects a missing app pubkey before any relay I/O', async () => {
		const context = createContext([registry({})])

		await expect(readNip05SettingsWorkflow(context, undefined)).rejects.toThrow('App pubkey is required')
		expect(context.requests).toEqual([])
	})

	test('no registry yields the empty settings record', async () => {
		expect(await readNip05SettingsWorkflow(createContext([]), APP)).toEqual({ entries: [], lastUpdated: 0, event: null })
	})
})
