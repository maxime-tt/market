#!/usr/bin/env bun
/**
 * Visual + console sweep for the ADR-0007 UI migration.
 *
 * Drives a headless Chromium over the routes the migration touched, against an
 * already-running local stack, and reports for each route: HTTP status, rendered
 * text length (a blank page shows up as a tiny number), and any NEW console
 * errors / page errors. Screenshots land in the output directory for eyeballing.
 *
 * Why this exists: `bun test ui`, `test:unit` and the widget book all render in
 * jsdom-free static markup or an isolated harness, so none of them can catch a
 * client-side runtime warning. The first run of this script found the
 * `colored` / `deterministicFallbackText` / `totalNotifications` DOM-attribute
 * leaks that the static gates were blind to.
 *
 * Usage — requires a seeded stack (relay + `bun run dev:seed`):
 *   bun run scripts/ui-visual-check.ts
 *   BASE_URL=http://localhost:3456 OUT_DIR=/tmp/shots bun run scripts/ui-visual-check.ts
 *
 * Env:
 *   BASE_URL  app origin              (default http://localhost:3456)
 *   OUT_DIR   screenshot directory    (default /tmp/pm-ui-visual-check)
 *   TIMEOUT   per-navigation ms       (default 20000)
 */

import { mkdir } from 'node:fs/promises'
import { chromium } from '@playwright/test'
import { setupAuthContext, type TestUser } from '../e2e/fixtures/auth'

/** devUser1 — owner/admin. A committed dev fixture, see `src/lib/fixtures.ts`. */
const DEV_USER1: TestUser = {
	pk: '86a82cab18b293f53cbaaae8cdcbee3f7ec427fdf9f9c933db77800bb5ef38a0',
	sk: '5c81bffa8303bbd7726d6a5a1170f3ee46de2addabefd6a735845166af01f5c0',
}

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3456'
const OUT_DIR = process.env.OUT_DIR ?? '/tmp/pm-ui-visual-check'
const TIMEOUT = Number(process.env.TIMEOUT ?? 20_000)

/**
 * Routes the migration touched. `blank` guards are deliberately loose — the job
 * is to notice a route that rendered nothing, not to assert copy.
 */
const ROUTES: Array<[path: string, name: string]> = [
	['/', 'home'],
	['/community', 'community'],
	['/products', 'products'],
	['/auctions', 'auctions-index'],
	['/dashboard', 'dashboard-home'],
	['/dashboard/products/auctions', 'dashboard-auctions-list'],
	['/dashboard/products/shipping-options', 'shipping-options'],
	['/dashboard/account/receiving-payments', 'receiving-payments'],
	['/dashboard/account/vanity-url', 'vanity-url'],
	['/dashboard/account/nostr-address', 'nostr-address'],
	['/dashboard/account/profile', 'profile'],
	['/dashboard/account/making-payments', 'making-payments'],
	['/dashboard/app-settings/blacklists', 'blacklists'],
	['/dashboard/app-settings/featured-items', 'featured-items'],
	['/dashboard/products/bids', 'bids'],
	['/dashboard/about', 'about'],
	['/checkout', 'checkout'],
]

/**
 * Environmental noise, not a defect: the seeded app settings point at the
 * production bug relay, and the seeded profiles carry `@example.com` NIP-05
 * addresses that cannot validate. Matched against a request URL, so a real
 * failure to any other host still surfaces.
 */
const IGNORED_HOSTS = ['bugs.plebeian.market', 'example.com', 'picsum.photos']

/** A cancelled request (navigation, lazy-load) is not a failure. */
const CANCELLED = 'net::ERR_ABORTED'

const isIgnored = (url: string) => IGNORED_HOSTS.some((host) => url.includes(host))

/** A route that paints fewer characters than this effectively rendered nothing. */
const EMPTY_TEXT_CHARS = 60

const errors: string[] = []

await mkdir(OUT_DIR, { recursive: true })

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await setupAuthContext(context, DEV_USER1)
// The PII-exposure modal is a blocking Dialog mounted on every route; suppress it
// exactly the way its own Dismiss handler does.
await context.addInitScript((pk: string) => {
	sessionStorage.setItem('pii-warning-dismissed', JSON.stringify([pk]))
}, DEV_USER1.pk)

const page = await context.newPage()
page.on('console', (message) => {
	if (message.type() !== 'error') return
	const text = message.text()
	// This generic line always accompanies a `requestfailed`, which we report
	// with a URL below — keeping both would double-count.
	if (text.startsWith('Failed to load resource: net::ERR_FAILED')) return
	if (!isIgnored(text)) errors.push(`[console] ${text.slice(0, 220)}`)
})
page.on('pageerror', (error) => errors.push(`[pageerror] ${error.message.slice(0, 220)}`))
// Attribute the bare "Failed to load resource: net::ERR_FAILED" console line to
// a URL, so only unexpected targets count.
page.on('requestfailed', (request) => {
	const reason = request.failure()?.errorText ?? '?'
	if (reason === CANCELLED || isIgnored(request.url())) return
	errors.push(`[requestfailed] ${reason} ${request.url().slice(0, 180)}`)
})

let failures = 0
for (const [path, name] of ROUTES) {
	const before = errors.length
	let status = 'ERR'
	try {
		const response = await page.goto(BASE_URL + path, { waitUntil: 'domcontentloaded', timeout: TIMEOUT })
		status = String(response?.status() ?? '?')
	} catch (error) {
		errors.push(`[goto] ${path}: ${(error as Error).message.slice(0, 140)}`)
	}
	await page.waitForTimeout(2500)

	const text = (await page.evaluate(() => document.body.innerText)).trim()
	await page.screenshot({ path: `${OUT_DIR}/${name}.png` })

	const newErrors = errors.length - before
	const blank = text.length < EMPTY_TEXT_CHARS
	if (status !== '200' || blank || newErrors > 0) failures += 1
	console.log(
		`${status}  chars=${String(text.length).padStart(5)}${blank ? ' EMPTY?' : ''}  newErrors=${newErrors}${
			newErrors > 0 ? ' <<' : '  '
		}  ${path}`,
	)
}

await page.goto(`${BASE_URL}/dashboard`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2000)
const loggedIn = !(await page.evaluate(() => document.body.innerText)).includes('Please log in')

await browser.close()

console.log(`\nlogged in as devUser1: ${loggedIn}`)
console.log(`screenshots: ${OUT_DIR}`)
const unique = [...new Set(errors)]
console.log(`\n--- ${unique.length} unique console/page error(s) ---`)
for (const error of unique) console.log(error)

if (failures > 0 || unique.length > 0 || !loggedIn) {
	console.log(`\n${failures} route(s) flagged.`)
	process.exit(1)
}
console.log('\nall routes rendered with no unexpected console errors.')
