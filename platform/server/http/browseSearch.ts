import type { BrowseSearchProvider, BrowseSearchPublicConfig } from '@platform/browseSearchConfig'
import type { BunRoutes } from './types'

/**
 * platform/server/http/browseSearch.ts — the browse-search server surface: the
 * settings read from the server's environment, and the same-origin streaming
 * proxy that makes the RabbitHole service reachable from an ordinary browser.
 *
 * Two facts shape this module:
 *
 *   1. The search client runs in the BROWSER, and the service binds loopback on
 *      the SERVER's box. `http://127.0.0.1:7711` in a visitor's browser is the
 *      visitor's own machine, so a remote test can never reach the service
 *      directly. The proxy mounts the service under the app's own origin
 *      instead (plan §5 + owner note 2026-11-06, option 1: "same box, loopback,
 *      proxied under the existing app hostname").
 *   2. The service answers ONE request with ONE streamed NDJSON response whose
 *      frames must arrive as they are produced (`rabbitholeClient.ts` reads the
 *      body chunk by chunk). The proxy therefore hands the upstream
 *      `ReadableStream` straight back — it never buffers the body.
 *
 * Default-off: with no environment set the provider resolves to `local` and
 * {@link buildBrowseSearchRoutes} mounts nothing at all.
 */

/** Selects the provider. Anything other than `rabbithole` (case-insensitive) means `local`. */
export const BROWSE_SEARCH_PROVIDER_ENV = 'BROWSE_SEARCH_PROVIDER'

/** The upstream search API base the proxy forwards to (server-side, on this box). */
export const BROWSE_SEARCH_UPSTREAM_ENV = 'BROWSE_SEARCH_UPSTREAM_URL'

/** The upstream service binds loopback on the app's own box; public exposure is a reverse-proxy decision for the owner. */
export const BROWSE_SEARCH_DEFAULT_UPSTREAM = 'http://127.0.0.1:7711'

/** The same-origin path the proxy is mounted under — and therefore the base the browser posts to. */
export const BROWSE_SEARCH_PROXY_PREFIX = '/api/browse-search'

/** The environment map the settings are read from (`process.env` in production). */
export type BrowseSearchEnv = Record<string, string | undefined>

/**
 * Resolve the browse-search settings from the server's environment.
 *
 * Unset — or any value other than `rabbithole` — resolves to `local`, which is
 * exactly the behaviour the instance had before this switch existed.
 */
export function resolveBrowseSearchSettings(env: BrowseSearchEnv = process.env): BrowseSearchPublicConfig {
	const provider: BrowseSearchProvider = env[BROWSE_SEARCH_PROVIDER_ENV]?.trim().toLowerCase() === 'rabbithole' ? 'rabbithole' : 'local'
	if (provider === 'local') return { provider }

	return {
		provider,
		baseUrl: BROWSE_SEARCH_PROXY_PREFIX,
		// A trailing slash would double the separator when a path is appended.
		upstream: (env[BROWSE_SEARCH_UPSTREAM_ENV]?.trim() || BROWSE_SEARCH_DEFAULT_UPSTREAM).replace(/\/+$/, ''),
	}
}

/**
 * The proxy's routes: the same-origin path, mounted only when the provider is
 * `rabbithole`. Returns an empty record otherwise, so `buildServer` spreads
 * nothing and the app owns no browse-search route at all by default.
 */
export function buildBrowseSearchRoutes(env: BrowseSearchEnv = process.env): BunRoutes {
	const settings = resolveBrowseSearchSettings(env)
	if (settings.provider !== 'rabbithole' || !settings.upstream) return {}

	const upstream = settings.upstream
	const handler = (request: Request): Promise<Response> => proxyBrowseSearchRequest(request, upstream)
	return {
		[BROWSE_SEARCH_PROXY_PREFIX]: handler,
		[`${BROWSE_SEARCH_PROXY_PREFIX}/*`]: handler,
	}
}

/**
 * Forward one request to the upstream search API and hand its response back
 * unbuffered: the returned `Response` is built around the upstream
 * `ReadableStream`, so each NDJSON frame reaches the browser as it arrives.
 * Only the RESPONSE is streamed — a search request is a bounded JSON document
 * (≤512-char query), so it is read whole and sent as a buffer.
 *
 * Only the framing `content-type` crosses back on the response. The body is
 * already decoded by `fetch`, so forwarding `content-encoding`/`content-length`
 * would misdescribe the stream handed out; `cache-control: no-store` keeps a
 * streamed search out of any cache.
 *
 * The target is built by appending the request's path to the configured
 * upstream base, with leading separators stripped — a request can reach a path
 * on the upstream origin and nothing else (a `//host` or `http://host` suffix
 * cannot escape it).
 */
async function proxyBrowseSearchRequest(request: Request, upstreamBase: string): Promise<Response> {
	const url = new URL(request.url)
	const suffix = url.pathname.slice(BROWSE_SEARCH_PROXY_PREFIX.length).replace(/^[/\\]+/, '')

	let target: URL
	try {
		// Trailing slash stripped so `base + '/' + suffix` never doubles the separator.
		target = new URL(`${upstreamBase.replace(/\/+$/, '')}/${suffix}${url.search}`)
	} catch {
		return Response.json({ error: `Browse search upstream is not a valid URL: ${upstreamBase}` }, { status: 502 })
	}

	const forwardBody = request.method !== 'GET' && request.method !== 'HEAD'

	let upstreamResponse: Response
	try {
		upstreamResponse = await fetch(target, {
			method: request.method,
			headers: forwardRequestHeaders(request.headers, forwardBody),
			body: forwardBody ? await request.arrayBuffer() : undefined,
		})
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		return Response.json({ error: `Browse search upstream unreachable: ${message}` }, { status: 502 })
	}

	return new Response(upstreamResponse.body, {
		status: upstreamResponse.status,
		headers: {
			'content-type': upstreamResponse.headers.get('content-type') ?? 'application/x-ndjson',
			'cache-control': 'no-store',
		},
	})
}

/** The request headers worth forwarding: the content type, and nothing that describes a body we re-frame. */
function forwardRequestHeaders(headers: Headers, withBody: boolean): Headers {
	const forwarded = new Headers()
	const contentType = headers.get('content-type')
	if (withBody && contentType) forwarded.set('content-type', contentType)
	const accept = headers.get('accept')
	if (accept) forwarded.set('accept', accept)
	return forwarded
}
