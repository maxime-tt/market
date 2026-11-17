import { beforeAll, describe, expect, mock, test } from 'bun:test'
import type { NostrEventLike } from '@sdk/core'
import { createEventReadContext, createMemoryEventStore } from '@sdk/core/event-store'
import type { EventFilter } from '@sdk/core/event-store'
import { STOREFRONT_PAGE_D_TAG, STOREFRONT_PAGE_KIND, STOREFRONT_PAGE_VERSION } from '@sdk/commerce/storefront/storefrontPage'

/**
 * "Which pages do I have?" is the one page read that must not carry a `#d`.
 * These tests pin the filter shape, the client-side replaceable rule and the
 * two states the picker depends on: a capped list reports what it left out, and
 * a failed read rejects instead of resolving to an empty list.
 *
 * The read seam (`platform/web/readContext.ts`) is mocked — first-party, as the
 * repo's test rules require — so the assertions are about the filter and the
 * winner, not about a relay.
 */

const AUTHOR = 'a'.repeat(64)
const OTHER = 'b'.repeat(64)

let lastFilters: EventFilter[] | null = null
let fetchResult: NostrEventLike[] = []
let fetchError: Error | null = null

// The seam module is replaced wholesale, so its other exports have to survive:
// `applesauceIo` imports `getNdkEventStore` from it. Spread the real module and
// override only the context factory.
const actualReadContext = await import('@platform/web/readContext')

mock.module('@platform/web/readContext', () => ({
	...actualReadContext,
	getReadContext: () =>
		createEventReadContext({
			store: createMemoryEventStore(),
			stream: async function* (filters) {
				lastFilters = [...filters]
				if (fetchError) throw fetchError
				for (const event of fetchResult) yield { type: 'event' as const, event }
				yield { type: 'caught-up' as const, info: { eose: [], pending: [], complete: true } }
			},
		}),
}))

// Imported after the seam is mocked: a static import would bind the real module.
let PAGE_LIST_CAP: (typeof import('./pageListQuery'))['PAGE_LIST_CAP']
let fetchMyPages: (typeof import('./pageListQuery'))['fetchMyPages']
let myPagesQueryOptions: (typeof import('./pageListQuery'))['myPagesQueryOptions']

beforeAll(async () => {
	;({ PAGE_LIST_CAP, fetchMyPages, myPagesQueryOptions } = await import('./pageListQuery'))
})

function pageEvent(d: string, over: Partial<NostrEventLike> = {}): NostrEventLike {
	return {
		id: `id-${d}`,
		pubkey: AUTHOR,
		kind: STOREFRONT_PAGE_KIND,
		created_at: 1000,
		tags: [
			['d', d],
			['title', `Title of ${d}`],
		],
		content: JSON.stringify({
			version: STOREFRONT_PAGE_VERSION,
			enabled: true,
			root: { props: {} },
			content: [{ type: 'Divider', props: { id: 'd1' } }],
		}),
		sig: 'sig',
		...over,
	}
}

describe('fetchMyPages', () => {
	test('reads the author’s kind-30024 set with no #d filter', async () => {
		fetchResult = []
		await fetchMyPages(AUTHOR)
		expect(lastFilters).toEqual([{ kinds: [STOREFRONT_PAGE_KIND], authors: [AUTHOR] }])
	})

	test('an invalid author is the empty list without touching the relay', async () => {
		lastFilters = null
		expect(await fetchMyPages('not-a-pubkey')).toEqual({ pages: [], dropped: 0 })
		expect(lastFilters).toBeNull()
	})

	test('newest wins per d, and the list is ordered newest first', async () => {
		fetchResult = [
			pageEvent('featured', { id: 'old', created_at: 1000 }),
			pageEvent('featured', { id: 'new', created_at: 2000 }),
			pageEvent('about', { id: 'about', created_at: 3000 }),
		]
		const result = await fetchMyPages(AUTHOR)
		expect(result.pages.map((page) => page.d)).toEqual(['about', 'featured'])
		expect(result.pages.find((page) => page.d === 'featured')?.eventId).toBe('new')
		expect(result.dropped).toBe(0)
	})

	test('a created_at tie breaks on the lower event id, as NIP-01 requires', async () => {
		fetchResult = [pageEvent('featured', { id: 'ffff', created_at: 2000 }), pageEvent('featured', { id: 'aaaa', created_at: 2000 })]
		const result = await fetchMyPages(AUTHOR)
		expect(result.pages[0].eventId).toBe('aaaa')
	})

	test('events from another author or another kind are discarded', async () => {
		fetchResult = [
			pageEvent('featured', { pubkey: OTHER }),
			pageEvent('about', { kind: 1 }),
			pageEvent('shop', { id: 'right' }),
		]
		const result = await fetchMyPages(AUTHOR)
		expect(result.pages.map((page) => page.d)).toEqual(['shop'])
	})

	test('an event with no d tag is not a page', async () => {
		fetchResult = [pageEvent('featured', { tags: [['title', 'no address']] })]
		expect((await fetchMyPages(AUTHOR)).pages).toEqual([])
	})

	test('a page that does not parse is listed as not enabled', async () => {
		fetchResult = [pageEvent('featured', { content: 'not json' })]
		const page = (await fetchMyPages(AUTHOR)).pages[0]
		expect(page.enabled).toBe(false)
	})

	test('the list is capped and reports how many it left out', async () => {
		const count = PAGE_LIST_CAP + 3
		fetchResult = Array.from({ length: count }, (_, index) =>
			pageEvent(`page-${index}`, { id: `id-${index}`, created_at: 1000 + index }),
		)
		const result = await fetchMyPages(AUTHOR)
		expect(result.pages).toHaveLength(PAGE_LIST_CAP)
		expect(result.dropped).toBe(3)
		// Newest first, so the capped list keeps the most recent documents.
		expect(result.pages[0].d).toBe(`page-${count - 1}`)
	})

	test('a failed read rejects; it never resolves to an empty list', async () => {
		fetchError = new Error('relay is down')
		await expect(fetchMyPages(AUTHOR)).rejects.toThrow('relay is down')
		fetchError = null
	})
})

describe('myPagesQueryOptions', () => {
	test('keys the read per author under the storefront family', () => {
		expect([...myPagesQueryOptions(AUTHOR).queryKey]).toEqual(['storefront', 'my-pages', AUTHOR])
	})

	test('gates on a valid author', () => {
		expect(myPagesQueryOptions(AUTHOR).enabled).toBe(true)
		expect(myPagesQueryOptions('not-a-pubkey').enabled).toBe(false)
	})
})

describe('the storefront page is just one of the pages', () => {
	test('the reserved default is listed like any other d', async () => {
		fetchResult = [pageEvent(STOREFRONT_PAGE_D_TAG)]
		const result = await fetchMyPages(AUTHOR)
		expect(result.pages[0].d).toBe(STOREFRONT_PAGE_D_TAG)
	})
})
