/**
 * platform/web/browse/rabbitholeClient.test.ts — The RabbitHole search client.
 *
 * Tests against a stubbed `fetch` (no network): the NDJSON streaming contract,
 * the frame → `BrowseSearchResult` mapping, the chunk-boundary cases a real
 * relay stream exercises (a frame split mid-line across reads, and several
 * frames in one chunk), the `partial` verdict (failed relays must reach `pending`,
 * never `eose`), a mid-stream `error` frame (an in-band failure, not an HTTP
 * status), and the failure paths the caller falls back from (HTTP-level failure,
 * an unreachable fetch, a truncated stream, an over-limit request).
 */

import { describe, expect, test } from 'bun:test'
import type { NostrEventLike } from '@sdk/core/nostr/eventLike'
import type { BrowseProduct } from './browseProductMap'
import {
	clampRabbitHoleLimit,
	rabbitholeSearch,
	RabbitHoleError,
	RABBITHOLE_DEFAULT_TIMEOUT_MS,
	RABBITHOLE_LIMITS,
	RABBITHOLE_SERVICE_TOTAL_DEADLINE_MS,
	RABBITHOLE_TIMEOUT_HEADROOM_MS,
} from './rabbitholeClient'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PUBKEY = 'a'.repeat(64)

function productEvent(id: string, title: string): NostrEventLike {
	return {
		id,
		pubkey: PUBKEY,
		kind: 30402,
		created_at: 1_700_000_000,
		content: `${title} body`,
		tags: [
			['d', id],
			['title', title],
			['price', '2500', 'SATS'],
			['stock', '3'],
			['t', 'pottery'],
		],
	}
}

/**
 * The outcome frame as the SERVICE actually sends it. `relaysFailed` is an array
 * of `{ relay, reason }` OBJECTS, not relay strings — a helper that emitted plain
 * strings made the client's wrong `string[]` declaration look correct, and the
 * mistake only surfaced as a React crash when a reader clicked the relay
 * indicator's "pending" chip. Test the wire, not the wish.
 */
function outcomeFrame(status: 'complete' | 'partial', answered: string[], failed: string[]): string {
	return JSON.stringify({
		type: 'outcome',
		status,
		outcome: {
			relaysQueried: [...answered, ...failed],
			relaysAnswered: answered,
			relaysFailed: failed.map((relay) => ({ relay, reason: 'socket error' })),
			deadlineHit: status === 'partial',
			eventsDelivered: 1,
			eventsDeduped: 0,
			eventsExpired: 0,
			elapsedMs: 702,
		},
	})
}

/** A `fetch` stub returning a canned NDJSON `Response` body (one line per frame). */
function ndjsonResponse(lines: string[], init: ResponseInit = { status: 200 }): Response {
	const encoder = new TextEncoder()
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			for (const line of lines) controller.enqueue(encoder.encode(`${line}\n`))
			controller.close()
		},
	})
	return new Response(body, { headers: { 'content-type': 'application/x-ndjson' }, ...init })
}

function fetchReturning(response: Response): typeof fetch {
	return (async () => response) as unknown as typeof fetch
}

// ---------------------------------------------------------------------------
// The streamed response → BrowseSearchResult
// ---------------------------------------------------------------------------

