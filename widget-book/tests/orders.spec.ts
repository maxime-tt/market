import { expect, test } from '@playwright/test'

/**
 * Order views. Each entry is a literal-prop render, so the copy, amounts and
 * status tones are asserted without any host plumbing.
 *
 * `ShippingOptionsMobileToolbar` is `lg:hidden`, so it is asserted at a phone
 * viewport; its desktop twin (`ShippingOptionsToolbar`, `hidden lg:flex`) is
 * asserted at the default desktop viewport.
 */

const WIDGETS = [
	'OrderActionsView',
	'OrderActionsViewWaiting',
	'StockUpdateDialogView',
	'OrderBuyerCardView',
	'OrderDetailLayoutView',
	'OrderMissingView',
	'OrderNotFoundView',
	'OrderPaymentDetailsCardView',
	'OrderProductsCardView',
	'OrderTimelineView',
	'OrderBuyerContactCard',
	'OrderDetailHeader',
	'OrderShippingCard',
	'PrivateAuctionClaimCard',
	'PrivateAuctionClaimCardLoading',
	'DeliveryAddressView',
	'InvoiceCardView',
	'InvoiceCardViewPaid',
	'OrderCardView',
	'PaymentSummaryView',
	'PrivateOrderDetailsView',
	'PrivateOrderDetailsViewLocked',
	'TrackingInfoView',
	'OrderAmountText',
	'OrderDateText',
	'OrderReferenceBadge',
	'OrderListView',
	'OrderListViewEmpty',
	'PickupAddressDisplay',
	'ShippingInfoDisplay',
	'ShippingOptionsEmptyState',
	'ShippingOptionsLoading',
	'ShippingOptionsMobileToolbar',
	'ShippingOptionsToolbar',
	'TimelineEventCard',
]

test('renders the orders library', async ({ page }) => {
	await page.goto('/?library=orders')

	await expect(page.getByTestId('widget-book-selection')).toHaveText('orders')
	await expect(page.getByTestId('library-orders')).toBeVisible()

	for (const widget of WIDGETS.filter((name) => name !== 'ShippingOptionsMobileToolbar')) {
		await expect(page.getByTestId(`widget-${widget}`)).toBeVisible()
	}
})

test('shows the mobile toolbar at a phone viewport', async ({ browser }) => {
	const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
	const page = await context.newPage()
	await page.goto('/?library=orders')

	await expect(page.getByTestId('widget-ShippingOptionsMobileToolbar')).toBeVisible()
	await expect(page.getByTestId('widget-ShippingOptionsMobileToolbar')).toContainText('Manage your shipping options for customers')

	// The desktop twin is `hidden lg:flex` and only attaches at large viewports.
	await expect(page.getByTestId('widget-ShippingOptionsToolbar')).toBeAttached()
	await context.close()
})

test('opens the cancel dialog from the order actions and logs the reason', async ({ page }) => {
	await page.goto('/?library=orders')

	const actions = page.getByTestId('widget-OrderActionsView')
	await actions.getByRole('button', { name: 'Cancel Order' }).click()

	const dialog = page.getByRole('dialog')
	await expect(dialog).toContainText('Cancel This Order')
	await dialog.getByLabel('Cancellation Reason (Optional)').fill('Changed my mind')
	await dialog.getByRole('button', { name: 'Yes, Cancel Order' }).click()

	await expect(actions.getByTestId('orders-actions-log')).toHaveText('cancelled: Changed my mind')
})

test('opens the stock update dialog from its trigger', async ({ page }) => {
	await page.goto('/?library=orders')

	await page.getByTestId('widget-StockUpdateDialogView').getByRole('button', { name: 'Open stock update' }).click()

	const dialog = page.getByRole('dialog')
	await expect(dialog).toContainText('Update Product Stock')
	await expect(dialog).toContainText('Handmade mug')
	await expect(dialog).toContainText('Stoneware bowl')

	const newStock = dialog.getByLabel('New Stock', { exact: false }).first()
	await newStock.fill('4')
	await expect(newStock).toHaveValue('4')
})

test('renders the order detail header status band', async ({ page }) => {
	await page.goto('/?library=orders')

	const header = page.getByTestId('widget-OrderDetailHeader')
	// The header prints the raw sat count without locale grouping.
	await expect(header).toContainText('25000 sats')
	await expect(header).toContainText('Pending')
	await expect(header).toContainText('Awaiting payment confirmation from the seller.')
	// The host-supplied header tone is a plain class string.
	await expect(header.locator('.bg-info-muted').first()).toBeAttached()
})

test('shows the buyer payment actions and the paid receipt', async ({ page }) => {
	await page.goto('/?library=orders')

	const pending = page.getByTestId('widget-InvoiceCardView')
	await expect(pending).toContainText('Merchant Payment')
	await expect(pending).toContainText('21,000 sats')
	await expect(pending.getByRole('button', { name: /Pay 21,000 sats/ })).toBeVisible()

	const paid = page.getByTestId('widget-InvoiceCardViewPaid')
	await expect(paid).toContainText('Payment completed')
	await expect(paid.getByRole('button', { name: 'Copy preimage' })).toBeVisible()
	await expect(paid.locator('.bg-success-muted').first()).toBeAttached()
})

test('renders the order list rows, empty state and reference links', async ({ page }) => {
	await page.goto('/?library=orders')

	const list = page.getByTestId('widget-OrderListView')
	await expect(list).toContainText('Purchase #a1b2c3d4')
	await expect(list).toContainText('21,000 sats')
	await expect(list.getByPlaceholder('Search by Order ID or Buyer...')).toBeVisible()

	await expect(page.getByTestId('widget-OrderListViewEmpty')).toContainText('No sales match your filters.')

	const badge = page.getByTestId('widget-OrderReferenceBadge')
	await expect(badge.getByRole('link', { name: 'a1b2c3d4...' })).toHaveAttribute('href', '#/orders/a1b2c3d4e5f6a7b8')

	await expect(page.getByTestId('widget-OrderAmountText')).toContainText('21,000 sats')
	await expect(page.getByTestId('widget-OrderDateText')).not.toHaveText('-')
})

test('shows the delivery, tracking and private details blocks', async ({ page }) => {
	await page.goto('/?library=orders')

	const delivery = page.getByTestId('widget-DeliveryAddressView')
	await expect(delivery).toContainText('Delivery Address')
	await expect(delivery).toContainText('21 Independence Ave')
	await expect(delivery).toContainText('Springfield 12345')

	const tracking = page.getByTestId('widget-TrackingInfoView')
	await expect(tracking).toContainText('Tracking Information')
	await expect(tracking).toContainText('https://dhl.com/track/JJD0001234567')
	await expect(tracking).toContainText('DHL')

	await expect(page.getByTestId('widget-PrivateOrderDetailsView')).toContainText('Leave at the door.')
	await expect(page.getByTestId('widget-PrivateOrderDetailsViewLocked')).toContainText('Encrypted delivery details are unavailable.')
})

test('shows the private auction claim details', async ({ page }) => {
	await page.goto('/?library=orders')

	const claim = page.getByTestId('widget-PrivateAuctionClaimCard')
	await expect(claim).toContainText('21 Independence Ave')
	await expect(claim).toContainText('satoshi@example.com')
	await expect(claim).toContainText('Please ship in the original box.')

	await expect(page.getByTestId('widget-PrivateAuctionClaimCardLoading')).toContainText('Loading private auction claim details...')
})
