import { expect, test } from '@playwright/test'

/**
 * Checkout views. Each entry is a literal-prop render, so the copy and the
 * status tone are asserted without any host plumbing.
 *
 * `CheckoutMobileSummaryCard` is mobile-only (`lg:hidden`), so it is asserted
 * in a mobile-viewport test; `CheckoutSidebarCard` is the desktop-only
 * (`hidden lg:flex`) counterpart and is visible at the default viewport.
 */

const entryNames = [
	'NwcWalletStatusConnected',
	'NwcWalletStatusConnectedOne',
	'NwcWalletStatusDisconnected',
	'CheckoutMainCard',
	'CheckoutMobileSummaryCard',
	'CheckoutSidebarCard',
	'CartFooter',
	'CartFooterDisabled',
	'CartLineShipping',
	'CartSellerCard',
	'CartShippingReminder',
	'CartTotals',
	'CartTotalsDetails',
	'CheckoutPaymentSummary',
	'CheckoutPaymentSummarySkipped',
	'CheckoutProgress',
	'EmptyCartScreen',
	'NoPaymentRequestsCard',
	'OnChainPaymentView',
	'OnChainPaymentViewConfirmed',
	'OrderFinalizeView',
	'PaymentContentView',
	'PaymentContentViewCompleted',
	'PaymentProgressBar',
	'PaymentDialogView',
	'WalletSelectorView',
	'ShippingAddressFormView',
]

test('renders the checkout library', async ({ page }) => {
	await page.goto('/?library=checkout')

	await expect(page.getByTestId('widget-book-selection')).toHaveText('checkout')
	await expect(page.getByTestId('library-checkout')).toBeVisible()

	for (const widget of entryNames) {
		// The mobile summary is hidden at desktop width; every other entry is visible.
		if (widget === 'CheckoutMobileSummaryCard') {
			await expect(page.getByTestId(`widget-${widget}`)).toBeAttached()
		} else {
			await expect(page.getByTestId(`widget-${widget}`)).toBeVisible()
		}
	}
})

test('renders the checkout card frames with their contents', async ({ page }) => {
	await page.goto('/?library=checkout')

	const main = page.getByTestId('widget-CheckoutMainCard').locator('[data-slot="checkout-main-card"]')
	await expect(main).toContainText('Order Review')
	await expect(main).toContainText('Step 2 of 3')
	await expect(main).toContainText('The step content (shipping form, summary, invoices) renders here.')

	const sidebar = page.getByTestId('widget-CheckoutSidebarCard').locator('[data-slot="checkout-sidebar"]')
	await expect(sidebar).toBeVisible()
	await expect(sidebar).toContainText('Order Summary')
	await expect(sidebar).toContainText('The payment summary or cart totals render here on desktop.')
})

test.describe('mobile-only card', () => {
	test.use({ viewport: { width: 390, height: 844 } })

	test('toggles the mobile summary card', async ({ page }) => {
		await page.goto('/?library=checkout')

		const mobile = page.getByTestId('widget-CheckoutMobileSummaryCard')
		await expect(mobile).toBeVisible()
		await expect(mobile.locator('[data-slot="checkout-mobile-summary"]')).toHaveClass(/lg:hidden/)
		await expect(mobile.locator('[aria-expanded="true"]')).toContainText('Cart Summary')
		await expect(mobile).toContainText('Collapsed order summary shown below `lg`.')

		await mobile.locator('[aria-expanded]').click()
		await expect(mobile.locator('[aria-expanded="false"]')).toBeVisible()
		await expect(mobile).not.toContainText('Collapsed order summary shown below `lg`.')

		await mobile.locator('[aria-expanded]').click()
		await expect(mobile).toContainText('Collapsed order summary shown below `lg`.')
	})

	test('hides the desktop sidebar below lg', async ({ page }) => {
		await page.goto('/?library=checkout')

		const sidebar = page.getByTestId('widget-CheckoutSidebarCard').locator('[data-slot="checkout-sidebar"]')
		await expect(sidebar).toBeHidden()
	})
})