describe('rabbitholeSearch — the streamed response', () => {
	test('a complete verdict maps delivered events and answered relays', async () => {
		const result = await rabbitholeSearch(
			{ q: 'ceramic mug', limit: 5 },
			{
				fetchImpl: fetchReturning(
					ndjsonResponse([
						JSON.stringify({ type: 'search', configHash: 'h', query: 'ceramic mug', candidateCount: 1, hits: [], suggested: [] }),
						JSON.stringify({ type: 'relay', relay: 'wss://a', state: 'querying' }),
						JSON.stringify({ type: 'event', sequence: 0, event: productEvent('e1', 'Ceramic Mug') }),
						JSON.stringify({ type: 'relay', relay: 'wss://a', state: 'answered' }),
						outcomeFrame('complete', ['wss://a'], []),
					]),
				),
			},
		)

		expect(result.products).toHaveLength(1)
		expect(result.products[0]).toMatchObject({ id: 'e1', title: 'Ceramic Mug', price: 2500, stock: '3', categories: ['pottery'] })
		expect(result.eose).toEqual(['wss://a'])
		expect(result.pending).toEqual([])
	})

	test('a partial verdict keeps its failed relays in pending, never flattened into eose', async () => {
		const result = await rabbitholeSearch(
			{ q: 'ceramic mug' },
			{
				fetchImpl: fetchReturning(
					ndjsonResponse([
						JSON.stringify({ type: 'search', candidateCount: 1, hits: [] }),
						JSON.stringify({ type: 'event', event: productEvent('e1', 'Ceramic Mug') }),
						outcomeFrame('partial', ['wss://a'], ['wss://b', 'wss://c']),
					]),
				),
			},
		)

		// The delivered events are real and kept…
		expect(result.products.map((p) => p.id)).toEqual(['e1'])
		// …and the verdict is the relay-failure state: failed relays in `pending`.
		expect(result.eose).toEqual(['wss://a'])
		expect(result.pending).toEqual(['wss://b', 'wss://c'])
		// The non-negotiable: a partial set is never a plain complete-shaped result.
		expect(result.pending.length).toBeGreaterThan(0)
	})

	test('flattens the service\'s failure OBJECTS to relay URLs — the crash this pins', async () => {
		// The wire states `relaysFailed: [{ relay, reason }]`. Assigning that to a
		// `string[]` compiled, then flowed into the indicator, which wrapped each
		// entry as `{ relay: <entry>, status }` and rendered the object as a React
		// child — React error #31, whole page replaced by the error boundary, one
		// click on "pending" away. Every entry here must be a STRING.
		const result = await rabbitholeSearch(
			{ q: 'ceramic mug' },
			{
				fetchImpl: fetchReturning(
					ndjsonResponse([
						JSON.stringify({ type: 'search', candidateCount: 1, hits: [] }),
						outcomeFrame('partial', ['wss://a'], ['wss://b']),
					]),
				),
			},
		)

		expect(result.pending).toEqual(['wss://b'])
		for (const entry of result.pending) {
			expect(typeof entry).toBe('string')
		}
		// And the shape the indicator is built from — the one that crashed.
		const relayDetails = result.pending.map((relay) => ({ relay, status: 'pending' as const }))
		expect(relayDetails[0]?.relay).toBe('wss://b')
	})

	test('deduplicates events by id (a relay re-sends the same payload)', async () => {
		const result = await rabbitholeSearch(
			{ q: 'ceramic mug' },
			{
				fetchImpl: fetchReturning(
					ndjsonResponse([
						JSON.stringify({ type: 'search', candidateCount: 1, hits: [] }),
						JSON.stringify({ type: 'event', event: productEvent('e1', 'Mug') }),
						JSON.stringify({ type: 'event', event: productEvent('e1', 'Mug') }),
						outcomeFrame('complete', ['wss://a'], []),
					]),
				),
			},
		)
		expect(result.products.map((p) => p.id)).toEqual(['e1'])
	})

	test('collapses a delivered family to ONE row, preferring the parent', async () => {
		const address = `30402:${PUBKEY}:trail-runner`
		const parent: NostrEventLike = {
			id: 'family-parent',
			pubkey: PUBKEY,
			kind: 30402,
			created_at: 1_700_000_000,
			content: 'family body',
			tags: [
				['d', 'trail-runner'],
				['type', 'variable'],
				['title', 'Trail Runner'],
				['price', '100', 'SATS'],
			],
		}
		const child = (size: number): NostrEventLike => ({
			id: `family-child-${size}`,
			pubkey: PUBKEY,
			kind: 30402,
			created_at: 1_700_000_000,
			content: '',
			tags: [
				['d', `trail-runner-${size}`],
				['type', 'variation'],
				['a', address],
				['spec', 'size', String(size)],
				['title', `Trail Runner ${size}`],
				['price', '100', 'SATS'],
			],
		})

		const result = await rabbitholeSearch(
			{ q: 'trail runner' },
			{
				fetchImpl: fetchReturning(
					ndjsonResponse([
						JSON.stringify({ type: 'search', candidateCount: 4, hits: [] }),
						JSON.stringify({ type: 'event', event: child(42) }),
						JSON.stringify({ type: 'event', event: child(43) }),
						JSON.stringify({ type: 'event', event: child(44) }),
						JSON.stringify({ type: 'event', event: parent }),
						outcomeFrame('complete', ['wss://a'], []),
					]),
				),
			},
		)

		expect(result.products).toHaveLength(1)
		expect(result.products[0]?.id).toBe('trail-runner')
		expect(result.products[0]?.familyRole).toBe('parent')
		expect(result.products[0]?.variantCount).toBe(3)
	})
})

// ---------------------------------------------------------------------------
// Chunk boundaries — a real relay stream does not respect frame boundaries
// ---------------------------------------------------------------------------

