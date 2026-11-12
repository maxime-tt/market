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

	for (const widget of [
		'AuctionStatusBadge',
		'AuctionSettlementBadge',
		'AuctionDetailCard',
		'AuctionPartyCard',
		'AuctionTechnicalRow',
		'AuctionListItemView',
		'AuctionListItemViewSeen',
		'AuctionDisplayView',
		'AuctionTopBidBox',
		'AuctionTopBidBoxEmpty',
		'AuctionTopBidBoxSettlement',
		'BidStatusPill',
		'BidStatusBanner',
		'AuctionShippingDetailRow',
		'AuctionShippingOptionCard',
		'AuctionShippingOptionCardStates',
		'AuctionShippingOptionCardPartial',
		'BidLadderPreview',
		'BidLadderPreviewNoReserve',
		'AuctionTimelinePreview',
		'AuctionTimelinePreviewFlat',
		'AuctionTimelinePreviewWaiting',
		'AntiSnipeCurveSettings',
		'AntiSnipeCurveSettingsOff',
		'AntiSnipeCurveSettingsInteractive',
		'SettlementGraceSettings',
		'SettlementGraceSettingsInteractive',
		'AuctionNameTab',
		'AuctionCategoryTab',
		'AuctionSpecTab',
		'AuctionImagesTab',
		'AuctionImagesTabInteractive',
		'AuctionTabView',
		'AuctionTabViewScheduled',
		'AuctionTabViewAdvanced',
		'AuctionShippingView',
		'AuctionShippingViewNotConnected',
		'AuctionShippingViewLoading',
		'AuctionShippingViewNoOptions',
		'AuctionShippingViewAllAttached',
		'AuctionVerdictView',
		'AuctionBidsView',
		'AuctionTimelineChartView',
		'BidProgressPlacing',
		'BidProgressConfirmed',
		'BidProgressPublishFailedRetry',
		'BidProgressLockUncertain',
		'BidProgressRejected',
		'BidProgressDepositUncertain',
		'AuctionCardView',
		'AuctionCardViewWinning',
		'AuctionCardViewEndedNoImage',
		'BidderPanelFull',
		'BidderPanelCompact',
		'BidderPanelAntiSnipe',
		'BidderPanelEnded',
		'BidderPanelNotStarted',
		'BidderRulesDialog',
		'BidderConfirmDialog',
	]) {
		await expect(page.getByTestId(`widget-${widget}`)).toBeVisible()
	}
})

/**
 * I-PARKED commit B: the bid progress dialog is the money-path surface of the
 * bid-funding lifecycle, so the spec asserts the stage mapping and the #1235
 * gating, not just visibility. Each dialog entry renders CLOSED behind its own
 * trigger (an open Radix dialog hides the rest of the catalogue from the
 * accessibility tree), so the spec opens one at a time and Escape-closes it
 * before driving the next (the wallet-library discipline).
 */
const openDialogFrom = async (page: import('@playwright/test').Page, widget: string, label: string) => {
	const trigger = page.getByTestId(`widget-${widget}`).getByRole('button', { name: label, exact: true })
	await trigger.click()
	const dialog = page.getByRole('dialog')
	await expect(dialog).toBeVisible()
	return dialog
}

const closeDialog = async (page: import('@playwright/test').Page) => {
	await page.keyboard.press('Escape')
	await expect(page.getByRole('dialog')).toBeHidden()
}

