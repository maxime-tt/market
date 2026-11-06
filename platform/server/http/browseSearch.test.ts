/**
 * platform/server/http/browseSearch.test.ts — the browse-search server surface.
 *
 * Two things are pinned here:
 *
 *   - the environment default is `local` and the proxy is NOT mounted, so an
 *     unconfigured instance keeps the exact behaviour it had before the switch;
 *   - when the provider is `rabbithole`, the proxy forwards to the configured
 *     upstream and streams the body back in MORE THAN ONE READ — the frames must
 *     reach the client as they arrive, exactly as they do against the direct API.
 */

import { afterEach, describe, expect, test } from 'bun:test'
import {
	BROWSE_SEARCH_DEFAULT_UPSTREAM,
	BROWSE_SEARCH_PROXY_PREFIX,
	buildBrowseSearchRoutes,
	resolveBrowseSearchSettings,
} from './browseSearch'

const realFetch = globalThis.fetch

afterEach(() => {
	globalThis.fetch = realFetch
})

type ProxyHandler = (request: Request) => Promise<Response>

/** The route record's value type is the `BunRouteValue` union; this test knows it just built a function. */
function proxyHandler(env: Record<string, string | undefined>): ProxyHandler {
	return buildBrowseSearchRoutes(env)[`${BROWSE_SEARCH_PROXY_PREFIX}/*`] as unknown as ProxyHandler
}

interface Forwarded {
	url: string
	method: string
	headers: Headers
	/** The forwarded request body, decoded (the proxy sends an ArrayBuffer). */
	body: string | null
}

/** Point global `fetch` at a canned upstream response and record what the proxy forwarded. */
function stubUpstream(respond: (forwarded: Forwarded) => Response): Forwarded {
	const forwarded: Forwarded = { url: '', method: '', headers: new Headers(), body: null }
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		forwarded.url = String(input)
		forwarded.method = init?.method ?? 'GET'
		forwarded.headers = new Headers(init?.headers)
		forwarded.body = init?.body instanceof ArrayBuffer ? new TextDecoder().decode(init.body) : null
		return respond(forwarded)
	}) as unknown as typeof fetch
	return forwarded
}

// ---------------------------------------------------------------------------
// The settings read from the server's environment
// ---------------------------------------------------------------------------

describe('resolveBrowseSearchSettings — the environment surface', () => {
	test('unset means local — the default path is untouched', () => {
		expect(resolveBrowseSearchSettings({})).toEqual({ provider: 'local' })
	})

	test('an unrecognised value still means local', () => {
		expect(resolveBrowseSearchSettings({ BROWSE_SEARCH_PROVIDER: '' })).toEqual({ provider: 'local' })
		expect(resolveBrowseSearchSettings({ BROWSE_SEARCH_PROVIDER: 'rabbit-hole' })).toEqual({ provider: 'local' })
		expect(resolveBrowseSearchSettings({ BROWSE_SEARCH_PROVIDER: 'remote' })).toEqual({ provider: 'local' })
	})

	test('rabbithole selects the same-origin base and the loopback upstream', () => {
		expect(resolveBrowseSearchSettings({ BROWSE_SEARCH_PROVIDER: 'rabbithole' })).toEqual({
			provider: 'rabbithole',
			baseUrl: BROWSE_SEARCH_PROXY_PREFIX,
			upstream: BROWSE_SEARCH_DEFAULT_UPSTREAM,
		})
		// The provider name is not case-sensitive.
		expect(resolveBrowseSearchSettings({ BROWSE_SEARCH_PROVIDER: 'RabbitHole' }).provider).toBe('rabbithole')
	})

	test('a configured upstream wins, with a trailing slash stripped', () => {
		expect(
			resolveBrowseSearchSettings({
				BROWSE_SEARCH_PROVIDER: 'rabbithole',
				BROWSE_SEARCH_UPSTREAM_URL: 'http://127.0.0.1:9001/',
			}).upstream,
		).toBe('http://127.0.0.1:9001')
	})
})

// ---------------------------------------------------------------------------
// Mounting — nothing at all unless the provider is rabbithole
// ---------------------------------------------------------------------------

describe('buildBrowseSearchRoutes — mounted only for rabbithole', () => {
	test('the local provider mounts no route', () => {
		expect(buildBrowseSearchRoutes({})).toEqual({})
		expect(buildBrowseSearchRoutes({ BROWSE_SEARCH_PROVIDER: 'local' })).toEqual({})
		expect(buildBrowseSearchRoutes({ BROWSE_SEARCH_PROVIDER: 'rabbit' })).toEqual({})
	})

	test('the rabbithole provider mounts the proxy on both the bare prefix and its subtree', () => {
		const routes = buildBrowseSearchRoutes({ BROWSE_SEARCH_PROVIDER: 'rabbithole' })
		expect(Object.keys(routes).sort()).toEqual([BROWSE_SEARCH_PROXY_PREFIX, `${BROWSE_SEARCH_PROXY_PREFIX}/*`].sort())
	})
})

