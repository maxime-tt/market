import { expect, test } from '@playwright/test'

/**
 * Dashboard list-item and overview views. Each entry is a literal event, so
 * titles, fallback copy and counts are asserted without any host plumbing.
 */

const entryNames = [
	'DashboardCollectionTrigger',
	'DashboardCollectionDetails',
	'DashboardCollectionDetailsBare',
	'DashboardProductTrigger',
	'DashboardProductTriggerHidden',
	'DashboardProductDetails',
	'DashboardOverviewStats',
	'DashboardOverviewStatsLoading',
	'TestLabelButtonView',
	'TestLabelButtonViewLabeled',
	'TestLabelDialogView',
	'TestLabelDialogViewUnmark',
]

test('renders the dashboard library', async ({ page }) => {
	await page.goto('/?library=dashboard')

	await expect(page.getByTestId('widget-book-selection')).toHaveText('dashboard')
	await expect(page.getByTestId('library-dashboard')).toBeVisible()

	for (const widget of entryNames) {
		await expect(page.getByTestId(`widget-${widget}`)).toBeVisible()
	}
})

test('shows the collection title in the trigger', async ({ page }) => {
	await page.goto('/?library=dashboard')

	const trigger = page.getByTestId('widget-DashboardCollectionTrigger')
	await expect(trigger).toContainText('Autumn Drops')
})

test('shows the collection summary, description and product count', async ({ page }) => {
	await page.goto('/?library=dashboard')

	const details = page.getByTestId('widget-DashboardCollectionDetails')
	await expect(details).toContainText('Fresh hardware for the heating season.')
	await expect(details).toContainText('Hand-picked miners that ship before the difficulty bump.')
	await expect(details).toContainText('Products:')
	await expect(details).toContainText('2')
	await expect(details.locator('img')).toHaveCount(1)
})

test('falls back to the default copy for a bare collection', async ({ page }) => {
	await page.goto('/?library=dashboard')

	const bare = page.getByTestId('widget-DashboardCollectionDetailsBare')
	await expect(bare).toContainText('No summary available.')
	await expect(bare).toContainText('Products:')
	await expect(bare).toContainText('0')
	await expect(bare.locator('img')).toHaveCount(0)
})

test('shows the product trigger with its image and the hidden variant with the placeholder box', async ({ page }) => {
	await page.goto('/?library=dashboard')

	const trigger = page.getByTestId('widget-DashboardProductTrigger')
	await expect(trigger).toContainText('Antminer S21')
	await expect(trigger.locator('img')).toHaveCount(1)

	const hidden = page.getByTestId('widget-DashboardProductTriggerHidden')
	await expect(hidden).toContainText('Test Rig (hidden)')
	await expect(hidden.locator('img')).toHaveCount(0)
})

test('renders the product details inside the host link', async ({ page }) => {
	await page.goto('/?library=dashboard')

	const details = page.getByTestId('widget-DashboardProductDetails')
	await expect(details.locator('a')).toHaveAttribute('href', '/product/antminer-s21')
	await expect(details).toContainText('A quiet, efficient home miner in original packaging.')
	await expect(details).toContainText('2100 SATS')
	await expect(details).toContainText('on-sale')
	await expect(details).toContainText('12 in stock')
	await expect(details).toContainText('Click to view product page →')
})

test('counts the overview stats from the passed events', async ({ page }) => {
	await page.goto('/?library=dashboard')

	const stats = page.getByTestId('widget-DashboardOverviewStats')
	// Two products, one hidden; the user placed one order and received one; three conversations.
	await expect(stats.locator('article').filter({ hasText: 'Active Listings' })).toContainText('1')
	await expect(stats.locator('article').filter({ hasText: 'Sales' })).toContainText('1')
	await expect(stats.locator('article').filter({ hasText: 'Purchases' })).toContainText('1')
	await expect(stats.locator('article').filter({ hasText: 'Messages' })).toContainText('4')
	await expect(stats.locator('[aria-label^="Loading"]')).toHaveCount(0)
})

test('shows the loading skeletons while the stats load', async ({ page }) => {
	await page.goto('/?library=dashboard')

	const stats = page.getByTestId('widget-DashboardOverviewStatsLoading')
	await expect(stats.locator('[aria-label^="Loading"]')).toHaveCount(4)
	await expect(stats.locator('.animate-pulse')).toHaveCount(4)
})

test('toggles the test-label button copy with the labelled state', async ({ page }) => {
	await page.goto('/?library=dashboard')

	await expect(page.getByTestId('widget-TestLabelButtonView').getByRole('button')).toHaveAccessibleName('Mark as Test Product')
	await expect(page.getByTestId('widget-TestLabelButtonViewLabeled').getByRole('button')).toHaveAccessibleName('Unmark as Test Product')
})

test('opens the mark dialog from the trigger and edits the appeal message', async ({ page }) => {
	await page.goto('/?library=dashboard')

	await page.getByTestId('widget-TestLabelDialogView').getByRole('button', { name: 'Mark as Test Product' }).click()

	const dialog = page.getByRole('alertdialog')
	await expect(dialog).toContainText('Mark this product as a test listing?')
	await expect(dialog.getByTestId('test-label-content-product')).toHaveValue(
		'Curated test listing — appeal to the marketplace team to relist.',
	)

	await dialog.getByRole('button', { name: 'Cancel' }).click()
	await expect(page.getByRole('alertdialog')).toHaveCount(0)
})

test('opens the unmark confirmation from the trigger', async ({ page }) => {
	await page.goto('/?library=dashboard')

	await page.getByTestId('widget-TestLabelDialogViewUnmark').getByRole('button', { name: 'Unmark as Test Product' }).click()

	const dialog = page.getByRole('alertdialog')
	await expect(dialog).toContainText('Remove the test label?')
	await expect(dialog.getByTestId('test-label-unmark-description-product')).toBeVisible()
	await expect(dialog.getByRole('button', { name: 'Unmark as Test' })).toBeEnabled()

	await dialog.getByRole('button', { name: 'Cancel' }).click()
	await expect(page.getByRole('alertdialog')).toHaveCount(0)
})
