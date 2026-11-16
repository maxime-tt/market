/**
 * `rolesRead.test.ts` — the two role-list reads over a fake `EventReadContext` (store + fetch),
 * framework-free and offline, in the sdk test style used by `curation/featuredReadWorkflows.test.ts`.
 *
 * Port semantics: exactly ONE fetch of the list filter, newest `created_at` wins, no deletion lookup.
 * The asymmetry between the two reads is the pre-drain contract and is pinned deliberately:
 * a missing admin list is `null`, a missing editor list is the empty settings record.
 */
import { describe, expect, test } from 'bun:test'
import type { EventFilter } from '../event-store/filter'
import { matchesFilter } from '../event-store/filter'
import { createMemoryEventStore } from '../event-store/memoryEventStore'
import { createEventReadContext, streamFromFetch, type EventReadContext } from '../event-store/read'
import type { NostrEventLike } from '../nostr/eventLike'
import { readAdminSettingsWorkflow, readEditorSettingsWorkflow } from './rolesRead'

const APP = 'a'.repeat(64)
const ALICE = 'b'.repeat(64)
const BOB = 'c'.repeat(64)

let counter = 0
const event = (overrides: Partial<NostrEventLike>): NostrEventLike => ({
	id: `id-${++counter}`,
	pubkey: APP,
	kind: 30000,
	created_at: 100,
	content: '',
	tags: [['d', 'admins']],
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

describe('readAdminSettingsWorkflow', () => {
	test('reads the admin list with exactly one fetch of its filter', async () => {
		const context = createContext([
			event({
				tags: [
					['d', 'admins'],
					['p', ALICE],
					['p', BOB],
				],
			}),
		])

		const settings = await readAdminSettingsWorkflow(context, APP)

		expect(context.requests).toEqual([[{ kinds: [30000], authors: [APP], '#d': ['admins'] }]])
		expect(settings).toMatchObject({ admins: [ALICE, BOB], owner: ALICE, lastUpdated: 100 })
	})

	test('two versions of the same list: the newest created_at wins', async () => {
		const context = createContext([
			event({
				id: 'old',
				created_at: 100,
				tags: [
					['d', 'admins'],
					['p', ALICE],
				],
			}),
			event({
				id: 'new',
				created_at: 200,
				tags: [
					['d', 'admins'],
					['p', BOB],
				],
			}),
		])

		expect(await readAdminSettingsWorkflow(context, APP)).toMatchObject({ admins: [BOB], owner: BOB })
	})

	test('no list is null (not an error)', async () => {
		expect(await readAdminSettingsWorkflow(createContext([]), APP)).toBeNull()
	})

	test('the owner falls back to the app pubkey when the list has no p items', async () => {
		const context = createContext([event({ tags: [['d', 'admins']] })])

		expect(await readAdminSettingsWorkflow(context, APP)).toMatchObject({ admins: [], owner: APP })
	})

	test('a missing app pubkey throws', async () => {
		await expect(readAdminSettingsWorkflow(createContext([]))).rejects.toThrow('App pubkey is required')
	})
})

describe('readEditorSettingsWorkflow', () => {
	test('reads the editor list with exactly one fetch of its filter', async () => {
		const context = createContext([
			event({
				tags: [
					['d', 'editors'],
					['p', BOB],
				],
			}),
		])

		const settings = await readEditorSettingsWorkflow(context, APP)

		expect(context.requests).toEqual([[{ kinds: [30000], authors: [APP], '#d': ['editors'] }]])
		expect(settings).toMatchObject({ editors: [BOB], lastUpdated: 100 })
	})

	test('no list is the empty settings record — deliberately not null', async () => {
		expect(await readEditorSettingsWorkflow(createContext([]), APP)).toEqual({ editors: [], lastUpdated: 0, event: null })
	})

	test('a missing app pubkey throws', async () => {
		await expect(readEditorSettingsWorkflow(createContext([]))).rejects.toThrow('App pubkey is required')
	})
})
