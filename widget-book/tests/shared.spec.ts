import { expect, test } from '@playwright/test'

test('renders the shared state atoms', async ({ page }) => {
	await page.goto('/?library=shared')

	await expect(page.getByTestId('widget-book-selection')).toHaveText('shared')
	await expect(page.getByTestId('library-shared')).toBeVisible()

	for (const widget of [
		'EmptyState',
		'EmptyStateAction',
		'ErrorState',
		'LoadingStateSpinner',
		'LoadingStateSkeleton',
		'StatCard',
		'DetailField',
		'ConfirmDialog',
		'ConfirmDialogDestructive',
		'EntityListItem',
		'EntityListItemPending',
		'Notice',
		'StatusBadge',
	]) {
		await expect(page.getByTestId(`widget-${widget}`)).toBeVisible()
	}
})

test('shows the meaningful state copy', async ({ page }) => {
	await page.goto('/?library=shared')

	await expect(page.getByTestId('widget-EmptyState')).toContainText('No products yet')
	await expect(page.getByTestId('widget-EmptyStateAction')).toContainText('No shipping options')
	await expect(page.getByTestId('widget-ErrorState')).toContainText('Could not load orders')
	await expect(page.getByTestId('widget-ErrorState')).toContainText('Try again')
	await expect(page.getByTestId('widget-LoadingStateSkeleton').locator('[data-slot="skeleton"]')).toHaveCount(3)
	await expect(page.getByTestId('widget-StatCard')).toContainText('128,400 sats')
	await expect(page.getByTestId('widget-StatCard')).toContainText('Live pulse')
	await expect(page.getByTestId('widget-DetailField')).toContainText('includes shipping')
})

test('renders the confirmation, notice and status atoms', async ({ page }) => {
	await page.goto('/?library=shared')

	await expect(page.getByTestId('widget-Notice')).toContainText('Delivery unconfirmed')
	await expect(page.getByTestId('widget-Notice')).toContainText('Dismissible notice')
	await expect(page.getByTestId('widget-StatusBadge')).toContainText('Warning')
	await expect(page.getByTestId('widget-StatusBadge')).toContainText('Success')

	// The dialogs are opened on demand: a mounted open modal hides the rest of the
	// catalogue from the accessibility tree, so nothing else may be asserted by role.
	await expect(page.getByText('Delete product?')).toHaveCount(0)
	await page.getByRole('button', { name: 'Open confirmation' }).click()
	await expect(page.getByText('Delete product?')).toBeVisible()
	await page.keyboard.press('Escape')

	await page.getByRole('button', { name: 'Open destructive confirmation' }).click()
	await expect(page.getByText('Delete collection?')).toBeVisible()
	await page.keyboard.press('Escape')
})

test('renders the entity list item molecule', async ({ page }) => {
	await page.goto('/?library=shared')

	const open = page.getByTestId('widget-EntityListItem')
	await expect(open).toContainText('Handmade mug')
	await expect(open).toContainText('Expanded details for the selected product.')
	await expect(open.getByRole('button', { name: 'Edit product' })).toBeVisible()
	await expect(open.getByRole('button', { name: 'Delete product' })).toBeVisible()

	const pending = page.getByTestId('widget-EntityListItemPending')
	await expect(pending).toContainText('Summer favourites')
	const deleteButton = pending.getByRole('button', { name: 'Delete collection' })
	await expect(deleteButton).toBeDisabled()
	await expect(deleteButton.getByRole('status', { name: 'Loading' })).toBeVisible()
})

test('renders the copy button and truncated text atoms', async ({ page }) => {
	await page.goto('/?library=shared')

	const labelled = page.getByTestId('widget-CopyButton')
	await expect(labelled.getByRole('button', { name: 'Copy npub' })).toBeVisible()
	await expect(labelled).toContainText('Copy npub')

	// The icon-only variant must still expose an accessible name.
	const iconOnly = page.getByTestId('widget-CopyButtonIconOnly')
	await expect(iconOnly.getByRole('button', { name: 'Copy to clipboard' })).toBeVisible()

	const truncated = page.getByTestId('widget-TruncatedText')
	await expect(truncated).toContainText('…')
	await expect(truncated).toContainText('short')
})
