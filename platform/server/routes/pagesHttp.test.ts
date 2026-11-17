import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { finalizeEvent, getPublicKey, type Event } from 'nostr-tools/pure'
import { hexToBytes } from 'nostr-tools/utils'
import { STOREFRONT_PAGE_KIND } from '@sdk/commerce/storefront/storefrontPage'
import { ROUTE_INTENT_KIND, ROUTE_INTENT_VERSION, routeIntentContent, type RouteIntent } from '@sdk/commerce/storefront/routeIntent'
import { buildAppEventsRoutes, type AccessLevel } from '../http/appEvents'
import { buildRouteTableRoutes } from '../http/routeTable'
import { buildContentRoutes } from '../buildServer'
import { createPageStore, type PageStore } from './pageStore'
import { renderPage } from './pageRender'
import { loadRouteTable, type RouteTable } from './routeTable'
import { validateRoutesFile, type RoutesFile } from './routeFile'

const realFetch = globalThis.fetch

const APP_KEY = hexToBytes('1'.repeat(64))
const APP_PUBKEY = getPublicKey(APP_KEY)
const EDITOR_KEY = hexToBytes('2'.repeat(64))
const OUTSIDER_KEY = hexToBytes('3'.repeat(64))
const OUTSIDER_PUBKEY = getPublicKey(OUTSIDER_KEY)

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

const binding = (path: string, d = 'home', extra: Record<string, unknown> = {}) => ({
	kind: 'admin',
	path,
	target: { type: 'page', author: APP_PUBKEY, d },
	updatedAt: 1763000000,
	updatedBy: 'instance',
	...extra,
})

function routesFile(bindings: ReturnType<typeof binding>[] = [binding('shop')]): RoutesFile {
	return validateRoutesFile({
		version: 1,
		instance: { pubkey: null },
		seq: 1,
		default: null,
		bindings,
		prefixes: [{ pattern: 'item/:eventId', target: { type: 'render', render: 'item', param: 'eventId' } }],
	}).file
}

function signed(
	content = DOCUMENT,
	options: { kind?: number; d?: string; createdAt?: number; key?: Uint8Array; tags?: string[][] } = {},
): Event {
	const tags: string[][] = [['d', options.d ?? 'home'], ...(options.tags ?? [])]
	return finalizeEvent(
		{
			kind: options.kind ?? STOREFRONT_PAGE_KIND,
			created_at: options.createdAt ?? clock,
			tags,
			content,
		},
		options.key ?? APP_KEY,
	) as Event
}

interface Harness {
	url: string
	store: PageStore
	root: string
	table: RouteTable
	routes: Record<string, unknown>
	stop: () => void
}

const harnesses: Harness[] = []
const directories: string[] = []

function start(
	options: {
		bindings?: ReturnType<typeof binding>[]
		levelOf?: (pubkey: string) => AccessLevel
		maxContentBytes?: number
		render?: typeof renderPage
		routeTable?: RouteTable
	} = {},
): Harness {
	const root = mkdtempSync(join(tmpdir(), 'ar-pages-http-'))
	directories.push(root)
	const store = createPageStore({ root })
	const routesPath = join(root, 'routes.json')
	writeFileSync(routesPath, `${JSON.stringify(routesFile(options.bindings), null, 2)}\n`)
	const table = options.routeTable ?? loadRouteTable(routesPath)
	const routes = {
		...buildAppEventsRoutes({
			pageStore: store,
			routeTable: table,
			levelOf: options.levelOf ?? ((pubkey) => (pubkey === APP_PUBKEY ? 'app' : null)),
			now: () => clock,
			maxContentBytes: options.maxContentBytes,
			render: options.render,
		}),
		...buildRouteTableRoutes({ table }),
		...buildContentRoutes({
			routing: table,
			pageStore: store,
			indexHtml: new Response('SHELL', { headers: { 'content-type': 'text/html' } }),
			now: () => clock,
		}),
	} as Record<string, unknown>

	const server = Bun.serve({ port: 0, routes: routes as never })
	const harness: Harness = { url: `http://localhost:${server.port}`, store, root, table, routes, stop: () => server.stop(true) }
	harnesses.push(harness)
	return harness
}

