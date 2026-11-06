/**
 * platform/web/browse/browseQuery.test.ts — The browse search provider switch.
 *
 * The switch is one config point (`configureBrowseSearch`), defaulting to the
 * local event-store stream. These tests pin:
 * - the **default is local** (no configuration changes behaviour);
 * - the **RabbitHole provider** answers the query and its `partial` verdict
 *   reaches the result as the relay-failure state (failed relays in `pending`);
 * - the **fallback**: an unreachable / failing RabbitHole provider degrades to
 *   the local stream (the provider stubbed to throw), and a caller abort is
 *   propagated, not retried locally.
 *
 * The read seam (`getReadContext`) is stubbed via `mock.module` so the local
 * path is deterministic (the registry is per-file under `bun test --isolate`,
 * which the gate battery uses). The RabbitHole provider uses the **global**
 * `fetch` (no `fetchImpl` is threaded from the query), so that is stubbed here
 * and restored afterwards.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import type { NostrEventLike } from '@sdk/core/nostr/eventLike'
import type { EventFilter } from '@sdk/core/event-store/filter'
import type { EventStreamItem } from '@sdk/core/event-store/read'

// Stub the read seam BEFORE importing browseQuery — bun's mock.module registry
// is consulted at import time and intercepts browseQuery's relative
// `../readContext` import (verified). Per-file under `--isolate`.
const localEvents: NostrEventLike[] = [
	{
		id: 'local-mug',
		pubkey: 'b'.repeat(64),
		kind: 30402,
		created_at: 1_700_000_000,
		content: 'A local ceramic mug.',
		tags: [
			['d', 'local-mug'],
			['title', 'Ceramic Mug'],
			['price', '1500', 'SATS'],
		],
	},
]

/**
 * The detail read's listing, with every tag the panel renders (description,
 * location, stock, shipping option). Kept OUT of `localEvents` on purpose: it is
 * deliberately purchasable, so leaving it in the stream would perturb the
 * product-list and seller-listing reads that share this backlog.
 */
const detailEvents: NostrEventLike[] = [
	{
		id: 'detail-mug',
		pubkey: 'b'.repeat(64),
		kind: 30402,
		created_at: 1_700_000_000,
		content: 'A local ceramic mug.',
		tags: [
			['d', 'detail-mug'],
			['title', 'Ceramic Mug'],
			['price', '1500', 'SATS'],
			['t', 'pottery'],
			['location', 'Porto'],
			['stock', '40 in stock'],
			['shipping_option', '30406:' + 'd'.repeat(64) + ':worldwide', '2400'],
		],
	},
]

/**
 * Two publications of the SAME coordinate (same `d`), for the detail read's
 * newest-wins rule. Kept out of `localEvents` so the search stream's product
 * list (one product per event) is unchanged.
 */
const duplicateUrns: NostrEventLike[] = [
	{
		id: 'urn-old',
		pubkey: 'e'.repeat(64),
		kind: 30402,
		created_at: 1_600_000_000,
		content: 'An older urn.',
		tags: [
			['d', 'duplicated-urn'],
			['title', 'Unglazed Urn (old)'],
		],
	},
	{
		id: 'urn-new',
		pubkey: 'e'.repeat(64),
		kind: 30402,
		created_at: 1_700_000_000,
		content: 'A newer urn.',
		tags: [
			['d', 'duplicated-urn'],
			['title', 'Unglazed Urn (new)'],
		],
	},
]

let localStreamCalls = 0
/** The filters the last stream was opened with (asserted by the seller-listings tests). */
let lastStreamFilters: readonly EventFilter[] = []
/** Extra events the stub stream yields after the canned local ones (per-test, cleared in afterEach). */
let extraStreamEvents: NostrEventLike[] = []
/** Event ids the stub store reports as deleted (NIP-09), plus the deletions the lookup `fetch` returns. */
let deletedEventIds: Record<string, true> = {}
let deletionEvents: NostrEventLike[] = []
/** The filters every single-entity `fetch` has been called with, in order. */
const fetchedFilters: EventFilter[][] = []

