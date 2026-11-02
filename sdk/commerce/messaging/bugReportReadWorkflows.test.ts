import { describe, expect, test } from 'bun:test'
import type { EventFilter } from '../../core/event-store/filter'
import { matchesFilter } from '../../core/event-store/filter'
import { createMemoryEventStore } from '../../core/event-store/memoryEventStore'
import { createEventReadContext, streamFromFetch, type EventReadContext } from '../../core/event-store/read'
import type { NostrEventLike } from '../../core/nostr/eventLike'
import { readBugReportsWorkflow } from './bugReportRead'

const REPORTER = 'a'.repeat(64)

const reportEvent = (overrides: Partial<NostrEventLike>): NostrEventLike => ({
	id: 'report',
	pubkey: REPORTER,
	kind: 1,
	created_at: 100,
	content: 'bug',
	tags: [['t', 'plebian2beta']],
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

describe('readBugReportsWorkflow', () => {
	test('returns the parsed reports newest first', async () => {
		const context = createContext([
			reportEvent({ id: 'old', created_at: 100 }),
			reportEvent({ id: 'new', created_at: 300 }),
			reportEvent({ id: 'mid', created_at: 200 }),
		])

		const reports = await readBugReportsWorkflow(context)

		expect(reports.map((report) => report.id)).toEqual(['new', 'mid', 'old'])
		expect(reports[0]).toMatchObject({ id: 'new', pubkey: REPORTER, content: 'bug', createdAt: 300 })
	})

	test('defaults to a limit of 20 and requests nothing else', async () => {
		const context = createContext([reportEvent({})])

		await readBugReportsWorkflow(context)

		expect(context.requests).toEqual([[{ kinds: [1], '#t': ['plebian2beta'], limit: 20 }]])
	})

	test('passes an explicit page size and until, and omits a falsy until', async () => {
		const page = createContext([reportEvent({})])
		await readBugReportsWorkflow(page, 5, 100)
		expect(page.requests[0]).toEqual([{ kinds: [1], '#t': ['plebian2beta'], limit: 5, until: 100 }])

		const falsy = createContext([reportEvent({})])
		await readBugReportsWorkflow(falsy, 5, 0)
		expect(falsy.requests[0]).toEqual([{ kinds: [1], '#t': ['plebian2beta'], limit: 5 }])
	})

	test('fetches plainly: one request, no kind-5 lookup, no store writes', async () => {
		const report = reportEvent({ id: 'only' })
		const context = createContext([report])

		await readBugReportsWorkflow(context)

		// A store-backed read would issue a second (kind-5) lookup and write the event.
		expect(context.requests).toHaveLength(1)
		expect(await context.store.get('only')).toBeUndefined()
	})

	test('no report yields an empty list', async () => {
		expect(await readBugReportsWorkflow(createContext([]))).toEqual([])
	})
})
