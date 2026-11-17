import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { finalizeEvent, getPublicKey, type Event } from 'nostr-tools/pure'
import { hexToBytes } from 'nostr-tools/utils'
import { STOREFRONT_PAGE_KIND } from '@sdk/commerce/storefront/storefrontPage'
import { ROUTE_INTENT_KIND, ROUTE_INTENT_VERSION, routeIntentContent, type RouteIntent } from '@sdk/commerce/storefront/routeIntent'
import { buildAppEventsRoutes } from '../http/appEvents'
import { buildContentRoutes } from '../buildServer'
import { createPageStore, type PageStore } from './pageStore'
import { renderPage } from './pageRender'
import { loadRouteTable, type RouteTable } from './routeTable'
import { validateRoutesFile, type RoutesFile } from './routeFile'

/**
 * The serving surface — increment 3's exit criteria S1–S5
 * (`IMPLEMENTATION-PLAN.md` §4), asserted against a **real started server**:
 * a `Bun.serve` with the same route record production composes, driven by
 * `fetch` exactly as `curl` would drive it.
 *
 * What is new here, and why each case is worth a test:
 *
 *   - `/` is routed at all. Before this increment Bun's `':name'` route never
 *     saw an empty segment, so `/` fell through the `'/*'` catch-all and the
 *     routing file's `default` had no production consumer.
 *   - an unbound single segment is a **404**, not "the app key's page at that
 *     `d`". That is the behaviour change the plan states loudly.
 *   - a **bound** compiled-in path serves the binding and does **not** answer
 *     with the shell (the server half of S4b; the client half — the compiled
 *     route must not mount over the served page — is the `#__AR_PAGE__` seam
 *     and is proven in the browser check).
 *   - a served page ships the bundle: the module script and the stylesheets are
 *     read from the shell's own bytes (`readShellAssets`), because the
 *     `HTMLBundle` exposes no file list in-process (measured).
 */

const realFetch = globalThis.fetch

const APP_KEY = hexToBytes('1'.repeat(64))
const APP_PUBKEY = getPublicKey(APP_KEY)

let clock = 1_800_000_000

const DOCUMENT = JSON.stringify({
	version: 1,
	enabled: true,
	root: { props: { title: 'Test shop', theme: 'default' } },
	content: [
		{ type: 'Hero', props: { id: 'hero-1', title: 'Welcome to the test shop' } },
		{ type: 'Text', props: { id: 'text-1', markdown: 'A served page with a marker: NEEDLE-42.' } },
		{ type: 'ProductGrid', props: { id: 'grid-1', title: 'Products' } },
	],
})

/**
 * A shell that looks like the real one where it matters: the asset URLs a
 * served page has to re-emit are exactly the ones the shell declares.
 */
const SHELL_HTML =
	'<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Plebeian Market</title>' +
	'<link rel="stylesheet" href="/chunk-app.css"><script type="module" src="/chunk-app.js"></script>' +
	'</head><body><div id="root"></div></body></html>'

const binding = (path: string, d = 'home', extra: Record<string, unknown> = {}) => ({
	kind: 'admin',
	path,
	target: { type: 'page', author: APP_PUBKEY, d },
	updatedAt: 1763000000,
	updatedBy: 'instance',
	...extra,
})

function routesFile(bindings: unknown[] = [], defaultPath: string | null = null): RoutesFile {
	return validateRoutesFile({
		version: 1,
		instance: { pubkey: null },
		seq: 1,
		default: defaultPath,
		bindings,
		prefixes: [{ pattern: 'item/:eventId', target: { type: 'render', render: 'item', param: 'eventId' } }],
	}).file
}

function signed(content = DOCUMENT, options: { d?: string; createdAt?: number; tags?: string[][] } = {}): Event {
	return finalizeEvent(
		{
			kind: STOREFRONT_PAGE_KIND,
			created_at: options.createdAt ?? clock,
			tags: [['d', options.d ?? 'home'], ...(options.tags ?? [])],
			content,
		},
		APP_KEY,
	) as Event
}