test('renders the cart footer with enabled and locked states', async ({ page }) => {
	await page.goto('/?library=checkout')

	const footer = page.getByTestId('widget-CartFooter')
	await expect(footer).toContainText('Total:')
	await expect(footer).toContainText('21,000 sat')
	await expect(footer.getByRole('button', { name: 'Clear' })).toBeEnabled()
	await expect(footer.getByRole('button', { name: 'Checkout' })).toBeEnabled()

	const locked = page.getByTestId('widget-CartFooterDisabled')
	await expect(locked.getByRole('button', { name: 'Clear' })).toBeDisabled()
	await expect(locked.getByRole('button', { name: 'Checkout' })).toBeDisabled()
})

test('shows the cart line shipping for selected and unselected methods', async ({ page }) => {
	await page.goto('/?library=checkout')

	const lines = page.getByTestId('widget-CartLineShipping').locator('span')
	await expect(lines.filter({ hasText: 'Shipping: Standard Post - 500 USD' })).toHaveCount(1)
	await expect(lines.filter({ hasText: 'Select shipping at checkout' })).toHaveCount(1)
})

test('breaks the seller card down into items, totals and the payment split', async ({ page }) => {
	await page.goto('/?library=checkout')

	const card = page.getByTestId('widget-CartSellerCard')
	await expect(card).toContainText("Alice's Emporium")
	await expect(card).toContainText('Handmade mug')
	await expect(card).toContainText('Frosted vase')
	await expect(card).toContainText('Shipping:')
	await expect(card).toContainText('500 sat')
	await expect(card).toContainText('21,000 sat')
	await expect(card).toContainText('Payment Breakdown')
	await expect(card).toContainText('20,000 sat (95.24%)')
	await expect(card).toContainText('1,000 sat (4.76%)')
	await expect(card.locator('.bg-info')).toHaveCount(1)
})

test('shows the shipping reminder for both cart and checkout contexts', async ({ page }) => {
	await page.goto('/?library=checkout')

	const reminder = page.getByTestId('widget-CartShippingReminder')
	await expect(reminder).toContainText('Select shipping at checkout for 2 items.')
	await expect(reminder).toContainText('Please select shipping for 1 item before checkout.')
	await expect(reminder.locator('.bg-warning-muted')).toHaveCount(2)
})

test('renders the cart totals summary', async ({ page }) => {
	await page.goto('/?library=checkout')

	const totals = page.getByTestId('widget-CartTotals')
	await expect(totals).toContainText('Subtotal:')
	await expect(totals).toContainText('20,500 sat')
	await expect(totals).toContainText('Shipping:')
	await expect(totals).toContainText('500 sat')
	await expect(totals).toContainText('21,000 sat')
})

test('expands the cart totals details on demand', async ({ page }) => {
	await page.goto('/?library=checkout')

	const details = page.getByTestId('widget-CartTotalsDetails')
	await expect(details).not.toContainText('Grand Total:')

	await details.getByRole('button', { name: 'View Details' }).click()
	await expect(details).toContainText('Products (USD):')
	await expect(details).toContainText('214.50')
	await expect(details).toContainText('Subtotal:')
	await expect(details).toContainText('Grand Total:')
	await expect(details).toContainText('21,000 sat')

	await details.getByRole('button', { name: 'View Details' }).click()
	await expect(details).not.toContainText('Grand Total:')
})

test('summarises the payment progress across invoices', async ({ page }) => {
	await page.goto('/?library=checkout')

	const summary = page.getByTestId('widget-CheckoutPaymentSummary')
	await expect(summary).toContainText('Payment Summary')
	await expect(summary).toContainText('1/2')
	await expect(summary).toContainText('12,000 sats')
	await expect(summary).toContainText('Remaining')
	await expect(summary).toContainText('5,000 sats')
	await expect(summary).toContainText('17,000 sats')
	await expect(summary).toContainText('V4V Payment')
	await expect(summary).toContainText('5m')
	// The pending current invoice gets the accent treatment; the paid one the success tone.
	await expect(summary.locator('.bg-success-muted')).toHaveCount(1)
	await expect(summary.locator('.border-fill-accent')).toHaveCount(1)
})