describe('rabbitholeSearch — chunk boundaries', () => {
	test('reassembles a frame split mid-line across two reads', async () => {
		const eventLine = JSON.stringify({ type: 'event', event: productEvent('split', 'Split Mug') })
		const cut = Math.floor(eventLine.length / 2) // split inside the JSON
		const encoder = new TextEncoder()

		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'search', candidateCount: 1, hits: [] })}\n`))
				// Each enqueue is delivered as its own read(), so the frame is
				// genuinely split across two reads: first the partial line (no
				// trailing newline), then the rest of the frame plus the outcome.
				controller.enqueue(encoder.encode(eventLine.slice(0, cut)))
				controller.enqueue(encoder.encode(`${eventLine.slice(cut)}\n`))
				controller.enqueue(encoder.encode(`${outcomeFrame('complete', ['wss://a'], [])}\n`))
				controller.close()
			},
		})

		const result = await rabbitholeSearch({ q: 'ceramic mug' }, { fetchImpl: fetchReturning(new Response(body)) })
		expect(result.products.map((p) => p.id)).toEqual(['split'])
		expect(result.eose).toEqual(['wss://a'])
	})

	test('emits several frames that arrive in one chunk', async () => {
		const encoder = new TextEncoder()
		const chunk =
			[
				JSON.stringify({ type: 'search', candidateCount: 2, hits: [] }),
				JSON.stringify({ type: 'event', event: productEvent('one', 'One') }),
				JSON.stringify({ type: 'event', event: productEvent('two', 'Two') }),
				JSON.stringify({ type: 'dropped', sequence: 3, dropped: 'duplicate', id: 'one' }),
				outcomeFrame('complete', [], []),
			].join('\n') + '\n'

		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(encoder.encode(chunk))
				controller.close()
			},
		})

		const result = await rabbitholeSearch({ q: 'ceramic mug' }, { fetchImpl: fetchReturning(new Response(body)) })
		expect(result.products.map((p) => p.id).sort()).toEqual(['one', 'two'])
	})

	test('reassembles a multi-byte UTF-8 character split across reads', async () => {
		// A title with a non-ASCII byte (é) split mid-character across two chunks.
		const eventLine = `${JSON.stringify({ type: 'event', event: productEvent('utf', 'Café Mug') })}\n`
		const encoder = new TextEncoder()
		const bytes = encoder.encode(eventLine)
		// JSON.stringify keeps the raw é (2 UTF-8 bytes); cut one byte in.
		const éByteOffset = encoder.encode(eventLine.slice(0, eventLine.indexOf('é'))).byteLength
		const cut = éByteOffset + 1 // one byte into the 2-byte é

		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(bytes.slice(0, cut))
				controller.enqueue(bytes.slice(cut))
				controller.enqueue(encoder.encode(`${outcomeFrame('complete', [], [])}\n`))
				controller.close()
			},
		})

		const result = await rabbitholeSearch({ q: 'ceramic mug' }, { fetchImpl: fetchReturning(new Response(body)) })
		expect(result.products.map((p) => p.id)).toEqual(['utf'])
		expect(result.products[0].title).toBe('Café Mug')
	})
})

// ---------------------------------------------------------------------------
// The in-stream error frame (a failure after the stream has started)
// ---------------------------------------------------------------------------

describe('rabbitholeSearch — in-stream error frame', () => {
	test('an error frame arriving after the stream starts rejects (the caller falls back)', async () => {
		const encoder = new TextEncoder()
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'event', event: productEvent('e1', 'Mug') })}\n`))
				// A real event is already delivered, then the failure arrives.
				controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'error', message: 'relay exploded', code: 'E5' })}\n`))
				controller.close()
			},
		})

		await expect(rabbitholeSearch({ q: 'ceramic mug' }, { fetchImpl: fetchReturning(new Response(body)) })).rejects.toMatchObject({
			code: 'stream-error',
		})
	})
})

// ---------------------------------------------------------------------------
// The failure paths the caller falls back from
// ---------------------------------------------------------------------------

describe('rabbitholeSearch — failure paths (fallback triggers)', () => {
	test('an HTTP-level failure (non-2xx) rejects with code http', async () => {
		await expect(
			rabbitholeSearch({ q: 'ceramic mug' }, { fetchImpl: fetchReturning(new Response('boom', { status: 500 })) }),
		).rejects.toMatchObject({
			code: 'http',
		})
	})

	test('an unreachable fetch (network error) rejects with code http', async () => {
		const unreachable = (async () => {
			throw new TypeError('fetch failed')
		}) as unknown as typeof fetch
		await expect(rabbitholeSearch({ q: 'ceramic mug' }, { fetchImpl: unreachable })).rejects.toMatchObject({ code: 'http' })
	})

	test('a stream that ends without an outcome frame rejects with code truncated', async () => {
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				const encoder = new TextEncoder()
				controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'event', event: productEvent('e1', 'Mug') })}\n`))
				controller.close() // no outcome frame
			},
		})
		await expect(rabbitholeSearch({ q: 'ceramic mug' }, { fetchImpl: fetchReturning(new Response(body)) })).rejects.toMatchObject({
			code: 'truncated',
		})
	})

	test('a stalled body read that outlives the deadline rejects with code timeout', async () => {
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				const encoder = new TextEncoder()
				controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'search', candidateCount: 0, hits: [] })}\n`))
				// Never close: the next read hangs until the deadline cancels it.
			},
		})
		await expect(
			rabbitholeSearch({ q: 'ceramic mug' }, { fetchImpl: fetchReturning(new Response(body)), timeoutMs: 40 }),
		).rejects.toMatchObject({ code: 'timeout' })
	})
})

// ---------------------------------------------------------------------------
// Request limits — enforced before the first byte
// ---------------------------------------------------------------------------

describe('rabbitholeSearch — request limits', () => {
	test('rejects an empty or over-limit query before any fetch', async () => {
		let called = false
		const fetchImpl = (async () => {
			called = true
			return ndjsonResponse([])
		}) as unknown as typeof fetch

		await expect(rabbitholeSearch({ q: '   ' }, { fetchImpl })).rejects.toMatchObject({ code: 'bad-request' })
		await expect(rabbitholeSearch({ q: 'x'.repeat(RABBITHOLE_LIMITS.maxQueryLength + 1) }, { fetchImpl })).rejects.toMatchObject({
			code: 'bad-request',
		})
		expect(called).toBe(false)
	})

	test('rejects more than 8 filters before any fetch', async () => {
		const fetchImpl = (async () => ndjsonResponse([])) as unknown as typeof fetch
		await expect(
			rabbitholeSearch({ q: 'mug', filters: Array.from({ length: RABBITHOLE_LIMITS.maxFilters + 1 }, (_, i) => `f${i}`) }, { fetchImpl }),
		).rejects.toMatchObject({ code: 'bad-request' })
	})

	test('clamps an out-of-range limit into 1–100 on the wire (never rejected)', async () => {
		const sent = (limit?: number): Promise<number> =>
			new Promise<number>((resolve) => {
				const fetchImpl = (async (_url: string, init?: RequestInit) => {
					resolve((JSON.parse((init as RequestInit).body as string) as { limit: number }).limit)
					return ndjsonResponse([JSON.stringify({ type: 'search', candidateCount: 0, hits: [] })])
				}) as unknown as typeof fetch
				// indexOnly: a search-only stream (no outcome frame) is valid.
				void rabbitholeSearch({ q: 'mug', limit, indexOnly: true }, { fetchImpl })
			})

		expect(await sent(0)).toBe(1)
		expect(await sent(101)).toBe(100)
		expect(await sent(50)).toBe(50)
		expect(await sent(undefined)).toBe(100)
	})
})

// ---------------------------------------------------------------------------
// Request shaping
// ---------------------------------------------------------------------------

describe('rabbitholeSearch — request shaping', () => {
	test('POSTs the query, clamped limit, and indexOnly to /search', async () => {
		const captured = { url: null as string | null, init: null as RequestInit | null }
		const fetchImpl = (async (url: string, init?: RequestInit) => {
			captured.url = url
			captured.init = init as RequestInit
			return ndjsonResponse([JSON.stringify({ type: 'search', candidateCount: 0, hits: [] })])
		}) as unknown as typeof fetch

		await rabbitholeSearch({ q: 'ceramic mug', limit: 250, indexOnly: true }, { fetchImpl, baseUrl: 'http://127.0.0.1:7711' })

		expect(captured.url).toBe('http://127.0.0.1:7711/search')
		expect(captured.init?.method).toBe('POST')
		const body = JSON.parse(captured.init?.body as string) as { q: string; limit: number; indexOnly: boolean }
		expect(body.q).toBe('ceramic mug')
		expect(body.limit).toBe(100) // clamped from 250
		expect(body.indexOnly).toBe(true)
	})

	test('sends the tag as a category filter', async () => {
		let body: Record<string, unknown> | null = null
		const fetchImpl = (async (_url: string, init?: RequestInit) => {
			body = JSON.parse((init as RequestInit).body as string)
			return ndjsonResponse([JSON.stringify({ type: 'search', candidateCount: 0, hits: [] })])
		}) as unknown as typeof fetch

		await rabbitholeSearch({ q: 'mug', filters: ['category_tags = "pottery"'], indexOnly: true }, { fetchImpl })
		expect(body).toMatchObject({ q: 'mug', filters: ['category_tags = "pottery"'] })
	})

	test('clamps a limit into the 1–100 range', () => {
		expect(clampRabbitHoleLimit(0)).toBe(1)
		expect(clampRabbitHoleLimit(1)).toBe(1)
		expect(clampRabbitHoleLimit(50)).toBe(50)
		expect(clampRabbitHoleLimit(100)).toBe(100)
		expect(clampRabbitHoleLimit(999)).toBe(100)
		expect(clampRabbitHoleLimit(undefined)).toBe(100)
	})

	test('a RabbitHoleError carries a machine-readable code', () => {
		expect(new RabbitHoleError('timeout', 'x').name).toBe('RabbitHoleError')
		expect(new RabbitHoleError('timeout', 'x').code).toBe('timeout')
	})
})

// ---------------------------------------------------------------------------
// The search frame's own statements: facets and per-listing relays
// ---------------------------------------------------------------------------

describe('rabbitholeSearch — the search frame', () => {
	test('maps the frame’s suggested facets onto the result', async () => {
		const result = await rabbitholeSearch(
			{ q: 'mug' },
			{
				fetchImpl: fetchReturning(
					ndjsonResponse([
						JSON.stringify({
							type: 'search',
							candidateCount: 120,
							hits: [],
							suggested: [
								{ field: 'category_tags', value: 'pottery', count: 120, coverage: 0.3, filter: 'category_tags = "pottery"' },
								{ field: 'currency', value: 'USD', count: 61 },
							],
						}),
						outcomeFrame('complete', ['wss://a'], []),
					]),
				),
			},
		)

		expect(result.suggested).toEqual([
			{ field: 'category_tags', value: 'pottery', count: 120, coverage: 0.3, filter: 'category_tags = "pottery"' },
			{ field: 'currency', value: 'USD', count: 61, coverage: undefined, filter: undefined },
		])
	})

	test('states an empty facet list when the frame carries none', async () => {
		const result = await rabbitholeSearch(
			{ q: 'mug' },
			{
				fetchImpl: fetchReturning(ndjsonResponse([JSON.stringify({ type: 'search', hits: [] }), outcomeFrame('complete', [], [])])),
			},
		)
		expect(result.suggested).toEqual([])
	})

	test('attaches the listing’s own relays from its index hit, by event id', async () => {
		const event = productEvent('e1', 'Ceramic Mug')
		const coordinate = `30402:${PUBKEY}:e1`

		const result = await rabbitholeSearch(
			{ q: 'mug' },
			{
				fetchImpl: fetchReturning(
					ndjsonResponse([
						JSON.stringify({
							type: 'search',
							candidateCount: 1,
							hits: [{ coordinate, event_id: 'e1', relays_seen: ['wss://nos.lol', 'wss://relay.damus.io'] }],
						}),
						JSON.stringify({ type: 'event', event }),
						outcomeFrame('complete', ['wss://nos.lol', 'wss://relay.damus.io'], []),
					]),
				),
			},
		)

		// The listing's relays are the hit's, not the search-level fan-out set.
		expect(result.products[0]?.relays).toEqual(['wss://nos.lol', 'wss://relay.damus.io'])
	})

	test('falls back to the hit’s coordinate when it omits event_id', async () => {
		const event = productEvent('e1', 'Ceramic Mug')

		const result = await rabbitholeSearch(
			{ q: 'mug' },
			{
				fetchImpl: fetchReturning(
					ndjsonResponse([
						JSON.stringify({
							type: 'search',
							candidateCount: 1,
							hits: [{ coordinate: `30402:${PUBKEY}:e1`, relays_seen: ['wss://nos.lol'] }],
						}),
						JSON.stringify({ type: 'event', event }),
						outcomeFrame('complete', ['wss://nos.lol'], []),
					]),
				),
			},
		)

		expect(result.products[0]?.relays).toEqual(['wss://nos.lol'])
	})

	test('attaches the listing’s own relays when the hit’s coordinate is not the canonical address', async () => {
		// The live shape: the index’s `coordinate` is a title-derived slug — a
		// `-<title bits><pubkey fragment>` suffix on the addressable `d` — so it
		// can never equal the delivered event’s canonical `30402:<pubkey>:<d>`.
		// Only `event_id` correlates the two. A fixture whose coordinate is
		// already canonical is self-confirming and would hide this.
		const event: NostrEventLike = {
			id: '0c5733242fd6453099812aa7972cf4d9b1ee41e2acbd3fb922eca4edd156d8dc',
			pubkey: PUBKEY,
			kind: 30402,
			created_at: 1_700_000_000,
			content: 'sneakers body',
			tags: [
				['d', 'orange-flock-urban-camo-sneakers-pn52ch'],
				['title', 'Orange Flock Urban Camo Sneakers'],
				['price', '2500', 'SATS'],
			],
		}

		const result = await rabbitholeSearch(
			{ q: 'sneakers' },
			{
				fetchImpl: fetchReturning(
					ndjsonResponse([
						JSON.stringify({
							type: 'search',
							candidateCount: 1,
							hits: [
								{
									coordinate: `30402:${PUBKEY}:orange-flock-urban-camo-sneakers-pn52ch-11-5-men-13-5-women-10dosx9`,
									event_id: event.id,
									relays_seen: ['wss://nos.lol', 'wss://relay.primal.net'],
								},
							],
						}),
						JSON.stringify({ type: 'event', event }),
						outcomeFrame('complete', ['wss://nos.lol', 'wss://relay.primal.net'], []),
					]),
				),
			},
		)

		expect(result.products[0]?.eventId).toBe(event.id)
		// The hit named its relays; the product must carry them despite the
		// coordinate mismatch.
		expect(result.products[0]?.relays).toEqual(['wss://nos.lol', 'wss://relay.primal.net'])
	})

	test('states no relays for a listing its index hit did not name', async () => {
		const result = await rabbitholeSearch(
			{ q: 'mug' },
			{
				fetchImpl: fetchReturning(
					ndjsonResponse([
						JSON.stringify({
							type: 'search',
							candidateCount: 1,
							hits: [{ coordinate: `30402:${PUBKEY}:other`, relays_seen: ['wss://nos.lol'] }],
						}),
						JSON.stringify({ type: 'event', event: productEvent('e1', 'Ceramic Mug') }),
						outcomeFrame('complete', ['wss://nos.lol'], []),
					]),
				),
			},
		)

		expect(result.products[0]?.relays).toBeUndefined()
	})

	test('states the facets of an indexOnly probe too (no outcome frame)', async () => {
		const result = await rabbitholeSearch(
			{ q: '', indexOnly: true, filters: ['category_tags = "bitcoin"'] },
			{
				fetchImpl: fetchReturning(
					ndjsonResponse([
						JSON.stringify({
							type: 'search',
							query: '',
							candidateCount: 160,
							hits: [],
							suggested: [{ field: 'currency', value: 'EUR', count: 5 }],
						}),
					]),
				),
			},
		)

		expect(result.suggested).toEqual([{ field: 'currency', value: 'EUR', count: 5, coverage: undefined, filter: undefined }])
	})

	test('accepts a filter-only request (empty query, an index filter)', async () => {
		let body: Record<string, unknown> | null = null
		const fetchImpl = (async (_url: string, init?: RequestInit) => {
			body = JSON.parse((init as RequestInit).body as string)
			return ndjsonResponse([JSON.stringify({ type: 'search', query: '', hits: [] }), outcomeFrame('complete', [], [])])
		}) as unknown as typeof fetch

		const result = await rabbitholeSearch({ q: '', filters: ['category_tags = "bitcoin"'], limit: 5 }, { fetchImpl })
		expect(body).toMatchObject({ q: '', filters: ['category_tags = "bitcoin"'] })
		expect(result.products).toEqual([])
	})

	test('still rejects an empty query with nothing to narrow it', async () => {
		await expect(rabbitholeSearch({ q: '   ' }, { fetchImpl: fetchReturning(ndjsonResponse([])) })).rejects.toMatchObject({
			code: 'bad-request',
		})
	})
})

// ---------------------------------------------------------------------------
// Progressive delivery — products handed over as they arrive
// ---------------------------------------------------------------------------

/** A stream whose later frames wait for the test: each enqueue is one read(). */
function gatedResponse(before: string[], after: string[]): { response: Response; open: () => void } {
	const encoder = new TextEncoder()
	let openGate: () => void = () => {}
	const gate = new Promise<void>((resolve) => {
		openGate = resolve
	})
	const body = new ReadableStream<Uint8Array>({
		async start(controller) {
			for (const line of before) controller.enqueue(encoder.encode(`${line}\n`))
			await gate
			for (const line of after) controller.enqueue(encoder.encode(`${line}\n`))
			controller.close()
		},
	})
	return { response: new Response(body), open: () => openGate() }
}

describe('rabbitholeSearch — progressive delivery', () => {
	test('hands each arrival to onProducts before the outcome frame is read', async () => {
		// The outcome frame does not exist on the wire until the callback has
		// fired: a client that collected everything and mapped it after the read
		// would deadlock here instead of passing.
		const stream = gatedResponse(
			[
				JSON.stringify({ type: 'search', candidateCount: 2, hits: [] }),
				JSON.stringify({ type: 'relay', relay: 'wss://a', state: 'querying' }),
				JSON.stringify({ type: 'event', event: productEvent('e1', 'Mug One') }),
				JSON.stringify({ type: 'event', event: productEvent('e2', 'Mug Two') }),
			],
			[
				JSON.stringify({ type: 'relay', relay: 'wss://a', state: 'answered' }),
				outcomeFrame('complete', ['wss://a'], []),
			],
		)

		const snapshots: Array<{ ids: string[]; eventsDelivered: number; complete: boolean }> = []
		const result = await rabbitholeSearch(
			{ q: 'mug' },
			{
				fetchImpl: fetchReturning(stream.response),
				onProducts: (products, stats) => {
					snapshots.push({ ids: products.map((product) => product.id), eventsDelivered: stats.eventsDelivered, complete: stats.complete })
					if (products.length === 2) stream.open()
				},
			},
		)

		expect(snapshots.length).toBeGreaterThan(0)
		// A snapshot is never a verdict, by type and by value.
		expect(snapshots.every((snapshot) => snapshot.complete === false)).toBe(true)
		// The first snapshot could state only what had arrived; the last one
		// states both products, before the read resolved.
		expect(snapshots[snapshots.length - 1]!.ids).toEqual(['e1', 'e2'])
		// And the settled result is the same two products.
		expect(result.products.map((product) => product.id)).toEqual(['e1', 'e2'])
	})

	test('a streamed product is the settled product — same mapper, same relays', async () => {
		const event = productEvent('e1', 'Ceramic Mug')
		const streamed: Array<unknown> = []
		const result = await rabbitholeSearch(
			{ q: 'mug' },
			{
				fetchImpl: fetchReturning(
					ndjsonResponse([
						JSON.stringify({
							type: 'search',
							candidateCount: 1,
							hits: [{ coordinate: `30402:${PUBKEY}:e1`, event_id: 'e1', relays_seen: ['wss://nos.lol'] }],
						}),
						JSON.stringify({ type: 'event', event }),
						outcomeFrame('complete', ['wss://nos.lol'], []),
					]),
				),
				onProducts: (products) => {
					if (products.length > 0) streamed.push(products[0])
				},
			},
		)

		expect(streamed.length).toBeGreaterThan(0)
		// Deep equality, not "looks the same": one mapping function feeds both.
		expect(streamed[streamed.length - 1]).toEqual(result.products[0])
		expect(result.products[0]?.relays).toEqual(['wss://nos.lol'])
	})

	test('withholds family rows from snapshots — a family is stated once, when settled', async () => {
		const address = `30402:${PUBKEY}:trail-runner`
		const parent: NostrEventLike = {
			id: 'family-parent',
			pubkey: PUBKEY,
			kind: 30402,
			created_at: 1_700_000_000,
			content: '',
			tags: [
				['d', 'trail-runner'],
				['type', 'variable'],
				['title', 'Trail Runner'],
				['price', '100', 'SATS'],
			],
		}
		const child = (size: number): NostrEventLike => ({
			id: `family-child-${size}`,
			pubkey: PUBKEY,
			kind: 30402,
			created_at: 1_700_000_000,
			content: '',
			tags: [
				['d', `trail-runner-${size}`],
				['type', 'variation'],
				['a', address],
				['spec', 'size', String(size)],
				['title', `Trail Runner ${size}`],
				['price', '100', 'SATS'],
			],
		})

		const snapshots: string[][] = []
		const result = await rabbitholeSearch(
			{ q: 'trail runner' },
			{
				fetchImpl: fetchReturning(
					ndjsonResponse([
						JSON.stringify({ type: 'search', candidateCount: 4, hits: [] }),
						JSON.stringify({ type: 'event', event: child(42) }),
						JSON.stringify({ type: 'event', event: child(43) }),
						JSON.stringify({ type: 'event', event: parent }),
						JSON.stringify({ type: 'event', event: productEvent('plain-mug', 'Plain Mug') }),
						outcomeFrame('complete', ['wss://a'], []),
					]),
				),
				onProducts: (products) => snapshots.push(products.map((product) => product.id)),
			},
		)

		// No snapshot ever states a family row: not the first child (which would
		// later be replaced by the parent), not two children, not a half family.
		expect(snapshots.length).toBeGreaterThan(0)
		for (const ids of snapshots) expect(ids).toEqual(ids.filter((id) => id === 'plain-mug'))
		// The non-family listing streams as it lands.
		expect(snapshots.some((ids) => ids.includes('plain-mug'))).toBe(true)
		// The family is stated exactly once, in the settled result.
		expect(result.products.map((product) => product.id).sort()).toEqual(['plain-mug', 'trail-runner'])
		expect(result.products.find((product) => product.id === 'trail-runner')?.variantCount).toBe(2)
	})

	test('the settled result is identical whether or not a callback is passed', async () => {
		const lines = [
			JSON.stringify({ type: 'search', candidateCount: 1, hits: [] }),
			JSON.stringify({ type: 'event', event: productEvent('e1', 'Mug') }),
			JSON.stringify({ type: 'relay', relay: 'wss://a', state: 'answered' }),
			outcomeFrame('partial', ['wss://a'], ['wss://b']),
		]
		const withCallback = await rabbitholeSearch(
			{ q: 'mug' },
			{ fetchImpl: fetchReturning(ndjsonResponse(lines)), onProducts: () => {} },
		)
		const withoutCallback = await rabbitholeSearch({ q: 'mug' }, { fetchImpl: fetchReturning(ndjsonResponse(lines)) })

		expect(withCallback).toEqual(withoutCallback)
		expect(withCallback.pending).toEqual(['wss://b'])
		expect(withCallback.incomplete).toBeUndefined()
	})

	test('a truncated read keeps what arrived on the error, for the caller to report as incomplete', async () => {
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				const encoder = new TextEncoder()
				controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'search', candidateCount: 1, hits: [] })}\n`))
				controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'event', event: productEvent('e1', 'Mug') })}\n`))
				controller.close() // no outcome frame
			},
		})

		const error = (await rabbitholeSearch({ q: 'mug' }, { fetchImpl: fetchReturning(new Response(body)) }).catch(
			(caught: unknown) => caught,
		)) as RabbitHoleError

		expect(error).toBeInstanceOf(RabbitHoleError)
		expect(error.code).toBe('truncated')
		// The products are real and must survive the cut.
		expect(error.partial?.products.map((product) => product.id)).toEqual(['e1'])
		expect(error.partial?.eventsDelivered).toBe(1)
	})

	test('a read that outlives its deadline keeps what arrived too', async () => {
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				const encoder = new TextEncoder()
				controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'search', candidateCount: 1, hits: [] })}\n`))
				controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'event', event: productEvent('e1', 'Mug') })}\n`))
				controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'relay', relay: 'wss://a', state: 'answered' })}\n`))
				// Never closes: the next read hangs until the deadline cancels it.
			},
		})

		const error = (await rabbitholeSearch(
			{ q: 'mug' },
			{ fetchImpl: fetchReturning(new Response(body)), timeoutMs: 40 },
		).catch((caught: unknown) => caught)) as RabbitHoleError

		expect(error.code).toBe('timeout')
		expect(error.partial?.products.map((product) => product.id)).toEqual(['e1'])
		expect(error.partial?.relaysAnswered).toEqual(['wss://a'])
	})

	test('the client deadline outlasts the service’s own total deadline', () => {
		// The defect this pins: the client gave up at 8 s on a service whose
		// config allows 12 s (total_deadline_ms), so every search with one slow
		// relay was cut off mid-stream by construction. The two numbers live in
		// two repositories; this is the only place they meet.
		expect(RABBITHOLE_SERVICE_TOTAL_DEADLINE_MS).toBe(12_000)
		expect(RABBITHOLE_TIMEOUT_HEADROOM_MS).toBeGreaterThan(0)
		expect(RABBITHOLE_DEFAULT_TIMEOUT_MS).toBe(RABBITHOLE_SERVICE_TOTAL_DEADLINE_MS + RABBITHOLE_TIMEOUT_HEADROOM_MS)
		expect(RABBITHOLE_DEFAULT_TIMEOUT_MS).toBeGreaterThan(RABBITHOLE_SERVICE_TOTAL_DEADLINE_MS)
		expect(RABBITHOLE_DEFAULT_TIMEOUT_MS).toBe(15_000)
	})
})

