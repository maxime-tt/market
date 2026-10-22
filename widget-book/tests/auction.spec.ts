import { expect, test } from '@playwright/test'

// The copy control writes through `navigator.clipboard`, which needs an
// explicit grant in the headless browser context.
test.use({ permissions: ['clipboard-read', 'clipboard-write'] })

/**
 * Auction detail presentations. Each entry renders a deterministic literal-prop
 * state, so the spec asserts copy and tone without any host plumbing.
 */

test('renders the auction library', async ({ page }) => {
	await page.goto('/?library=auction')

	await expect(page.getByTestId('widget-book-selection')).toHaveText('auction')
	await expect(page.getByTestId('library-auction')).toBeVisible()

	for (const widget of ['AuctionStatusBadge', 'AuctionSettlementBadge', 'AuctionDetailCard', 'AuctionPartyCard', 'AuctionTechnicalRow']) {
		await expect(page.getByTestId(`widget-${widget}`)).toBeVisible()
	}
})

test('maps auction lifecycle status to semantic tones', async ({ page }) => {
	await page.goto('/?library=auction')

	const badge = page.getByTestId('widget-AuctionStatusBadge')
	await expect(badge).toContainText('Live')
	await expect(badge).toContainText('Scheduled')
	await expect(badge).toContainText('Ended')
	await expect(badge.locator('[data-tone="success"]')).toHaveCount(1)
	await expect(badge.locator('[data-tone="info"]')).toHaveCount(1)
	await expect(badge.locator('[data-tone="neutral"]')).toHaveCount(1)
})

test('maps settlement display state to copy and tone', async ({ page }) => {
	await page.goto('/?library=auction')

	const badge = page.getByTestId('widget-AuctionSettlementBadge')
	await expect(badge).toContainText('Awaiting close')
	await expect(badge).toContainText('Ready to settle')
	await expect(badge).toContainText('reserve not met')
	await expect(badge).toContainText('cancelled')
	await expect(badge.locator('[data-tone="warning"]')).toHaveCount(2)
	await expect(badge.locator('[data-tone="error"]')).toHaveCount(1)
})

test('renders the auction detail and party cards', async ({ page }) => {
	await page.goto('/?library=auction')

	const detail = page.getByTestId('widget-AuctionDetailCard')
	await expect(detail).toContainText('Auction type')
	await expect(detail).toContainText('Primary format shown to buyers.')
	await expect(detail.locator('[data-slot="auction-detail-card"]')).toHaveCount(3)

	const party = page.getByTestId('widget-AuctionPartyCard')
	await expect(party).toContainText('Seller')
	await expect(party).toContainText('satoshi')
	await expect(party.locator('[data-slot="auction-party-card"]')).toHaveCount(2)
})

test('renders the activity summary with a new-items highlight', async ({ page }) => {
	await page.goto('/?library=auction')

	const row = page.getByTestId('widget-AuctionActivityRow')
	await expect(row.locator('[data-slot="auction-activity-row"]')).toHaveCount(3)
	// Plural at three, singular at one, plural at zero.
	await expect(row).toContainText('3 Bids')
	await expect(row).toContainText('1 Comment')
	await expect(row).toContainText('0 Messages')
	// Only the first row carries unseen items.
	await expect(row.getByText('1 New')).toHaveCount(1)
})

test('renders the technical row with a copy control only when copyable', async ({ page }) => {
	await page.goto('/?library=auction')

	const row = page.getByTestId('widget-AuctionTechnicalRow')
	await expect(row).toContainText('Bidder pubkey')
	await expect(row).toContainText('Trusted mints')
	// Three rows, but only the first carries a copy value.
	await expect(row.locator('[data-slot="auction-technical-row"]')).toHaveCount(3)
	await expect(row.locator('[data-slot="copy-button"]')).toHaveCount(1)
	await expect(row.locator('[data-slot="copy-button"]')).toHaveAttribute('aria-label', 'Copy Bidder pubkey')

	await row.locator('[data-slot="copy-button"]').click()
	await expect(row.locator('[data-slot="copy-button"]')).toHaveAttribute('data-copied', 'true')
})
