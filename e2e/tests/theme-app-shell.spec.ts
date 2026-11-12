import { test, expect } from '../fixtures'
import type { Page } from '@playwright/test'

/**
 * P0b acceptance check — D3/D4 contract rev 2.3, ruling V11.
 *
 * The app shell must run under `ThemeMigrationWrapper` so a theme token
 * actually moves the UI. This check proves the wiring, not a mock:
 *
 *   1. `.theme-new` is attached at the app root on BOTH a storefront (`/`)
 *      and a dashboard (`/dashboard`) route. If `ThemeMigrationWrapper` is
 *      removed from `platform/web/frontend.tsx`, the first assertion fails.
 *   2. Flipping ONE token (`--radius`) changes the computed border-radius of
 *      the rendered subtree on BOTH surfaces.
 *
 * Literal flip: the check does not drive a preset; it overrides `--radius`
 * on the `.theme-new` app-shell scope and reads back real computed styles.
 */

async function radiusSignature(page: Page): Promise<string> {
	return page.evaluate(() => {
		const scope = document.querySelector<HTMLElement>('.theme-new')
		if (!scope) throw new Error('no .theme-new at the app shell — ThemeMigrationWrapper is not mounted')
		return Array.from(scope.querySelectorAll<HTMLElement>('*'))
			.map((node) => getComputedStyle(node).borderTopLeftRadius)
			.join(',')
	})
}

async function flipRadiusToken(page: Page): Promise<void> {
	await page.evaluate(() => {
		const scope = document.querySelector<HTMLElement>('.theme-new')
		if (!scope) throw new Error('no .theme-new at the app shell')
		scope.style.setProperty('--radius', '42px')
	})
}

for (const [surface, path] of [
	['storefront', '/'],
	['dashboard', '/dashboard'],
] as const) {
	test(`flipping --radius moves the rendered ${surface}`, async ({ merchantPage: page }) => {
		await page.goto(path)
		await page.waitForLoadState('domcontentloaded')
		// `.theme-new` is the app-shell scope; `display: contents` keeps it out
		// of the layout box tree, so assert attachment rather than visibility.
		await expect(page.locator('.theme-new').first()).toBeAttached({ timeout: 10_000 })
		await page.waitForTimeout(500)

		const before = await radiusSignature(page)
		await flipRadiusToken(page)
		const after = await radiusSignature(page)

		expect(before).not.toBe(after)
	})
}