function intentEvent(intent: RouteIntent): Event {
	return finalizeEvent(
		{
			kind: ROUTE_INTENT_KIND,
			created_at: clock,
			tags: [['d', intent.path]],
			content: routeIntentContent(intent),
		},
		APP_KEY,
	) as Event
}

const setIntent = (path: string, d = 'home'): RouteIntent => ({
	version: ROUTE_INTENT_VERSION,
	action: 'set',
	path,
	target: { type: 'page', author: APP_PUBKEY, d },
})

interface Harness {
	url: string
	store: PageStore
	root: string
	table: RouteTable
	stop: () => void
}

const harnesses: Harness[] = []
const directories: string[] = []

function start(options: { bindings?: unknown[]; default?: string | null; shell?: string } = {}): Harness {
	const root = mkdtempSync(join(tmpdir(), 'ar-surface-'))
	directories.push(root)
	const store = createPageStore({ root })
	const routesPath = join(root, 'routes.json')
	writeFileSync(routesPath, `${JSON.stringify(routesFile(options.bindings, options.default ?? null), null, 2)}\n`)
	const table = loadRouteTable(routesPath)
	const routes = {
		...buildAppEventsRoutes({
			pageStore: store,
			routeTable: table,
			levelOf: (pubkey) => (pubkey === APP_PUBKEY ? 'app' : null),
			now: () => clock,
			render: renderPage,
		}),
		...buildContentRoutes({
			routing: table,
			pageStore: store,
			indexHtml: new Response(options.shell ?? SHELL_HTML, { headers: { 'content-type': 'text/html; charset=utf-8' } }),
			now: () => clock,
		}),
	} as Record<string, unknown>

	const server = Bun.serve({ port: 0, routes: routes as never })
	const harness: Harness = { url: `http://localhost:${server.port}`, store, root, table, stop: () => server.stop(true) }
	harnesses.push(harness)
	return harness
}

afterEach(() => {
	for (const harness of harnesses.splice(0)) harness.stop()
	for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
	clock = 1_800_000_000
})

const post = (harness: Harness, event: Event) =>
	realFetch(`${harness.url}/api/app-events`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ event }),
	})

const status = async (harness: Harness, path: string) => (await realFetch(`${harness.url}${path}`)).status
const body = async (harness: Harness, path: string) => (await realFetch(`${harness.url}${path}`)).text()

describe('S1 — `/` renders the default binding, or the compiled-in home when it names nothing', () => {
	test('with no default, `/` is the compiled-in home: the SPA shell, which composes the inline home', async () => {
		const harness = start()
		const response = await realFetch(`${harness.url}/`)
		expect(response.status).toBe(200)
		expect(await response.text()).toBe(SHELL_HTML)
	})

	test('with `default: "shop"`, `/` serves the page bound at `shop` — marker, payload and all', async () => {
		const harness = start({ default: 'shop', bindings: [binding('shop')] })
		expect((await post(harness, signed())).status).toBe(200)

		const response = await realFetch(`${harness.url}/`)
		expect(response.status).toBe(200)
		const html = await response.text()
		expect(html).toContain('NEEDLE-42')
		expect(html).toContain('<div data-testid="storefront-page"')
		// The payload names the coordinate the binding resolved to, and the
		// canonical stays the URL that was asked for.
		expect(html).toContain(`{"author":"${APP_PUBKEY}","d":"home","version":1}`)
		expect(html).toContain('<link rel="canonical" href="/">')
	})

	test('`/` and the path the default names serve the same page; only the canonical URL differs', async () => {
		const harness = start({ default: 'shop', bindings: [binding('shop')] })
		await post(harness, signed())
		const home = await body(harness, '/')
		const shop = await body(harness, '/shop')

		// One page, one branch, one payload: `/` is served by the identical code
		// path the named path is. The canonical URL (and `og:url`, derived from
		// it) is the URL the request arrived on — which is the only difference.
		const withoutPathMeta = (html: string) => html.replace(/<link rel="canonical"[^>]*>\n?/, '').replace(/<meta property="og:url"[^>]*>\n?/, '')
		expect(withoutPathMeta(home)).toBe(withoutPathMeta(shop))
		expect(home).toContain('<link rel="canonical" href="/">')
		expect(shop).toContain('<link rel="canonical" href="/shop">')
	})

	test('a default naming a compiled-in path answers with that compiled-in page', async () => {
		const harness = start({ default: 'dashboard' })
		expect(await status(harness, '/')).toBe(200)
		expect(await body(harness, '/')).toBe(SHELL_HTML)
	})

	test('a default naming a series path resolves through the series rung, not around it', async () => {
		const harness = start({
			default: 'featured',
			bindings: [
				{
					kind: 'admin',
					path: 'featured',
					target: { type: 'series', series: 'featured', author: APP_PUBKEY },
					updatedAt: 1763000000,
					updatedBy: 'instance',
				},
			],
		})
		// A dated member of the series, published through the one ingest.
		expect((await post(harness, signed(DOCUMENT, { d: 'featured-13-11-2026', tags: [['t', 'featured']] }))).status).toBe(200)

		const response = await realFetch(`${harness.url}/`)
		expect(response.status).toBe(200)
		const html = await response.text()
		expect(html).toContain('NEEDLE-42')
		expect(html).toContain(`{"author":"${APP_PUBKEY}","d":"featured-13-11-2026","version":1}`)
	})

	test('a default naming a path with no binding is the honest 404, not the shell and not a blank home', async () => {
		const harness = start({ default: 'shop' })
		expect(await status(harness, '/')).toBe(404)
	})
})

