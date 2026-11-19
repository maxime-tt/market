import { test, expect } from '../fixtures'

test.use({ scenario: 'base' })

test.describe('Navigation', () => {
	test('homepage loads and shows the app bar', async ({ page }) => {
		await page.goto('/')
		// The bar is the frame's, mounted on every route; its testid is the stable
		// contract (the legacy `<header>` it replaced was route-dependent).
		await expect(page.getByTestId('widget-app-bar')).toBeVisible()
	})

	test('products page loads', async ({ page }) => {
		await page.goto('/products')
		await expect(page).toHaveURL(/\/products/)
	})

	test('community page loads', async ({ page }) => {
		await page.goto('/community')
		await expect(page).toHaveURL(/\/community/)
	})

	test('authenticated user can access dashboard', async ({ merchantPage }) => {
		await merchantPage.goto('/dashboard')
		await expect(merchantPage).toHaveURL(/\/dashboard/)
	})

	test('dashboard shows navigation sections', async ({ merchantPage }) => {
		await merchantPage.goto('/dashboard')

		// Verify key dashboard nav section headings are visible
		await expect(merchantPage.getByRole('heading', { name: 'SALES' })).toBeVisible()
		await expect(merchantPage.getByRole('heading', { name: 'PRODUCTS' })).toBeVisible()
		await expect(merchantPage.getByRole('heading', { name: 'ACCOUNT' })).toBeVisible()
	})

	test('dashboard products link navigates correctly', async ({ merchantPage }) => {
		await merchantPage.goto('/dashboard')

		// Click the sidebar Products link (not the app bar one)
		await merchantPage
			.locator('[data-slot="sidebar-nav"]')
			.getByRole('link', { name: /Products/i })
			.click()
		await expect(merchantPage).toHaveURL(/\/dashboard\/products/)
	})
})