afterEach(() => {
	for (const harness of harnesses.splice(0)) harness.stop()
	for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
	clock = 1_800_000_000
})

const post = (harness: Harness, event: Event, headers: Record<string, string> = {}) =>
	realFetch(`${harness.url}/api/app-events`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', ...headers },
		body: JSON.stringify({ event }),
	})

const pagePath = (harness: Harness, d = 'home') => join(harness.root, APP_PUBKEY, `${encodeURIComponent(d)}.json`)

describe('POST /api/app-events — the one write-restricted ingest', () => {
	test('a signed page from the app key is stored and then served with its body and meta', async () => {
		const harness = start()
		const response = await post(harness, signed())
		expect(response.status).toBe(200)
		expect(await response.json()).toMatchObject({ stored: true, kind: 30024, author: APP_PUBKEY, d: 'home' })
		expect(existsSync(pagePath(harness))).toBe(true)

		const page = await realFetch(`${harness.url}/shop`)
		expect(page.status).toBe(200)
		const html = await page.text()
		expect(html).toContain('<h1')
		expect(html).toContain('NEEDLE-42')
		expect(html).toContain('og:title')
		expect(html).toContain('data-ar-block="ProductGrid"')
	})

	test('the same page is served byte-identically twice', async () => {
		const harness = start()
		await post(harness, signed())
		const first = await (await realFetch(`${harness.url}/shop`)).text()
		const second = await (await realFetch(`${harness.url}/shop`)).text()
		expect(first).toBe(second)
	})

	test('a page switched off is no longer served at its bound path', async () => {
		const harness = start()
		await post(harness, signed())
		expect((await realFetch(`${harness.url}/shop`)).status).toBe(200)

		// The unpublish document: the same coordinate, `enabled: false`. The
		// author keeps every block — the store still holds them — but the bound
		// path must stop answering with a withdrawn page.
		clock += 1
		const withdrawnDocument = JSON.stringify({ ...JSON.parse(DOCUMENT), enabled: false })
		expect((await post(harness, signed(withdrawnDocument))).status).toBe(200)

		const withdrawn = await realFetch(`${harness.url}/shop`)
		expect(withdrawn.status).toBe(500)
		expect(await withdrawn.text()).toContain('binding-target-missing')
	})

	test('an editor is allowed and the level comes from the pubkey, not the body', async () => {
		const harness = start({ levelOf: (pubkey) => (pubkey === APP_PUBKEY ? 'app' : pubkey === getPublicKey(EDITOR_KEY) ? 'editor' : null) })
		const response = await post(harness, signed(DOCUMENT, { key: EDITOR_KEY }))
		expect(response.status).toBe(200)
	})

	test('a bad signature is 400 bad-signature and writes nothing', async () => {
		const harness = start()
		const event = signed()
		const tampered = { ...event, sig: `${event.sig.slice(0, -1)}${event.sig.endsWith('0') ? '1' : '0'}` }
		const response = await post(harness, tampered as Event)
		expect(response.status).toBe(400)
		expect(await response.json()).toMatchObject({ error: 'bad-signature' })
		expect(existsSync(pagePath(harness))).toBe(false)
	})

	test('a pubkey outside {app, admin, editor} is 403 no-acl and writes nothing', async () => {
		const harness = start()
		const response = await post(harness, signed(DOCUMENT, { key: OUTSIDER_KEY }))
		expect(response.status).toBe(403)
		expect(await response.json()).toMatchObject({ error: 'no-acl' })
		expect(existsSync(join(harness.root, OUTSIDER_PUBKEY))).toBe(false)
	})

	test('a wrong kind is 400 kind-not-allowed', async () => {
		const harness = start()
		const response = await post(harness, signed(DOCUMENT, { kind: 1 }))
		expect(response.status).toBe(400)
		expect(await response.json()).toMatchObject({ error: 'kind-not-allowed' })
	})

	test('a stale signed event is 400 stale-intent', async () => {
		const harness = start()
		const response = await post(harness, signed(DOCUMENT, { createdAt: clock - 301 }))
		expect(response.status).toBe(400)
		expect(await response.json()).toMatchObject({ error: 'stale-intent' })
	})

	test('an over-cap document is 400 too-large and writes nothing', async () => {
		const harness = start({ maxContentBytes: 256 })
		const response = await post(harness, signed())
		expect(response.status).toBe(400)
		expect(await response.json()).toMatchObject({ error: 'too-large' })
		expect(existsSync(pagePath(harness))).toBe(false)
	})

	test('an invalid document is 400 invalid-page and writes nothing', async () => {
		const harness = start()
		const response = await post(harness, signed('{"version":1,'))
		expect(response.status).toBe(400)
		expect(await response.json()).toMatchObject({ error: 'invalid-page' })
		expect(existsSync(pagePath(harness))).toBe(false)
	})

	test('a document that fails to render is 400 render-failed and writes nothing', async () => {
		const harness = start({
			render: () => {
				throw new Error('renderer exploded')
			},
		})
		const response = await post(harness, signed())
		expect(response.status).toBe(400)
		expect(await response.json()).toMatchObject({ error: 'render-failed', detail: 'renderer exploded' })
		expect(existsSync(pagePath(harness))).toBe(false)
	})

	test('a page without a d tag is refused', async () => {
		const harness = start()
		const event = finalizeEvent({ kind: STOREFRONT_PAGE_KIND, created_at: clock, tags: [], content: DOCUMENT }, APP_KEY) as Event
		const response = await post(harness, event)
		expect(response.status).toBe(400)
		expect(await response.json()).toMatchObject({ error: 'invalid-page' })
	})

	test('a malformed body is 400 bad-request', async () => {
		const harness = start()
		const response = await realFetch(`${harness.url}/api/app-events`, { method: 'POST', body: 'not json' })
		expect(response.status).toBe(400)
		expect(await response.json()).toMatchObject({ error: 'bad-request' })
	})
})

