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
 * The detail read's listings, covering every identifier shape the panel can
 * hand out: a `d`-tag slug, a listing published without a `d` tag (whose id is
 * the 64-char event id), and a full NIP-33 coordinate. Kept OUT of
 * `localEvents` on purpose: they are deliberately purchasable, so leaving them
 * in the stream would perturb the product-list and seller-listing reads that
 * share this backlog.
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
	{
		// No `d` tag: `mapProduct` falls back to the event id, so this is the
		// identifier shape that legitimately belongs in an `ids` filter.
		id: 'f'.repeat(64),
		pubkey: 'b'.repeat(64),
		kind: 30402,
		created_at: 1_700_000_000,
		content: 'A listing published without a `d` tag.',
		tags: [
			['title', 'Hex-id listing'],
			['price', '500', 'SATS'],
		],
	},
	{
		// The full NIP-33 address `30402:<pubkey>:<d>` a coordinate-aware caller
		// (not the `?p=` slug) would hand out.
		id: 'coord-event',
		pubkey: 'b'.repeat(64),
		kind: 30402,
		created_at: 1_700_000_000,
		content: 'A coordinate-addressed listing.',
		tags: [
			['d', 'coord-mug'],
			['title', 'Coordinate Mug'],
			['price', '800', 'SATS'],
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

/**
 * A product family: a `type=variable` parent plus its `type=variation`
 * children. Kept out of `localEvents`/`detailEvents` so the other reads are
 * unchanged; the children read resolves the parent by `#d` and the children by
 * `#a`.
 */
const FAMILY_READ_PUBKEY = 'b'.repeat(64)
const FAMILY_READ_ADDRESS = `30402:${FAMILY_READ_PUBKEY}:trail-runner`

const familyReadParentEvent: NostrEventLike = {
	id: 'family-parent',
	pubkey: FAMILY_READ_PUBKEY,
	kind: 30402,
	created_at: 1_700_000_000,
	content: 'A trail runner in several sizes.',
	tags: [
		['d', 'trail-runner'],
		['type', 'variable'],
		['title', 'Trail Runner'],
		['price', '100', 'SATS'],
		['image', 'https://example.test/parent.png'],
	],
}

const familyChildEvents: NostrEventLike[] = [
	{
		id: 'family-child-42',
		pubkey: FAMILY_READ_PUBKEY,
		kind: 30402,
		created_at: 1_700_000_000,
		content: '',
		tags: [
			['d', 'trail-runner-42'],
			['type', 'variation'],
			['a', FAMILY_READ_ADDRESS],
			['spec', 'size', '42'],
			['title', 'Trail Runner 42'],
			['price', '120', 'SATS'],
			['stock', '2'],
			['image', 'https://example.test/forty-two.png'],
		],
	},
	{
		id: 'family-child-43',
		pubkey: FAMILY_READ_PUBKEY,
		kind: 30402,
		created_at: 1_700_000_000,
		content: '',
		tags: [
			['d', 'trail-runner-43'],
			['type', 'variation'],
			['a', FAMILY_READ_ADDRESS],
			['spec', 'size', '43'],
			['title', 'Trail Runner 43'],
			['price', '120', 'SATS'],
			['stock', '0'],
		],
	},
	{
		// Hidden: the family rules drop it, so it must never reach the picker.
		id: 'family-child-hidden',
		pubkey: FAMILY_READ_PUBKEY,
		kind: 30402,
		created_at: 1_700_000_000,
		content: '',
		tags: [
			['d', 'trail-runner-hidden'],
			['type', 'variation'],
			['a', FAMILY_READ_ADDRESS],
			['spec', 'size', '99'],
			['title', 'Trail Runner 99'],
			['stock', '1'],
			['visibility', 'hidden'],
		],
	},
]

const familyReadEvents: NostrEventLike[] = [familyReadParentEvent, ...familyChildEvents]

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
/** The relay sets every relay-targeted detail read has been aimed at, in order. */
const relayFetches: Array<{ relayUrls?: string[] }> = []
/** When set, the relay-targeted read rejects — an unreachable relay. */
let relayFetchError: Error | null = null

/** Resolve the canned backlog by the ids/coordinates a filter set asks for. */
function eventsForFilters(filters: readonly EventFilter[]): NostrEventLike[] {
	const wanted = filters.flatMap((filter) => [...(filter.ids ?? []), ...(filter['#d'] ?? [])])
	const wantedParents = filters.flatMap((filter) => filter['#a'] ?? [])
	if (wanted.length === 0 && wantedParents.length === 0) return []
	return [...localEvents, ...detailEvents, ...duplicateUrns, ...familyReadEvents].filter(
		(event) =>
			wanted.includes(event.id) ||
			event.tags.some((tag) => tag[0] === 'd' && wanted.includes(tag[1])) ||
			event.tags.some((tag) => tag[0] === 'a' && wantedParents.includes(tag[1])),
	)
}

mock.module('@platform/web/readContext', () => ({
	// The relay-targeted read the detail query uses when the search hit named the
	// relays it was seen on (`applesauceIo.fetchEvents` and its `relayUrls`).
	applesauceIo: {
		fetchEvents: async (filters: readonly EventFilter[], opts?: { relayUrls?: string[] }) => {
			relayFetches.push({ relayUrls: opts?.relayUrls })
			if (relayFetchError) throw relayFetchError
			return eventsForFilters(filters)
		},
	},
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
			return eventsForFilters(filters)
		},
		store: {
			add: async (event: NostrEventLike) => ({ status: 'added' as const, event }),
			isDeleted: (event: NostrEventLike) => deletedEventIds[event.id] === true,
		},
	}),
}))

