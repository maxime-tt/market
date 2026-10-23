import { expect, test } from '@playwright/test'

/**
 * Products and collections views. Each entry renders a deterministic
 * literal-prop state, so the spec asserts copy, stock tones, and interaction
 * without any host plumbing.
 */

test('renders the products library', async ({ page }) => {
	await page.goto('/?library=products')

	await expect(page.getByTestId('widget-book-selection')).toHaveText('products')
	await expect(page.getByTestId('library-products')).toBeVisible()

	for (const widget of [
		'ProductCardView',
		'ProductCardViewInCart',
		'ProductDisplayView',
		'ProductDisplayViewLoading',
		'ProductFilters',
		'ProductSearchResults',
		'ProductSearchResultsEmpty',
		'ProductSelectionList',
		'ProductSelectionListEmpty',
		'CollectionCardView',
		'CollectionDisplayView',
		'CollectionWelcomeScreen',
		'ProductCategoryView',
		'ProductImagesView',
		'ProductPricingView',
		'ProductShippingView',
		'ProductShippingViewTemplates',
		'ProductSpecsView',
		'AdultContentGate',
		'ProductLoadErrorState',
		'ProductLoadingState',
		'ProductNotFoundState',
		'ProductPurchasePanel',
		'ProductPurchasePanelPreorder',
	]) {
		await expect(page.getByTestId(`widget-${widget}`)).toBeVisible()
	}
})

test('renders the product card with stock and cart affordances', async ({ page }) => {
	await page.goto('/?library=products')

	const card = page.getByTestId('widget-ProductCardView')
	await expect(card).toContainText('Antminer S21')
	await expect(card).toContainText('2100 SATS')
	await expect(card).toContainText('12 in stock')
	await expect(card.getByRole('button', { name: 'Add to Cart' })).toBeVisible()
	await expect(card.locator('img[alt="Antminer S21"]')).toBeVisible()

	const inCart = page.getByTestId('widget-ProductCardViewInCart')
	await expect(inCart).toContainText('2')
	await expect(inCart.getByRole('button', { name: 'Add', exact: true })).toBeVisible()
})

test('renders the display row states including loading', async ({ page }) => {
	await page.goto('/?library=products')

	const row = page.getByTestId('widget-ProductDisplayView')
	await expect(row).toContainText('Antminer S21')
	await expect(row).toContainText('ID: antminer-s21')
	await expect(row.getByRole('button', { name: 'Remove product 1' })).toBeVisible()
	await expect(row.getByRole('button', { name: 'Move product 1 up' })).toBeDisabled()

	const loading = page.getByTestId('widget-ProductDisplayViewLoading')
	await expect(loading).toContainText('Loading...')
	await expect(loading).toContainText('No description available')
})

test('opens the filter popover from the trigger', async ({ page }) => {
	await page.goto('/?library=products')

	await page.getByTestId('widget-ProductFilters').getByRole('button', { name: 'Filter & Sort' }).click()
	await expect(page.getByText('Show out of stock')).toBeVisible()
	await expect(page.getByText('Hide pre-order items')).toBeVisible()
	await expect(page.getByText('Sort by')).toBeVisible()
	await expect(page.getByText('Country')).toBeVisible()
})

test('renders the search results with seller and empty state', async ({ page }) => {
	await page.goto('/?library=products')

	const results = page.getByTestId('widget-ProductSearchResults')
	await expect(results).toContainText('Antminer S21')
	await expect(results).toContainText('by')
	await expect(results).toContainText('satoshi')
	await expect(results).toContainText('Show search results in page')

	const empty = page.getByTestId('widget-ProductSearchResultsEmpty')
	await expect(empty).toContainText('No products found')
})

test('renders the product selection list states', async ({ page }) => {
	await page.goto('/?library=products')

	const list = page.getByTestId('widget-ProductSelectionList')
	await expect(list).toContainText('Antminer S21')
	await expect(list).toContainText('Bitaxe Gamma')
	await expect(list).toContainText('1 product selected')
	await expect(list.locator('input[type="checkbox"]')).toHaveCount(2)
	await expect(list.locator('input[type="checkbox"]').first()).toBeChecked()

	const empty = page.getByTestId('widget-ProductSelectionListEmpty')
	await expect(empty).toContainText('No products found')
	await expect(empty).toContainText('Create some products first to add them to collections')
})

