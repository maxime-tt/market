import { serve, type Server } from 'bun'
import { buildBrowseSearchRoutes } from './http/browseSearch'
import { configRoutes } from './http/config'
import { nip05Routes } from './http/nip05'
import { ogRoutes } from './http/og'
import { staticRoutes } from './http/static'
import { zapPurchaseRoutes } from './http/zapPurchase'
import { PORT } from './runtime'
import { websocketHandler } from './websocket'
import type { BunRoutes } from './http/types'
import { buildAnalyticsRoutes } from './http/analytics'
import { buildAuctionsProtocolRoutes } from './http/auctionsProtocol'
import { buildAppEventsRoutes, createLevelLookup } from './http/appEvents'
import { COMPILED_IN_NAMES } from '@sdk/config/routeNames'
import { resolve } from './routes/resolve'
import { composePageHtml, composeRenderPlaceholder } from './routes/pageHtml'
import { createPageStore, type PageStore } from './routes/pageStore'
import type { RoutesFile } from './routes/routeFile'

/**
 * Compose the Bun HTTP/WebSocket server. Routes are merged from each
 * domain's plain `BunRoutes` record. The SPA index.html fallback
 * (`'/*'`) is provided by the entrypoint that owns the build artefact —
 * we accept it as an argument so this module stays free of asset imports.
 *
 * Routing (increment 1): the routing file is loaded once by the entrypoint
 * and passed in. Every bound path, programmed prefix and compiled-in segment
 * is registered before the `':name'` catch and the `'/*'` SPA fallback, so an
 * unmatched single-segment path is a real 404 — the visible change rung 3 is
 * for. Multi-segment client routes still fall through to the SPA, which is
 * the pre-existing behaviour and is extended in increment 3.
 */
export interface BuildServerOptions {
	/**
	 * SPA shell — typically `import index from './index.html'` from the
	 * entrypoint. Bun's `HTMLBundle` is a valid `RouteValue` for the
	 * catch-all `'/*'`, but its type lives in `bun.d.ts` and isn't useful
	 * to import here, so we accept anything Bun's route record will take.
	 */
	indexHtml: unknown
	/** Loaded once at boot; an unreadable file refuses boot before we get here. */
	routing: RoutesFile
	pageStore?: PageStore
}

export interface ContentRoutesOptions {
	routing: RoutesFile
	pageStore: PageStore
	indexHtml: unknown
	/** Unix seconds; injected so a lapsed lease can be asserted at expiry + 1. */
	now?: () => number
}

const html = (body: string, status = 200): Response =>
	new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } })

/**
 * The route table for pages. Exported so the serve path can be exercised
 * without `serve()` and without the relay-dependent runtime.
 */
export function buildContentRoutes({
	routing,
	pageStore,
	indexHtml,
	now = () => Math.floor(Date.now() / 1000),
}: ContentRoutesOptions): BunRoutes {
	const routes: BunRoutes = {}
	const boundPaths = new Set(routing.bindings.map((binding) => binding.path))

	const servePath = (request: Request): Response => {
		const url = new URL(request.url)
		const resolution = resolve(routing, url.pathname, now())

		if (resolution.status === 404)
			return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } })

		if (resolution.outcome === 'render') {
			return html(composeRenderPlaceholder(resolution.target, resolution.params))
		}

		if (resolution.outcome === 'compiled-in') {
			// Compiled-in segments are registered as static routes; a handler
			// reaching here cannot delegate to Bun's HTMLBundle, so it is not a
			// path this table serves.
			return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } })
		}

		const page = pageStore.get(resolution.target.author, resolution.target.d)
		if (!page) {
			// Routing succeeded; the binding's target is missing. That is 500 with
			// a named error — never 404, which stays reserved for "no binding matched".
			return html(
				`<!doctype html><html><head><title>Page unavailable</title></head><body><h1>binding-target-missing</h1><p>No stored page at (${resolution.target.author}, ${resolution.target.d}).</p></body></html>`,
				500,
			)
		}

		return html(
			composePageHtml({
				meta: page.meta,
				html: page.html,
				payload: { author: resolution.target.author, d: resolution.target.d, version: 1 },
				path: url.pathname.replace(/\/+$/, '') || '/',
			}),
		)
	}

	// Rung 1: one literal route per binding. The handler still re-resolves on
	// every request so a lease that lapses while the process runs 404s.
	for (const binding of routing.bindings) {
		routes[`/${binding.path}`] = { GET: servePath }
	}

	// Rung 1b: compiled-in pages with no binding keep their compiled page. A
	// binding on the same name is already registered above and wins.
	for (const name of COMPILED_IN_NAMES) {
		if (!boundPaths.has(name)) routes[`/${name}`] = indexHtml as BunRoutes[string]
	}

	// Rung 2: programmed prefixes. Bun's `:param` segments carry the value.
	for (const prefix of routing.prefixes) {
		routes[`/${prefix.pattern}`] = { GET: servePath }
	}

	// Any other single-segment path is resolved (and 404s) rather than being
	// handed the SPA shell. Multi-segment paths still reach the shell below.
	routes['/:name'] = { GET: servePath }
	routes['/*'] = indexHtml as BunRoutes[string]

	return routes
}

export function buildServer({ indexHtml, routing, pageStore = createPageStore() }: BuildServerOptions): Server<undefined> {
	// Auction issuer endpoints used to live on this HTTP server
	// (`/api/auctions/path-request`, `/api/auctions/settlement-plan`).
	// They've moved to ContextVM `tools/call` over Nostr — see
	// `contextvm/server.ts` and AUCTIONS.md §4.5 / §7.5. The bun web
	// server only serves the SPA, the config endpoint, zap purchase,
	// static assets, the ingest endpoint and routed pages now.
	const routes: BunRoutes = {
		...configRoutes,
		...zapPurchaseRoutes,
		...nip05Routes,
		...staticRoutes,
		// Browse search proxy — mounted only when the instance selects the
		// `rabbithole` provider; an empty record (nothing mounted) by default.
		...buildBrowseSearchRoutes(),
		// Auctions backend read surface (loopback demo on this box).
		...buildAuctionsProtocolRoutes(),
		// What this instance may report: page views only, environment-gated.
		...buildAnalyticsRoutes(),
		// The one write-restricted ingest surface.
		...buildAppEventsRoutes({ pageStore, levelOf: createLevelLookup() }),
		// Product pages get og: meta tags server-rendered into the initial
		// HTML (issue #459) — must beat the catch-all below.
		...ogRoutes(indexHtml),
		// The routing table, pages routes and the SPA fallback. Registered last
		// so every explicit API/static route above still wins.
		...buildContentRoutes({ routing, pageStore, indexHtml }),
	}

	console.log(`App port: ${PORT}`)

	// Bun's `serve` route record carries per-path generic typing
	// (`Routes<WebSocketData, R>` parameterised by literal path strings).
	// Our merged record erases those literals — perfectly fine at runtime
	// but unhelpful to typecheck — so we cast at the call site.
	//
	// We also pin `WebSocketData = undefined` explicitly so `server.upgrade`
	// has the no-options arity it had before the refactor.
	return serve<undefined, never>({
		port: PORT,
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		routes: routes as any,
		development: process.env.NODE_ENV !== 'production',
		fetch(req, server) {
			if (server.upgrade(req)) {
				return new Response()
			}
			return new Response('Upgrade failed', { status: 500 })
		},
		// @ts-ignore — Bun WebSocket handler typing is currently loose.
		websocket: websocketHandler,
	})
}
