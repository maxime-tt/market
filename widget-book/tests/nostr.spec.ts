import { expect, test } from '@playwright/test'

/**
 * Nostr identity rendering. `VerifiedBadge` resolves its own state from props,
 * so each entry shows a deterministic verification state.
 */

test('renders the nostr library', async ({ page }) => {
	await page.goto('/?library=nostr')

	await expect(page.getByTestId('widget-book-selection')).toHaveText('nostr')
	await expect(page.getByTestId('library-nostr')).toBeVisible()

	for (const widget of [
		'NpubDisplay',
		'NpubDisplayShort',
		'VerifiedBadgeVerified',
		'VerifiedBadgeInvalid',
		'VerifiedBadgeLoading',
		'VerifiedBadgeAddressHidden',
		'FeaturedUserCard',
		'FeaturedUserCardNoProducts',
		'FeaturedUserCardLoading',
	]) {
		await expect(page.getByTestId(`widget-${widget}`)).toBeVisible()
	}
})

test('renders the featured user card states', async ({ page }) => {
	await page.goto('/?library=nostr')

	const card = page.getByTestId('widget-FeaturedUserCard')
	await expect(card).toContainText('Mugsmith')
	await expect(card).toContainText('Handmade ceramics, fired in small batches.')
	// The total product count, not the number of rendered tiles.
	await expect(card).toContainText('12 products')
	await expect(card.locator('[data-slot="featured-user-card"]')).toHaveCount(1)
	// Two profile links plus one tile per supplied product.
	await expect(card.locator('a[href^="/product/"]')).toHaveCount(3)

	await expect(page.getByTestId('widget-FeaturedUserCardNoProducts')).toContainText('0 products')

	// While loading, the strip shows pulse placeholders and no tile links.
	const loading = page.getByTestId('widget-FeaturedUserCardLoading')
	await expect(loading.locator('a[href^="/product/"]')).toHaveCount(0)
})

test('truncates the npub and keeps the full value available', async ({ page }) => {
	await page.goto('/?library=nostr')

	const display = page.getByTestId('widget-NpubDisplay').locator('[data-slot="npub-display"]')
	await expect(display).toContainText('...')
	await expect(display).toHaveAttribute('title', /^npub1plebeianmarket/)

	// The short variant keeps fewer head characters.
	await expect(page.getByTestId('widget-NpubDisplayShort').locator('[data-slot="npub-display"]')).toContainText('npub1p...')
})

test('announces each verification state', async ({ page }) => {
	await page.goto('/?library=nostr')

	const verified = page.getByTestId('widget-VerifiedBadgeVerified')
	await expect(verified).toContainText('plebeian.market')
	await expect(verified.locator('[data-state="verified"]')).toHaveCount(1)

	const invalid = page.getByTestId('widget-VerifiedBadgeInvalid')
	await expect(invalid.locator('[data-state="invalid"]')).toHaveCount(1)

	// Loading delegates its accessible name to the spinner primitive.
	await expect(page.getByTestId('widget-VerifiedBadgeLoading').getByRole('status', { name: 'Loading' })).toBeVisible()

	// The address can be hidden while the badge stays.
	const hidden = page.getByTestId('widget-VerifiedBadgeAddressHidden')
	await expect(hidden.locator('[data-state="verified"]')).toHaveCount(1)
	await expect(hidden).not.toContainText('@')
})
