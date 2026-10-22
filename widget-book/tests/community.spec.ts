import { expect, test } from '@playwright/test'

/**
 * Community placeholders. The testids are the same ones the community
 * progressive-loading suite asserts on, so a rename here is a real regression.
 */

test('renders the community library', async ({ page }) => {
	await page.goto('/?library=community')

	await expect(page.getByTestId('widget-book-selection')).toHaveText('community')
	await expect(page.getByTestId('library-community')).toBeVisible()
	await expect(page.getByTestId('widget-CollectionSkeletons')).toBeVisible()
	await expect(page.getByTestId('widget-MerchantSkeletons')).toBeVisible()
})

test('renders the collection and merchant placeholder grids', async ({ page }) => {
	await page.goto('/?library=community')

	const collections = page.getByTestId('widget-CollectionSkeletons')
	await expect(collections.getByTestId('community-collections-skeleton')).toHaveCount(4)
	await expect(collections).not.toContainText('community-merchants-skeleton')

	const merchants = page.getByTestId('widget-MerchantSkeletons')
	await expect(merchants.getByTestId('community-merchants-skeleton')).toHaveCount(3)
})