mock.module('@platform/web/readContext', () => ({
	getReadContext: () => ({
		stream: async function* (filters: readonly EventFilter[]): AsyncIterable<EventStreamItem<NostrEventLike>> {
			localStreamCalls++
			lastStreamFilters = filters
			// Yield the canned local events, then the caught-up marker.
			for (const event of [...localEvents, ...extraStreamEvents]) yield { type: 'event', event }
			yield { type: 'caught-up', info: { eose: ['wss://local'], pending: [], complete: true } }
		},
		fetch: async (filters: readonly EventFilter[]) => {
			fetchedFilters.push(filters.map((filter) => ({ ...filter })))
			// The NIP-09 deletion lookup (`#e`) is a different read from the
			// single-product read by id/coordinate (`#d` / `ids`).
			if (filters.some((filter) => filter['#e'])) return deletionEvents
			const wanted = filters.flatMap((filter) => [...(filter.ids ?? []), ...(filter['#d'] ?? [])])
			if (wanted.length === 0) return []
			return [...localEvents, ...detailEvents, ...duplicateUrns].filter(
				(event) => wanted.includes(event.id) || event.tags.some((tag) => tag[0] === 'd' && wanted.includes(tag[1])),
			)
		},
		store: {
			add: async (event: NostrEventLike) => ({ status: 'added' as const, event }),
			isDeleted: (event: NostrEventLike) => deletedEventIds[event.id] === true,
		},
	}),
}))

import {
	browseProductDetailQueryOptions,
	browseSearchQueryOptions,
	configureBrowseSearch,
	fetchSellerListings,
	getBrowseSearchProvider,
	type BrowseSearchResult,
} from './browseQuery'

// ---------------------------------------------------------------------------
// The RabbitHole global-fetch stub
// ---------------------------------------------------------------------------

const rhEvent: NostrEventLike = {
	id: 'rh-mug',
	pubkey: 'c'.repeat(64),
	kind: 30402,
	created_at: 1_700_000_000,
	content: 'A rabbithole mug.',
	tags: [
		['d', 'rh-mug'],
		['title', 'Ceramic Mug'],
		['price', '999', 'SATS'],
	],
}

function ndjsonResponse(lines: string[]): Response {
	const encoder = new TextEncoder()
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			for (const line of lines) controller.enqueue(encoder.encode(`${line}\n`))
			controller.close()
		},
	})
	return new Response(body, { status: 200, headers: { 'content-type': 'application/x-ndjson' } })
}

function rhOutcome(status: 'complete' | 'partial', answered: string[], failed: string[]): string {
	return JSON.stringify({
		type: 'outcome',
		status,
		outcome: { relaysQueried: [...answered, ...failed], relaysAnswered: answered, relaysFailed: failed, deadlineHit: status === 'partial' },
	})
}

const realFetch = globalThis.fetch
let fetchStub: typeof fetch | null = null

async function runQueryFn(query: string, tag?: string, signal?: AbortSignal): Promise<BrowseSearchResult> {
	const options = browseSearchQueryOptions(query, tag, 100)
	return await options.queryFn!({ signal: signal ?? new AbortController().signal } as Parameters<NonNullable<typeof options.queryFn>>[0])
}

beforeEach(() => {
	configureBrowseSearch({ provider: 'local' })
	localStreamCalls = 0
	fetchStub = null
	lastStreamFilters = []
	extraStreamEvents = []
	deletedEventIds = {}
	deletionEvents = []
})

afterEach(() => {
	configureBrowseSearch({ provider: 'local' })
	globalThis.fetch = realFetch
})

/** A stub fetch: a subset of the real signature (tests call it with a URL + init at most). */
type FetchStub = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

/** Point the RabbitHole provider (global fetch) at a canned behaviour. */
function stubFetch(fetchImpl: FetchStub): void {
	fetchStub = fetchImpl as typeof fetch
	globalThis.fetch = fetchImpl as typeof fetch
}

