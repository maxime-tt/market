import { expect, test } from '@playwright/test'

/**
 * Checkout views. Each entry is a literal-prop render, so the copy and the
 * status tone are asserted without any host plumbing.
 */

test('renders the checkout library', async ({ page }) => {
	await page.goto('/?library=checkout')

	await expect(page.getByTestId('widget-book-selection')).toHaveText('checkout')
	await expect(page.getByTestId('library-checkout')).toBeVisible()

	for (const widget of ['NwcWalletStatusConnected', 'NwcWalletStatusConnectedOne', 'NwcWalletStatusDisconnected']) {
		await expect(page.getByTestId(`widget-${widget}`)).toBeVisible()
	}
})

test('reports the NWC wallet count with one footer', async ({ page }) => {
	await page.goto('/?library=checkout')

	const connected = page.getByTestId('widget-NwcWalletStatusConnected')
	await expect(connected.locator('[data-slot="nwc-wallet-status"]')).toHaveCount(1)
	await expect(connected).toContainText('Wallet Status:')
	await expect(connected).toContainText('2 NWC wallets connected')
	await expect(connected).toContainText('Configure more wallets in settings')
	await expect(connected.locator('.bg-success')).toHaveCount(1)

	await expect(page.getByTestId('widget-NwcWalletStatusConnectedOne')).toContainText('1 NWC wallet connected')
})

test('links to settings when NWC is not connected', async ({ page }) => {
	await page.goto('/?library=checkout')

	const off = page.getByTestId('widget-NwcWalletStatusDisconnected')
	await expect(off).toContainText('Fast Payments available with NWC, setup in')
	await expect(off.getByRole('link', { name: 'settings' })).toHaveAttribute('href', '/dashboard/account/making-payments')
	// The connected-only footer is absent.
	await expect(off).not.toContainText('Configure more wallets')
})
