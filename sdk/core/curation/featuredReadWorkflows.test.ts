/**
 * Featured-list read workflow — pins `readFeaturedWorkflow` over a fake `EventReadContext` (store +
 * fetch), framework-free and offline, in the sdk test style used by `relayListReadWorkflows.test.ts`.
 *
 * Port semantics (the declared D1 slice-4 delta): the read is the pre-drain `fetchLatestAppEvent`
 * contract — EXACTLY ONE fetch of the list filter, newest `created_at` wins, and no deletion lookup,
 * so a kind-5 deletion never hides a list. A missing list is `null` (not an error).
 */
import { describe, expect, test } from 'bun:test'
import type { EventFilter } from '../event-store/filter'
import { matchesFilter } from '../event-store/filter'
import { createMemoryEventStore } from '../event-store/memoryEventStore'
import { createEventReadContext, streamFromFetch, type EventReadContext } from '../event-store/read'
import type { NostrEventLike } from '../nostr/eventLike'
import { readFeaturedWorkflow } from './curationRead'

const APP = 'a'.repeat(64)

let counter = 0
const event = (overrides: Partial<NostrEventLike>): NostrEventLike => ({
	id: `id-${++counter}`,
	pubkey: APP,
	kind: 30405,
	created_at: 100,
	content: '',
	tags: [['d', 'featured_products']],
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

describe('readFeaturedWorkflow', () => {
	test('returns the single list event', async () => {
		const context = createContext([
			event({
				tags: [
					['d', 'featured_products'],
					['a', `30402:${APP}:widget`],
				],
			}),
		])

		expect((await readFeaturedWorkflow(context, 'featuredProducts', APP))?.id).toBe('id-1')
	})

	test('two versions of the same addressable list: the newest wins', async () => {
		const context = createContext([event({ id: 'old', created_at: 100 }), event({ id: 'new', created_at: 200 })])

		expect((await readFeaturedWorkflow(context, 'featuredProducts', APP))?.id).toBe('new')
	})

	test('asks the context for exactly the one list filter (no deletion lookup)', async () => {
		const context = createContext([event({ id: 'm1' })])

		await readFeaturedWorkflow(context, 'featuredProducts', APP)

		expect(context.requests).toEqual([[{ kinds: [30405], authors: [APP], '#d': ['featured_products'] }]])
	})

	test('maps a list key to its own kind and d-tag', async () => {
		const context = createContext([event({ kind: 30409, tags: [['d', 'featured_auctions']] })])

		await readFeaturedWorkflow(context, 'featuredAuctions', APP)

		expect(context.requests[0]).toEqual([{ kinds: [30409], authors: [APP], '#d': ['featured_auctions'] }])
	})

	test('no event yields null', async () => {
		expect(await readFeaturedWorkflow(createContext([]), 'featuredProducts', APP)).toBeNull()
	})
})
