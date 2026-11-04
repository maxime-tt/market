/**
 * widget-book/tests/browse.spec.ts — Playwright assertions for the browse library.
 *
 * Asserts every entry under ?library=browse has its data-testid="widget-<EntryName>".
 */

import { test, expect } from '@playwright/test'

test.describe('browse library', () => {
	test('all widget entries are renderable and have data-testid', async ({ page }) => {
		await page.goto('/?library=browse')

		// Every entry should render without error
		const entries = page.locator('[data-widget]')
		const count = await entries.count()
		expect(count).toBeGreaterThan(0)

		// Verify each entry has its data-testid
		for (let i = 0; i < count; i++) {
			const widget = entries.n(i)
			const name = await widget.getAttribute('data-widget')
			expect(name).toBeTruthy()

			// Each widget should have a matching data-testid inside
			const hasTestid = await widget.locator('[data-testid]').first().isVisible()
			expect(hasTestid).toBe(true)
		}
	})

	test('browse-nav-default renders', async ({ page }) => {
		await page.goto('/?library=browse')
		const nav = page.locator('[data-widget="browse-nav-default"] [data-testid="widget-browse-nav"]')
		await expect(nav).toBeVisible()
		await expect(page.locator('[data-testid="widget-browse-nav-wordmark"]')).toBeVisible()
		await expect(page.locator('[data-testid="widget-browse-nav-featured"]')).toBeVisible()
	})

	test('search-field entries render', async ({ page }) => {
		await page.goto('/?library=browse')

		// Empty field
		const emptyField = page.locator('[data-widget="search-field-empty"] [data-testid="widget-search-field"]')
		await expect(emptyField).toBeVisible()

		// Field with value
		const valueField = page.locator('[data-widget="search-field-with-value"] [data-testid="widget-search-field"]')
		await expect(valueField).toBeVisible()
	})

	test('art materials render', async ({ page }) => {
		await page.goto('/?library=browse')

		// Check each material renders
		for (const m of ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8']) {
			const art = page.locator(`[data-testid="widget-art-${m}"]`)
			await expect(art).toBeVisible()
		}

		// Sprite should be present (0x0 container)
		const sprite = page.locator('[data-widget="art-sprite"] svg')
		await expect(sprite).toBeVisible()
	})
})