test('renders the bid progress dialog money-path states', async ({ page }) => {
	await page.goto('/?library=auction')

	const placing = await openDialogFrom(page, 'BidProgressPlacing', 'Open placing-your-bid dialog')
	await expect(placing).toContainText('Placing Your Bid')
	await expect(placing).toContainText('Payment received — minting e-cash...')
	await expect(placing).not.toContainText('Retry publish')
	await closeDialog(page)

	const confirmed = await openDialogFrom(page, 'BidProgressConfirmed', 'Open confirmed-bid dialog')
	await expect(confirmed).toContainText('Bid successfully placed!')
	await expect(confirmed).toContainText('21,000 sats')
	await expect(confirmed).toContainText('Refund available after:')
	await closeDialog(page)

	// The retry affordance renders ONLY for an evidenced publish failure.
	const retryable = await openDialogFrom(page, 'BidProgressPublishFailedRetry', 'Open publish-failed dialog')
	await expect(retryable).toContainText('Bid Publish Failed')
	await expect(retryable).toContainText('Retry publish')
	await closeDialog(page)

	// #1235 round-3 fix 3: an uncertain lock outcome claims neither "funding
	// completed" nor a retry — the hook refuses the retry outright.
	const uncertain = await openDialogFrom(page, 'BidProgressLockUncertain', 'Open lock-uncertain dialog')
	await expect(uncertain).toContainText('Bid lock outcome unconfirmed')
	await expect(uncertain).not.toContainText('Retry publish')
	await closeDialog(page)

	const rejected = await openDialogFrom(page, 'BidProgressRejected', 'Open rejected-bid dialog')
	await expect(rejected).toContainText('Bid Rejected')
	await expect(rejected).toContainText('fraudulent_bid')
	await closeDialog(page)

	// #1235 round-3 B3: an unevidenced deposit outcome is terminal but must not
	// render the "Funding Failed" copy.
	const deposit = await openDialogFrom(page, 'BidProgressDepositUncertain', 'Open deposit-uncertain dialog')
	await expect(deposit).toContainText('Payment outcome unconfirmed')
	await expect(deposit).not.toContainText('Funding Failed')
	await closeDialog(page)
})

/**
 * I-PARKED commit C: the bidder panel is the money-path bid control, so the
 * spec asserts the gating (lower-bound gate, ended, compact card, anti-snipe
 * banner) and the confirm-bid surfaces, not just visibility.
 */
test('renders the bidder panel money-path gating states', async ({ page }) => {
	await page.goto('/?library=auction')

	const full = page.getByTestId('widget-BidderPanelFull')
	await expect(full).toContainText('Minimum allowed bid: 10,000 sats')
	await expect(full).toContainText('Mint:')
	await expect(full).toContainText('mint.example')
	await expect(full).toContainText('Review auction rules')
	await expect(full.getByRole('button', { name: 'Place Bid' })).toBeEnabled()

	// Compact card mode: the amount input and the minimum-bid info are hidden.
	const compact = page.getByTestId('widget-BidderPanelCompact')
	await expect(compact).toContainText('Bid 10,000 sats')
	await expect(compact).not.toContainText('Minimum allowed bid:')
	await expect(compact).not.toContainText('Mint:')

	// AUCTIONS.md §6.1: the banner shows only inside `(end_at, max_end_at]`.
	const antiSnipe = page.getByTestId('widget-BidderPanelAntiSnipe')
	await expect(antiSnipe).toContainText('Anti-snipe window — minimum bid rising')
	await expect(antiSnipe).toContainText('Floor right now: 10,000 sats.')

	const ended = page.getByTestId('widget-BidderPanelEnded')
	await expect(ended).toContainText('Auction Ended')
	await expect(ended).not.toContainText('Minimum allowed bid:')

	// Lower-bound gate: bids cannot be placed before start_at.
	const notStarted = page.getByTestId('widget-BidderPanelNotStarted')
	await expect(notStarted).toContainText('Bidding not started')
	await expect(notStarted.getByRole('button', { name: 'Bidding not started' })).toBeDisabled()

	// The confirm-bid dialog surfaces the auction identity, the mint options,
	// the funding delta and the refund locktime.
	const confirm = await openDialogFrom(page, 'BidderConfirmDialog', 'Open confirm-bid dialog')
	await expect(confirm).toContainText('Confirm Bid')
	await expect(confirm).toContainText('Handmade mug')
	await expect(confirm).toContainText('Minimum allowed bid: 10,000 sats')
	await expect(confirm).toContainText('To lock')
	await expect(confirm).toContainText('6,000 sats')
	await expect(confirm).toContainText('Your funds will be locked in this auction until')
	await closeDialog(page)

	const rules = await openDialogFrom(page, 'BidderRulesDialog', 'Open auction rules dialog')
	await expect(rules).toContainText('Review auction rules before bidding')
	await expect(rules).toContainText('I understand these rules')
	await closeDialog(page)
})

/**
 * I-PARKED commit D: the list card is the auction discovery surface, so the
 * spec asserts the price/count surfaces and the badge/pill mapping.
 */
test('renders the auction card surface states', async ({ page }) => {
	await page.goto('/?library=auction')

	const withBids = page.getByTestId('widget-AuctionCardView')
	await expect(withBids).toContainText('Handmade mug')
	await expect(withBids).toContainText('21,000 sats')
	await expect(withBids).toContainText('3 Bids')
	await expect(withBids).toContainText('LIVE')
	await expect(withBids).toContainText('2d 3h left')

	const winning = page.getByTestId('widget-AuctionCardViewWinning')
	await expect(winning).toContainText("You're winning")
	await expect(winning).not.toContainText('3 Bids')

	const ended = page.getByTestId('widget-AuctionCardViewEndedNoImage')
	await expect(ended).toContainText('No image')
	await expect(ended).toContainText('ENDED')
	await expect(ended).toContainText('You were outbid')
})

