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
import { buildRouteTableRoutes } from './http/routeTable'
import { resolve } from './routes/resolve'
import { composePageHtml, composeRenderPlaceholder } from './routes/pageHtml'
import { createPageStore, type PageStore } from './routes/pageStore'
import { createShellResponder } from './routes/shell'
import type { RouteTable } from './routes/routeTable'

/**
 * Compose the Bun HTTP/WebSocket server. Routes are merged from each
 * domain's plain `BunRoutes` record. The SPA index.html fallback
 * (`'/*'`) is provided by the entrypoint that owns the build artefact —
 * we accept it as an argument so this module stays free of asset imports.
 *
 * Routing (increment 2): the table is a *live* object, not a snapshot. The
 * entrypoint loads it at boot and passes it in; every handler resolves against
 * `table.current()` when the request arrives, so a binding authored over
 * `POST /api/app-events` is served by the next request with no restart.
 *
 * Registration order still decides which handler a URL reaches — boot bindings
 * and programmed prefixes get their own literal routes, then `':name'`, then
 * the SPA — but it no longer decides *whether* a binding is honoured. The
 * compiled-in names are deliberately not registered as static shell routes any
 * more: they flow through `':name'` so that rung 1 (an exact binding) can
 * supersede a compiled-in page at request time, which is ruling 3 applied to a
 * table that changes while the process runs.
 */
export interface BuildServerOptions {
	/**
	 * SPA shell — typically `import index from './index.html'` from the
	 * entrypoint. Bun's `HTMLBundle` is a valid `RouteValue` for the
	 * catch-all `'/*'`, but its type lives in `bun.d.ts` and isn't useful
	 * to import here, so we accept anything Bun's route record will take.
	 */
	indexHtml: unknown
	/** Loaded once at boot, then mutated by route intents; unreadable refuses boot. */
	routing: RouteTable
	pageStore?: PageStore
}

export interface ContentRoutesOptions {
	routing: RouteTable
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
	// The shell, as a Response a handler may return. One self-request per boot
	// when `indexHtml` is the Bun HTML bundle; a clone per request otherwise.
	const shell = createShellResponder({ indexHtml, fetchShell: () => fetch(`http://127.0.0.1:${PORT}/`) })

	const servePath = async (request: Request): Promise<Response> => {
		const url = new URL(request.url)
		// Read the table per request: this is what makes an authored binding live.
		const resolution = resolve(routing.current(), url.pathname, now())

		if (resolution.status === 404)
			return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } })

		if (resolution.outcome === 'render') {
			return html(composeRenderPlaceholder(resolution.target, resolution.params))
		}

		if (resolution.outcome === 'compiled-in') {
			// Rung 1b: no binding claims this compiled-in name, so the SPA shell
			// answers — the same bytes the `'/*'` route would have returned.
			try {
				return await shell()
			} catch (error) {
				const detail = error instanceof Error ? error.message : String(error)
				return html(
					`<!doctype html><html><head><title>Page unavailable</title></head><body><h1>spa-shell-unavailable</h1><p>${detail}</p></body></html>`,
					500,
				)
			}
		}

		const page = pageStore.get(resolution.target.author, resolution.target.d)
		// A stored page is servable only while the author has it switched on.
		// `enabled: false` is the unpublish: the store keeps the document (so
		// the author loses no blocks — ADR-019 R6) but a bound path must stop
		// answering with a withdrawn page, or an unpublish that reached only
		// relays would leave this instance serving it.
		if (!page || page.document?.enabled !== true) {
			// Routing succeeded; the binding's target is missing (never stored,
			// or stored but switched off). That is 500 with a named error —
			// never 404, which stays reserved for "no binding matched".
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

	// Bindings that exist at boot keep their own literal routes. A subpath
	// binding (`a/b`) has no other way to be reached; the top-level ones are
	// registered here too so their URL keeps the most specific route.
	for (const binding of routing.current().bindings) {
		routes[`/${binding.path}`] = { GET: servePath }
	}

	// Rung 2: programmed prefixes. Bun's `:param` segments carry the value.
	// Prefixes are not authorable in this increment (the pattern must be one the
	// build programs), so reading them once here is still correct.
	for (const prefix of routing.current().prefixes) {
		routes[`/${prefix.pattern}`] = { GET: servePath }
	}

	// Any other single-segment path is resolved per request — including a
	// binding authored after boot, and including the compiled-in names, whose
	// precedence over a binding is rung 1 vs rung 1b and therefore resolved
	// with the live table rather than baked into registration.
	routes['/:name'] = { GET: servePath }

	// Multi-segment client routes still fall through to the SPA.
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
		// The one write-restricted ingest surface: pages and route intents.
		...buildAppEventsRoutes({ pageStore, routeTable: routing, levelOf: createLevelLookup() }),
		// The routing table as this process currently serves it.
		...buildRouteTableRoutes({ table: routing }),
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
