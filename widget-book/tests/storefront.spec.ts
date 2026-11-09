import { expect, test } from '@playwright/test'

/**
 * Storefront blocks and renderer (CMS theme-studio port). Each entry renders a
 * deterministic literal-prop state; the data-bound block types render through
 * the `StorefrontDataSlots` seam with literal data.
 */

test('renders the storefront library', async ({ page }) => {
	await page.goto('/?library=storefront')

	await expect(page.getByTestId('widget-book-selection')).toHaveText('storefront')
	await expect(page.getByTestId('library-storefront')).toBeVisible()

	for (const widget of [
		'StorefrontRenderer',
		'StorefrontRendererWithSlots',
		'StorefrontLink',
		'MiniMarkdown',
		'MiniMarkdownEmpty',
		'HeroBlock',
		'HeroBlockNoImage',
		'HeroBlockEmpty',
		'TextBlock',
		'TextBlockEmpty',
		'ImageBlock',
		'ImageBlockInvalid',
		'LinkListBlock',
		'LinkListBlockColumn',
		'LinkListBlockEmpty',
		'SpacerDividerBlocks',
		'ProductGridBlockFilled',
		'ProductGridBlockLoading',
		'ProductGridBlockError',
		'ProductGridBlockEmpty',
		'FeaturedProductBlockFilled',
		'FeaturedProductBlockLoading',
		'FeaturedProductBlockMissing',
		'ProfileHeaderBlock',
		'ProfileHeaderBlockBanner',
		'ProfileHeaderBlockLoading',
		'StorefrontBlockViewCanvas',
		'ThemeSwatchGrid',
		'ThemePaletteStrip',
		'ThemeTunePanel',
		'ThemeStudio',
	]) {
		await expect(page.getByTestId(`widget-${widget}`)).toBeVisible()
	}
})

test('the full-page renderer marks the live page and applies the theme', async ({ page }) => {
	await page.goto('/?library=storefront')

	const rendered = page.getByTestId('widget-StorefrontRenderer')
	await expect(rendered.getByTestId('storefront-page')).toBeVisible()
	await expect(rendered.locator('[data-storefront-theme="default"]')).toHaveCount(1)
	await expect(rendered.locator('a[href="https://example.com/shop"]')).toBeVisible()
})

test('the slotted renderer renders the three data-bound block types', async ({ page }) => {
	await page.goto('/?library=storefront')

	const rendered = page.getByTestId('widget-StorefrontRendererWithSlots')

	const header = rendered.getByTestId('storefront-profile-header')
	await expect(header).toContainText('Satoshi Nakamoto')
	await expect(header.getByTestId('storefront-nip05-badge')).toContainText('satoshi@nakamoto.org')

	const grid = rendered.getByTestId('storefront-product-grid')
	await expect(grid).toContainText('Antminer S21')
	await expect(grid).toContainText('Stoneware Plate')

	await expect(rendered.getByTestId('storefront-featured-product')).toContainText('Antminer S21')
})

test('mini markdown renders links but never an unsafe one', async ({ page }) => {
	await page.goto('/?library=storefront')

	const markdown = page.getByTestId('widget-MiniMarkdown')
	await expect(markdown.getByRole('heading', { name: 'Title' })).toBeVisible()
	await expect(markdown.locator('a[href="https://example.com"]')).toBeVisible()
	await expect(page.getByTestId('widget-MiniMarkdownEmpty')).toContainText('Empty source renders nothing')
})

test('the hero renders its CTA and the empty states show editor hints', async ({ page }) => {
	await page.goto('/?library=storefront')

	await expect(page.getByTestId('widget-HeroBlock').getByRole('link', { name: 'Shop the kiln' })).toBeVisible()
	await expect(page.getByTestId('widget-HeroBlockEmpty')).toContainText('Give this hero a title')
	await expect(page.getByTestId('widget-TextBlockEmpty')).toContainText('Write something')
	await expect(page.getByTestId('widget-ImageBlockInvalid')).toContainText('Add an image URL')
	await expect(page.getByTestId('widget-LinkListBlockEmpty')).toContainText('Add links')
	await expect(page.getByTestId('widget-FeaturedProductBlockMissing')).toContainText('No published product matches')
})

test('the product grid view covers loading, error and empty', async ({ page }) => {
	await page.goto('/?library=storefront')

	await expect(page.getByTestId('widget-ProductGridBlockLoading')).toContainText('Loading products…')
	await expect(page.getByTestId('widget-ProductGridBlockError')).toContainText('Products could not be loaded right now')
	await expect(page.getByTestId('widget-ProductGridBlockEmpty')).toContainText('Nothing listed here yet.')

	const filled = page.getByTestId('widget-ProductGridBlockFilled')
	await expect(filled.getByTestId('storefront-product-grid')).toBeVisible()
	await expect(filled).toContainText('Antminer S21')
})

test('the profile header view covers loading and filled with a verified badge', async ({ page }) => {
	await page.goto('/?library=storefront')

	await expect(page.getByTestId('widget-ProfileHeaderBlockLoading')).toContainText('Loading…')

	const filled = page.getByTestId('widget-ProfileHeaderBlock').getByTestId('storefront-profile-header')
	await expect(filled).toContainText('Satoshi Nakamoto')
	await expect(filled).toContainText('Building bitcoin things from a small studio.')
	await expect(filled.getByTestId('storefront-nip05-badge')).toContainText('satoshi@nakamoto.org')

	// The banner variant elides `_@nakamoto.org` to the domain.
	await expect(page.getByTestId('widget-ProfileHeaderBlockBanner').getByTestId('storefront-nip05-badge')).toContainText('nakamoto.org')
})