test('renders the four simple editor tabs', async ({ page }) => {
	await page.goto('/?library=auction')

	const name = page.getByTestId('widget-AuctionNameTab')
	await expect(name.locator('#auction-title')).toHaveValue('Handmade mug')
	await expect(name.locator('#auction-summary')).toHaveValue('One-of-a-kind stoneware mug')
	await expect(name.locator('#auction-description')).toHaveValue('Wheel-thrown, food-safe glaze.')
	await expect(name).toContainText('This auction contains adult/sensitive content')

	const category = page.getByTestId('widget-AuctionCategoryTab')
	await expect(category).toContainText('Main Category')
	await expect(category.locator('textarea')).toHaveValue('Cameras, Optics')

	const spec = page.getByTestId('widget-AuctionSpecTab')
	await expect(spec).toContainText('Item Specifications')
	await expect(spec.getByRole('button', { name: 'Add Specification' })).toBeVisible()

	// The images tab hands every slot to the host renderer.
	const images = page.getByTestId('widget-AuctionImagesTab')
	await expect(images.locator('[data-slot="uploader-slot"]')).toHaveCount(2)
})

test('removes an image slot through the host renderer callback', async ({ page }) => {
	await page.goto('/?library=auction')

	const live = page.getByTestId('widget-AuctionImagesTabInteractive')
	await expect(live.locator('[data-slot="uploader-slot"]')).toHaveCount(3)
	await live.locator('[data-slot="uploader-slot"] button', { hasText: 'Delete' }).first().click()
	await expect(live.locator('[data-slot="uploader-slot"]')).toHaveCount(2)
})

test('renders the mechanics tab, and Advanced reveals the deferred controls', async ({ page }) => {
	await page.goto('/?library=auction')

	const view = page.getByTestId('widget-AuctionTabView')
	await expect(view).toContainText('Start Time')
	await expect(view).toContainText('Immediate')
	await expect(view).toContainText('The auction goes live the moment you publish.')
	await expect(view).toContainText('Starting Bid (sats)')
	// Advanced is collapsed at rest.
	await expect(view).not.toContainText('Reserve (sats)')

	const scheduled = page.getByTestId('widget-AuctionTabViewScheduled')
	await expect(scheduled).toContainText('Pick a start date')
	await expect(scheduled).toContainText('Pick an end date')

	// The interactive demo opens Advanced and composes the S3/S4 cards.
	const live = page.getByTestId('widget-AuctionTabViewAdvanced')
	await live.getByRole('button', { name: 'Advanced' }).click()
	await expect(live).toContainText('Bid Increment (sats)')
	await expect(live).toContainText('Reserve (sats)')
	await expect(live).toContainText('Bid ladder preview')
	await expect(live).toContainText('Anti-snipe')
	await expect(live).toContainText('Settlement grace')
	await expect(live).toContainText('Trusted Mints')
})

test('renders the shipping panel and its degenerate branches', async ({ page }) => {
	await page.goto('/?library=auction')

	const view = page.getByTestId('widget-AuctionShippingView')
	await expect(view).toContainText('Attached')
	await expect(view).toContainText('Standard Post')
	await expect(view).toContainText('Unknown shipping option')
	await expect(view).toContainText('Enter a whole number')
	await expect(view).toContainText('10 USD · standard · DHL')

	const notConnected = page.getByTestId('widget-AuctionShippingViewNotConnected')
	await expect(notConnected).toContainText('Connect your wallet to load your shipping options.')
	await expect(notConnected.locator('[data-slot="empty-state"]')).toHaveCount(1)

	const loading = page.getByTestId('widget-AuctionShippingViewLoading')
	await expect(loading).toContainText('Loading shipping options...')
	await expect(loading.locator('[data-slot="loading-state"]')).toHaveCount(1)

	const noOptions = page.getByTestId('widget-AuctionShippingViewNoOptions')
	await expect(noOptions).toContainText('any shipping options yet')
	await expect(noOptions.locator('[data-slot="empty-state"]')).toHaveCount(1)
	await expect(noOptions.locator('a[href="/dashboard/products/shipping-options"]')).toHaveCount(1)

	const allAttached = page.getByTestId('widget-AuctionShippingViewAllAttached')
	await expect(allAttached).toContainText('All of your shipping options are already attached.')
	await expect(allAttached.locator('[data-slot="notice"]')).toHaveCount(1)
})

