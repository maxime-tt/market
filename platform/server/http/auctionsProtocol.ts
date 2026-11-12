import type { BunRoutes } from './types'

/**
 * platform/server/http/auctionsProtocol.ts — the auctions backend's read
 * surface, proxied under the app's own origin.
 *
 * The demo binds loopback on this box (`127.0.0.1:8080`), so a browser can never
 * reach it directly: `127.0.0.1` in a visitor's browser is the visitor's own
 * machine. The proxy mounts the parts the UI needs under the app's origin, the
 * same way `browseSearch.ts` mounts the search service.
 *
 * Only what the Catalogue surface reads is exposed: the committed state, the
 * network config, and the coordinator's custodial-reservation receipt. Publishing
 * still happens through the relay (the observer transports auction kinds), which
 * is why there is no event-forwarding route here — a `POST`ed envelope would be
 * a `400` at the backend and, worse, would look like it worked.
 *
 * The money is fake (`FAKE_MONEY_ONLY`): the config carries that profile and any
 * UI built on this must say so.
 */

export const AUCTIONS_UPSTREAM_ENV = 'AUCTIONS_PROTOCOL_UPSTREAM_URL'

/** The demo binds loopback on this box; public exposure is a reverse-proxy decision. */
export const AUCTIONS_UPSTREAM_DEFAULT = 'http://127.0.0.1:8080'

export const AUCTIONS_STATE_PATH = '/api/auctions/state'
export const AUCTIONS_CONFIG_PATH = '/api/auctions/config'
export const AUCTIONS_RESERVATION_PATH = '/api/auctions/reservation'
export const AUCTIONS_EVENT_PATH = '/api/auctions/event'

type Env = Record<string, string | undefined>

function upstreamBase(env: Env): string {
	const raw = env[AUCTIONS_UPSTREAM_ENV]?.trim()
	return (raw && raw.length > 0 ? raw : AUCTIONS_UPSTREAM_DEFAULT).replace(/\/+$/, '')
}

async function forward(base: string, path: string, init?: RequestInit): Promise<Response> {
	try {
		const upstream = await fetch(base + path, init)
		// Pass the body through untouched: the state document is large and the
		// client parses it as-is, so buffering would only add latency and could
		// turn a relay-side error body into a mystery.
		return new Response(upstream.body, {
			status: upstream.status,
			headers: {
				'content-type': upstream.headers.get('content-type') ?? 'application/json',
				'cache-control': 'no-store',
			},
		})
	} catch (err) {
		return Response.json(
			{
				error: 'auctions_upstream_unreachable',
				message: err instanceof Error ? err.message : String(err),
			},
			{ status: 502 },
		)
	}
}

export function buildAuctionsProtocolRoutes(env: Env = process.env): BunRoutes {
	const base = upstreamBase(env)
	return {
		[AUCTIONS_STATE_PATH]: {
			GET: () => forward(base, '/api/state'),
		},
		[AUCTIONS_CONFIG_PATH]: {
			GET: () => forward(base, '/api/config'),
		},
		[AUCTIONS_EVENT_PATH]: {
			// The relay binds loopback too, and it is ephemeral: a browser cannot
			// reach it, and an event published with nobody listening is gone. The
			// backend's HTTP door takes the BARE signed event (no envelope — the
			// decoder uses DisallowUnknownFields), so the body is forwarded
			// verbatim and never wrapped.
			POST: (request: Request) =>
				forward(base, '/api/event', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: request.body,
				}),
		},
		[AUCTIONS_RESERVATION_PATH]: {
			// The receipt describes one auction, bidder and amount; forward the
			// body verbatim so the backend's own validation is the only authority.
			POST: (request: Request) =>
				forward(base, '/api/demo/reservation', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: request.body,
				}),
		},
	}
}
