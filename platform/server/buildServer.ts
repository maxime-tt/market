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
import { buildAppEventsRoutes, createLevelLookup } from './http/appEvents'
import { buildRouteTableRoutes } from './http/routeTable'
import { resolve } from './routes/resolve'
import { composePageHtml, composeRenderPlaceholder, injectRoutePayload } from './routes/pageHtml'
import { createPageStore, type PageStore } from './routes/pageStore'
import { createShellResponder, readShellAssets, SHELL_PATH, type ShellAssets } from './routes/shell'
import { pagePayloadFor } from './routes/defaultBinding'
import { resolveSeries } from './routes/series'
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
 *
 * Serving (increment 3): `'/'` is registered like any other path and means
 * whatever the table's `default` names (R4) — with no default it is the
 * compiled-in home, so the URL that used to bypass this function entirely now
 * goes through it. A served page ships the bundle's own script and stylesheets,
 * read from the shell bytes this module already caches (`readShellAssets`);
 * `/` no longer answers with the shell, so the shell is fetched from
 * `SHELL_PATH` instead — a self-request to `/` would re-enter `servePath`.
 */
export interface BuildServerOptions {
	/**
	 * SPA shell — typically `import index from './index.html'` from the
	 * entrypoint. Bun's `HTMLBundle` is a valid `RouteValue` for the
	 * catch-all `'/*'`, but its type lives in `bun.d.ts` and isn't useful
	 * to import here, so we accept anything Bun's route record will take.
	 */
	indexHtml: unknown
	/** Loaded once at boot, then mutated by route intents; an invalid file refuses boot, a missing one is the empty table. */
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
 * How a stored page asks its bound path to answer.
 *
 * The field is presentation intent carried on the page document
 * (`StorefrontPage.chrome`), so the author's choice travels with the page and
 * any client can honour or ignore it. This is the **one** place that decides
 * what a missing or unrecognised value means: a record written before the field
 * existed has no `chrome`, and it resolves to `'app'` — the same default the
 * schema applies to a document that omits it. Only the exact string
 * `'standalone'` opts out.
 *
 * Takes the loose shape rather than `StorefrontPage` because the value comes
 * off local storage written by an older process; nothing here is trusted.
 */
export const servedChrome = (document: { chrome?: string } | undefined): 'app' | 'standalone' =>
	document?.chrome === 'standalone' ? 'standalone' : 'app'

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
	//
	// The self-request goes to `SHELL_PATH`, never to `/`: since increment 3 `/`
	// is the default binding's page (R4), so a fetch of `/` would re-enter this
	// handler and wait on the very promise that is fetching it. `SHELL_PATH` is
	// the same bundle, served by the `'/*'` catch-all below.
	const shell = createShellResponder({ indexHtml, fetchShell: () => fetch(`http://127.0.0.1:${PORT}${SHELL_PATH}`) })

	// The bundle's asset URLs, read once from the shell bytes the responder
	// already caches — the only in-process source there is (the `HTMLBundle`
	// exposes no file list, measured). A shell that cannot be read leaves a
	// served page without its bundle rather than failing the page: the page's
	// content and its meta are already composed and are what the request is for.
	let assets: Promise<ShellAssets> | null = null
	const shellAssets = (): Promise<ShellAssets> => {
		assets ??= shell
			.text()
			.then(readShellAssets)
			.catch((error: unknown) => {
				console.warn(`⚠️ served page has no bundle: ${error instanceof Error ? error.message : String(error)}`)
				return { bootstrapSrc: null, stylesheetHrefs: [] } satisfies ShellAssets
			})
		return assets
	}