describe('the serve path — the ladder, 404s and a dead relay', () => {
	test('an unmatched path is a real 404, not the SPA shell', async () => {
		const harness = start()
		const response = await realFetch(`${harness.url}/nothing`)
		expect(response.status).toBe(404)
	})

	test('a bound path whose page was never stored is 500, not 404', async () => {
		const harness = start({ bindings: [binding('shop', 'absent')] })
		const response = await realFetch(`${harness.url}/shop`)
		expect(response.status).toBe(500)
		expect(await response.text()).toContain('binding-target-missing')
	})

	test('a lease that lapses while the process runs 404s at the next request', async () => {
		const harness = start({ bindings: [binding('shop', 'home', { meaning: 'lease', expiresAt: clock + 10 })] })
		await post(harness, signed())

		expect((await realFetch(`${harness.url}/shop`)).status).toBe(200)
		clock += 11
		expect((await realFetch(`${harness.url}/shop`)).status).toBe(404)
	})

	test('an unbound compiled-in path keeps its compiled page; a lapsed lease on it 404s', async () => {
		const unbound = start()
		const shell = await realFetch(`${unbound.url}/dashboard`)
		expect(shell.status).toBe(200)
		expect(await shell.text()).toBe('SHELL')

		const harness = start({ bindings: [binding('dashboard', 'home', { meaning: 'lease', expiresAt: clock })] })
		expect((await realFetch(`${harness.url}/dashboard`)).status).toBe(404)
	})

	test('a programmed prefix resolves server-side with no network call to route', async () => {
		const harness = start()
		const response = await realFetch(`${harness.url}/item/abc123`)
		expect(response.status).toBe(200)
		expect(await response.text()).toContain('data-ar-param-value="abc123"')
	})

	test('ingest and serve work with every outbound fetch throwing (the relay is dead)', async () => {
		const harness = start()
		let outboundCalls = 0
		globalThis.fetch = (() => {
			outboundCalls += 1
			throw new Error('network is dead')
		}) as unknown as typeof fetch

		try {
			const ingested = await post(harness, signed())
			expect(ingested.status).toBe(200)

			const served = await realFetch(`${harness.url}/shop`)
			expect(served.status).toBe(200)
			expect(await served.text()).toContain('NEEDLE-42')

			const missing = await realFetch(`${harness.url}/nothing`)
			expect(missing.status).toBe(404)
		} finally {
			globalThis.fetch = realFetch
		}
		expect(outboundCalls).toBe(0)
	})
})

