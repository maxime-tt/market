import { expect, test } from '@playwright/test'

/**
 * Layout bands. `PageHeader` is the sticky desktop band; `MobilePageHeader` is
 * the compact-viewport band. At the default desktop viewport only the former is
 * visible, so the compact band is asserted as attached rather than visible.
 */

test('renders the layout bands', async ({ page }) => {
	await page.goto('/?library=layout')

	await expect(page.getByTestId('widget-PageHeader')).toBeVisible()
	await expect(page.getByTestId('widget-MobilePageHeader')).toBeAttached()
})

test('shows the page header title block and actions', async ({ page }) => {
	await page.goto('/?library=layout')

	const band = page.getByTestId('widget-PageHeader')
	await expect(band).toContainText('Products')
	await expect(band).toContainText('Everything you have listed for sale.')
	await expect(band.getByRole('button', { name: 'Add product' })).toBeVisible()
})

test('keeps the desktop band sticky so it pins while the page scrolls', async ({ page }) => {
	await page.goto('/?library=layout')

	const band = page.getByTestId('widget-PageHeader').locator('[data-slot="page-header"]')
	await expect(band).toHaveClass(/sticky/)
	await expect(band).toHaveClass(/lg:flex/)
})