	const servePath = async (request: Request): Promise<Response> => {
		const url = new URL(request.url)
		// Read the table per request: this is what makes an authored binding live.
		// The series resolver is injected rather than inlined into `resolve()`:
		// routing stays pure and does no I/O, and `/featured` still answers from
		// the local series index (`resolveSeries` is the only reader of it).
		const resolution = resolve(routing.current(), url.pathname, now(), {
			series: (target) => {
				const found = resolveSeries(target, pageStore, pageStore)
				return found.outcome === 'found' ? { author: found.author, d: found.d } : null
			},
		})

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

		// A `page` or a `series` outcome both name an `(author, d)` to read; for a
		// series, the resolver already chose the newest present member.
		const { author, d } = resolution.outcome === 'series' ? resolution : resolution.target
		// The binding's own path — what the routing file wrote, not the request
		// URL. The subpath guard below is about the binding's shape; `/` is served
		// by the same branch because `resolve()` normalises it to the path its
		// default names (R4), so `resolution.path` is the named path for `/` and
		// for a direct request alike. A series resolution carries the same field.
		const bindingPath = resolution.path
		const page = pageStore.get(author, d)
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
				`<!doctype html><html><head><title>Page unavailable</title></head><body><h1>binding-target-missing</h1><p>No stored page at (${author}, ${d}).</p></body></html>`,
				500,
			)
		}

		// The request path, normalised once: it is the standalone arm's canonical
		// URL and the app-chrome arm's payload `path`, and the client compares it
		// against `location.pathname` with the same trailing-slash rule.
		const path = url.pathname.replace(/\/+$/, '') || '/'

		// **Subpath guard** (`PLAN-2026-11-17-app-chrome-pages.md` §8.2). An
		// authorable lease cannot name a subpath (`NAME_PATTERN` has no `/`), but
		// a hand-written `data/routes.json` can, and this function registers a
		// literal route for it above. The browser has no route for a two-segment
		// bound path — `/$vanityName` matches exactly one segment — so app chrome
		// there would cold-load the shell and render the router's not-found. The
		// binding's own path is what is checked: it is the shape the file wrote,
		// independent of how the URL was cased or slashed. A subpath always
		// answers with the composed standalone document.
		//
		// `/` needs no special case: `resolve()` normalises the default binding
		// to a path and returns the same `page` outcome (R4), so the home flows
		// through this identical branch.
		const appChrome = servedChrome(page.document) === 'app' && !bindingPath.includes('/')

		if (appChrome) {
			// The shell's own bytes, with the route payload inserted: the client
			// mounts the app normally and the root guard
			// (`platform/web/routes/__root.tsx`) renders the page inside the real
			// header and footer. `shell()` returns a Response — read it, never
			// mutate the cached one. The response is a fresh one with `no-store`:
			// the injected document is per-URL and depends on live state, so it
			// must not be cacheable.
			try {
				const shellResponse = await shell()
				const bytes = await shellResponse.text()
				return new Response(injectRoutePayload(bytes, { author, d, path }), {
					status: shellResponse.status,
					headers: {
						'content-type': shellResponse.headers.get('content-type') ?? 'text/html; charset=utf-8',
						'cache-control': 'no-store',
					},
				})
			} catch (error) {
				// Fail visible, in the same shape as the compiled-in arm. Never fall
				// back to the standalone document: a silent fallback would hand the
				// same URL two different looks and hide the reason it changed.
				const detail = error instanceof Error ? error.message : String(error)
				return html(
					`<!doctype html><html><head><title>Page unavailable</title></head><body><h1>spa-shell-unavailable</h1><p>${detail}</p></body></html>`,
					500,
				)
			}
		}

		// The standalone answer: the composed document, unchanged. It is the
		// opt-out (`chrome: 'standalone'`), the subpath case, and what a stored
		// record served it before this increment.
		//
		// The bundle the page needs to hydrate, and the stylesheets the shell
		// styled itself with: both read from the shell's own bytes, and both
		// absent (never invented) when the shell cannot be read.
		const { bootstrapSrc, stylesheetHrefs } = await shellAssets()

		return html(
			composePageHtml({
				meta: page.meta,
				html: page.html,
				payload: pagePayloadFor({ author, d }),
				path,
				bootstrapSrc: bootstrapSrc ?? undefined,
				stylesheetHrefs,
			}),
		)
	}

	// `/` — the default binding (R4). Bun matches a literal `'/'` route and its
	// `':name'` route never sees an empty segment (measured), so the root has to
	// be registered explicitly or it falls through to the SPA shell and the
	// routing file's `default` is never consulted. `resolve()` decides what it
	// means: the named path's ladder, or the compiled-in home when there is none.
	routes['/'] = { GET: servePath }

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