import {
	browseFacetsQueryOptions,
	browseFamilyChildrenQueryOptions,
	browseProductDetailQueryOptions,
	browseSearchQueryOptions,
	configureBrowseSearch,
	fetchSellerListings,
	getBrowseSearchProgress,
	getBrowseSearchProvider,
	resetBrowseSearchConfig,
	type BrowseSearchResult,
} from './browseQuery'
import { mapProduct } from './browseProductMap'

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

async function runQueryFn(query: string, signal?: AbortSignal): Promise<BrowseSearchResult> {
	const options = browseSearchQueryOptions(query, 100)
	return await options.queryFn!({ signal: signal ?? new AbortController().signal } as Parameters<NonNullable<typeof options.queryFn>>[0])
}

beforeEach(() => {
	resetBrowseSearchConfig()
	localStreamCalls = 0
	fetchStub = null
	lastStreamFilters = []
	extraStreamEvents = []
	deletedEventIds = {}
	deletionEvents = []
	fetchedFilters.length = 0
	relayFetches.length = 0
	relayFetchError = null
})

afterEach(() => {
	resetBrowseSearchConfig()
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

	test('with no configured base URL the client keeps its loopback default', async () => {
		configureBrowseSearch({ provider: 'rabbithole' })
		const requestedUrls: string[] = []
		stubFetch(async (input: RequestInfo | URL) => {
			requestedUrls.push(String(input))
			return ndjsonResponse([JSON.stringify({ type: 'search', candidateCount: 0, hits: [] }), rhOutcome('complete', [], [])])
		})

		await runQueryFn('ceramic mug')
		expect(requestedUrls).toEqual(['http://127.0.0.1:7711/search'])
	})

	test('a configured base URL is honoured end to end (config → client)', async () => {
		configureBrowseSearch({ provider: 'rabbithole', baseUrl: '/api/browse-search' })
		const requestedUrls: string[] = []
		stubFetch(async (input: RequestInfo | URL) => {
			requestedUrls.push(String(input))
			return ndjsonResponse([
				JSON.stringify({ type: 'search', candidateCount: 1, hits: [] }),
				JSON.stringify({ type: 'event', event: rhEvent }),
				rhOutcome('complete', ['wss://a'], []),
			])
		})

		const result = await runQueryFn('ceramic mug')
		// The same-origin proxy path the host publishes — never the loopback address.
		expect(requestedUrls).toEqual(['/api/browse-search/search'])
		expect(result.products.map((p) => p.id)).toEqual(['rh-mug'])
		expect(localStreamCalls).toBe(0)
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

		await expect(runQueryFn('ceramic mug', controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
		expect(localStreamCalls).toBe(0) // an abort is not a fallback
	})

	test('a category browses as a KEYWORD — the term is sent, and no filter is', async () => {
		// The owner's ruling: `See all →` writes its value as the term, not as a
		// `category_tags` filter. The service searches `all_tags` alongside the
		// title and the body, so the category's listings are still reached — and
		// relevance ranking orders what the exact-match filter used to narrow.
		configureBrowseSearch({ provider: 'rabbithole' })
		let sentBody: Record<string, unknown> | null = null
		stubFetch(async (_url, init) => {
			sentBody = JSON.parse((init as RequestInit).body as string)
			return ndjsonResponse([JSON.stringify({ type: 'search', candidateCount: 0, hits: [] }), rhOutcome('complete', [], [])])
		})

		await runQueryFn('pottery')
		expect(sentBody).toMatchObject({ q: 'pottery' })
		expect(sentBody).not.toHaveProperty('filters')
	})

	test('the local stream collapses a family to ONE row, preferring the parent', async () => {
		// The parent is last in arrival order; the collapse must still pick it
		// over its three children, and the term filter is unchanged (child titles
		// match the query too).
		extraStreamEvents = familyEvents()

		const result = await runQueryFn('trail runner')
		expect(result.products).toHaveLength(1)
		expect(result.products[0]?.id).toBe('trail-runner')
		expect(result.products[0]?.familyRole).toBe('parent')
		expect(result.products[0]?.variantCount).toBe(3)
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

const FAMILY_PUBKEY = 'b'.repeat(64)
const FAMILY_ADDRESS = `30402:${FAMILY_PUBKEY}:trail-runner`

/** A `type=variable` parent, in stock so the seller `purchasable` read keeps it. */
function familyParentEvent(): NostrEventLike {
	return {
		id: 'family-parent',
		pubkey: FAMILY_PUBKEY,
		kind: 30402,
		created_at: 1_700_000_000,
		content: '',
		tags: [
			['d', 'trail-runner'],
			['type', 'variable'],
			['title', 'Trail Runner'],
			['price', '100', 'SATS'],
			['stock', '5'],
		],
	}
}

/** A `type=variation` child of the parent above. */
function familyChildEvent(size: number): NostrEventLike {
	return {
		id: `family-child-${size}`,
		pubkey: FAMILY_PUBKEY,
		kind: 30402,
		created_at: 1_700_000_000,
		content: '',
		tags: [
			['d', `trail-runner-${size}`],
			['type', 'variation'],
			['a', FAMILY_ADDRESS],
			['spec', 'size', String(size)],
			['title', `Trail Runner ${size}`],
			['price', '100', 'SATS'],
			['stock', '2'],
		],
	}
}

/** The three children plus the parent, in child-first order. */
function familyEvents(): NostrEventLike[] {
	return [familyChildEvent(42), familyChildEvent(43), familyChildEvent(44), familyParentEvent()]
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

	test('collapses a seller’s family to ONE row, preferring the parent', async () => {
		extraStreamEvents = familyEvents()

		const result = await fetchSellerListings('b'.repeat(64))
		expect(result.listings).toHaveLength(1)
		expect(result.listings[0]?.id).toBe('trail-runner')
		expect(result.listings[0]?.variantCount).toBe(3)
	})
})

// ---------------------------------------------------------------------------
// Product detail — the split-view panel's single read
// ---------------------------------------------------------------------------

async function runDetailQueryFn(id: string, relays?: readonly string[]) {
	const options = browseProductDetailQueryOptions(id, relays)
	return await options.queryFn!({} as Parameters<NonNullable<typeof options.queryFn>>[0])
}

describe('browse product detail read', () => {
	test('a `d`-tag slug is read with one `#d` filter and no `ids` entry', async () => {
		fetchedFilters.length = 0

		await runDetailQueryFn('detail-mug')
		expect(fetchedFilters).toEqual([[{ kinds: [30402], '#d': ['detail-mug'] }]])
	})

	test('a 64-character hex identifier is read by event id', async () => {
		const eventId = 'f'.repeat(64)

		const detail = await runDetailQueryFn(eventId)
		expect(fetchedFilters).toEqual([[{ kinds: [30402], ids: [eventId] }]])
		expect(detail?.title).toBe('Hex-id listing')
	})

	test('a NIP-33 coordinate is read by kind/author/#d, with no `ids` entry', async () => {
		const coordinate = `30402:${'b'.repeat(64)}:coord-mug`

		const detail = await runDetailQueryFn(coordinate)
		expect(fetchedFilters).toEqual([[{ kinds: [30402], authors: ['b'.repeat(64)], '#d': ['coord-mug'] }]])
		expect(detail?.title).toBe('Coordinate Mug')
	})

	test('every value ever placed in `ids` is 64-character hex', async () => {
		// The invariant behind the defect: a slug in `ids` makes the relay reject
		// the whole REQ (CLOSED ... unexpected character in from_hex), which the
		// local store never reproduces. Every shape a caller can hand out, plus
		// shapes that are none of the three (so a new call path cannot smuggle
		// one through): all of them must obey it.
		const identifiers = [
			'detail-mug',
			'handcrafted-ceramic-ball',
			'orange-flock-black-orange-edition-high-top-sneakers-ma5ond',
			'f'.repeat(64),
			'A'.repeat(64),
			`30402:${'b'.repeat(64)}:coord-mug`,
			'30402:not-hex:slug',
			'a:b:c:d',
			'',
		]
		for (const identifier of identifiers) await runDetailQueryFn(identifier)

		const hex64 = /^[0-9a-f]{64}$/i
		for (const filters of fetchedFilters) {
			for (const filter of filters) {
				for (const id of filter.ids ?? []) expect(id).toMatch(hex64)
				for (const author of filter.authors ?? []) expect(author).toMatch(hex64)
			}
		}
		// The slug's read carried no `ids` key at all — the defect's exact shape.
		expect(fetchedFilters[0]).toEqual([{ kinds: [30402], '#d': ['detail-mug'] }])
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

	test('reads the listing from the relays the search hit was seen on', async () => {
		const detail = await runDetailQueryFn('detail-mug', ['wss://rabbithole-one', 'wss://rabbithole-two'])

		// The hit's own relays, in the order the hit recorded them…
		expect(relayFetches).toEqual([{ relayUrls: ['wss://rabbithole-one', 'wss://rabbithole-two'] }])
		// …and the app's own read context is not consulted for the same read.
		expect(fetchedFilters).toEqual([])
		// The same single-entity OR, and the same mapped listing the panel renders.
		expect(detail?.title).toBe('Ceramic Mug')
	})

	test('falls back to the app read context when the hit recorded no relays', async () => {
		const detail = await runDetailQueryFn('detail-mug', [])

		expect(relayFetches).toEqual([])
		expect(fetchedFilters).toEqual([[{ kinds: [30402], '#d': ['detail-mug'] }]])
		expect(detail?.title).toBe('Ceramic Mug')
	})

	test('an unreachable relay degrades to the empty state, not to an error', async () => {
		relayFetchError = new Error('relay refused the connection')

		expect(await runDetailQueryFn('detail-mug', ['wss://dead-relay'])).toBeNull()
	})

	test('the relays are part of the query key, so a different set is a different read', () => {
		expect(browseProductDetailQueryOptions('mug', ['wss://a']).queryKey).not.toEqual(browseProductDetailQueryOptions('mug').queryKey)
	})
})

// ---------------------------------------------------------------------------
// Family children — the open family's options (fetch, single family)
// ---------------------------------------------------------------------------

async function runFamilyChildrenQueryFn(parentAddress?: string, relays?: readonly string[]) {
	const options = browseFamilyChildrenQueryOptions(parentAddress, relays)
	return await options.queryFn!({} as Parameters<NonNullable<typeof options.queryFn>>[0])
}

describe('browse family children read', () => {
	test('reads the family with one parent filter and one `#a` children filter', async () => {
		fetchedFilters.length = 0
		const before = localStreamCalls

		await runFamilyChildrenQueryFn(FAMILY_READ_ADDRESS)

		expect(fetchedFilters).toHaveLength(1)
		const filters = fetchedFilters[0]
		// The parent by coordinate, the children by the family's parent address.
		expect(filters).toContainEqual({ kinds: [30402], authors: [FAMILY_READ_PUBKEY], '#d': ['trail-runner'] })
		expect(filters).toContainEqual({ kinds: [30402], limit: 200, '#a': [FAMILY_READ_ADDRESS] })
		// A detail read, not a list: the stream is never opened for it.
		expect(localStreamCalls).toBe(before)
	})

	test('maps every non-hidden child through the shared results mapper', async () => {
		const result = await runFamilyChildrenQueryFn(FAMILY_READ_ADDRESS)

		expect(result?.family.address).toBe(FAMILY_READ_ADDRESS)
		// Hidden children are dropped by the family rules; the rest are offered.
		expect(result?.children.map((child) => child.dTag)).toEqual(['trail-runner-42', 'trail-runner-43'])

		// The panel row for a child IS the shared mapper's output for that event,
		// so it cannot disagree with the same child rendered in a list.
		expect(result?.children[0]?.product).toEqual(mapProduct(familyChildEvents[0]))
		expect(result?.children[0]?.product.variantLabel).toBe('42')
		// The label is the variation's spec label, never the d-tag.
		expect(result?.children[0]?.label).toBe('42')
	})

	test('carries each option’s availability, including out-of-stock', async () => {
		const result = await runFamilyChildrenQueryFn(FAMILY_READ_ADDRESS)
		const byTag = new Map((result?.children ?? []).map((child) => [child.dTag, child]))
		expect(byTag.get('trail-runner-42')?.available).toBe(true)
		expect(byTag.get('trail-runner-43')?.available).toBe(false)
	})

	test('an absent or malformed address reads nothing rather than a placeholder family', async () => {
		expect(await runFamilyChildrenQueryFn(undefined)).toBeNull()
		expect(await runFamilyChildrenQueryFn('not-a-coordinate')).toBeNull()
	})
})

// ---------------------------------------------------------------------------
// Filters and facets — the tag-only browse and the unfiltered facet probe
// ---------------------------------------------------------------------------

describe('browse facets — a term-only read, with no filter path at all', () => {
	test('an empty term with no open product reads NOTHING — the state cannot exist', async () => {
		configureBrowseSearch({ provider: 'rabbithole' })
		let sentBody: Record<string, unknown> | null = null
		stubFetch(async (_url, init) => {
			sentBody = JSON.parse((init as RequestInit).body as string)
			return ndjsonResponse([JSON.stringify({ type: 'search', candidateCount: 0, hits: [] }), rhOutcome('complete', [], [])])
		})

		// There is no tag-only browse any more: a category writes its value as the
		// TERM. So `q=''` with nothing else is the idle state, and it must not
		// reach the provider at all — an empty term is exactly what let the facet
		// probe answer over the whole index and put Health/Pharma on a Bitcoin page.
		const result = await runQueryFn('')
		expect(sentBody).toBeNull()
		expect(result.products).toEqual([])
	})

	test('no request ever carries a filter — the read is the term alone', async () => {
		configureBrowseSearch({ provider: 'rabbithole' })
		let sentBody: Record<string, unknown> | null = null
		stubFetch(async (_url, init) => {
			sentBody = JSON.parse((init as RequestInit).body as string)
			return ndjsonResponse([JSON.stringify({ type: 'search', candidateCount: 0, hits: [] }), rhOutcome('complete', [], [])])
		})

		await runQueryFn('pottery')
		expect(sentBody).toMatchObject({ q: 'pottery' })
		expect(sentBody).not.toHaveProperty('filters')
	})

	test('the facet probe reads the unfiltered, index-only suggestion list', async () => {
		configureBrowseSearch({ provider: 'rabbithole' })
		let sentBody: Record<string, unknown> | null = null
		stubFetch(async (_url, init) => {
			sentBody = JSON.parse((init as RequestInit).body as string)
			return ndjsonResponse([
				JSON.stringify({
					type: 'search',
					query: 'mug',
					candidateCount: 120,
					hits: [],
					suggested: [
						{ field: 'category_tags', value: 'pottery', count: 120 },
						{ field: 'currency', value: 'USD', count: 61, filter: 'currency = "USD"' },
					],
				}),
			])
		})

		const options = browseFacetsQueryOptions('mug', true)
		const facets = await options.queryFn!({ signal: new AbortController().signal } as Parameters<NonNullable<typeof options.queryFn>>[0])

		// The probe carries the term but no filter — selecting a filter must not
		// rotate the pill set it feeds.
		expect(sentBody).toMatchObject({ q: 'mug', indexOnly: true, limit: 1 })
		expect((sentBody as Record<string, unknown> | null)?.filters).toBeUndefined()
		expect(facets).toEqual([
			{ field: 'category_tags', value: 'pottery', count: 120, coverage: undefined, filter: undefined },
			{ field: 'currency', value: 'USD', count: 61, coverage: undefined, filter: 'currency = "USD"' },
		])
	})

	test('the local provider states no facets rather than counting its window', async () => {
		stubFetch(async () => {
			throw new Error('the local provider must not fetch')
		})
		const options = browseFacetsQueryOptions('mug', true)
		expect(await options.queryFn!({ signal: new AbortController().signal } as Parameters<NonNullable<typeof options.queryFn>>[0])).toEqual(
			[],
		)
	})
})

// ---------------------------------------------------------------------------
// Progressive delivery — the read hands its products over while it runs
// ---------------------------------------------------------------------------

/** Poll until the read's own async loop has published what the test waits for. */
async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
	const started = Date.now()
	while (!predicate()) {
		if (Date.now() - started > timeoutMs) throw new Error('timed out waiting for the search read')
		await new Promise((resolve) => setTimeout(resolve, 1))
	}
}

describe('progressive browse search', () => {
	test('publishes products while the read is still running, then the settled result replaces them', async () => {
		configureBrowseSearch({ provider: 'rabbithole' })
		const key = browseSearchQueryOptions('ceramic mug', 100).queryKey

		const encoder = new TextEncoder()
		let openGate: () => void = () => {}
		const gate = new Promise<void>((resolve) => {
			openGate = resolve
		})
		const body = new ReadableStream<Uint8Array>({
			async start(controller) {
				controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'search', candidateCount: 1, hits: [] })}\n`))
				controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'relay', relay: 'wss://a', state: 'querying' })}\n`))
				controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'event', event: rhEvent })}\n`))
				// The outcome waits for the test: the snapshot must be readable
				// while this promise is unsettled, which is the whole point.
				await gate
				controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'relay', relay: 'wss://a', state: 'answered' })}\n`))
				controller.enqueue(encoder.encode(`${rhOutcome('complete', ['wss://a'], [])}\n`))
				controller.close()
			},
		})
		stubFetch(async () => new Response(body))

		const pending = runQueryFn('ceramic mug')
		await waitFor(() => (getBrowseSearchProgress(key)?.products.length ?? 0) === 1)

		const snapshot = getBrowseSearchProgress(key)
		expect(snapshot?.products.map((product) => product.id)).toEqual(['rh-mug'])
		// A snapshot is never a verdict, and it does not settle the read.
		expect(snapshot?.complete).toBe(false)
		// The provider answered, so the local stream was never consulted.
		expect(localStreamCalls).toBe(0)

		openGate()
		const result = await pending
		expect(result.products.map((product) => product.id)).toEqual(['rh-mug'])
		expect(result.incomplete).toBeUndefined()
	})

	/**
	 * The index frame's rows, readable BEFORE the first relay event exists.
	 *
	 * The snapshot store is keyed on the query and only lists what the read has
	 * handed over; a store that treats "no event yet" as "nothing to say" would
	 * hide the index's paint and leave the grid empty until the relays answered —
	 * the gating this removes.
	 */
	test('publishes the index frame’s products into the snapshot, before any event arrives', async () => {
		configureBrowseSearch({ provider: 'rabbithole' })
		const key = browseSearchQueryOptions('ceramic mug', 100).queryKey

		const encoder = new TextEncoder()
		let openGate: () => void = () => {}
		const gate = new Promise<void>((resolve) => {
			openGate = resolve
		})
		const body = new ReadableStream<Uint8Array>({
			async start(controller) {
				// The `search` frame, alone: the index's slim hits, no tags.
				controller.enqueue(
					encoder.encode(
						`${JSON.stringify({
							type: 'search',
							candidateCount: 2,
							hits: [
								{
									coordinate: `30402:${'c'.repeat(64)}:rh-mug`,
									event_id: 'rh-mug',
									title: 'Ceramic Mug',
									pubkey: 'c'.repeat(64),
									price_amount: 999,
									currency: 'SATS',
									category_tags: ['pottery'],
									relays_seen: ['wss://a'],
									has_image: true,
									created_at: 1_700_000_000,
								},
								{
									coordinate: `30402:${'c'.repeat(64)}:still-coming`,
									event_id: 'still-coming',
									title: 'Second Mug',
									pubkey: 'c'.repeat(64),
									price_amount: 1200,
									currency: 'SATS',
									category_tags: [],
									relays_seen: ['wss://a'],
									has_image: false,
									created_at: 1_700_000_000,
								},
							],
						})}\n`,
					),
				)
				// Everything else waits for the test: the snapshot must be
				// readable while the read is still open on the wire.
				await gate
				controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'event', event: rhEvent })}\n`))
				controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'relay', relay: 'wss://a', state: 'answered' })}\n`))
				controller.enqueue(encoder.encode(`${rhOutcome('complete', ['wss://a'], [])}\n`))
				controller.close()
			},
		})
		stubFetch(async () => new Response(body))

		const pending = runQueryFn('ceramic mug')
		await waitFor(() => (getBrowseSearchProgress(key)?.products.length ?? 0) === 2)

		const snapshot = getBrowseSearchProgress(key)
		// The cards are the index's own rows, mapped through the same mapper.
		expect(snapshot?.products.map((product) => product.id)).toEqual(['rh-mug', 'still-coming'])
		expect(snapshot?.products[0]).toMatchObject({ title: 'Ceramic Mug', price: 999, currency: 'SATS', categories: ['pottery'] })
		// Nothing from the relays has arrived — the snapshot says so honestly…
		expect(snapshot?.eventsDelivered).toBe(0)
		// …and it is still never a verdict.
		expect(snapshot?.complete).toBe(false)

		openGate()
		const result = await pending
		// The settled read keeps the painted rows and enriches the one whose
		// event arrived; the other stays as the index painted it.
		expect(result.products.map((product) => product.id)).toEqual(['rh-mug', 'still-coming'])
		expect(result.incomplete).toBeUndefined()
	})

	test('a snapshot is scoped to its own query key — another search never sees it', async () => {
		configureBrowseSearch({ provider: 'rabbithole' })
		const mugKey = browseSearchQueryOptions('ceramic mug', 100).queryKey
		const teaKey = browseSearchQueryOptions('tea pot', 100).queryKey

		stubFetch(async () =>
			ndjsonResponse([JSON.stringify({ type: 'search', candidateCount: 1, hits: [] }), JSON.stringify({ type: 'event', event: rhEvent }), rhOutcome('complete', [], [])]),
		)
		await runQueryFn('ceramic mug')

		expect(getBrowseSearchProgress(mugKey)?.products.map((product) => product.id)).toEqual(['rh-mug'])
		expect(getBrowseSearchProgress(teaKey)).toBeNull()
	})

	test('a truncated read is incomplete — it never falls back to the local verdict', async () => {
		configureBrowseSearch({ provider: 'rabbithole' })
		stubFetch(async () =>
			ndjsonResponse([
				JSON.stringify({ type: 'search', candidateCount: 1, hits: [] }),
				JSON.stringify({ type: 'relay', relay: 'wss://a', state: 'answered' }),
				JSON.stringify({ type: 'relay', relay: 'wss://b', state: 'querying' }),
				JSON.stringify({ type: 'event', event: rhEvent }),
				// The stream ends without its outcome frame — the deadline or the
				// connection cut it. Everything above is real; the set is not whole.
			]),
		)

		const result = await runQueryFn('ceramic mug')

		// The arrived products are kept, and the read says it did not finish.
		expect(result.products.map((product) => product.id)).toEqual(['rh-mug'])
		expect(result.incomplete).toEqual({ reason: 'truncated', eventsDelivered: 1 })
		// The relays that had answered, and the one still in flight, are the
		// honest eose/pending — not a flattened "complete" shape.
		expect(result.eose).toEqual(['wss://a'])
		expect(result.pending).toEqual(['wss://b'])
		// The disguise this kills: the local stream's unrelated verdict.
		expect(localStreamCalls).toBe(0)
		// The product the local stream would have contributed is not here.
		expect(result.products.map((product) => product.id)).not.toContain('local-mug')
	})

	test('a read cut before it delivered anything is still incomplete, not an empty search', async () => {
		configureBrowseSearch({ provider: 'rabbithole' })
		// The 8050 ms / 300-byte shape: the search frame arrived, nothing else did.
		stubFetch(async () => ndjsonResponse([JSON.stringify({ type: 'search', candidateCount: 0, hits: [] })]))

		const result = await runQueryFn('ceramic mug')

		expect(result.products).toEqual([])
		expect(result.incomplete).toEqual({ reason: 'truncated', eventsDelivered: 0 })
		expect(localStreamCalls).toBe(0)
	})
})