describe('browse search provider switch', () => {
	test('defaults to the local stream — no configuration, no RabbitHole fetch', async () => {
		expect(getBrowseSearchProvider()).toBe('local')
		// A spy that would fail the test if the local path ever called fetch.
		stubFetch(async () => {
			throw new Error('the local provider must not fetch')
		})

		const result = await runQueryFn('ceramic mug')
		expect(result.products.map((p) => p.id)).toEqual(['local-mug'])
		expect(result.eose).toEqual(['wss://local'])
		expect(localStreamCalls).toBe(1)
	})

	test('switching to rabbithole answers from the streamed NDJSON, not the local stream', async () => {
		configureBrowseSearch({ provider: 'rabbithole' })
		stubFetch(async () =>
			ndjsonResponse([
				JSON.stringify({ type: 'search', candidateCount: 1, hits: [] }),
				JSON.stringify({ type: 'event', event: rhEvent }),
				rhOutcome('complete', ['wss://a'], []),
			]),
		)

		const result = await runQueryFn('ceramic mug')
		expect(result.products.map((p) => p.id)).toEqual(['rh-mug'])
		expect(result.eose).toEqual(['wss://a'])
		expect(localStreamCalls).toBe(0) // the local stream was not consulted
	})

	test('a rabbithole partial verdict reaches the result as the relay-failure state', async () => {
		configureBrowseSearch({ provider: 'rabbithole' })
		stubFetch(async () =>
			ndjsonResponse([
				JSON.stringify({ type: 'search', candidateCount: 1, hits: [] }),
				JSON.stringify({ type: 'event', event: rhEvent }),
				rhOutcome('partial', ['wss://a'], ['wss://b']),
			]),
		)

		const result = await runQueryFn('ceramic mug')
		expect(result.products.map((p) => p.id)).toEqual(['rh-mug'])
		// partial is never flattened: the failed relay is in `pending`.
		expect(result.eose).toEqual(['wss://a'])
		expect(result.pending).toEqual(['wss://b'])
		expect(localStreamCalls).toBe(0)
	})

	test('an unreachable rabbithole provider falls back to the local stream', async () => {
		configureBrowseSearch({ provider: 'rabbithole' })
		// The provider stubbed to throw (the service is down / unreachable).
		stubFetch(async () => {
			throw new TypeError('fetch failed')
		})

		const result = await runQueryFn('ceramic mug')
		// Degrades to the v1 (local) result, not an error.
		expect(result.products.map((p) => p.id)).toEqual(['local-mug'])
		expect(result.eose).toEqual(['wss://local'])
		expect(localStreamCalls).toBe(1)
	})

	test('a mid-stream rabbithole error frame falls back to the local stream', async () => {
		configureBrowseSearch({ provider: 'rabbithole' })
		const encoder = new TextEncoder()
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'event', event: rhEvent })}\n`))
				controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'error', message: 'relay exploded', code: 'E5' })}\n`))
				controller.close()
			},
		})
		stubFetch(async () => new Response(body, { status: 200 }))

		const result = await runQueryFn('ceramic mug')
		expect(result.products.map((p) => p.id)).toEqual(['local-mug'])
		expect(localStreamCalls).toBe(1)
	})

	test('an HTTP-level rabbithole failure falls back to the local stream', async () => {
		configureBrowseSearch({ provider: 'rabbithole' })
		stubFetch(async () => new Response('service unavailable', { status: 503 }))

		const result = await runQueryFn('ceramic mug')
		expect(result.products.map((p) => p.id)).toEqual(['local-mug'])
		expect(localStreamCalls).toBe(1)
	})

	test('a caller abort is propagated, not retried locally', async () => {
		configureBrowseSearch({ provider: 'rabbithole' })
		const controller = new AbortController()
		controller.abort() // already aborted before the query runs
		stubFetch(async (_url, init) => {
			if ((init as RequestInit).signal?.aborted) throw new DOMException('Aborted', 'AbortError')
			return ndjsonResponse([])
		})

		await expect(runQueryFn('ceramic mug', undefined, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
		expect(localStreamCalls).toBe(0) // an abort is not a fallback
	})

	test('the tag narrows the rabbithole request to a category filter', async () => {
		configureBrowseSearch({ provider: 'rabbithole' })
		let sentBody: Record<string, unknown> | null = null
		stubFetch(async (_url, init) => {
			sentBody = JSON.parse((init as RequestInit).body as string)
			return ndjsonResponse([JSON.stringify({ type: 'search', candidateCount: 0, hits: [] }), rhOutcome('complete', [], [])])
		})

		await runQueryFn('mug', 'pottery')
		expect(sentBody).toMatchObject({ q: 'mug', filters: ['category_tags = "pottery"'] })
	})
})

// ---------------------------------------------------------------------------

// The seller profile's list read (frame YcjyRPZbVo)
// ---------------------------------------------------------------------------

