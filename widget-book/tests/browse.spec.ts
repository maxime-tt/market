/**
 * widget-book/tests/browse.spec.ts — Playwright assertions for the browse library.
 *
 * Asserts every entry under ?library=browse has its data-testid="widget-<EntryName>".
 */

import { test, expect } from '@playwright/test'

test.describe('browse library', () => {
	test('renders the browse library catalog', async ({ page }) => {
		await page.goto('/?library=browse')
		await expect(page.getByTestId('widget-book-selection')).toHaveText('browse')
		await expect(page.getByTestId('library-browse')).toBeVisible()
	})

	test('browse-nav entries', async ({ page }) => {
		await page.goto('/?library=browse')
		await expect(page.getByTestId('widget-browse-nav-default')).toBeVisible()
		await expect(page.getByTestId('widget-browse-nav-inactive')).toBeVisible()
		await expect(page.getByTestId('widget-browse-nav-with-slots')).toBeVisible()
	})

	test('search-field entries', async ({ page }) => {
		await page.goto('/?library=browse')
		await expect(page.getByTestId('widget-search-field-empty')).toBeVisible()
		await expect(page.getByTestId('widget-search-field-with-value')).toBeVisible()
		await expect(page.getByTestId('widget-search-field-focused')).toBeVisible()
	})

	test('art module entries', async ({ page }) => {
		await page.goto('/?library=browse')
		await expect(page.getByTestId('widget-art-sprite')).toBeVisible()
		for (const m of ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8']) {
			await expect(page.getByTestId(`widget-art-${m}`)).toBeVisible()
		}
		await expect(page.getByTestId('widget-art-all-materials')).toBeVisible()
	})

	test('product-card entries', async ({ page }) => {
		await page.goto('/?library=browse')
		await expect(page.getByTestId('widget-product-card-default')).toBeVisible()
		await expect(page.getByTestId('widget-product-card-in-list')).toBeVisible()
		await expect(page.getByTestId('widget-product-card-auction')).toBeVisible()
		await expect(page.getByTestId('widget-product-card-menu-open')).toBeVisible()
	})

	test('product-strip entries', async ({ page }) => {
		await page.goto('/?library=browse')
		await expect(page.getByTestId('widget-product-strip-default')).toBeVisible()
		await expect(page.getByTestId('widget-product-strip-single')).toBeVisible()
	})

	test('account-pane entries', async ({ page }) => {
		await page.goto('/?library=browse')
		await expect(page.getByTestId('widget-account-pane-default')).toBeVisible()
	})

	test('list-views entries', async ({ page }) => {
		await page.goto('/?library=browse')
		await expect(page.getByTestId('widget-list-row-default')).toBeVisible()
		await expect(page.getByTestId('widget-list-detail-default')).toBeVisible()
	})

	test('relay-indicator entries', async ({ page }) => {
		await page.goto('/?library=browse')
		await expect(page.getByTestId('widget-relay-indicator-default')).toBeVisible()
		await expect(page.getByTestId('widget-dead-search-error-default')).toBeVisible()
	})

	test('browse-idle entries', async ({ page }) => {
		await page.goto('/?library=browse')
		await expect(page.getByTestId('widget-browse-idle-default')).toBeVisible()
		await expect(page.getByTestId('widget-browse-idle-with-search')).toBeVisible()
	})

	test('skeleton-grid entries', async ({ page }) => {
		await page.goto('/?library=browse')
		await expect(page.getByTestId('widget-skeleton-grid-default')).toBeVisible()
	})

	test('empty-state-browse entries', async ({ page }) => {
		await page.goto('/?library=browse')
		await expect(page.getByTestId('widget-empty-state-browse-default')).toBeVisible()
	})

	test('tag-filtered-badge entries', async ({ page }) => {
		await page.goto('/?library=browse')
		await expect(page.getByTestId('widget-tag-filtered-badge-default')).toBeVisible()
	})

	test('relay-indicator expanded entries', async ({ page }) => {
		await page.goto('/?library=browse')
		await expect(page.getByTestId('widget-relay-indicator-expanded')).toBeVisible()
	})

	test('search-results-grid entries', async ({ page }) => {
		await page.goto('/?library=browse')
		await expect(page.getByTestId('widget-search-results-grid-default')).toBeVisible()
		await expect(page.getByTestId('widget-search-results-grid-active-facet')).toBeVisible()
		await expect(page.getByTestId('widget-search-results-grid-no-facets')).toBeVisible()
	})
})
