import { expect, test } from '@playwright/test'

/**
 * Navigation renderers. The entries are built from the real `DASHBOARD_NAV`
 * through the real `resolveNavView`, so these assertions pin the projection the
 * app runs: section order, badge caps, admin gating, and the back control's
 * resolved label.
 */

test('renders the nav library', async ({ page }) => {
	await page.goto('/?library=nav')

	await expect(page.getByTestId('widget-book-selection')).toHaveText('nav')
	await expect(page.getByTestId('library-nav')).toBeVisible()

	for (const widget of [
		'SidebarNav',
		'SidebarNavBadgesOverflow',
		'SidebarNavAdmin',
		'BackButtonInline',
		'BackButtonIcon',
		'BackButtonResolvedTarget',
	]) {
		await expect(page.getByTestId(`widget-${widget}`)).toBeVisible()
	}
})

test('projects the dashboard model into sections, in model order', async ({ page }) => {
	await page.goto('/?library=nav')

	const sidebar = page.getByTestId('widget-SidebarNav')
	await expect(sidebar.locator('[data-slot="sidebar-nav"]')).toHaveCount(1)

	const headings = sidebar.locator('h3')
	await expect(headings.first()).toHaveText('SALES')
	// Model order, and only non-admin sections for a non-admin viewer.
	expect(await headings.allTextContents()).toEqual(['SALES', 'PRODUCTS', 'ACCOUNT', 'INFO'])
	await expect(sidebar).not.toContainText('APP SETTINGS')

	// The emoji and title are joined by the renderer, never parsed out of one string.
	await expect(sidebar.getByRole('link', { name: '💰 Sales' })).toBeVisible()
	await expect(sidebar.getByRole('link', { name: '📦 Products' })).toBeVisible()
})

test('marks the active item and shows resolved badge counts', async ({ page }) => {
	await page.goto('/?library=nav')

	const sidebar = page.getByTestId('widget-SidebarNav')
	await expect(sidebar.locator('[data-status="active"]')).toHaveCount(1)
	await expect(sidebar.locator('[data-status="active"]')).toContainText('Sales')

	await expect(sidebar.getByRole('link', { name: '💰 Sales' })).toContainText('3')
	await expect(sidebar.getByRole('link', { name: '✉️ Messages' })).toContainText('12')
	// An item with no resolved badge renders no badge at all.
	await expect(sidebar.getByRole('link', { name: '♻️ Circular Economy' })).not.toContainText('0')
})

test('caps a badge at 99+', async ({ page }) => {
	await page.goto('/?library=nav')

	const sidebar = page.getByTestId('widget-SidebarNavBadgesOverflow')
	await expect(sidebar.getByRole('link', { name: '📦 Products' })).toContainText('99+')
	await expect(sidebar).not.toContainText('250')
})

test('admin gating adds the app-settings section', async ({ page }) => {
	await page.goto('/?library=nav')

	const admin = page.getByTestId('widget-SidebarNavAdmin')
	await expect(admin).toContainText('APP SETTINGS')
	await expect(admin.getByRole('link', { name: '👥 Team' })).toBeVisible()
})

test('renders both back-button variants and fires its callback', async ({ page }) => {
	await page.goto('/?library=nav')

	const inline = page.getByTestId('widget-BackButtonInline')
	const inlineButton = inline.getByRole('button', { name: 'Sales' })
	await expect(inlineButton).toBeVisible()
	await expect(inlineButton).toHaveAttribute('data-variant', 'inline')
	await expect(inlineButton).toContainText('Sales')
	await inlineButton.click()
	await inlineButton.click()
	await expect(inline).toContainText('onClick fired 2 times')

	// The icon variant never shows its label, but must still be named for a11y.
	const icon = page.getByTestId('widget-BackButtonIcon')
	const iconButton = icon.getByRole('button', { name: 'Sales' })
	await expect(iconButton).toHaveAttribute('data-variant', 'icon')
	await expect(iconButton).not.toContainText('Sales')
})

test('resolves the back target from the model, not the path', async ({ page }) => {
	await page.goto('/?library=nav')

	const resolved = page.getByTestId('widget-BackButtonResolvedTarget')
	await expect(resolved).toContainText("resolveBackTarget('/dashboard/sales/messages')")
	await expect(resolved.getByRole('button')).toBeVisible()
})