// ---------------------------------------------------------------------------
// Forwarding
// ---------------------------------------------------------------------------

describe('the browse-search proxy', () => {
	test('forwards method, path, query, body, and content type to the upstream', async () => {
		const forwarded = stubUpstream(
			() => new Response('{"type":"search"}\n', { status: 200, headers: { 'content-type': 'application/x-ndjson' } }),
		)

		const response = await proxyHandler({ BROWSE_SEARCH_PROVIDER: 'rabbithole' })(
			new Request('http://app.test/api/browse-search/search?q=mug', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: '{"q":"mug"}',
			}),
		)

		expect(forwarded.url).toBe('http://127.0.0.1:7711/search?q=mug')
		expect(forwarded.method).toBe('POST')
		expect(forwarded.headers.get('content-type')).toBe('application/json')
		expect(forwarded.body).toBe('{"q":"mug"}')
		expect(response.status).toBe(200)
		expect(response.headers.get('content-type')).toBe('application/x-ndjson')
		expect(response.headers.get('cache-control')).toBe('no-store')
	})

	test('a configured upstream is the forwarding target', async () => {
		const forwarded = stubUpstream(() => new Response('ok', { status: 200 }))
		await proxyHandler({
			BROWSE_SEARCH_PROVIDER: 'rabbithole',
			BROWSE_SEARCH_UPSTREAM_URL: 'http://127.0.0.1:9001',
		})(new Request('http://app.test/api/browse-search/health'))

		expect(forwarded.url).toBe('http://127.0.0.1:9001/health')
	})

	test('a path suffix cannot move the request off the upstream origin', async () => {
		const forwarded = stubUpstream(() => new Response('ok', { status: 200 }))
		await proxyHandler({ BROWSE_SEARCH_PROVIDER: 'rabbithole' })(new Request('http://app.test/api/browse-search//evil.test/steal'))

		expect(forwarded.url).toBe('http://127.0.0.1:7711/evil.test/steal')
	})

	test('a dead upstream answers 502 rather than throwing', async () => {
		globalThis.fetch = (async () => {
			throw new TypeError('fetch failed')
		}) as unknown as typeof fetch

		const response = await proxyHandler({ BROWSE_SEARCH_PROVIDER: 'rabbithole' })(
			new Request('http://app.test/api/browse-search/search', { method: 'POST', body: '{}' }),
		)
		const body: unknown = await response.json()

		expect(response.status).toBe(502)
		if (typeof body !== 'object' || body === null || !('error' in body) || typeof body.error !== 'string') {
			throw new Error('expected a JSON error body')
		}
		expect(body.error).toContain('unreachable')
	})
})

// ---------------------------------------------------------------------------
// Streaming — the whole point of the proxy
// ---------------------------------------------------------------------------

describe('the browse-search proxy streams', () => {
	test('a chunked upstream response reaches the caller in more than one read', async () => {
		const encoder = new TextEncoder()
		const frames = ['{"type":"search"}\n', '{"type":"event","sequence":1}\n', '{"type":"outcome","status":"complete"}\n']
		let produced = 0
		// `pull` produces ONE frame per demand: if the proxy buffered the body,
		// the caller would see a single read; a pass-through yields one read per
		// frame, and the first frame arrives while later ones do not yet exist.
		const upstreamBody = new ReadableStream<Uint8Array>({
			pull(controller) {
				if (produced >= frames.length) {
					controller.close()
					return
				}
				controller.enqueue(encoder.encode(frames[produced]))
				produced++
			},
		})
		stubUpstream(() => new Response(upstreamBody, { status: 200, headers: { 'content-type': 'application/x-ndjson' } }))

		const response = await proxyHandler({ BROWSE_SEARCH_PROVIDER: 'rabbithole' })(
			new Request('http://app.test/api/browse-search/search', { method: 'POST', body: '{"q":"mug"}' }),
		)

		const reader = response.body!.getReader()
		const decoder = new TextDecoder()
		const reads: string[] = []
		while (true) {
			const { done, value } = await reader.read()
			if (done) break
			reads.push(decoder.decode(value, { stream: true }))
		}

		// One read per frame: a proxy that buffered the body would deliver a
		// single read, and the frames would not be separately observable.
		expect(reads.length).toBe(frames.length)
		expect(reads.join('')).toBe(frames.join(''))
	})
})
