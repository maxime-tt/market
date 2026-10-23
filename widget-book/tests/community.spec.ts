import { expect, test } from '@playwright/test'

/**
 * Community placeholders. The testids are the same ones the community
 * progressive-loading suite asserts on, so a rename here is a real regression.
 */

test('renders the community library', async ({ page }) => {
	await page.goto('/?library=community')

	await expect(page.getByTestId('widget-book-selection')).toHaveText('community')
	await expect(page.getByTestId('library-community')).toBeVisible()

	for (const widget of [
		'CollectionSkeletons',
		'MerchantSkeletons',
		'CommentButtonView',
		'ShareButtonView',
		'ReactionButtonView',
		'ReactionButtonViewActive',
		'ZapButtonView',
		'ZapButtonViewDisabled',
		'ReactionsListView',
		'ZapsListView',
	]) {
		await expect(page.getByTestId(`widget-${widget}`)).toBeVisible()
	}
})

test('renders the collection and merchant placeholder grids', async ({ page }) => {
	await page.goto('/?library=community')

	const collections = page.getByTestId('widget-CollectionSkeletons')
	await expect(collections.getByTestId('community-collections-skeleton')).toHaveCount(4)
	await expect(collections).not.toContainText('community-merchants-skeleton')

	const merchants = page.getByTestId('widget-MerchantSkeletons')
	await expect(merchants.getByTestId('community-merchants-skeleton')).toHaveCount(3)
})

test('the comment and share buttons show their tooltips on hover', async ({ page }) => {
	await page.goto('/?library=community')

	const comment = page.getByTestId('widget-CommentButtonView').getByTestId('comment-button')
	await expect(comment).toHaveCount(2) // outline and ghost variants
	await comment.first().hover()
	await expect(page.getByRole('tooltip')).toHaveText('Comment')

	// Move to a neutral element so the tooltip unmounts before the next hover.
	await page.getByTestId('widget-book-title').hover()
	await expect(page.getByRole('tooltip')).toHaveCount(0)

	const share = page.getByTestId('widget-ShareButtonView').getByTestId('share-button')
	await share.hover()
	await expect(page.getByRole('tooltip')).toHaveText('Share')
})

test('the reaction button opens the emoji picker on hover', async ({ page }) => {
	await page.goto('/?library=community')

	const idle = page.getByTestId('widget-ReactionButtonView').getByTestId('reaction-button')
	await expect(idle).toBeEnabled()
	await idle.hover()
	// The picker is a Radix popover (role=dialog); scoping keeps the assertion
	// away from the reaction chips in the list below.
	await expect(page.getByRole('dialog').getByRole('button', { name: '😂' })).toBeVisible()
	await expect(page.getByRole('dialog').getByRole('button', { name: '💰' })).toBeVisible()
})

test('a reacted reaction button shows the emoji on the accent fill', async ({ page }) => {
	await page.goto('/?library=community')

	const active = page.getByTestId('widget-ReactionButtonViewActive').getByTestId('reaction-button')
	await expect(active).toContainText('🔥')
	await expect(active).toHaveClass(/bg-fill-accent/)
})

test('the zap button is enabled, and disabled with a reason when the zap address is missing', async ({ page }) => {
	await page.goto('/?library=community')

	const zap = page.getByTestId('widget-ZapButtonView').getByTestId('zap-button')
	await expect(zap).toBeEnabled()

	const disabled = page.getByTestId('widget-ZapButtonViewDisabled').getByTestId('zap-button')
	await expect(disabled).toBeDisabled()
})

test('the zap button shows its tooltip on hover', async ({ page }) => {
	await page.goto('/?library=community')

	const zap = page.getByTestId('widget-ZapButtonView').getByTestId('zap-button')
	await zap.hover()
	await expect(page.getByRole('tooltip')).toHaveText('Zap')
})

test('the reactions list renders chips with own-state styling', async ({ page }) => {
	await page.goto('/?library=community')

	const list = page.getByTestId('widget-ReactionsListView').getByTestId('reactions-list')
	const chips = list.getByRole('button')
	await expect(chips).toHaveCount(3)
	await expect(chips.filter({ hasText: '❤️' })).toHaveClass(/bg-fill-accent/)
	await expect(chips.filter({ hasText: '🔥' })).toHaveClass(/bg-info-muted/)
	await expect(chips.filter({ hasText: '😂' })).toHaveClass(/bg-info-muted/)
})

test('the zaps list renders avatar, amount and truncated message chips', async ({ page }) => {
	await page.goto('/?library=community')

	const list = page.getByTestId('widget-ZapsListView').getByTestId('zaps-list')
	const chips = list.getByRole('button')
	await expect(chips).toHaveCount(3)
	await expect(chips.filter({ hasText: '21' })).toHaveCount(1)
	await expect(chips.filter({ hasText: '100' })).toHaveCount(1)
	await expect(list).toContainText('Great listing, thanks!')
	// The long message is cut at forty characters.
	await expect(list).toContainText('...')
	await expect(list).toContainText('AB')
	await expect(list).toContainText('CD')
})