test('renders the validator verdict panel with claim tones and injected avatars', async ({ page }) => {
	await page.goto('/?library=auction')

	const view = page.getByTestId('widget-AuctionVerdictView')
	await expect(view.locator('[data-slot="auction-verdict-view"]')).toHaveCount(1)
	await expect(view).toContainText('Validator verdicts')
	await expect(view).toContainText('4 total')
	// The claim copy renders verbatim, one row per verdict.
	await expect(view).toContainText('settled_promptly')
	await expect(view).toContainText('valid_bid_placed')
	await expect(view).toContainText('fraudulent_bid')
	await expect(view).toContainText('griefed')
	// The host-owned identity slot: validator + bidder avatar per row.
	await expect(view.locator('[data-slot="verdict-avatar"]')).toHaveCount(8)
	await expect(view.locator('[data-slot="verdict-avatar"][data-pubkey^="bbbb"]')).toHaveCount(2)
})

test('renders the auction bids view and expands its technical accordion', async ({ page }) => {
	await page.goto('/?library=auction')

	const view = page.getByTestId('widget-AuctionBidsView')
	await expect(view.locator('[data-slot="auction-bids-view"]')).toHaveCount(1)
	await expect(view).toContainText('Highest visible bid')
	await expect(view).toContainText('15,000 sats')
	await expect(view).toContainText('Mint: mint.example.com')
	await expect(view.locator('[data-slot="bidder-card"]')).not.toHaveCount(0)

	// Collapsed: the technical row is not mounted until the trigger is clicked.
	await expect(view.getByText('hd_p2pk')).toHaveCount(0)
	await view.getByRole('button', { name: 'Bid event details' }).first().click()

	await expect(view.getByText('Bidder pubkey')).toBeVisible()
	await expect(view).toContainText('Key scheme')
	await expect(view).toContainText('hd_p2pk')
})

test('renders the auction timeline chart scatter surface', async ({ page }) => {
	await page.goto('/?library=auction')

	const view = page.getByTestId('widget-AuctionTimelineChartView')
	await expect(view.locator('[data-slot="auction-timeline-chart-view"]')).toHaveCount(1)
	await expect(view.locator('.recharts-surface')).toBeVisible()
})

test('renders the dashboard auction list row with its host-owned slots', async ({ page }) => {
	await page.goto('/?library=auction')

	const item = page.getByTestId('widget-AuctionListItemView')
	await expect(item.locator('[data-slot="auction-list-item"]')).toHaveCount(1)
	await expect(item).toContainText('Handmade mug auction')
	await expect(item).toContainText('One-of-a-kind stoneware mug')
	await expect(item).toContainText('Created:')
	// The host-owned action, countdown and composed top-bid panel all slot in.
	await expect(item.getByRole('button', { name: 'View auction' })).toBeVisible()
	await expect(item.locator('[data-slot="demo-countdown"]')).toContainText('2d 4h left')
	await expect(item).toContainText('15,000 sats')
	await expect(item).toContainText('satoshi')
	// Fresh activity: the seen control is enabled and the new counts highlight.
	await expect(item.getByRole('button', { name: 'Mark as seen' })).toBeEnabled()
	await expect(item).toContainText('2 New')
})

test('renders the drained-down list row with disabled seen control and empty top bid', async ({ page }) => {
	await page.goto('/?library=auction')

	const item = page.getByTestId('widget-AuctionListItemViewSeen')
	await expect(item).toContainText('Frosted vase auction')
	// No thumbnail: the gavel placeholder shows instead.
	await expect(item.locator('svg.lucide-gavel')).toHaveCount(1)
	await expect(item).toContainText('No bids yet. Winning bid will appear here.')
	await expect(item.getByRole('button', { name: 'Mark as seen' })).toBeDisabled()
})