/** An in-stock, visible listing for the seller the tests read. */
function listingEvent(id: string, extraTags: string[][] = []): NostrEventLike {
	return {
		id,
		pubkey: 'b'.repeat(64),
		kind: 30402,
		created_at: 1_700_000_000,
		content: '',
		tags: [['d', id], ['title', `Listing ${id}`], ['price', '2100', 'SATS'], ['stock', '3'], ...extraTags],
	}
}

describe('seller listings read', () => {
	// The canned `local-events` fixture carries no `stock` tag, which the
	// products module's own `purchasable` rule treats as out of stock — so the
	// seller read drops it too. The listing under test is an in-stock one.
	test('streams this author only, and reports the seam verdict verbatim', async () => {
		const seller = 'b'.repeat(64)
		extraStreamEvents = [listingEvent('in-stock')]
		const result = await fetchSellerListings(seller, 25)

		// One filter, this author, the frame's listing kind.
		expect(lastStreamFilters).toEqual([{ kinds: [30402], limit: 25, authors: [seller] }])
		expect(result.listings.map((listing) => listing.id)).toEqual(['in-stock'])
		expect(result.listings[0]?.eventId).toBe('in-stock')
		// The relay verdict is the seam's, not a guess: both arrays pass through.
		expect(result.eose).toEqual(['wss://local'])
		expect(result.pending).toEqual([])
	})

	test('an invalid pubkey reads nothing', async () => {
		const result = await fetchSellerListings('not-a-pubkey')
		expect(result).toEqual({ listings: [], eose: [], pending: [] })
		expect(localStreamCalls).toBe(0)
	})

	test('drops a listing its author deleted (NIP-09)', async () => {
		extraStreamEvents = [listingEvent('live'), listingEvent('gone')]
		deletedEventIds = { gone: true }

		const result = await fetchSellerListings('b'.repeat(64))
		expect(result.listings.map((listing) => listing.id)).toEqual(['live'])
	})

	test('drops hidden, sold-out and stockless listings, as the product list does', async () => {
		extraStreamEvents = [
			listingEvent('live'),
			listingEvent('hidden', [['visibility', 'hidden']]),
			{
				...listingEvent('sold-out'),
				tags: [
					['d', 'sold-out'],
					['title', 'Sold out'],
					['price', '100', 'SATS'],
					['stock', '0'],
				],
			},
			{
				...listingEvent('no-stock-tag'),
				tags: [
					['d', 'no-stock-tag'],
					['title', 'No stock tag'],
					['price', '100', 'SATS'],
				],
			},
		]

		const result = await fetchSellerListings('b'.repeat(64))
		expect(result.listings.map((listing) => listing.id)).toEqual(['live'])
	})
})

// ---------------------------------------------------------------------------
// Product detail — the split-view panel's single read
// ---------------------------------------------------------------------------

async function runDetailQueryFn(id: string) {
	const options = browseProductDetailQueryOptions(id)
	return await options.queryFn!({} as Parameters<NonNullable<typeof options.queryFn>>[0])
}

describe('browse product detail read', () => {
	test('fetches the listing by coordinate (#d), with the event id as one OR', async () => {
		fetchedFilters.length = 0

		await runDetailQueryFn('detail-mug')
		expect(fetchedFilters).toEqual([
			[
				{ kinds: [30402], '#d': ['detail-mug'] },
				{ kinds: [30402], ids: ['detail-mug'] },
			],
		])
	})

	test('maps the listing tags the panel renders', async () => {
		const detail = await runDetailQueryFn('detail-mug')
		expect(detail).toMatchObject({
			id: 'detail-mug',
			title: 'Ceramic Mug',
			price: 1500,
			stock: '40 in stock',
			categories: ['pottery'],
			description: 'A local ceramic mug.',
			location: 'Porto',
			shipping: [{ costSats: 2400 }],
		})
	})

	test('resolves a coordinate with no event to null, not to a placeholder product', async () => {
		expect(await runDetailQueryFn('missing-listing')).toBeNull()
	})

	test('a coordinate published twice resolves to the newest publication', async () => {
		const detail = await runDetailQueryFn('duplicated-urn')
		expect(detail?.title).toBe('Unglazed Urn (new)')
		expect(detail?.description).toBe('A newer urn.')
	})
})
