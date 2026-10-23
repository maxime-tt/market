import { expect, test } from '@playwright/test'

/**
 * Flow dialog views. Every dialog is kept closed at rest so the catalogue stays
 * in the accessibility tree; each test opens one from its trigger and asserts
 * through roles. The profile share writes through `navigator.clipboard`, which
 * needs an explicit grant in the headless browser context.
 */

test('renders the dialogs library', async ({ page }) => {
	await page.goto('/?library=dialogs')

	await expect(page.getByTestId('widget-book-selection')).toHaveText('dialogs')
	await expect(page.getByTestId('library-dialogs')).toBeVisible()

	for (const widget of [
		'NSFWConfirmationDialogView',
		'ShareProfileDialogView',
		'V4VSetupDialogView',
		'PickupLocationDialogView',
		'PickupLocationDialogViewError',
		'ShareProductDialogView',
		'ShareProductDialogViewGuest',
		'TermsConditionsDialogView',
		'TermsConditionsDialogViewCustom',
	]) {
		await expect(page.getByTestId(`widget-${widget}`)).toBeVisible()
	}
})

test('confirms the adult-content warning from both buttons', async ({ page }) => {
	await page.goto('/?library=dialogs')

	const widget = page.getByTestId('widget-NSFWConfirmationDialogView')
	await expect(page.getByRole('dialog')).toHaveCount(0)
	await widget.getByRole('button', { name: 'Open adult-content warning' }).click()

	const dialog = page.getByRole('dialog')
	await expect(dialog).toBeVisible()
	await expect(dialog).toContainText('Adult Content Warning')
	await expect(dialog).toContainText('Weapons and related items')

	await dialog.getByRole('button', { name: 'I understand, show adult content' }).click()
	await expect(dialog).toHaveCount(0)

	await widget.getByRole('button', { name: 'Open adult-content warning' }).click()
	await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click()
	await expect(page.getByRole('dialog')).toHaveCount(0)
})

test.describe('share profile', () => {
	test.use({ permissions: ['clipboard-read', 'clipboard-write'] })

	test('shares the profile with a QR code and a copy control', async ({ page }) => {
		await page.goto('/?library=dialogs')

		const widget = page.getByTestId('widget-ShareProfileDialogView')
		await widget.getByRole('button', { name: 'Open profile share' }).click()

		const dialog = page.getByRole('dialog')
		await expect(dialog).toBeVisible()
		await expect(dialog).toContainText("Share satoshi's profile")
		await expect(dialog).toContainText('npub1qqqqqqqqqq')
		await expect(dialog.locator('svg[width="200"]')).toHaveCount(1) // the QR code

		// The copy button is the icon button sitting next to the npub code.
		await dialog.locator('code + button').click()
		await expect(dialog.locator('svg.lucide-check')).toHaveCount(1)

		await dialog.locator('[data-slot="dialog-close"]').click()
		await expect(dialog).toHaveCount(0)
	})
})

test('hosts the V4V editor inside the setup dialog', async ({ page }) => {
	await page.goto('/?library=dialogs')

	const widget = page.getByTestId('widget-V4VSetupDialogView')
	await widget.getByRole('button', { name: 'Open V4V setup' }).click()

	const dialog = page.getByRole('dialog')
	await expect(dialog).toBeVisible()
	await expect(dialog).toContainText('Set up Value for Value (V4V)')
	await expect(dialog).toContainText('The V4V editor the host supplies renders here.')

	await dialog.locator('[data-slot="dialog-close"]').click()
	await expect(dialog).toHaveCount(0)
})

test('shows the pickup location while geocoding', async ({ page }) => {
	await page.goto('/?library=dialogs')

	const widget = page.getByTestId('widget-PickupLocationDialogView')
	await widget.getByRole('button', { name: 'Open pickup location' }).click()

	const dialog = page.getByRole('dialog')
	await expect(dialog).toBeVisible()
	await expect(dialog).toContainText('Pickup Location')
	await expect(dialog).toContainText("Alice's Emporium's pickup location")
	await expect(dialog).toContainText('Corner Studio')
	await expect(dialog).toContainText('12 Brick Lane, London')
	// The map area is still waiting on geocodes, so it shows the spinner.
	await expect(dialog.locator('[data-slot="spinner"], .animate-spin').first()).toBeVisible()
})