test('renders the top-bid panel in its current, empty and settlement states', async ({ page }) => {
	await page.goto('/?library=auction')

	const current = page.getByTestId('widget-AuctionTopBidBox')
	await expect(current.locator('[data-slot="auction-top-bid-box"]')).toHaveCount(1)
	await expect(current).toContainText('15,000 sats')
	await expect(current).toContainText('5 mins ago')
	await expect(current).toContainText('Current top bid')

	const empty = page.getByTestId('widget-AuctionTopBidBoxEmpty')
	await expect(empty).toContainText('No bids yet. Winning bid will appear here.')

	// Settlement phase turns the frame success-toned and hides the bid behind the accordion.
	const settlement = page.getByTestId('widget-AuctionTopBidBoxSettlement')
	const frame = settlement.locator('[data-slot="auction-top-bid-box"]')
	await expect(frame).toHaveClass(/border-success-border bg-success-muted/)
	await expect(settlement).toContainText('Winning bid')
	await expect(settlement).toContainText('Settlement details')
	await expect(settlement).not.toContainText('Waiting for release path')

	await settlement.getByRole('button', { name: 'Settlement details' }).click()
	await expect(settlement).toContainText('Waiting for release path')
	await expect(settlement).toContainText('2 days to publish settlement')
	await expect(settlement).toContainText('Bid was not settled. It was grieved because release path was not published.')
	await expect(settlement.getByRole('button', { name: 'Waiting for bidder shipping method' })).toBeDisabled()
})

test('derives the bid status pills and banners from the status copy', async ({ page }) => {
	await page.goto('/?library=auction')

	const pills = page.getByTestId('widget-BidStatusPill')
	await expect(pills.locator('[data-slot="status-badge"]')).toHaveCount(5)
	await expect(pills).toContainText('Winning bid')
	await expect(pills).toContainText('Reclaim available')
	await expect(pills).toContainText('Locked')
	await expect(pills).toContainText('Outbid')
	await expect(pills).toContainText('Auction cancelled')
	await expect(pills.locator('[data-tone="success"]')).toHaveCount(1)
	await expect(pills.locator('[data-tone="warning"]')).toHaveCount(1)
	await expect(pills.locator('[data-tone="info"]')).toHaveCount(1)
	await expect(pills.locator('[data-tone="neutral"]')).toHaveCount(1)
	await expect(pills.locator('[data-tone="error"]')).toHaveCount(1)

	const banners = page.getByTestId('widget-BidStatusBanner')
	await expect(banners.locator('[data-slot="notice"]')).toHaveCount(3)
	await expect(banners).toContainText('This bid won the auction. Submit your shipping address from the auction page.')
	await expect(banners).toContainText('1 locked bid part is past locktime and can be reclaimed now.')
	// Neutral copy renders through the info notice tone.
	await expect(banners.locator('[data-tone="info"]')).toHaveCount(1)
})

test('renders the shipping detail rows and skips empty values', async ({ page }) => {
	await page.goto('/?library=auction')

	const rows = page.getByTestId('widget-AuctionShippingDetailRow')
	await expect(rows.locator('dt')).toHaveCount(2)
	await expect(rows).toContainText('Base price')
	await expect(rows).toContainText('International Priority')
	await expect(rows).not.toContainText('Carrier')
})