describe('S2/S3 — a bound `/<name>` serves; an unbound one is a real 404', () => {
	test('a bound `/<name>` is 200 with the page', async () => {
		const harness = start({ bindings: [binding('shop')] })
		await post(harness, signed())
		expect(await status(harness, '/shop')).toBe(200)
		expect(await body(harness, '/shop')).toContain('NEEDLE-42')
	})

	test('an unbound `/<name>` is 404 — never the app key’s page at that `d`', async () => {
		// The page the old fall-through would have rendered: the app key's page at
		// `d = nothing-here`. It is stored, and the path is still 404.
		const harness = start()
		expect((await post(harness, signed(DOCUMENT, { d: 'nothing-here' }))).status).toBe(200)

		const response = await realFetch(`${harness.url}/nothing-here`)
		expect(response.status).toBe(404)
		expect(await response.text()).not.toContain('NEEDLE-42')
	})

	test('a multi-segment path is not the ladder’s business and still falls through to the SPA', async () => {
		// Unchanged by this increment, and asserted so the boundary is visible:
		// the routing file is consulted for `/`, single segments and programmed
		// prefixes; anything deeper is a client route (or the client's own 404)
		// and reaches the shell exactly as it did before (200, measured).
		const harness = start()
		expect(await status(harness, '/nothing/here')).toBe(200)
		expect(await body(harness, '/nothing/here')).toBe(SHELL_HTML)
	})
})

