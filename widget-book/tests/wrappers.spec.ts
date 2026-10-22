import { expect, test } from '@playwright/test'

/**
 * Wrapper adapters. The pending states are the contract the routes rely on:
 * spinner present, button disabled, and no accessible-name pollution.
 */

test('renders the wrappers library', async ({ page }) => {
	await page.goto('/?library=wrappers')

	await expect(page.getByTestId('widget-book-selection')).toHaveText('wrappers')
	await expect(page.getByTestId('library-wrappers')).toBeVisible()

	for (const widget of ['ButtonVariants', 'ButtonPendingStart', 'ButtonPendingEnd', 'ButtonPendingSmall']) {
		await expect(page.getByTestId(`widget-${widget}`)).toBeVisible()
	}
})

test('a pending button shows a spinner and is disabled', async ({ page }) => {
	await page.goto('/?library=wrappers')

	const pending = page.getByTestId('widget-ButtonPendingStart').getByRole('button')
	await expect(pending).toBeDisabled()
	await expect(pending).toHaveAttribute('aria-busy', 'true')
	await expect(pending).toHaveAttribute('data-pending', 'true')
	await expect(pending.locator('[data-slot="button-spinner"]')).toHaveCount(1)
	// The spinner is aria-hidden, so the accessible name is the label alone.
	await expect(pending).toHaveAccessibleName('Saving…')
})

test('a non-pending button keeps the primitive behaviour', async ({ page }) => {
	await page.goto('/?library=wrappers')

	const plain = page.getByTestId('widget-ButtonVariants').getByRole('button', { name: 'Default' })
	await expect(plain).toBeEnabled()
	await expect(plain).toHaveAttribute('data-pending', 'false')
	await expect(plain.locator('[data-slot="button-spinner"]')).toHaveCount(0)
})

test('pendingPosition=end places the spinner after the label', async ({ page }) => {
	await page.goto('/?library=wrappers')

	const pending = page.getByTestId('widget-ButtonPendingEnd').getByRole('button')
	await expect(pending).toHaveAccessibleName('Saving…')
	const html = (await pending.innerHTML()) ?? ''
	expect(html.indexOf('button-spinner')).toBeGreaterThan(html.indexOf('Saving'))
})
