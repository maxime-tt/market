import { expect, test } from '@playwright/test'

/**
 * Zap, V4V and wallet views drained into ui/lightning. Every entry is a
 * literal-prop render, so copy, disabled reasons and the pluralisation of the
 * invoices banner are asserted without any host plumbing. The zap dialog is
 * closed at rest and driven from a trigger (see `shared.tsx`).
 */

const lightningEntries = [
	'IncompleteInvoicesBanner',
	'IncompleteInvoicesBannerSingle',
	'LightningPaymentView',
	'LightningPaymentViewGenerating',
	'LightningPaymentViewUnavailable',
	'V4VRecipientsCard',
	'WalletSetupGuide',
	'ZapDialogView',
	'ZapDialogViewInvoiceStep',
]

test('renders the lightning library', async ({ page }) => {
	await page.goto('/?library=lightning')

	await expect(page.getByTestId('widget-book-selection')).toHaveText('lightning')
	await expect(page.getByTestId('library-lightning')).toBeVisible()

	for (const widget of lightningEntries) {
		await expect(page.getByTestId(`widget-${widget}`)).toBeVisible()
	}
})

test('renders the lightning payment view with its disabled payment methods', async ({ page }) => {
	await page.goto('/?library=lightning')

	const pay = page.getByTestId('widget-LightningPaymentView')
	// The QR container (the primitive wraps an svg), not its pixels.
	await expect(pay.locator('svg').first()).toBeVisible()
	await expect(pay.locator('#invoice')).toHaveValue(/^lnbc/)
	await expect(pay.getByRole('button', { name: 'Pay with NIP-60 Wallet' })).toBeEnabled()

	// Disabled methods keep their reason as a tooltip.
	await expect(pay.getByRole('button', { name: 'Pay with NWC' })).toBeDisabled()
	await expect(pay.getByRole('button', { name: 'Pay with WebLN' })).toBeDisabled()

	await expect(pay.getByLabel('Payment Preimage (Manual Verification)')).toBeVisible()
	await expect(pay.getByRole('button', { name: 'Verify' })).toBeVisible()
	await expect(pay.getByRole('button', { name: 'Pay Later' })).toBeVisible()
	await expect(pay.getByRole('button', { name: 'Cancel' })).toBeVisible()

	// Mobile navigation is attached but hidden from the desktop viewport, so
	// role queries (which skip display:none elements) would miss it.
	await expect(pay.locator('button', { hasText: 'Previous' })).toHaveCount(1)
	await expect(pay.locator('button', { hasText: 'Next' })).toHaveCount(1)
})

test('shows the generating and unavailable payment states', async ({ page }) => {
	await page.goto('/?library=lightning')

	await expect(page.getByTestId('widget-LightningPaymentViewGenerating')).toContainText('Generating invoice...')

	const unavailable = page.getByTestId('widget-LightningPaymentViewUnavailable')
	await expect(unavailable).toContainText('Unable to generate Lightning invoice')
	await expect(unavailable).toContainText('You can skip this payment and pay directly later.')
	await expect(unavailable.getByRole('button', { name: 'Skip Payment (Pay Later)' })).toBeVisible()
})

test('pluralises the incomplete invoices banner', async ({ page }) => {
	await page.goto('/?library=lightning')

	const banner = page.getByTestId('widget-IncompleteInvoicesBanner')
	await expect(banner).toContainText('3 invoices require payment')
	await expect(banner).toContainText('Make all payments to complete the order')
	await expect(banner.getByRole('button', { name: 'Refresh All' })).toBeVisible()

	const single = page.getByTestId('widget-IncompleteInvoicesBannerSingle')
	// Pins the component as written: the noun is singular but the verb is not
	// pluralised in reverse — "1 invoice require payment" (defect, not fixed here).
	await expect(single).toContainText('1 invoice require payment')
	await expect(single).not.toContainText('invoices require')
})

test('lists the V4V recipients with normalised percentages', async ({ page }) => {
	await page.goto('/?library=lightning')

	const card = page.getByTestId('widget-V4VRecipientsCard')
	await expect(card).toContainText('This seller shares revenue with 3 community recipients:')
	await expect(card).toContainText('Podcast host')
	await expect(card).toContainText('20%')
	await expect(card).toContainText('10%')
	await expect(card).toContainText('5%')
})

test('renders the wallet setup guide with its three options', async ({ page }) => {
	await page.goto('/?library=lightning')

	const guide = page.getByTestId('widget-WalletSetupGuide')
	await expect(guide).toContainText('Get Started with Bitcoin Payments')
	for (const wallet of ['Coinos', 'npub.cash', 'Minibits']) {
		await expect(guide).toContainText(wallet)
	}
	await expect(guide).toContainText('What happens next?')
})

test('drives the zap dialog from a trigger and validates the amount', async ({ page }) => {
	await page.goto('/?library=lightning')

	await page.getByRole('button', { name: 'Open zap dialog', exact: true }).click()
	const dialog = page.getByRole('dialog')
	await expect(dialog).toBeVisible()
	await expect(dialog).toContainText('Zap satoshi')
	await expect(dialog).toContainText('(satoshi@plebeian.market)')

	// Amount starts empty, so the required error shows.
	await expect(dialog).toContainText('Amount is required')
	await expect(dialog.getByRole('button', { name: 'Continue to payment' })).toBeDisabled()

	// Presets and manual entry both drive the same controlled field.
	await dialog.getByRole('button', { name: '1k' }).click()
	await expect(dialog).toContainText('Continue to payment')
	await expect(dialog.locator('#zapAmount')).toHaveValue('1000')

	await dialog.locator('#zapAmount').fill('0')
	await expect(dialog).toContainText('Please enter a valid amount')

	await dialog.locator('#zapAmount').fill('1000')
	await expect(dialog.locator('#zapMessage')).toHaveValue('Great product!')
	await expect(dialog.getByRole('switch')).not.toBeChecked()
	await expect(dialog.getByRole('button', { name: 'Zap with Nutzap (NIP-60)' })).toBeEnabled()
	// hasNwc is false in the demo, so the hint omits NWC from the pay options.
	await expect(dialog).toContainText('NIP-60, WebLN, or QR in the next step')
})

test('renders the zap dialog invoice step with its payment processor', async ({ page }) => {
	await page.goto('/?library=lightning')

	await page.getByRole('button', { name: 'Open zap dialog (invoice step)' }).click()
	const dialog = page.getByRole('dialog')
	await expect(dialog).toBeVisible()
	await expect(dialog).toContainText('1000 sats')
	await expect(dialog).toContainText('Great product!')

	// The host-supplied LightningPaymentView is rendered through the render prop.
	await expect(dialog.locator('svg').first()).toBeVisible()
	await expect(dialog.getByRole('button', { name: 'Pay with NIP-60 Wallet' })).toBeVisible()
})
