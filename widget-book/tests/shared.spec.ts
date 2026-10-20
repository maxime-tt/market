import { expect, test } from '@playwright/test'

test('renders the shared state atoms', async ({ page }) => {
	await page.goto('/?library=shared')

	await expect(page.getByTestId('widget-book-selection')).toHaveText('shared')
	await expect(page.getByTestId('library-shared')).toBeVisible()

	for (const widget of [
		'EmptyState',
		'EmptyStateAction',
		'ErrorState',
		'LoadingStateSpinner',
		'LoadingStateSkeleton',
		'StatCard',
		'DetailField',
	]) {
		await expect(page.getByTestId(`widget-${widget}`)).toBeVisible()
	}
})

test('shows the meaningful state copy', async ({ page }) => {
	await page.goto('/?library=shared')

	await expect(page.getByTestId('widget-EmptyState')).toContainText('No products yet')
	await expect(page.getByTestId('widget-EmptyStateAction')).toContainText('No shipping options')
	await expect(page.getByTestId('widget-ErrorState')).toContainText('Could not load orders')
	await expect(page.getByTestId('widget-ErrorState')).toContainText('Try again')
	await expect(page.getByTestId('widget-LoadingStateSkeleton').locator('[data-slot="skeleton"]')).toHaveCount(3)
	await expect(page.getByTestId('widget-StatCard')).toContainText('128,400 sats')
	await expect(page.getByTestId('widget-DetailField')).toContainText('includes shipping')
})