test('lists several pickup locations above the map error', async ({ page }) => {
	await page.goto('/?library=dialogs')

	const widget = page.getByTestId('widget-PickupLocationDialogViewError')
	await widget.getByRole('button', { name: 'Open pickup locations error' }).click()

	const dialog = page.getByRole('dialog')
	await expect(dialog).toBeVisible()
	await expect(dialog).toContainText('Pickup Locations')
	await expect(dialog).toContainText('Corner Studio')
	await expect(dialog).toContainText('Harbour Workshop')
	await expect(dialog).toContainText('Could not load the map. Check your connection and try again.')

	await dialog.locator('[data-slot="dialog-close"]').click()
	await expect(dialog).toHaveCount(0)
})

test('edits and copies the product share text', async ({ page }) => {
	await page.goto('/?library=dialogs')

	const widget = page.getByTestId('widget-ShareProductDialogView')
	await widget.getByRole('button', { name: 'Open share dialog' }).click()

	const dialog = page.getByRole('dialog')
	await expect(dialog).toBeVisible()
	await expect(dialog).toContainText('Share Product')
	await expect(dialog).toContainText('Content to post to Nostr')

	const textarea = dialog.getByLabel('Content to post to Nostr')
	await expect(textarea).toHaveValue(/Check out this handmade mug/)
	await expect(dialog.getByRole('button', { name: 'Post to Nostr' })).toBeEnabled()

	await dialog.getByRole('button', { name: 'Copy URL' }).click()
	await expect(dialog.getByRole('button', { name: 'Copied!' })).toBeVisible()

	await textarea.fill('')
	await expect(dialog.getByRole('button', { name: 'Post to Nostr' })).toBeDisabled()

	await dialog.locator('[data-slot="dialog-close"]').click()
	await expect(dialog).toHaveCount(0)
})

test('reduces the share dialog to the copy action for signed-out visitors', async ({ page }) => {
	await page.goto('/?library=dialogs')

	const widget = page.getByTestId('widget-ShareProductDialogViewGuest')
	await widget.getByRole('button', { name: 'Open share dialog' }).click()

	const dialog = page.getByRole('dialog')
	await expect(dialog).toBeVisible()
	await expect(dialog.getByLabel('Content to post to Nostr')).toHaveCount(0)
	await expect(dialog.getByRole('button', { name: 'Post to Nostr' })).toHaveCount(0)
	await expect(dialog.getByRole('button', { name: 'Copy URL' })).toBeVisible()
})

test('requires accepting the shipped terms before continuing', async ({ page }) => {
	await page.goto('/?library=dialogs')

	const widget = page.getByTestId('widget-TermsConditionsDialogView')
	await widget.getByRole('button', { name: 'Open terms and conditions' }).click()

	const dialog = page.getByRole('dialog')
	await expect(dialog).toBeVisible()
	await expect(dialog).toContainText('Terms and Conditions')
	await expect(dialog).toContainText('to continue using Plebeian Market.')
	await expect(dialog).toContainText('User Friendly Summary')
	// The dialog close button is hidden on purpose: Accept is the only way out.
	await expect(dialog.locator('[data-slot="dialog-close"]')).toBeHidden()

	await dialog.getByRole('button', { name: 'I Accept' }).click()
	await expect(dialog).toHaveCount(0)
})

test('links out to instance-supplied terms instead of the shipped text', async ({ page }) => {
	await page.goto('/?library=dialogs')

	const widget = page.getByTestId('widget-TermsConditionsDialogViewCustom')
	await widget.getByRole('button', { name: 'Open custom terms' }).click()

	const dialog = page.getByRole('dialog')
	await expect(dialog).toBeVisible()
	await expect(dialog).toContainText('Satoshi Bazaar publishes its own Terms and Conditions')
	const link = dialog.getByRole('link', { name: "Satoshi Bazaar's Terms and Conditions" })
	await expect(link).toHaveAttribute('href', 'https://satoshi.example/terms')
	await expect(link).toHaveAttribute('target', '_blank')
})
