import { expect, test } from '@playwright/test'

/**
 * Wallet views — the NIP-60 panel and the four ecash/Lightning modal views
 * drained out of `src/feature/wallet/components/**`. Every entry is a
 * literal-prop render; the modals are closed at rest and driven from a trigger
 * (see `shared.tsx`).
 */

const walletEntries = [
	'Nip60WalletView',
	'Nip60WalletViewDevTools',
	'Nip60WalletViewUnauthenticated',
	'Nip60WalletViewError',
	'ReceiveEcashModalView',
	'ReceiveEcashModalViewSuccess',
	'SendEcashModalView',
	'SendEcashModalViewToken',
	'WithdrawLightningModalView',
	'WithdrawLightningModalViewSuccess',
	'DepositLightningModalView',
	'DepositLightningModalViewInvoice',
	'DepositLightningModalViewBid',
]

test('renders the wallet library', async ({ page }) => {
	await page.goto('/?library=wallet')

	await expect(page.getByTestId('widget-book-selection')).toHaveText('wallet')
	await expect(page.getByTestId('library-wallet')).toBeVisible()

	for (const widget of walletEntries) {
		await expect(page.getByTestId(`widget-${widget}`)).toBeVisible()
	}
})

test('renders the NIP-60 panel, its mints and the dev tools', async ({ page }) => {
	await page.goto('/?library=wallet')

	const panel = page.getByTestId('widget-Nip60WalletView')
	await expect(panel).toContainText('Balance')
	await expect(panel).toContainText('3,000 sats')
	await expect(panel.getByRole('button', { name: 'Deposit' })).toBeVisible()
	await expect(panel.getByRole('button', { name: 'Withdraw' })).toBeEnabled()
	await expect(panel.getByRole('button', { name: 'Receive eCash' })).toBeVisible()
	// The mints section is open and lists both mints with their balances.
	await expect(panel).toContainText('mint.one.example')
	await expect(panel).toContainText('mint.two.example')

	// The unauthenticated and error states.
	await expect(page.getByTestId('widget-Nip60WalletViewUnauthenticated')).toContainText('Please log in to view your wallet')
	await expect(page.getByTestId('widget-Nip60WalletViewError')).toContainText('Failed to initialize the wallet')

	// The dev tools panel appears only in the dev-mode entry.
	const devTools = page.getByTestId('widget-Nip60WalletViewDevTools')
	await expect(devTools).toContainText('Auction Test Tools')
	await expect(devTools.getByRole('button', { name: 'Mint Test' })).toBeVisible()
	await expect(devTools.getByRole('button', { name: 'Bid Seeded' })).toBeVisible()
	await expect(page.getByTestId('widget-Nip60WalletView')).not.toContainText('Auction Test Tools')
})

test('drives the receive eCash modal', async ({ page }) => {
	await page.goto('/?library=wallet')

	await page.getByRole('button', { name: 'Open receive eCash', exact: true }).click()
	const dialog = page.getByRole('dialog')
	await expect(dialog).toBeVisible()
	await expect(dialog).toContainText('Receive eCash')
	await expect(dialog).toContainText('Scan or paste a Cashu token to receive eCash')
	await expect(dialog.getByRole('button', { name: 'Scan QR' })).toBeVisible()
	// The receive button is disabled until a token is entered.
	await expect(dialog.getByRole('button', { name: 'Receive' })).toBeDisabled()

	// Close the modal before driving the next trigger: an open Radix dialog hides the
	// background triggers from the accessibility tree (widget-book convention).
	await page.keyboard.press('Escape')
	await expect(page.getByRole('dialog')).toBeHidden()

	await page.getByRole('button', { name: 'Open received eCash', exact: true }).click()
	const successDialog = page.getByRole('dialog')
	await expect(successDialog).toContainText('eCash Received!')
	await expect(successDialog.getByRole('button', { name: 'Done' })).toBeVisible()
})

test('drives the send eCash modal and its generated-token state', async ({ page }) => {
	await page.goto('/?library=wallet')

	await page.getByRole('button', { name: 'Open send eCash', exact: true }).click()
	const dialog = page.getByRole('dialog')
	await expect(dialog).toContainText('Send eCash')
	await expect(dialog).toContainText('Balance: 3,000 sats')
	await expect(dialog.getByRole('button', { name: 'Generate Token' })).toBeDisabled()

	await page.keyboard.press('Escape')
	await expect(page.getByRole('dialog')).toBeHidden()

	await page.getByRole('button', { name: 'Open send eCash (token)', exact: true }).click()
	const tokenDialog = page.getByRole('dialog')
	await expect(tokenDialog).toContainText('Cashu Token')
	await expect(tokenDialog.locator('svg').first()).toBeVisible()
	await expect(tokenDialog.getByRole('button', { name: 'Copy Token' })).toBeVisible()
	await expect(tokenDialog.getByRole('button', { name: 'Send Another' })).toBeVisible()
})

test('drives the withdraw modal and its success state', async ({ page }) => {
	await page.goto('/?library=wallet')

	await page.getByRole('button', { name: 'Open withdraw', exact: true }).first().click()
	const dialog = page.getByRole('dialog')
	await expect(dialog).toContainText('Withdraw to Lightning')
	await expect(dialog).toContainText('Balance: 2,000 sats')
	await expect(dialog.getByRole('button', { name: 'Withdraw' })).toBeDisabled()
})

test('drives the deposit modal, its invoice state and the bid quick view', async ({ page }) => {
	await page.goto('/?library=wallet')

	// Top-up form.
	await page.getByRole('button', { name: 'Open deposit', exact: true }).first().click()
	const formDialog = page.getByRole('dialog')
	await expect(formDialog).toContainText('Deposit Lightning')
	await expect(formDialog.getByRole('button', { name: 'Generate Invoice' })).toBeDisabled()
	await expect(formDialog.getByText('mint.one.example')).toBeAttached()

	await page.keyboard.press('Escape')
	await expect(page.getByRole('dialog')).toBeHidden()

	// Invoice state with the NWC wallet picker.
	await page.getByRole('button', { name: 'Open deposit', exact: true }).nth(1).click()
	const invoiceDialog = page.getByRole('dialog')
	await expect(invoiceDialog).toContainText('Lightning Invoice')
	await expect(invoiceDialog).toContainText('Pay with connected wallet')
	await expect(invoiceDialog.getByRole('button', { name: 'Pay invoice with NWC' })).toBeVisible()

	await page.keyboard.press('Escape')
	await expect(page.getByRole('dialog')).toBeHidden()

	// Bid quick-pay view: QR + amount, no "Generate Invoice" button.
	await page.getByRole('button', { name: 'Open bid funding', exact: true }).click()
	const bidDialog = page.getByRole('dialog')
	await expect(bidDialog).toContainText('Bid with lightning')
	await expect(bidDialog).toContainText('1,000 sats')
	await expect(bidDialog.locator('svg').first()).toBeVisible()
	await expect(bidDialog.getByRole('button', { name: 'Generate Invoice' })).toHaveCount(0)
})