// ---------------------------------------------------------------------------
// The index frame paints the grid — before any relay event arrives
// ---------------------------------------------------------------------------

/** A `search`-frame hit as the service states it: the slim index document, no tags. */
function indexHit(id: string, title: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		coordinate: `30402:${PUBKEY}:${id}`,
		event_id: id,
		title,
		pubkey: PUBKEY,
		price_amount: 2500,
		currency: 'SATS',
		category_tags: ['pottery'],
		relays_seen: ['wss://nos.lol'],
		has_image: true,
		created_at: 1_700_000_000,
		...overrides,
	}
}

describe('rabbitholeSearch — the index frame paints the grid', () => {
	test('hands the search frame’s products over BEFORE an event frame is read', async () => {
		// The gate is the assertion: the outcome frame does not exist on the wire
		// until the callback has already received the three index rows, so a
		// client that waited for the relay events (or for the verdict) cannot
		// pass this — it hangs and then trips its own deadline.
		const stream = gatedResponse(
			[
				JSON.stringify({
					type: 'search',
					candidateCount: 3,
					hits: [indexHit('e1', 'Index Mug'), indexHit('e2', 'Index Bowl'), indexHit('e3', 'Index Plate')],
				}),
			],
			[
				JSON.stringify({ type: 'event', event: productEvent('e1', 'Index Mug') }),
				JSON.stringify({ type: 'event', event: productEvent('e2', 'Index Bowl') }),
				JSON.stringify({ type: 'event', event: productEvent('e3', 'Index Plate') }),
				outcomeFrame('complete', ['wss://nos.lol'], []),
			],
		)

		const snapshots: Array<{ ids: string[]; eventsDelivered: number; relaysSeen: number; complete: boolean }> = []
		const paintedBeforeAnyEvent: string[] = []

		const result = await rabbitholeSearch(
			{ q: 'mug' },
			{
				fetchImpl: fetchReturning(stream.response),
				onProducts: (products, stats) => {
					snapshots.push({
						ids: products.map((product) => product.id),
						eventsDelivered: stats.eventsDelivered,
						relaysSeen: stats.relaysSeen.length,
						complete: stats.complete,
					})
					if (products.length === 3 && paintedBeforeAnyEvent.length === 0) {
						paintedBeforeAnyEvent.push(...products.map((product) => product.id))
						stream.open()
					}
				},
			},
		)

		// Three cards, painted from the index alone: no event had been read yet.
		expect(paintedBeforeAnyEvent).toEqual(['e1', 'e2', 'e3'])
		const first = snapshots[0]!
		expect(first.eventsDelivered).toBe(0)
		expect(first.relaysSeen).toBe(0)
		// A snapshot is still never a verdict, by type and by value.
		expect(snapshots.every((snapshot) => snapshot.complete === false)).toBe(true)
		expect(snapshots.every((snapshot) => snapshot.ids.length === 3)).toBe(true)

		// The relay events ENRICH those same rows rather than replacing the set:
		// one card each, in the index's own order.
		expect(result.products.map((product) => product.id)).toEqual(['e1', 'e2', 'e3'])
	})

	test('a frame-painted card and the settled card agree on everything the index states', async () => {
		// The hard requirement, stated as an assertion: one mapper, so the two
		// paintings of the same listing cannot disagree on the fields the index
		// carries. Only what the slim hit cannot know may differ — and it may
		// only FILL IN, never retract.
		const stream = gatedResponse(
			[JSON.stringify({ type: 'search', candidateCount: 1, hits: [indexHit('e1', 'Ceramic Mug')] })],
			[
				JSON.stringify({ type: 'event', event: productEvent('e1', 'Ceramic Mug') }),
				outcomeFrame('complete', ['wss://nos.lol'], []),
			],
		)

		const painted: BrowseProduct[] = []
		const result = await rabbitholeSearch(
			{ q: 'mug' },
			{
				fetchImpl: fetchReturning(stream.response),
				onProducts: (products) => {
					if (products.length > 0 && painted.length === 0) {
						painted.push({ ...products[0]! })
						stream.open()
					}
				},
			},
		)

		const firstPaint = painted[0]!
		const settled = result.products[0]!
		// Every field the hit states, identical on both cards.
		expect(firstPaint).toMatchObject({
			id: settled.id,
			eventId: settled.eventId,
			pubkey: settled.pubkey,
			title: settled.title,
			price: settled.price,
			currency: settled.currency,
			categories: settled.categories,
			relays: settled.relays,
		})
		expect(firstPaint).toMatchObject({ id: 'e1', eventId: 'e1', title: 'Ceramic Mug', price: 2500, currency: 'SATS', categories: ['pottery'] })
		// What the index does not carry is ABSENT, not invented — the settled
		// card adds it when the event lands.
		expect(firstPaint?.stock).toBeUndefined()
		expect(firstPaint?.location).toBeUndefined()
		expect(settled.stock).toBe('3')
	})

	test('a caller that does not opt in sees the settled result unchanged — hits alone are not products', async () => {
		// Requirement: the resolved shape stays what it was for a caller that
		// never asked to paint early. `ghost` is an index hit whose event never
		// arrives; it may be PAINTED, but it is not a product of a settled read.
		const lines = [
			JSON.stringify({ type: 'search', candidateCount: 2, hits: [indexHit('e1', 'Index Mug'), indexHit('ghost', 'Ghost Mug')] }),
			JSON.stringify({ type: 'event', event: productEvent('e1', 'Index Mug') }),
			outcomeFrame('complete', ['wss://nos.lol'], []),
		]

		const optedOut = await rabbitholeSearch({ q: 'mug' }, { fetchImpl: fetchReturning(ndjsonResponse(lines)) })
		expect(optedOut.products.map((product) => product.id)).toEqual(['e1'])

		// …while the caller that DID opt in keeps the card it was shown, so the
		// grid does not lose a listing at the moment the read settles.
		const optedIn = await rabbitholeSearch({ q: 'mug' }, { fetchImpl: fetchReturning(ndjsonResponse(lines)), onProducts: () => {} })
		expect(optedIn.products.map((product) => product.id)).toEqual(['e1', 'ghost'])
		// The verdict itself is untouched by the opt-in.
		expect(optedIn.eose).toEqual(optedOut.eose)
	})
})
