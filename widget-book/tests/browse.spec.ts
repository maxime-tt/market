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
		await expect(page.getByTestId('widget-browse-idle-with-stats')).toBeVisible()
	})

	// The regression guard for the fabricated hero statistics: the entry with no
	// stats renders the hero's MotD band with no text in it at all. (The band is
	// an empty flex line then, which is why its *text* is asserted, not visibility.)
	test('the idle hero renders no number it was not handed', async ({ page }) => {
		await page.goto('/?library=browse')
		const noStats = page.getByTestId('widget-browse-idle-default')
		await expect(noStats).toBeVisible()
		const motd = noStats.getByTestId('widget-browse-idle-motd')
		expect(await motd.textContent()).toBe('')

		// ...and the entry that is handed facts states them, scoped as loaded.
		const withStats = page.getByTestId('widget-browse-idle-with-stats')
		const statsMotd = withStats.getByTestId('widget-browse-idle-motd')
		await expect(statsMotd).toContainText('1,208 items loaded from 38 sellers')
		await expect(statsMotd).toContainText('412 posted in the last 24 hours')
		await expect(statsMotd).toContainText('38 relays queried')
	})

	test('browse by category entries', async ({ page }) => {
		await page.goto('/?library=browse')

		// the section, its rows and their headers
		const rowsEntry = page.getByTestId('widget-category-rows-default')
		await expect(rowsEntry.getByTestId('widget-category-rows')).toBeVisible()
		await expect(rowsEntry.getByTestId('widget-category-row-Bitcoin')).toBeVisible()
		await expect(rowsEntry.getByTestId('widget-category-row-see-all-Bitcoin')).toBeVisible()
		await expect(rowsEntry.getByTestId('widget-category-row-Health & Beauty')).toBeVisible()
		// the header states the loaded count, never a market total
		await expect(rowsEntry.getByTestId('widget-category-row-Bitcoin')).toContainText('4 loaded')
		// the row's cards are the frame's treatment: no top rule
		await expect(rowsEntry.locator('[data-testid^="widget-product-card-price-"]').first()).toBeVisible()

		// the section's own read states
		await expect(page.getByTestId('widget-category-rows-failed').getByTestId('widget-category-rows-error')).toContainText(
			'no relay answered',
		)
		await expect(page.getByTestId('widget-category-rows-loading').locator('[data-slot="skeleton-card"]').first()).toBeVisible()
	})

	test('the featured nav marks its destination current', async ({ page }) => {
		await page.goto('/?library=browse')
		const entry = page.getByTestId('widget-browse-nav-featured-current')
		const featured = entry.getByTestId('widget-browse-nav-featured')
		await expect(featured).toHaveAttribute('aria-current', 'page')
		await expect(featured).toHaveAttribute('href', '/featured')
		await expect(featured).toHaveClass(/border-b-2 border-fill-ink/)
		// the marker is on exactly one destination: the wordmark is not current
		await expect(entry.getByTestId('widget-browse-nav-wordmark')).not.toHaveAttribute('aria-current', 'page')
	})

	test('the row card presentation renders without a top rule', async ({ page }) => {
		await page.goto('/?library=browse')
		const card = page.getByTestId('widget-product-card-row-card')
		await expect(card).toBeVisible()
		await expect(card).not.toHaveClass(/border-border-strong/)
		await expect(card.locator('[data-testid^="widget-product-art-"]')).toHaveClass(/aspect-\[16\/9\]/)
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

	test('seller profile entries', async ({ page }) => {
		await page.goto('/?library=browse')
		await expect(page.getByTestId('widget-product-card-with-category')).toBeVisible()
		await expect(page.getByTestId('widget-seller-profile-header-default')).toBeVisible()
		await expect(page.getByTestId('widget-seller-profile-header-minimal')).toBeVisible()
		await expect(page.getByTestId('widget-seller-profile-view-default')).toBeVisible()
		await expect(page.getByTestId('widget-seller-profile-view-loading')).toBeVisible()
		await expect(page.getByTestId('widget-seller-profile-view-empty')).toBeVisible()
	})

	test('split-view entries', async ({ page }) => {
		await page.goto('/?library=browse')
		await expect(page.getByTestId('widget-split-view-default')).toBeVisible()
		// the frame's split: a master pane, a drag separator, a detail pane
		await expect(page.getByTestId('widget-split-view-default').locator('[data-slot="split-master"]')).toBeVisible()
		await expect(page.getByTestId('widget-split-view-default').locator('[data-slot="split-separator"]')).toBeVisible()
		await expect(page.getByTestId('widget-split-view-default').locator('[data-slot="split-detail"]')).toBeVisible()
	})

	test('product-detail-panel entries', async ({ page }) => {
		await page.goto('/?library=browse')
		await expect(page.getByTestId('widget-product-detail-default')).toBeVisible()
		await expect(page.getByTestId('widget-product-detail-open')).toBeVisible()
		await expect(page.getByTestId('widget-product-detail-no-tags')).toBeVisible()
		await expect(page.getByTestId('widget-product-detail-loading')).toBeVisible()
		await expect(page.getByTestId('widget-product-detail-empty')).toBeVisible()
		await expect(page.getByTestId('widget-product-detail-error')).toBeVisible()
	})

	test('product-detail entries render the frame content and every state', async ({ page }) => {
		await page.goto('/?library=browse')

		// the open panel (the frame's own state): title, action row beside it, sats, stock
		const open = page.getByTestId('widget-product-detail-open')
		await expect(open.locator('[data-slot="product-detail-title"]')).toHaveText('Handcrafted Ceramic Ball')
		await expect(open.locator('[data-slot="product-detail-price"]')).toContainText('21,000')
		await expect(open.locator('[data-slot="product-detail-stock"]')).toHaveText('76 in stock')
		await expect(open.locator('[data-slot="tools"]')).toBeVisible()
		await expect(open.getByTestId('widget-product-context-menu')).toBeVisible()

		// the read states
		await expect(page.getByTestId('widget-product-detail-loading').locator('[data-state="loading"]')).toBeVisible()
		await expect(page.getByTestId('widget-product-detail-empty').locator('[data-slot="empty-state"]')).toContainText(
			'This listing is not on the relays',
		)
		await expect(page.getByTestId('widget-product-detail-error').getByTestId('widget-product-detail-retry')).toBeVisible()
	})

	test('selected product card entry', async ({ page }) => {
		await page.goto('/?library=browse')
		await expect(page.getByTestId('widget-product-card-selected')).toBeVisible()
		await expect(page.getByTestId('widget-product-card-selected').locator('[data-slot="card-open-note"]')).toHaveText(/·\s*open/)
	})
})
