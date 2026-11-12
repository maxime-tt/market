import { expect, test } from '@playwright/test'

/**
 * Migration views. `MigrationFormView` is a controlled form and
 * `MigrationProgressDialog` a Radix dialog without an outside-close, so the
 * specs drive them through the demos' triggers and inputs.
 */

test('renders the migration library', async ({ page }) => {
	await page.goto('/?library=migration')

	await expect(page.getByTestId('widget-book-selection')).toHaveText('migration')
	await expect(page.getByTestId('library-migration')).toBeVisible()

	for (const widget of ['MigrationFormView', 'MigrationFormViewPublishing', 'MigrationProgressDialog', 'MigrationProgressDialogError']) {
		await expect(page.getByTestId(`widget-${widget}`)).toBeVisible()
	}
})

test('shows the NIP-15 original beside the NIP-99 editor', async ({ page }) => {
	await page.goto('/?library=migration')

	const form = page.getByTestId('widget-MigrationFormView')
	await expect(form).toContainText('NIP-15 Original')
	await expect(form).toContainText('Read-only view of the original NIP-15 product')
	await expect(form.locator('input[readonly]').first()).toHaveValue('Handmade mug')
	await expect(form).toContainText('Material: Stoneware')
	await expect(form).toContainText('NIP-99 Enhanced Version')
	await expect(form.locator('#name')).toHaveValue('Handmade mug')
	await expect(form.locator('#description')).toHaveValue(/Wheel-thrown stoneware mug/)
	await expect(form.getByPlaceholder('Sub category 1')).toHaveValue('Mugs')
	await expect(form).toContainText('Standard Post') // selected shipping
	await expect(form).toContainText('Express Courier')
	await expect(form).toContainText('Weight (optional)')
	await expect(form).toContainText('Dimensions (optional)')
	await expect(form.getByRole('button', { name: 'Migrate Product' })).toBeEnabled()
})

test('edits the controlled migration form fields', async ({ page }) => {
	await page.goto('/?library=migration')

	const form = page.getByTestId('widget-MigrationFormView')

	await form.locator('#name').fill('Handmade mug, second batch')
	await expect(form.locator('#name')).toHaveValue('Handmade mug, second batch')

	await form.getByRole('button', { name: 'Add Image' }).click()
	await expect(form).toContainText('Image uploader slot 1')

	await form.getByRole('button', { name: 'Add Sub Category' }).click()
	await expect(form.getByPlaceholder('Sub category 2')).toBeVisible()
})

test('moves a shipping option from available to selected', async ({ page }) => {
	await page.goto('/?library=migration')

	const form = page.getByTestId('widget-MigrationFormView')

	await expect(form).toContainText('Selected:')
	await expect(form.getByRole('button', { name: 'Added', exact: true })).toBeDisabled()

	await form.getByRole('button', { name: 'Add', exact: true }).click()
	await expect(form.locator('input[placeholder="Extra cost"]')).toHaveCount(2)
})

test('disables publishing while the host is publishing', async ({ page }) => {
	await page.goto('/?library=migration')

	const form = page.getByTestId('widget-MigrationFormViewPublishing')
	await expect(form.getByRole('button', { name: 'Migrating...' })).toBeDisabled()
	await expect(form.getByRole('button', { name: 'Cancel' })).toBeEnabled()
})

test('tracks the publishing progress across relays', async ({ page }) => {
	await page.goto('/?library=migration')

	const widget = page.getByTestId('widget-MigrationProgressDialog')
	await widget.getByRole('button', { name: 'Open migration progress' }).click()

	const dialog = page.getByRole('dialog')
	await expect(dialog).toBeVisible()
	await expect(dialog).toContainText('Migrating Product...')
	await expect(dialog).toContainText('Reading NIP-15 product')
	await expect(dialog).toContainText('Publishing NIP-99 product')
	await expect(dialog).toContainText('Relay Status')
	await expect(dialog).toContainText('relay.plebeian.market')
	await expect(dialog).toContainText('1 of 3 relays')
	await expect(dialog.locator('[data-slot="progress"]')).toHaveCount(1)
})

test('reports the failed migration with retry and cancel actions', async ({ page }) => {
	await page.goto('/?library=migration')

	const widget = page.getByTestId('widget-MigrationProgressDialogError')
	await widget.getByRole('button', { name: 'Open failed migration' }).click()

	const dialog = page.getByRole('dialog')
	await expect(dialog).toBeVisible()
	await expect(dialog).toContainText('Migration Failed')
	await expect(dialog).toContainText('The relay rejected the product event: duplicate d tag.')
	await expect(dialog.getByRole('button', { name: 'Try Again' })).toBeVisible()

	await dialog.getByRole('button', { name: 'Cancel' }).click()
	await expect(dialog).toHaveCount(0)
})