test('shows the skipped invoice rows in the payment summary', async ({ page }) => {
	await page.goto('/?library=checkout')

	const summary = page.getByTestId('widget-CheckoutPaymentSummarySkipped')
	await expect(summary).toContainText('Skipped')
	await expect(summary).toContainText('1/2')
	await expect(summary).toContainText('Skipped Amount')
	await expect(summary).toContainText('5,000 sats')
	await expect(summary).toContainText('12,000 sats')
	await expect(summary.locator('.bg-warning-muted')).toHaveCount(1)
})

test('renders the checkout progress header', async ({ page }) => {
	await page.goto('/?library=checkout')

	const progress = page.getByTestId('widget-CheckoutProgress')
	await expect(progress).toContainText('2/3')
	await expect(progress).toContainText('Review payment')
	await expect(progress.getByRole('button', { name: 'Go back in checkout' })).toBeVisible()
	await expect(progress.locator('[data-slot="progress"]')).toHaveCount(1)
})

test('renders the payment progress bar', async ({ page }) => {
	await page.goto('/?library=checkout')

	const bar = page.getByTestId('widget-PaymentProgressBar')
	await expect(bar).toContainText('Payment Progress')
	await expect(bar).toContainText('2/5 Complete')
	await expect(bar.locator('.bg-success')).toHaveCount(1)
})

test('renders the empty cart screen', async ({ page }) => {
	await page.goto('/?library=checkout')

	const empty = page.getByTestId('widget-EmptyCartScreen')
	await expect(empty).toContainText('Your cart is empty')
	await expect(empty).toContainText("Looks like you haven't added any products to your cart yet.")
	await expect(empty.getByRole('button', { name: 'Continue Shopping' })).toBeVisible()
})

test('adapts the payment request card copy to the buyer and seller roles', async ({ page }) => {
	await page.goto('/?library=checkout')

	const card = page.getByTestId('widget-NoPaymentRequestsCard')
	await expect(card).toContainText('Waiting for Payment Requests')
	await expect(card).toContainText('The seller has not yet created payment requests for this order.')
	await expect(card).toContainText('No Payment Requests Created')
	await expect(card).toContainText('Payment requests have not been created for this order yet.')
})

test('renders the pending on-chain payment with its QR code and actions', async ({ page }) => {
	await page.goto('/?library=checkout')

	const view = page.getByTestId('widget-OnChainPaymentView')
	await expect(view).toContainText('Bitcoin On-chain')
	await expect(view).toContainText('Idle')
	await expect(view).toContainText('12,000 sats')
	await expect(view).toContainText('0.00012000 BTC')
	await expect(view).toContainText('Expires in: 10:00')
	// The QR code is the only 200px SVG; lucide icons are much smaller.
	await expect(view.locator('svg[width="200"]')).toHaveCount(1)
	await expect(view).toContainText('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq')
	await expect(view.getByRole('button', { name: 'Open in Wallet' })).toBeVisible()
	await expect(view.getByRole('button', { name: "I've Paid - Check Status" })).toBeVisible()
	await expect(view.getByRole('button', { name: 'Cancel Payment' })).toBeVisible()
})

test('renders the confirmed on-chain payment without the QR code', async ({ page }) => {
	await page.goto('/?library=checkout')

	const view = page.getByTestId('widget-OnChainPaymentViewConfirmed')
	await expect(view).toContainText('Completed')
	await expect(view).toContainText('Payment received successfully!')
	await expect(view).toContainText('f4184fc596403b5d382b5d1c8d3a4b0a3e1d2c4b5a6f7e8d9c0b1a2f3e4d5c6f')
	await expect(view).toContainText('✓ Confirmed')
	await expect(view.getByRole('button', { name: 'Payment Complete' })).toBeDisabled()
	await expect(view.getByRole('button', { name: 'Open in Wallet' })).toHaveCount(0)
	await expect(view.locator('svg[width="200"]')).toHaveCount(0)
})

