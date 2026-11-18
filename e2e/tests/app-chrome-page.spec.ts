import { expect, test } from '../fixtures'
import type { APIRequestContext, Page } from '@playwright/test'
import { finalizeEvent, getPublicKey, type EventTemplate } from 'nostr-tools/pure'
import { Relay, useWebSocketImplementation } from 'nostr-tools/relay'
import { hexToBytes } from '@noble/hashes/utils.js'
import WebSocket from 'ws'
import { BASE_URL, RELAY_URL, TEST_APP_PRIVATE_KEY } from '../test-config'
import { STOREFRONT_PAGE_KIND, STOREFRONT_PAGE_VERSION } from '../../sdk/commerce/storefront/storefrontPage'
import { ROUTE_INTENT_KIND, ROUTE_INTENT_VERSION } from '../../sdk/commerce/storefront/routeIntent'

useWebSocketImplementation(WebSocket)

/**
 * The increment-6 acceptance proof: a bound path renders **inside the app** on a
 * cold load, and the same path renders standalone when the author opts out.
 *
 * This is the assertion no bun suite can make. The header, footer, cart and
 * navigation are client-rendered, so whether a cold load of a bound path
 * produces the app or a bare document is only visible to a browser — and it is
 * the whole point of the change: before it, one URL had two looks.
 *
 * Deliberately a **logged-out** load: the spec takes the base `page` fixture,
 * which injects no auth state, rather than the `unauthenticatedPage` fixture.
 * That fixture waits for `login-button` on `/` — and the browse home hides the
 * app header (it has its own nav), so it cannot pass on this tree for a reason
 * that predates the routing work. This spec needs a *cold, anonymous* document
 * load of the bound path and nothing else.
 *
 * Both halves of the write happen here, because the app-chrome answer needs
 * both: the page must be on the **relay** (the client's `StorefrontAddressPage`
 * reads the document there) and through the **ingest** (the server's local
 * store is what decides how the path answers).
 */

const APP_SK = TEST_APP_PRIVATE_KEY
const APP_PUBKEY = getPublicKey(hexToBytes(APP_SK))

/** One stable address, so a rerun replaces rather than accumulates bindings. */
const PATH = 'app-chrome-e2e'
const MARKER = 'APP-CHROME-MARKER'

const pageDocument = (chrome: 'app' | 'standalone') => ({
	version: STOREFRONT_PAGE_VERSION,
	enabled: true,
	chrome,
	root: { props: { title: 'App chrome e2e' } },
	content: [
		{
			type: 'Text',
			props: { id: 'text-1', markdown: `${MARKER} rendered by the block renderer.`, align: 'left', width: 'normal' },
		},
	],
})

async function publishToRelay(template: EventTemplate) {
	const relay = await Relay.connect(RELAY_URL)
	try {
		await relay.publish(finalizeEvent(template, hexToBytes(APP_SK)))
	} finally {
		relay.close()
	}
}

/** The one write surface, as the app posts it: signed, and `stored: true` or it is not served. */
async function postToIngest(request: APIRequestContext, template: EventTemplate) {
	const event = finalizeEvent(template, hexToBytes(APP_SK))
	const response = await request.post(`${BASE_URL}/api/app-events`, { data: { event } })
	expect(await response.json().catch(() => ({ stored: null }))).toMatchObject({ stored: true })
	expect(response.status()).toBe(200)
}

async function writePage(request: APIRequestContext, chrome: 'app' | 'standalone') {
	const template: EventTemplate = {
		kind: STOREFRONT_PAGE_KIND,
		created_at: Math.floor(Date.now() / 1000),
		tags: [['d', PATH]],
		content: JSON.stringify(pageDocument(chrome)),
	}
	await publishToRelay(template)
	await postToIngest(request, template)
}

/** A binding is ingest-only: it never goes to a relay, and no client asks one for it. */
async function bindPath(request: APIRequestContext) {
	await postToIngest(request, {
		kind: ROUTE_INTENT_KIND,
		created_at: Math.floor(Date.now() / 1000),
		tags: [['d', PATH]],
		content: JSON.stringify({
			version: ROUTE_INTENT_VERSION,
			action: 'set',
			path: PATH,
			target: { type: 'page', author: APP_PUBKEY, d: PATH },
		}),
	})
}

/** A document load, not a client-side navigation: this is the case under test. */
async function coldLoad(page: Page, path: string) {
	await page.goto(path, { waitUntil: 'domcontentloaded' })
}

test.use({ scenario: 'merchant' })

test.describe('a bound path renders inside the app', () => {
	test('app chrome by default, standalone when the author opts out', async ({ page, request }) => {
		await writePage(request, 'app')
		await bindPath(request)

		// ── the default: the app's own chrome, with the page rendered inside it
		await coldLoad(page, `/${PATH}`)

		await expect(page.getByTestId('storefront-page')).toBeVisible({ timeout: 20_000 })
		await expect(page.getByText(MARKER)).toBeVisible({ timeout: 20_000 })
		// The header and footer are the app's, and this visitor is logged out.
		await expect(page.getByTestId('login-button')).toBeVisible({ timeout: 20_000 })
		await expect(page.locator('footer')).toBeVisible({ timeout: 20_000 })
		// And *not* the served-document seam: this URL is the app's, not a page's.
		await expect(page.locator('[data-ar-served-page]')).toHaveCount(0)

		// ── the opt-out: the author flips one switch, and the URL changes look
		await writePage(request, 'standalone')
		await coldLoad(page, `/${PATH}`)

		await expect(page.locator('[data-ar-served-page]')).toHaveCount(1, { timeout: 20_000 })
		await expect(page.getByText(MARKER)).toBeVisible({ timeout: 20_000 })
		// No header at all: a standalone page is its own document.
		await expect(page.getByTestId('login-button')).toHaveCount(0)
	})
})
