import { expect, test } from '@playwright/test'

/**
 * Wrapper adapters. The pending states are the contract the routes rely on:
 * spinner present, button disabled, and no accessible-name pollution.
 */

test('renders the wrappers library', async ({ page }) => {
	await page.goto('/?library=wrappers')

	await expect(page.getByTestId('widget-book-selection')).toHaveText('wrappers')
	await expect(page.getByTestId('library-wrappers')).toBeVisible()

	for (const widget of [
		'ButtonVariants',
		'ButtonPendingStart',
		'ButtonPendingEnd',
		'ButtonPendingSmall',
		'TooltipButton',
		'TooltipToggleGroupItem',
		'CollectionSelectField',
		'EditorTextField',
		'EditorTextFieldError',
	]) {
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

test('a tooltip button shows its message on hover', async ({ page }) => {
	await page.goto('/?library=wrappers')

	const block = page.getByTestId('widget-TooltipButton')
	const save = block.getByRole('button', { name: 'Save' })
	await expect(save).toBeEnabled()
	await save.hover()
	await expect(page.getByRole('tooltip')).toHaveText('Save your changes')

	// Move to a neutral element so the tooltip unmounts before the next hover.
	await page.getByTestId('widget-book-title').hover()
	await expect(page.getByRole('tooltip')).toHaveCount(0)
	await block.getByRole('button', { name: 'Publish' }).hover()
	await expect(page.getByRole('tooltip')).toHaveText('Publish now')
})

test('a disabled tooltip button is disabled', async ({ page }) => {
	await page.goto('/?library=wrappers')

	const zap = page.getByTestId('widget-TooltipButton').getByRole('button', { name: 'Zap' })
	await expect(zap).toBeDisabled()
})

test('toggle-group items toggle and show their tooltips', async ({ page }) => {
	await page.goto('/?library=wrappers')

	const block = page.getByTestId('widget-TooltipToggleGroupItem')
	const grid = block.getByRole('button', { name: 'Grid view' })
	await expect(grid).toHaveAttribute('aria-pressed', 'true')
	await grid.click()
	await expect(grid).toHaveAttribute('aria-pressed', 'false')

	// Move to a neutral element so the tooltip unmounts before the next hover.
	await page.getByTestId('widget-book-title').hover()
	await expect(page.getByRole('tooltip')).toHaveCount(0)

	const list = block.getByRole('button', { name: 'List view' })
	await list.click()
	await expect(list).toHaveAttribute('aria-pressed', 'true')

	await page.getByTestId('widget-book-title').hover()
	await expect(page.getByRole('tooltip')).toHaveCount(0)
	await list.hover()
	await expect(page.getByRole('tooltip')).toHaveText('List view')
})

test('the collection select field changes the selected collection', async ({ page }) => {
	await page.goto('/?library=wrappers')

	const block = page.getByTestId('widget-CollectionSelectField')
	const select = block.getByRole('combobox', { name: 'Collection' })
	await expect(select).toHaveValue('summer')
	await expect(block).toContainText('Selected: summer')
	await expect(select.getByRole('option', { name: 'Not In A Collection' })).toHaveCount(1)
	await expect(select.getByRole('option', { name: 'Summer collection' })).toHaveCount(1)

	await select.selectOption({ label: 'Winter favourites' })
	await expect(block).toContainText('Selected: winter')
})

test('the editor text field keeps label, hint and typing', async ({ page }) => {
	await page.goto('/?library=wrappers')

	const block = page.getByTestId('widget-EditorTextField')
	await expect(block.getByText('Title', { exact: true })).toBeVisible()
	await expect(block.getByText('Shown on the product page.')).toBeVisible()

	const title = block.locator('#demo-title')
	await expect(title).toHaveValue('Handmade mug')
	await title.fill('Handmade vase')
	await expect(title).toHaveValue('Handmade vase')

	const description = block.locator('#demo-description')
	await expect(description).toBeEmpty()
	await description.fill('A mug, handmade.')
	await expect(description).toHaveValue('A mug, handmade.')
})

test('a touched editor text field shows its validation errors', async ({ page }) => {
	await page.goto('/?library=wrappers')

	const block = page.getByTestId('widget-EditorTextFieldError')
	await expect(block).toContainText('Price is required')
	await expect(block).toContainText('Use whole sats')
})