test('renders the shipping option card and its degenerate branches', async ({ page }) => {
	await page.goto('/?library=auction')

	const card = page.getByTestId('widget-AuctionShippingOptionCard')
	await expect(card).toContainText('International Priority')
	await expect(card).toContainText('Door-to-door courier with tracking')
	await expect(card).toContainText('1,200 sats')
	await expect(card).toContainText('Base price')
	await expect(card).toContainText('1,000 sats')
	await expect(card).toContainText('Auction extra cost')
	await expect(card).toContainText('200 sats')

	const states = page.getByTestId('widget-AuctionShippingOptionCardStates')
	await expect(states.locator('li')).toHaveCount(3)
	await expect(states).toContainText('Invalid shipping reference')
	await expect(states).toContainText('Event 30402:abc123 could not be parsed.')
	await expect(states).toContainText('Loading shipping details...')
	await expect(states).toContainText('Shipping option unavailable')

	const partial = page.getByTestId('widget-AuctionShippingOptionCardPartial')
	await expect(partial).toContainText('Some shipping details are missing or malformed.')
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

test('renders the bid-ladder preview in its reserve and no-reserve states', async ({ page }) => {
	await page.goto('/?library=auction')

	const reserved = page.getByTestId('widget-BidLadderPreview')
	await expect(reserved).toContainText('Bid ladder preview')
	await expect(reserved).toContainText('1,000 sats')
	await expect(reserved).toContainText('+50')
	await expect(reserved).toContainText('2,500 sats')
	await expect(reserved).toContainText('Reserve')
	// 30 increments to the reserve, capped at the 24-tick ladder.
	await expect(reserved.locator('[class*="w-px"]')).toHaveCount(24)
	await expect(reserved).toContainText('30 bids of 50 sats needed to clear the reserve.')

	const plain = page.getByTestId('widget-BidLadderPreviewNoReserve')
	await expect(plain).toContainText('No reserve')
	await expect(plain).toContainText('Highest bid wins')
	await expect(plain.locator('[class*="w-px"]')).toHaveCount(0)
})

test('renders the timeline preview with the anti-snipe ramp and the flat fallback', async ({ page }) => {
	await page.goto('/?library=auction')

	const ramped = page.getByTestId('widget-AuctionTimelinePreview')
	await expect(ramped).toContainText('Bidding timeline')
	await expect(ramped).toContainText('ramp begins')
	await expect(ramped).toContainText('locktime')
	await expect(ramped).toContainText('Preview top bid')
	await expect(ramped).toContainText('(from reserve)')
	await expect(ramped).toContainText('(2×, linear)')
	await expect(ramped).toContainText("segments aren't to scale")
	await expect(ramped.locator('svg')).toHaveCount(1)
	await expect(ramped.locator('svg path')).toHaveCount(1)

	const flat = page.getByTestId('widget-AuctionTimelinePreviewFlat')
	await expect(flat).toContainText('(no reserve, using starting bid)')
	await expect(flat).toContainText('(no curve)')
	await expect(flat).not.toContainText('ramp begins')
	await expect(flat.locator('svg path')).toHaveCount(0)
})

test('prompts for an end time instead of charting the timeline', async ({ page }) => {
	await page.goto('/?library=auction')

	const waiting = page.getByTestId('widget-AuctionTimelinePreviewWaiting')
	await expect(waiting).toContainText('Pick an end time to preview the bidding timeline.')
	await expect(waiting.locator('svg')).toHaveCount(0)
	await expect(waiting).not.toContainText('Bidding timeline')
})

test('renders the anti-snipe policy card and gates the curve on a window', async ({ page }) => {
	await page.goto('/?library=auction')

	const off = page.getByTestId('widget-AntiSnipeCurveSettingsOff')
	await expect(off).toContainText('Anti-snipe')
	await expect(off.getByRole('switch')).toHaveAttribute('data-state', 'unchecked')
	await expect(off).toContainText('Pick a window above to enable the curve.')
	// Both the shape buttons (3) and the multiplier buttons (3) are gated on a window.
	await expect(off.locator('button:disabled')).toHaveCount(6)

	// The interactive demo proves the `onFormPatch` wiring: switching on enables
	// every control and the peak footnote, then the window/shape chips move.
	const live = page.getByTestId('widget-AntiSnipeCurveSettingsInteractive')
	await expect(live.locator('button:disabled')).toHaveCount(6)
	await live.getByRole('switch').click()
	await expect(live.getByRole('switch')).toHaveAttribute('data-state', 'checked')
	await expect(live.locator('button:disabled')).toHaveCount(0)
	await expect(live).toContainText('Floor at auction end will be 2× the floor when the anti-snipe ramp begins.')

	await live.getByRole('button', { name: '15 min' }).click()
	await expect(live.getByRole('button', { name: '15 min' })).toHaveClass(/border-success/)
	await live.getByRole('button', { name: 'Exponential' }).click()
	await expect(live.getByRole('button', { name: 'Exponential' })).toHaveClass(/border-success/)
	await expect(live.getByRole('button', { name: 'Linear' })).not.toHaveClass(/border-success/)
})

test('renders the settlement-grace picker and moves the active choice', async ({ page }) => {
	await page.goto('/?library=auction')

	const card = page.getByTestId('widget-SettlementGraceSettings')
	await expect(card).toContainText('Settlement grace')
	await expect(card.getByRole('button')).toHaveCount(3)
	await expect(card.getByRole('button', { name: '1 hour' })).toHaveClass(/border-success/)

	// The interactive demo proves the `onValueChange` wiring: the active chip moves.
	const live = page.getByTestId('widget-SettlementGraceSettingsInteractive')
	await expect(live.getByRole('button', { name: '1 hour' })).toHaveClass(/border-success/)
	await live.getByRole('button', { name: '3 hours' }).click()
	await expect(live.getByRole('button', { name: '3 hours' })).toHaveClass(/border-success/)
	await expect(live.getByRole('button', { name: '1 hour' })).not.toHaveClass(/border-success/)
})