describe('one write surface (E14)', () => {
	test('the ingest is registered once and the retired name does not exist', () => {
		const harness = start()
		const keys = Object.keys(harness.routes)
		expect(keys.filter((key) => key === '/api/app-events')).toHaveLength(1)
		expect(keys.some((key) => key.includes(`pages${'/'}publish`))).toBe(false)
	})
})

/** A signed route intent, with the path doubling as the event's `d` tag. */
function intentEvent(intent: RouteIntent, options: { key?: Uint8Array; createdAt?: number } = {}): Event {
	return finalizeEvent(
		{
			kind: ROUTE_INTENT_KIND,
			created_at: options.createdAt ?? clock,
			tags: [['d', intent.path]],
			content: routeIntentContent(intent),
		},
		options.key ?? APP_KEY,
	) as Event
}

const setIntent = (path: string, d = 'home', author = APP_PUBKEY): RouteIntent => ({
	version: ROUTE_INTENT_VERSION,
	action: 'set',
	path,
	target: { type: 'page', author, d },
})

const removeIntent = (path: string): RouteIntent => ({ version: ROUTE_INTENT_VERSION, action: 'remove', path, target: null })

describe('route intents — the admin authors a binding over the one ingest', () => {
	test('a binding authored at runtime is served by the next request, with no restart', async () => {
		const harness = start()
		await post(harness, signed())

		// Before the intent: an unknown single-segment path is a real 404.
		expect((await realFetch(`${harness.url}/newshop`)).status).toBe(404)

		const response = await post(harness, intentEvent(setIntent('newshop')))
		expect(response.status).toBe(200)
		expect(await response.json()).toMatchObject({
			stored: true,
			kind: ROUTE_INTENT_KIND,
			path: 'newshop',
			action: 'set',
			changed: true,
		})

		const served = await realFetch(`${harness.url}/newshop`)
		expect(served.status).toBe(200)
		expect(await served.text()).toContain('NEEDLE-42')
	})

	test('the binding is persisted to the table file, not just held in memory', async () => {
		const harness = start()
		const path = join(harness.root, 'routes.json')
		await post(harness, intentEvent(setIntent('newshop', 'home')))

		const written = JSON.parse(readFileSync(path, 'utf8'))
		expect(written.bindings.map((entry: { path: string }) => entry.path)).toContain('newshop')
		expect(written.bindings.find((entry: { path: string }) => entry.path === 'newshop')).toMatchObject({
			updatedAt: clock,
			updatedBy: APP_PUBKEY,
		})
	})

	test('a remove intent takes the path down without a restart', async () => {
		const harness = start()
		await post(harness, signed())
		await post(harness, intentEvent(setIntent('newshop')))
		expect((await realFetch(`${harness.url}/newshop`)).status).toBe(200)

		expect((await post(harness, intentEvent(removeIntent('newshop')))).status).toBe(200)
		expect((await realFetch(`${harness.url}/newshop`)).status).toBe(404)
	})

	test('a binding authored at runtime supersedes a compiled-in page, which still answers when unbound', async () => {
		const harness = start()
		await post(harness, signed())

		const compiled = await realFetch(`${harness.url}/products`)
		expect(compiled.status).toBe(200)
		expect(await compiled.text()).toBe('SHELL')

		const applied = await post(harness, intentEvent(setIntent('products')))
		expect(applied.status).toBe(200)
		expect(await applied.json()).toMatchObject({ warnings: [{ code: 'compiled-in-path', path: 'products' }] })

		const served = await realFetch(`${harness.url}/products`)
		expect(await served.text()).toContain('NEEDLE-42')
	})

	test('an editor may author a binding — the ACL is the existing one, not a second model', async () => {
		const editorPubkey = getPublicKey(EDITOR_KEY)
		const harness = start({ levelOf: (pubkey) => (pubkey === APP_PUBKEY ? 'app' : pubkey === editorPubkey ? 'editor' : null) })
		const response = await post(harness, intentEvent(setIntent('newshop'), { key: EDITOR_KEY }))
		expect(response.status).toBe(200)
		expect(harness.table.current().bindings.find((entry) => entry.path === 'newshop')?.updatedBy).toBe(editorPubkey)
	})

	test('a signer below app/admin/editor is 403 no-acl and the table is untouched', async () => {
		const harness = start()
		const response = await post(harness, intentEvent(setIntent('newshop'), { key: OUTSIDER_KEY }))
		expect(response.status).toBe(403)
		expect(await response.json()).toMatchObject({ error: 'no-acl' })
		expect(harness.table.current().bindings.map((entry) => entry.path)).toEqual(['shop'])
	})

	test('an intent whose path disagrees with its d tag is refused and nothing is applied', async () => {
		const harness = start()
		// Signed with a d tag that disagrees with the path inside the document.
		const mismatched = finalizeEvent(
			{ kind: ROUTE_INTENT_KIND, created_at: clock, tags: [['d', 'other']], content: routeIntentContent(setIntent('newshop')) },
			APP_KEY,
		) as Event
		const response = await post(harness, mismatched)
		expect(response.status).toBe(400)
		expect(await response.json()).toMatchObject({ error: 'invalid-route-intent' })
		expect(harness.table.current().bindings.map((entry) => entry.path)).toEqual(['shop'])
	})

	test('a subpath or a URL-space name is refused with the reason', async () => {
		const harness = start()
		for (const path of ['shop/featured', 'api']) {
			const response = await post(harness, intentEvent(setIntent(path)))
			expect(response.status).toBe(400)
			const body = (await response.json()) as { error: string; detail: string }
			expect(body.error).toBe('invalid-route-intent')
			expect(body.detail).toContain('/path')
		}
		expect(harness.table.current().bindings.map((entry) => entry.path)).toEqual(['shop'])
	})

	test('a stale intent is refused before it reaches the table', async () => {
		const harness = start()
		const response = await post(harness, intentEvent(setIntent('newshop'), { createdAt: clock - 301 }))
		expect(response.status).toBe(400)
		expect(await response.json()).toMatchObject({ error: 'stale-intent' })
	})

	test('a change that would make the table invalid is a 400 and is not persisted', async () => {
		const harness = start()
		const before = readFileSync(join(harness.root, 'routes.json'), 'utf8')
		// Stand in for a table whose validator rejects the result: the ingest must
		// map that refusal to a named error and write nothing. (The table-level
		// test in routeTable.test.ts exercises a real validator refusal.)
		const refusing: RouteTable = {
			path: join(harness.root, 'routes.json'),
			current: () => harness.table.current(),
			warnings: () => harness.table.warnings(),
			apply: () => ({ ok: false, violations: ['/bindings/0/path: duplicate binding for shop'] }),
		}
		const guarded = start({ routeTable: refusing })

		const response = await post(guarded, intentEvent(setIntent('newshop')))
		expect(response.status).toBe(400)
		const body = (await response.json()) as { error: string; detail: string }
		expect(body.error).toBe('invalid-route-table')
		expect(body.detail).toContain('duplicate binding')
		expect(readFileSync(join(harness.root, 'routes.json'), 'utf8')).toBe(before)
		expect(guarded.table.current().bindings.map((entry) => entry.path)).toEqual(['shop'])
	})

	test('GET /api/routes reports the live table and its warnings', async () => {
		const harness = start()
		const before = (await (await realFetch(`${harness.url}/api/routes`)).json()) as {
			seq: number
			bindings: Array<{ path: string }>
			warnings: unknown[]
		}
		expect(before.bindings.map((entry) => entry.path)).toEqual(['shop'])
		expect(before.warnings).toEqual([])

		await post(harness, intentEvent(setIntent('products')))
		const after = (await (await realFetch(`${harness.url}/api/routes`)).json()) as {
			seq: number
			bindings: Array<{ path: string; target: { author: string; d: string } }>
			warnings: Array<{ code: string; path: string; message: string }>
		}
		expect(after.seq).toBe(before.seq + 1)
		expect(after.bindings.map((entry) => entry.path)).toEqual(['shop', 'products'])
		expect(after.warnings).toEqual([{ code: 'compiled-in-path', path: 'products', message: expect.any(String) }])
	})
})
