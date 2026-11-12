import { expect, test } from '@playwright/test'

test('renders the catalogue shell for every library', async ({ page }) => {
	await page.goto('/?library=*')

	await expect(page.getByTestId('widget-book-title')).toBeVisible()
	await expect(page.getByTestId('library-atoms')).toBeVisible()
	await expect(page.getByTestId('widget-SelectableBadge')).toBeVisible()
})

test('honours the launch/query library selection', async ({ page }) => {
	await page.goto('/?library=atoms')

	await expect(page.getByTestId('widget-book-selection')).toHaveText('atoms')
	await expect(page.getByTestId('library-atoms')).toBeVisible()
})
