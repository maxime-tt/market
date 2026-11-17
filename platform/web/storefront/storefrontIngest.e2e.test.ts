import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { finalizeEvent, getPublicKey, type Event } from 'nostr-tools/pure'
import { hexToBytes } from 'nostr-tools/utils'
import {
	STOREFRONT_PAGE_D_TAG,
	STOREFRONT_PAGE_VERSION,
	parseStorefrontRootProps,
	type StorefrontPage,
} from '@sdk/commerce/storefront/storefrontPage'
import type { EventTemplate, NostrEvent } from '@platform/web/ndkPublishContext'
import { buildAppEventsRoutes } from '@platform/server/http/appEvents'
import { buildContentRoutes } from '@platform/server/buildServer'
import { createPageStore } from '@platform/server/routes/pageStore'
import { loadRouteTable } from '@platform/server/routes/routeTable'
import { validateRoutesFile, type RoutesFile } from '@platform/server/routes/routeFile'

/**
 * The end-to-end proof for slice 0.
 *
 * The defect it closes was a seam, not a bug in either half: the CMS published
 * to relays and the server served from its local store, and nothing joined
 * them. This file therefore exercises the REAL publish function against a REAL
 * ingest + serve server over HTTP — sign → relay publish → `POST /api/app-events`
 * → `pageStore.put` → `GET /shop` — and asserts the marker in the served HTML.
 *
 * Only the signer/relay bridge is mocked (there is no signer in a test
 * process). The event it returns is genuinely signed, so the ingest's
 * `verifyEvent` is a real check, and the server is the production route set the
 * repo's `pagesHttp.test.ts` harness builds.
 */

const realFetch = globalThis.fetch

const APP_KEY = hexToBytes('1'.repeat(64))
const APP_PUBKEY = getPublicKey(APP_KEY)

mock.module('@platform/web/ndkPublishContext', () => ({
	getUser: async () => ({ pubkey: APP_PUBKEY }),
	// A real signature: the ingest verifies it for real.
	signNostrEvent: async (template: EventTemplate): Promise<NostrEvent> => finalizeEvent(template, APP_KEY) as unknown as NostrEvent,
	publishNostrEvent: async () => ({ publishedRelays: new Set(['wss://relay.example']) }),
}))

let publishStorefrontPage: (typeof import('./storefrontPublish'))['publishStorefrontPage']

const PAGE: StorefrontPage = {
	version: STOREFRONT_PAGE_VERSION,
	enabled: true,
	root: { props: parseStorefrontRootProps({ title: 'Served shop' }) },
	content: [{ type: 'Text', props: { id: 'text-1', markdown: 'A served page with a marker: NEEDLE-42.', align: 'left', width: 'normal' } }],
}

const dirs: string[] = []
let server: ReturnType<typeof Bun.serve> | null = null
let base = ''

beforeAll(async () => {
	;({ publishStorefrontPage } = await import('./storefrontPublish'))

	const root = mkdtempSync(join(tmpdir(), 'ar-ingest-e2e-'))
	dirs.push(root)
	const routesPath = join(root, 'routes.json')
	const file: RoutesFile = validateRoutesFile({
		version: 1,
		instance: { pubkey: null },
		seq: 1,
		default: null,
		// The binding names the page's real coordinate: (author, `storefront-page`).
		// Choosing that `d` is the admin's job; this slice does not invent one.
		bindings: [
			{
				kind: 'admin',
				path: 'shop',
				target: { type: 'page', author: APP_PUBKEY, d: STOREFRONT_PAGE_D_TAG },
				updatedAt: 1763000000,
				updatedBy: 'instance',
			},
		],
		prefixes: [],
	}).file
	writeFileSync(routesPath, `${JSON.stringify(file, null, 2)}\n`)

	const store = createPageStore({ root })
	const table = loadRouteTable(routesPath)
	const routes = {
		...buildAppEventsRoutes({ pageStore: store, routeTable: table, levelOf: (pubkey) => (pubkey === APP_PUBKEY ? 'app' : null) }),
		...buildContentRoutes({
			routing: table,
			pageStore: store,
			indexHtml: new Response('SHELL', { headers: { 'content-type': 'text/html' } }),
		}),
	}
	server = Bun.serve({ port: 0, routes: routes as never })
	base = `http://localhost:${server.port}`

	// The browser's fetch resolves the relative ingest path against the page's
	// own origin; here that origin is the test server.
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
		return realFetch(url.startsWith('/') ? `${base}${url}` : url, init)
	}) as typeof fetch
})

afterAll(() => {
	globalThis.fetch = realFetch
	server?.stop(true)
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('a page published from the CMS is served at its bound path', () => {
	test('publish → ingest → store → the bound path answers with the page bytes', async () => {
		const result = await publishStorefrontPage(PAGE)
		expect(result.pubkey).toBe(APP_PUBKEY)

		const served = await realFetch(`${base}/shop`)
		expect(served.status).toBe(200)
		const html = await served.text()
		expect(html).toContain('NEEDLE-42')
		expect(html).toContain('data-testid="storefront-page"')
		// The served bytes are the stored record's own bytes, addressed by the
		// coordinate the binding named.
		expect(html).toContain('"d":"storefront-page"')
		expect(html).toContain('<link rel="canonical" href="/shop"')
	})

	test('switching the page off withdraws it from the bound path', async () => {
		await publishStorefrontPage({ ...PAGE, enabled: false })

		const withdrawn = await realFetch(`${base}/shop`)
		expect(withdrawn.status).toBe(500)
		expect(await withdrawn.text()).toContain('binding-target-missing')
	})
})