test('finalises the order with the success banner and breakdown', async ({ page }) => {
	await page.goto('/?library=checkout')

	const finalize = page.getByTestId('widget-OrderFinalizeView')
	await expect(finalize).toContainText('All payments completed successfully!')
	await expect(finalize).toContainText('Shipping Address')
	await expect(finalize).toContainText('Satoshi Nakamoto')
	await expect(finalize).toContainText('21 Generation Street')
	await expect(finalize).toContainText('London, E1 6AN')
	await expect(finalize).toContainText('Delivery Notes:')
	await expect(finalize).toContainText('Ring the bell twice.')
	await expect(finalize).toContainText('17,000 sats')
	await expect(finalize.getByRole('button', { name: "Message Alice's Emporium" })).toBeVisible()
	await expect(finalize.getByRole('button', { name: 'View Your Purchases' })).toBeVisible()
	await expect(finalize.getByRole('button', { name: 'Continue Shopping' })).toBeVisible()
	await expect(finalize.getByRole('button', { name: 'Print Order Summary' })).toBeVisible()
})

test('pages between payments in the payment content view', async ({ page }) => {
	await page.goto('/?library=checkout')

	const view = page.getByTestId('widget-PaymentContentView')
	await expect(view).toContainText('Payment Progress')
	await expect(view).toContainText('1 of 3 completed')
	await expect(view).toContainText('Payment 2 of 3')
	await expect(view).toContainText('Wallet selector slot')
	await expect(view).toContainText('Processor slot')

	const completed = page.getByTestId('widget-PaymentContentViewCompleted')
	await expect(completed).toContainText('✓ Payment Complete')
	await expect(completed).toContainText("Alice's Emporium - 12000 sats")
	await expect(completed.getByRole('button', { name: 'Next Payment' })).toBeVisible()
	await expect(completed.getByText('Processor slot')).toHaveCount(0)
})

test('opens the payment dialog from a trigger', async ({ page }) => {
	await page.goto('/?library=checkout')

	const widget = page.getByTestId('widget-PaymentDialogView')
	await widget.getByRole('button', { name: 'Open payment dialog' }).click()

	const dialog = page.getByRole('dialog')
	await expect(dialog).toBeVisible()
	await expect(dialog).toContainText('Lightning Payment')
	await expect(dialog).toContainText('Invoice 1 of 3 · satoshi 12,000')

	await dialog.getByRole('button', { name: 'Close payment dialog' }).click()
	await expect(dialog).toHaveCount(0)
})

test('selects a payment wallet from the host-owned list', async ({ page }) => {
	await page.goto('/?library=checkout')

	const selector = page.getByTestId('widget-WalletSelectorView')
	await expect(selector).toContainText("Alice's Emporium's Wallet")
	await expect(selector).toContainText('Select payment wallet')

	await selector.getByRole('combobox').click()
	await page.getByRole('option', { name: 'Alby · Browser extension' }).click()
	await expect(selector.getByRole('combobox')).toContainText('Alby · Browser extension')
})

test('edits the controlled shipping address form', async ({ page }) => {
	await page.goto('/?library=checkout')

	const form = page.getByTestId('widget-ShippingAddressFormView')
	await expect(form.locator('#shipping-form')).toHaveCount(1)
	await expect(form.getByLabel('Full Name')).toBeVisible()
	await expect(form.getByLabel('Email Address')).toBeVisible()
	// The city/country inputs sit next to toggle buttons labelled "Toggle city list" etc.,
	// which substring-match `getByLabel('City')`, so assert on the textbox role.
	await expect(form.getByRole('textbox', { name: 'City *' })).toBeVisible()
	await expect(form.getByRole('textbox', { name: 'Country *' })).toBeVisible()
	await expect(form.getByLabel('Delivery Notes (Optional)')).toBeVisible()
	await expect(form.getByRole('button', { name: 'Continue to Review' })).toBeEnabled()

	await form.getByLabel('Full Name').fill('Alice Henderson')
	await expect(form.getByLabel('Full Name')).toHaveValue('Alice Henderson')
})
