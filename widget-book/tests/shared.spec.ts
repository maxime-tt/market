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
		'CopyableField',
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

test('renders the copyable field row', async ({ page }) => {
	await page.goto('/?library=shared')

	const field = page.getByTestId('widget-CopyableField')
	await expect(field.locator('[data-slot="copyable-field"]')).toHaveCount(1)
	await expect(field).toContainText('App Relay')
	await expect(field).toContainText('wss://relay.plebeian.market')
	await expect(field.getByRole('button', { name: 'Copy App Relay' })).toBeVisible()
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

test('renders the drained shared components', async ({ page }) => {
	await page.goto('/?library=shared')

	for (const widget of [
		'Media',
		'MediaFallback',
		'ImageCarousel',
		'ImageCarouselEmpty',
		'ImageViewerModal',
		'ItemGrid',
		'ConfettiBurst',
		'PriceDisplayView',
		'PriceDisplayViewLoading',
		'CityCombobox',
		'CountryCombobox',
		'PhoneInput',
	]) {
		await expect(page.getByTestId(`widget-${widget}`)).toBeVisible()
	}
})

test('renders Media with an inline image and the fallback tile', async ({ page }) => {
	await page.goto('/?library=shared')

	const loaded = page.getByTestId('widget-Media')
	const img = loaded.locator('img[alt="Handmade mug"]')
	await expect(img).toBeVisible()
	await expect(img).toHaveAttribute('src', /data:image\/svg\+xml/)

	// The errored image collapses to the centered fallback tile.
	const fallback = page.getByTestId('widget-MediaFallback')
	await expect(fallback.getByRole('img', { name: 'Missing media' })).toHaveClass(/bg-fill-ink text-on-fill-ink/)
	await expect(fallback.locator('img')).toHaveCount(0)
})

test('renders the image carousel previews and the empty state', async ({ page }) => {
	await page.goto('/?library=shared')

	const carousel = page.getByTestId('widget-ImageCarousel')
	await expect(carousel.locator('img[alt="Handmade mug - Image 1"]').first()).toBeVisible()
	// Full-size buttons carry an "in full size" suffix, previews do not.
	for (const index of [1, 2, 3]) {
		await expect(carousel.getByRole('button', { name: `View Handmade mug - Image ${index}`, exact: true })).toBeVisible()
	}
	await expect(carousel.getByRole('button', { name: 'View Handmade mug - Image 1 in full size' })).toBeVisible()

	const empty = page.getByTestId('widget-ImageCarouselEmpty')
	await expect(empty.locator('.bg-fill-ink')).toHaveCount(1)
})

test('opens the image viewer modal from a trigger', async ({ page }) => {
	await page.goto('/?library=shared')

	const widget = page.getByTestId('widget-ImageViewerModal')
	await widget.getByRole('button', { name: 'Open image viewer' }).click()

	const dialog = page.getByRole('dialog')
	await expect(dialog).toBeVisible()
	await expect(dialog).toContainText('1 of 2')
	await expect(dialog).toContainText('100%')

	await dialog.getByRole('button', { name: 'Zoom in' }).click()
	await expect(dialog).toContainText('125%')

	// Escape instead of the Close button: the toolbar close and the dialog
	// primitive's built-in close both resolve to the name "Close".
	await page.keyboard.press('Escape')
	await expect(dialog).toHaveCount(0)
	await expect(widget.getByRole('button', { name: 'Open image viewer' })).toBeVisible()
})

test('renders the item grid with its columns and title', async ({ page }) => {
	await page.goto('/?library=shared')

	const grid = page.getByTestId('widget-ItemGrid')
	await expect(grid.getByRole('heading', { name: 'Products' })).toBeVisible()
	await expect(grid.locator('.grid.grid-cols-2.lg\\:grid-cols-3.gap-4')).toHaveCount(1)
	await expect(grid.locator('.grid > div')).toHaveCount(3)
})

test('mounts the confetti burst canvas through the portal', async ({ page }) => {
	await page.goto('/?library=shared')

	// The canvas renders into document.body via createPortal, not inside the card.
	await expect(page.locator('body > canvas[aria-hidden="true"]')).toHaveCount(1)
	await expect(page.getByTestId('widget-ConfettiBurst')).toContainText('Viewport confetti via portal')
})

test('renders the price display states', async ({ page }) => {
	await page.goto('/?library=shared')

	const loaded = page.getByTestId('widget-PriceDisplayView')
	await expect(loaded).toContainText('120,000 sats')
	await expect(loaded).toContainText('135.12 USD')

	const loading = page.getByTestId('widget-PriceDisplayViewLoading')
	await expect(loading.locator('.animate-pulse')).toHaveCount(2)
})

test('filters and selects a city for the chosen country', async ({ page }) => {
	await page.goto('/?library=shared')

	const widget = page.getByTestId('widget-CityCombobox')
	const input = widget.getByPlaceholder('e.g. San Francisco')
	await input.fill('San')

	const list = widget.locator('[data-city-item]')
	await expect(list.filter({ hasText: 'San Francisco' })).toBeVisible()
	await list.filter({ hasText: 'San Francisco' }).click()

	await expect(input).toHaveValue('San Francisco')
	await expect(list).toHaveCount(0)
})

test('selects a country from the full list', async ({ page }) => {
	await page.goto('/?library=shared')

	const widget = page.getByTestId('widget-CountryCombobox')
	await widget.getByRole('button', { name: 'Toggle country list' }).click()

	const item = widget.locator('[data-country-item]').filter({ has: page.getByText('Germany', { exact: true }) })
	await expect(item).toBeVisible()
	await item.click()

	await expect(widget.getByPlaceholder('e.g. United Kingdom')).toHaveValue('Germany')
})

test('combines the dial code with the phone number', async ({ page }) => {
	await page.goto('/?library=shared')

	const widget = page.getByTestId('widget-PhoneInput')

	// `selectedCountry="Germany"` auto-selects the dial code while empty.
	const trigger = widget.getByRole('button')
	await expect(trigger).toContainText('+49')

	const input = widget.locator('input[type="tel"]')
	await input.fill('15123456789')
	await expect(input).toHaveValue('15123456789')

	await trigger.click()
	const france = widget.locator('[data-country-item]').filter({ has: page.getByText('France', { exact: true }) })
	await expect(france).toBeVisible()
	await france.click()
	await expect(trigger).toContainText('+33')
})

test('opens the date-time picker and reads the derived time', async ({ page }) => {
	await page.goto('/?library=shared')

	const trigger = page.getByTestId('widget-DateTimePicker').getByRole('button')
	await expect(trigger).toHaveAttribute('aria-expanded', 'false')
	await expect(trigger).toContainText('Pick a start date & time')

	// Empty value defaults the time half to midday; the popover is closed at rest.
	await trigger.click()
	await expect(page.locator('input[type="time"]')).toHaveValue('12:00')
	await page.keyboard.press('Escape')
	await expect(trigger).toHaveAttribute('aria-expanded', 'false')
})

test('shows the selected instant and its time half', async ({ page }) => {
	await page.goto('/?library=shared')

	const trigger = page.getByTestId('widget-DateTimePickerSelected').getByRole('button')
	await expect(trigger).not.toContainText('Pick a start date & time')

	await trigger.click()
	await expect(page.locator('input[type="time"]')).toHaveValue('15:30')
	await page.keyboard.press('Escape')
})
