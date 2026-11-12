import { expect, test } from '@playwright/test'

/**
 * Auth views. Every dialog is closed at rest and driven from a trigger, because
 * a mounted open modal hides the rest of the catalogue from the accessibility
 * tree. The demo hosts reject their async callbacks, so the inline error paths
 * are exercised with literal state only.
 */

const authEntries = [
	'DecryptPasswordDialogView',
	'MigratePrivateKeyDialogView',
	'BunkerConnectView',
	'BunkerConnectViewChallenge',
	'LoginDialogView',
	'LoginDialogViewExtensionError',
	'NostrConnectQRView',
	'NostrConnectQRViewConnected',
	'PrivateKeyLoginView',
]

test('renders the auth library', async ({ page }) => {
	await page.goto('/?library=auth')

	await expect(page.getByTestId('widget-book-selection')).toHaveText('auth')
	await expect(page.getByTestId('library-auth')).toBeVisible()

	for (const widget of authEntries) {
		await expect(page.getByTestId(`widget-${widget}`)).toBeVisible()
	}
})

test('drives the login dialog from a trigger and pins its header and sub-tabs', async ({ page }) => {
	await page.goto('/?library=auth')

	await page.getByRole('button', { name: 'Open login dialog', exact: true }).click()
	const dialog = page.getByTestId('login-dialog')
	await expect(dialog).toBeVisible()

	// The fixed ink header with the dotted pattern.
	const header = dialog.locator('.bg-fill-ink')
	await expect(header).toHaveCount(1)
	await expect(header).toContainText('Login')
	await expect(header).toContainText('Choose your preferred login method below.')

	// Private key panel is the demo PrivateKeyLoginView.
	await dialog.getByTestId('private-key-tab').click()
	await expect(dialog.getByTestId('private-key-input')).toBeVisible()
	await expect(dialog.getByRole('button', { name: 'Generate New Key' })).toBeVisible()

	// N-Connect panel renders the QR code panel; its sub-tabs pin the
	// text-high/text-mid tone split (inactive tabs are unmounted by Radix,
	// so assert after the panel is active).
	await dialog.getByTestId('connect-tab').click()
	await expect(dialog.getByTestId('qr-tab')).toHaveClass(/data-\[state=active\]:text-text-high/)
	await expect(dialog.getByTestId('bunker-tab')).toHaveClass(/data-\[state=inactive\]:text-text-mid/)
	await expect(dialog.locator('a.bg-white svg')).toBeVisible()

	await dialog.getByTestId('bunker-tab').click()
	await expect(dialog.getByTestId('bunker-url-input')).toBeVisible()

	await expect(dialog.getByTestId('auto-login-checkbox')).toBeChecked()
	await page.keyboard.press('Escape')
	await expect(dialog).not.toBeVisible()
})

test('shows the extension error state of the login dialog', async ({ page }) => {
	await page.goto('/?library=auth')

	await page.getByRole('button', { name: 'Open login dialog (extension error)' }).click()
	const dialog = page.getByTestId('login-dialog')
	await expect(dialog).toBeVisible()
	await expect(dialog).toContainText('No Nostr extension found. Install Alby or nos2x.')
	await expect(dialog).toContainText('Login Failed')
})

test('reports a wrong password in the decrypt dialog', async ({ page }) => {
	await page.goto('/?library=auth')

	await expect(page.getByTestId('decrypt-password-dialog')).toHaveCount(0)
	await page.getByRole('button', { name: 'Open decrypt dialog' }).click()
	const dialog = page.getByTestId('decrypt-password-dialog')
	await expect(dialog).toBeVisible()

	await dialog.getByTestId('decrypt-password-input').fill('hunter2')
	await dialog.getByTestId('decrypt-login-button').click()
	await expect(dialog).toContainText('Failed to decrypt key. Please check your password.')
	await expect(dialog.getByTestId('logout-clear-key-button')).toBeVisible()
})

test('validates both fields in the migrate dialog', async ({ page }) => {
	await page.goto('/?library=auth')

	await page.getByRole('button', { name: 'Open migration dialog' }).click()
	const dialog = page.getByTestId('migrate-private-key-dialog')
	await expect(dialog).toBeVisible()
	await expect(dialog.getByTestId('migrate-encrypt-button')).toBeDisabled()

	await dialog.getByTestId('migrate-password-input').fill('correct horse battery')
	await dialog.getByTestId('migrate-confirm-password-input').fill('correct horse staple')
	await dialog.getByTestId('migrate-encrypt-button').click()
	await expect(dialog).toContainText('Passwords do not match')

	await dialog.getByTestId('migrate-confirm-password-input').fill('correct horse battery')
	await dialog.getByTestId('migrate-encrypt-button').click()
	await expect(dialog).toContainText('Failed to encrypt key')
})

test('renders the N-Connect QR panel and its connected state', async ({ page }) => {
	await page.goto('/?library=auth')

	const qr = page.getByTestId('widget-NostrConnectQRView')
	// Assert the QR container, not its pixels.
	await expect(qr.locator('a.bg-white')).toBeVisible()
	await expect(qr.locator('a.bg-white svg')).toBeVisible()
	await expect(qr).toContainText('Waiting for approval...')
	await expect(qr.locator('input')).toHaveValue(/nostrconnect:\/\//)

	const connected = page.getByTestId('widget-NostrConnectQRViewConnected')
	await expect(connected).toContainText('Connected successfully!')
	await expect(connected).toContainText('Logging you in...')
	await expect(connected.locator('a.bg-white')).toHaveCount(0)
})

test('disables the bunker connect button until a URL is entered', async ({ page }) => {
	await page.goto('/?library=auth')

	const bunker = page.getByTestId('widget-BunkerConnectView')
	await expect(bunker.getByTestId('bunker-url-input')).toBeVisible()
	await expect(bunker.getByTestId('connect-bunker-button')).toBeDisabled()
	await expect(bunker).toContainText('How to get a bunker URL:')

	const challenge = page.getByTestId('widget-BunkerConnectViewChallenge')
	await expect(challenge).toContainText('Your signer needs browser approval before this connection can finish.')
	await expect(challenge.getByTestId('bunker-auth-url-link')).toBeVisible()
})

test('shows the three private key login steps side by side', async ({ page }) => {
	await page.goto('/?library=auth')

	const pkl = page.getByTestId('widget-PrivateKeyLoginView')
	await expect(pkl).toContainText('enter-key (freshly generated key)')
	await expect(pkl).toContainText('stored-key (wrong password)')

	// enter-key: freshly generated key must be acknowledged before continuing.
	await expect(pkl.getByTestId('private-key-input')).toHaveValue(/nsec1/)
	await expect(pkl).toContainText('it cannot be recovered')
	await expect(pkl.getByTestId('continue-button')).toBeDisabled()
	await pkl.getByTestId('acknowledge-warning-checkbox').check()
	await expect(pkl.getByTestId('continue-button')).toBeEnabled()

	// stored-key: pubkey prefix plus the wrong-password error.
	await expect(pkl.getByTestId('stored-password-input')).toBeVisible()
	await expect(pkl).toContainText('Pubkey: d943e96d...')
	await expect(pkl).toContainText('Incorrect password')

	// set-password.
	await expect(pkl.getByTestId('encrypt-continue-button')).toBeVisible()
	await expect(pkl.getByTestId('new-password-input')).toBeVisible()
})
