/**
 * Blacklist read workflow — pins `readBlacklistSettingsWorkflow` over a fake `EventReadContext`
 * (store + fetch), framework-free and offline, in the sdk test style already used by
 * `relayListReadWorkflows.test.ts` and `vanityReadWorkflows.test.ts`.
 *
 * Port semantics (the declared D1 delta). The read merges through the store, so a NIP-09 kind-5
 * deletion that names the list event id hides the blacklist. The kind-10000 mute list is a
 * *replaceable* kind, not an addressable one, so a NIP-09 **coordinate** (`#a`, e.g.
 * `10000:<pubkey>:`) deletion is NOT honoured: `buildDeletionLookupFilters` never asks for an `#a`
 * lookup for a replaceable event, and `isDeletedBy` only reaches replaceable events by event id.
 * That limitation is documented here rather than left implied.
 */
import { describe, expect, test } from 'bun:test'
import type { EventFilter } from '../../core/event-store/filter'
import { matchesFilter } from '../../core/event-store/filter'
import { createMemoryEventStore } from '../../core/event-store/memoryEventStore'
import type { EventReadContext } from '../../core/event-store/read'
import type { NostrEventLike } from '../../core/nostr/eventLike'
import { readBlacklistSettingsWorkflow } from './curationRead'

const APP = 'a'.repeat(64)
const ALICE = 'b'.repeat(64)
const BOB = 'c'.repeat(64)
const PRODUCT_COORD = `30402:${ALICE}:widget`
const COLLECTION_COORD = `30405:${BOB}:set`

let counter = 0
const event = (overrides: Partial<NostrEventLike>): NostrEventLike => ({
	id: `id-${++counter}`,
	pubkey: APP,
	kind: 10000,
	created_at: 100,
	content: '',
	tags: [],
	...overrides,
})

const EMPTY = { blacklistedPubkeys: [], blacklistedProducts: [], blacklistedCollections: [], lastUpdated: 0, event: null }

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

describe('readBlacklistSettingsWorkflow', () => {
	test('returns the parsed blacklist record for a normal mute-list event', async () => {
		const context = createContext([
			event({
				created_at: 100,
				tags: [
					['p', ALICE],
					['p', BOB],
					['a', PRODUCT_COORD],
					['a', COLLECTION_COORD],
					['a', '30000:someone:not-a-product'],
				],
			}),
		])

		const settings = await readBlacklistSettingsWorkflow(context, APP)

		expect(settings.blacklistedPubkeys).toEqual([ALICE, BOB])
		expect(settings.blacklistedProducts).toEqual([PRODUCT_COORD])
		expect(settings.blacklistedCollections).toEqual([COLLECTION_COORD])
		expect(settings.lastUpdated).toBe(100)
	})

	test('two replaceable versions of kind 10000: the most recent wins', async () => {
		const older = event({ created_at: 100, tags: [['p', ALICE]] })
		const newer = event({ created_at: 200, tags: [['p', BOB]] })
		const context = createContext([older, newer])

		const settings = await readBlacklistSettingsWorkflow(context, APP)

		expect(settings.blacklistedPubkeys).toEqual([BOB])
		expect(settings.lastUpdated).toBe(200)
	})

	test('a NIP-09 kind-5 deletion of the list event id hides the blacklist', async () => {
		const listing = event({ tags: [['p', ALICE]] })
		const deletion = event({ kind: 5, created_at: 300, tags: [['e', listing.id]] })
		const context = createContext([listing, deletion])

		expect(await readBlacklistSettingsWorkflow(context, APP)).toEqual(EMPTY)
	})

	test('a coordinate-style kind-5 deletion is NOT honoured for replaceable kind 10000', async () => {
		const listing = event({ tags: [['p', ALICE]] })
		const deletion = event({ kind: 5, created_at: 300, tags: [['a', `10000:${APP}:`]] })
		const context = createContext([listing, deletion])

		const settings = await readBlacklistSettingsWorkflow(context, APP)

		expect(settings.blacklistedPubkeys).toEqual([ALICE])
		expect(settings.lastUpdated).toBe(100)
	})

	test('asks the context for the author filter, then for the id deletions of what came back', async () => {
		const listing = event({ created_at: 150, tags: [['p', ALICE]] })
		const context = createContext([listing])

		await readBlacklistSettingsWorkflow(context, APP)

		expect(context.requests[0]).toEqual([{ kinds: [10000], authors: [APP] }])
		expect(context.requests[1]).toEqual([{ kinds: [5], authors: [APP], '#e': [listing.id] }])
	})

	test('rejects a missing app pubkey before any relay I/O', async () => {
		const context = createContext([event({})])

		await expect(readBlacklistSettingsWorkflow(context, undefined)).rejects.toThrow('App pubkey is required')
		expect(context.requests).toEqual([])
	})

	test('no event yields the empty settings record', async () => {
		expect(await readBlacklistSettingsWorkflow(createContext([]), APP)).toEqual(EMPTY)
	})
})
