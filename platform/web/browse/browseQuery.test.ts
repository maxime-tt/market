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

let localStreamCalls = 0

mock.module('@platform/web/readContext', () => ({
	getReadContext: () => ({
		stream: async function* (_filters: readonly EventFilter[]): AsyncIterable<EventStreamItem<NostrEventLike>> {
			localStreamCalls++
			// Yield the canned local events, then the caught-up marker.
			for (const event of localEvents) yield { type: 'event', event }
			yield { type: 'caught-up', info: { eose: ['wss://local'], pending: [], complete: true } }
		},
		fetch: async (_filters: readonly EventFilter[]) => localEvents,
		store: {},
	}),
}))

import { browseSearchQueryOptions, configureBrowseSearch, getBrowseSearchProvider, type BrowseSearchResult } from './browseQuery'

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
