/**
 * ui/browse/product-detail-panel.test.tsx — Unit tests for the split-view
 * detail pane: the frame's content and every read state.
 *
 * Uses bun:test + renderToStaticMarkup (react-dom/server), matching the
 * existing pattern in ui/browse/product-card.test.tsx.
 */

import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ProductDetailPanel, type ProductDetailPanelProduct } from './product-detail-panel'
import type { MaterialClass } from './art'

function makeProduct(opts: Partial<ProductDetailPanelProduct> = {}): ProductDetailPanelProduct {
	return {
		id: 'handcrafted-ceramic-ball',
		title: 'Handcrafted Ceramic Ball',
		seller: 'abcdef01',
		sellerNpub: 'npub1q…7f3k',
		location: 'Porto',
		price: 21000,
		stockNote: '76 in stock',
		description: 'Wood-fired stoneware, thrown and glazed by hand.',
		material: 'm1' as MaterialClass,
		...opts,
	}
}

describe('ProductDetailPanel', () => {
	test('renders the frame content of the open panel', () => {
		const markup = renderToStaticMarkup(
			createElement(ProductDetailPanel, {
				state: 'ready',
				product: makeProduct(),
				onThreeDots: () => {},
				onHeart: () => {},
				onBuy: () => {},
				onAddToList: () => {},
			}),
		)
		expect(markup).toContain('data-testid="widget-product-detail-panel"')
		expect(markup).toContain('data-state="ready"')
		// art
		expect(markup).toContain('data-slot="product-detail-art"')
		// seller line — initials avatar, seller, elided npub · location
		expect(markup).toContain('data-slot="seller-avatar"')
		expect(markup).toContain('AB')
		expect(markup).toContain('abcdef01')
		expect(markup).toContain('npub1q…7f3k · Porto')
		// title + the action row beside it
		expect(markup).toContain('Handcrafted Ceramic Ball')
		expect(markup).toContain('data-slot="product-detail-title"')
		expect(markup).toContain('data-slot="tools"')
		expect(markup).toContain('data-slot="tool-heart"')
		expect(markup).toContain('data-slot="tool-three-dots"')
		// price in sats + stock state
		expect(markup).toContain('21,000')
		expect(markup).toContain('sats')
		expect(markup).toContain('76 in stock')
		// description + spec row
		expect(markup).toContain('Wood-fired stoneware, thrown and glazed by hand.')
		expect(markup).toContain('Ships from')
		expect(markup).toContain('Listing')
		expect(markup).toContain('NIP-99 · kind 30402')
		// action row
		expect(markup).toContain('Buy with Lightning')
		expect(markup).toContain('Add to list')
	})

	test('the tools sit beside the title (action row placement)', () => {
		const markup = renderToStaticMarkup(
			createElement(ProductDetailPanel, { state: 'ready', product: makeProduct(), onThreeDots: () => {} }),
		)
		const titleRow = markup.indexOf('data-slot="product-detail-titlerow"')
		const title = markup.indexOf('data-slot="product-detail-title"')
		const tools = markup.indexOf('data-slot="tools"')
		expect(titleRow).toBeGreaterThan(-1)
		expect(title).toBeGreaterThan(titleRow)
		expect(tools).toBeGreaterThan(title)
		// the tools are inside the title row, before the price row
		expect(tools).toBeLessThan(markup.indexOf('data-slot="product-detail-price"'))
	})

	test('renders shipping costs when the listing carries shipping options', () => {
		const markup = renderToStaticMarkup(
			createElement(ProductDetailPanel, {
				state: 'ready',
				product: makeProduct({ shipping: [{ costSats: 2400 }] }),
			}),
		)
		expect(markup).toContain('data-slot="spec-shipping"')
		expect(markup).toContain('2,400 sats')
	})

	test('omits the ships-from and shipping rows when the listing has neither', () => {
		const markup = renderToStaticMarkup(
			createElement(ProductDetailPanel, {
				state: 'ready',
				product: makeProduct({ location: undefined, shipping: undefined }),
			}),
		)
		expect(markup).not.toContain('data-slot="spec-ships-from"')
		expect(markup).not.toContain('data-slot="spec-shipping"')
		// the listing row is protocol fact and always renders
		expect(markup).toContain('data-slot="spec-listing"')
	})

	test('renders an unknown price as an em dash, not as zero sats', () => {
		const markup = renderToStaticMarkup(createElement(ProductDetailPanel, { state: 'ready', product: makeProduct({ price: undefined }) }))
		expect(markup).toContain('—')
		expect(markup).not.toContain('0 sats')
	})

	test('renders no action or tool without a callback (nothing inert)', () => {
		const markup = renderToStaticMarkup(createElement(ProductDetailPanel, { state: 'ready', product: makeProduct() }))
		expect(markup).not.toContain('data-slot="tools"')
		expect(markup).not.toContain('data-slot="product-detail-actions"')
		expect(markup).not.toContain('Buy with Lightning')
	})

	test('renders the context menu open with the shared menu items', () => {
		const markup = renderToStaticMarkup(
			createElement(ProductDetailPanel, {
				state: 'ready',
				product: makeProduct({ inList: true }),
				menuOpen: true,
				onThreeDots: () => {},
				onHeart: () => {},
				onAddToList: () => {},
				onCopyLink: () => {},
			}),
		)
		expect(markup).toContain('data-testid="widget-product-context-menu"')
		expect(markup).toContain('Add to list')
		expect(markup).toContain('Copy link')
		// heart reflects list membership
		expect(markup).toContain('aria-pressed="true"')
		expect(markup).toContain('aria-label="In a list"')
	})

	test('renders the loading state', () => {
		const markup = renderToStaticMarkup(createElement(ProductDetailPanel, { state: 'loading' }))
		expect(markup).toContain('data-state="loading"')
		expect(markup).toContain('data-slot="product-detail-loading"')
		expect(markup).toContain('aria-busy="true"')
		expect(markup).not.toContain('data-slot="product-detail-title"')
	})

	test('renders the empty state — the coordinate resolved to no listing', () => {
		const markup = renderToStaticMarkup(createElement(ProductDetailPanel, { state: 'empty' }))
		expect(markup).toContain('data-state="empty"')
		expect(markup).toContain('This listing is not on the relays')
	})

	test('renders the error state with a retry', () => {
		const markup = renderToStaticMarkup(createElement(ProductDetailPanel, { state: 'error', onRetry: () => {} }))
		expect(markup).toContain('data-state="error"')
		expect(markup).toContain('The listing could not be loaded')
		expect(markup).toContain('data-testid="widget-product-detail-retry"')
	})

	test('renders nothing but the pane shell in the ready state without a product', () => {
		const markup = renderToStaticMarkup(createElement(ProductDetailPanel, { state: 'ready' }))
		expect(markup).toContain('data-state="ready"')
		expect(markup).not.toContain('data-slot="product-detail-title"')
	})

	test('applies extra classes to the pane root', () => {
		const markup = renderToStaticMarkup(
			createElement(ProductDetailPanel, { state: 'ready', product: makeProduct(), className: 'custom-pane-class' }),
		)
		expect(markup).toContain('custom-pane-class')
	})
})
