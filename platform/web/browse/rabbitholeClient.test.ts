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
import { clampRabbitHoleLimit, rabbitholeSearch, RabbitHoleError, RABBITHOLE_LIMITS } from './rabbitholeClient'

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

function outcomeFrame(status: 'complete' | 'partial', answered: string[], failed: string[]): string {
	return JSON.stringify({
		type: 'outcome',
		status,
		outcome: {
			relaysQueried: [...answered, ...failed],
			relaysAnswered: answered,
			relaysFailed: failed,
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