test('links the collection card through a plain anchor', async ({ page }) => {
	await page.goto('/?library=products')

	const card = page.getByTestId('widget-CollectionCardView')
	await expect(card).toContainText('Autumn Drops')
	await expect(card).toContainText('Fresh hardware for the heating season.')
	await expect(card).toContainText('satoshi')
	const links = card.locator('a[href="/collection/autumn-drops"]')
	await expect(links).toHaveCount(2)
	await expect(card.locator('img[alt="Autumn Drops"]')).toBeVisible()

	const row = page.getByTestId('widget-CollectionDisplayView')
	await expect(row).toContainText('Autumn Drops')
	await expect(row).toContainText('ID: autumn-drops')
	await expect(row.getByRole('button', { name: 'Remove collection 1' })).toBeVisible()
})

test('renders the collection welcome screen', async ({ page }) => {
	await page.goto('/?library=products')

	const widget = page.getByTestId('widget-CollectionWelcomeScreen')
	await expect(widget).toContainText('CREATE COLLECTION')
	await expect(widget).toContainText('Organize your products')
	await expect(widget.getByRole('button', { name: 'GET STARTED' })).toBeVisible()
})

test('renders the editor tab views', async ({ page }) => {
	await page.goto('/?library=products')

	const category = page.getByTestId('widget-ProductCategoryView')
	await expect(category).toContainText('Main Category')
	await expect(category).toContainText('Electronics')
	await expect(category.locator('input').first()).toHaveValue('Bitcoin Miners')
	await expect(category.locator('input').nth(1)).toHaveValue('Accessories')
	await expect(category).toContainText('New Sub Category')

	const images = page.getByTestId('widget-ProductImagesView')
	await expect(images.getByTestId('product-images-tab-panel')).toBeVisible()
	await expect(images).toContainText('At least one image required')

	const pricing = page.getByTestId('widget-ProductPricingView')
	await expect(pricing).toContainText('Choose your local currency')
	await expect(pricing).toContainText('Price in SATS')
	await expect(pricing.getByTestId('product-quantity-input')).toHaveValue('100')
	await expect(pricing).toContainText('This product contains adult/sensitive content')

	const specs = page.getByTestId('widget-ProductSpecsView')
	await expect(specs).toContainText('Product Specifications')
	await expect(specs.locator('input').first()).toHaveValue('Material')
	await expect(specs.locator('input').nth(1)).toHaveValue('Aluminium')
	await expect(specs.getByRole('button', { name: 'Add Specification' })).toBeVisible()
})

test('renders shipping options and the quick-create templates', async ({ page }) => {
	await page.goto('/?library=products')

	const shipping = page.getByTestId('widget-ProductShippingView')
	await expect(shipping).toContainText('Worldwide Tracked')
	await expect(shipping).toContainText('20000 SATS')
	await expect(shipping).toContainText('Available Shipping Options')
	await expect(shipping).toContainText('Digital Delivery')
	await expect(shipping.getByRole('button', { name: 'Add', exact: true })).toBeVisible()

	const templates = page.getByTestId('widget-ProductShippingViewTemplates')
	await expect(templates).toContainText('No shipping options available.')
	await expect(templates).toContainText('Digital delivery')
	await expect(templates).toContainText('Worldwide shipping')
	await expect(templates).toContainText('Local pickup')
})

test('renders the page-level states', async ({ page }) => {
	await page.goto('/?library=products')

	const gate = page.getByTestId('widget-AdultContentGate')
	await expect(gate).toContainText('Adult Content')
	await expect(gate.getByRole('link', { name: 'Back to products' })).toBeVisible()
	await expect(gate.getByRole('button', { name: 'Enable adult content' })).toBeVisible()

	const error = page.getByTestId('widget-ProductLoadErrorState')
	await expect(error).toContainText('Still loading product')
	await expect(error.getByRole('button', { name: 'Retry' })).toBeVisible()

	const loading = page.getByTestId('widget-ProductLoadingState')
	await expect(loading).toContainText('Loading product…')

	const notFound = page.getByTestId('widget-ProductNotFoundState')
	await expect(notFound).toContainText('Product Not Found')
})

test('renders the purchase panel states', async ({ page }) => {
	await page.goto('/?library=products')

	const panel = page.getByTestId('widget-ProductPurchasePanel')
	await expect(panel).toContainText('12 in stock')
	await expect(panel).toContainText('Simple / Digital')
	await expect(panel.getByRole('button', { name: 'Add to cart' })).toBeVisible()
	await expect(panel.getByRole('button', { name: 'Edit Product' })).toBeVisible()
	await expect(panel.getByRole('spinbutton', { name: 'Quantity' })).toHaveValue('1')

	const preorder = page.getByTestId('widget-ProductPurchasePanelPreorder')
	await expect(preorder).toContainText('Pre-order')
	await expect(preorder.getByRole('button', { name: 'Add to cart' })).toHaveCount(0)
})