describe('S4/S4b — compiled-in paths: unchanged while unbound, superseded while bound', () => {
	/**
	 * Quoted before/after, measured on a real server.
	 *
	 * Before increment 3 (base commit 96589f0d3, same fixture): `/dashboard`,
	 * `/auctions`, `/products` → **200**, body the SPA shell (`SHELL` in the
	 * harness of the time) — the `':name'` route resolved rung 1b and handed over
	 * the shell. `/` → **200** with the shell too, but by a different mechanism:
	 * it was never routed at all, falling through `'/*'`.
	 */
	test('unbound compiled-in paths answer exactly as before: 200 with the shell', async () => {
		const harness = start()
		for (const path of ['/dashboard', '/auctions', '/products']) {
			expect(await status(harness, path)).toBe(200)
			expect(await body(harness, path)).toBe(SHELL_HTML)
		}
	})

	test('a live binding on a compiled-in name serves the binding, not the shell', async () => {
		const harness = start({ bindings: [binding('dashboard')] })
		await post(harness, signed())

		const response = await realFetch(`${harness.url}/dashboard`)
		expect(response.status).toBe(200)
		const html = await response.text()
		expect(html).toContain('NEEDLE-42')
		expect(html).toContain('<div data-testid="storefront-page"')
		// The compiled-in page is what answers *only* when no binding exists; with
		// one live, the shell must not be served at all.
		expect(html).not.toBe(SHELL_HTML)
		expect(html).not.toContain('<title>Plebeian Market</title>')
	})

	test('the write that binds a compiled-in path reports the compiled-in-path warning', async () => {
		const harness = start()
		await post(harness, signed())
		const applied = await post(harness, intentEvent(setIntent('dashboard')))
		expect(applied.status).toBe(200)
		expect(await applied.json()).toMatchObject({ warnings: [{ code: 'compiled-in-path', path: 'dashboard' }] })
		expect(await body(harness, '/dashboard')).toContain('NEEDLE-42')
	})

	test('removing the binding hands the path back to the compiled-in page', async () => {
		const harness = start({ bindings: [binding('dashboard')] })
		await post(harness, signed())
		expect(await body(harness, '/dashboard')).toContain('NEEDLE-42')

		const removed = await post(harness, intentEvent({ version: ROUTE_INTENT_VERSION, action: 'remove', path: 'dashboard', target: null }))
		expect(removed.status).toBe(200)
		expect(await body(harness, '/dashboard')).toBe(SHELL_HTML)
	})
})

describe('S5 — a binding whose page is unrenderable is 500 with a named error', () => {
	test('an absent page is binding-target-missing, never 404 and never 200', async () => {
		const harness = start({ bindings: [binding('shop', 'never-published')] })
		const response = await realFetch(`${harness.url}/shop`)
		expect(response.status).toBe(500)
		expect(await response.text()).toContain('binding-target-missing')
	})

	test('a page switched off is the same 500 — the store keeps the document, the path stops answering', async () => {
		const harness = start({ bindings: [binding('shop')] })
		await post(harness, signed())
		expect(await status(harness, '/shop')).toBe(200)

		clock += 1
		await post(harness, signed(JSON.stringify({ ...JSON.parse(DOCUMENT), enabled: false })))
		const response = await realFetch(`${harness.url}/shop`)
		expect(response.status).toBe(500)
		expect(await response.text()).toContain('binding-target-missing')
	})

	test('the default binding is held to the same rule: a broken default is a 500, not a blank home', async () => {
		const harness = start({ default: 'shop', bindings: [binding('shop', 'never-published')] })
		const response = await realFetch(`${harness.url}/`)
		expect(response.status).toBe(500)
		expect(await response.text()).toContain('binding-target-missing')
	})
})

describe('a served page ships the bundle the shell declares', () => {
	test('the module script and every stylesheet come from the shell bytes', async () => {
		const harness = start({ bindings: [binding('shop')] })
		await post(harness, signed())

		const html = await body(harness, '/shop')
		expect(html).toContain('<script type="module" src="/chunk-app.js"></script>')
		expect(html).toContain('<link rel="stylesheet" href="/chunk-app.css">')
		// The payload script is still the only inline JSON, and it is present.
		expect(html).toContain('id="__AR_PAGE__"')
	})

	test('a page served at `/` ships them too', async () => {
		const harness = start({ default: 'shop', bindings: [binding('shop')] })
		await post(harness, signed())
		const html = await body(harness, '/')
		expect(html).toContain('<script type="module" src="/chunk-app.js"></script>')
		expect(html).toContain('<link rel="stylesheet" href="/chunk-app.css">')
	})

	test('a shell carrying no asset URLs leaves the page without them — nothing is invented', async () => {
		const harness = start({
			bindings: [binding('shop')],
			shell: '<!doctype html><html><body><div id="root"></div></body></html>',
		})
		await post(harness, signed())

		const html = await body(harness, '/shop')
		expect(html).toContain('NEEDLE-42')
		expect(html).not.toContain('<script type="module"')
		expect(html).not.toContain('<link rel="stylesheet"')
	})
})
