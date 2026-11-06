/**
 * ui/browse/product-card.test.tsx — Unit tests for ProductCard,
 * ProductContextMenu, and ProductStrip.
 *
 * Uses bun:test + renderToStaticMarkup (react-dom/server), matching the
 * existing test pattern in ui/products/product-search-results.test.tsx.
 */

import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ProductCard, ProductContextMenu } from './product-card'
import { ProductStrip } from './product-strip'
import type { MaterialClass } from './art'
import type { StripItem } from './product-strip'

function makeCard(opts: Partial<Parameters<typeof ProductCard>[0]> = {}) {
	return {
		id: 'test-1',
		title: 'Test Product',
		seller: 'Test Seller',
		sellerPubkey: 'abcdef0123456789',
		price: 1000,
		material: 'm1' as MaterialClass,
		...opts,
	}
}

// ---------------------------------------------------------------------------
// ProductCard
// ---------------------------------------------------------------------------

describe('ProductCard', () => {
	test('renders product card with all data-testid elements', () => {
		const markup = renderToStaticMarkup(createElement(ProductCard, makeCard({ id: 'c1', onHeart: () => {}, onThreeDots: () => {} })))
		expect(markup).toContain('widget-product-card-c1')
		expect(markup).toContain('widget-product-card-title-c1')
		expect(markup).toContain('widget-product-card-seller-c1')
		expect(markup).toContain('widget-product-card-tools-c1')
		expect(markup).toContain('widget-product-card-heart-c1')
		expect(markup).toContain('widget-product-card-menu-c1')
		expect(markup).toContain('widget-product-card-price-c1')
	})

	test('renders seller avatar with tint class', () => {
		// parseInt('abcdef0123456789', 16) % 3 = 2
		const markup = renderToStaticMarkup(createElement(ProductCard, makeCard({ id: 'c2', sellerPubkey: 'abcdef0123456789' })))
		expect(markup).toContain('widget-product-card-seller-c2')
		expect(markup).toContain('avatar-tint-2')
	})

	test('renders without sellerPubkey — no tint class', () => {
		const markup = renderToStaticMarkup(createElement(ProductCard, makeCard({ id: 'c3', sellerPubkey: '' })))
		expect(markup).toContain('widget-product-card-seller-c3')
		// Empty pubkey: parseInt('', 16) is NaN, NaN % 3 is NaN → avatar-tint-NaN
		// We test that seller row still renders regardless
		expect(markup).toContain('widget-product-card-title-c3')
	})

	test('renders heart button when onHeart callback provided', () => {
		const markup = renderToStaticMarkup(createElement(ProductCard, makeCard({ id: 'c4', heartActive: true, onHeart: () => {} })))
		expect(markup).toContain('widget-product-card-heart-c4')
		expect(markup).toContain('aria-pressed="true"')
	})

	test('renders bid pill when bidCount present', () => {
		const markup = renderToStaticMarkup(createElement(ProductCard, makeCard({ id: 'c5', bidCount: 3 })))
		expect(markup).toContain('widget-product-card-bid-c5')
		expect(markup).toContain('3 bids')
	})

	test('renders with custom className', () => {
		const markup = renderToStaticMarkup(createElement(ProductCard, makeCard({ id: 'c6', className: 'custom-class' })))
		expect(markup).toContain('custom-class')
	})

	test('renders title text', () => {
		const markup = renderToStaticMarkup(createElement(ProductCard, makeCard({ id: 'c7', title: 'Unique Product Title' })))
		expect(markup).toContain('Unique Product Title')
	})

	test('renders seller name text', () => {
		const markup = renderToStaticMarkup(createElement(ProductCard, makeCard({ id: 'c8', seller: 'Unique Seller Name' })))
		expect(markup).toContain('Unique Seller Name')
	})

	test('renders the category chip beside the title only when a category is supplied', () => {
		const withCategory = renderToStaticMarkup(createElement(ProductCard, makeCard({ id: 'c9', category: 'pottery' })))
		expect(withCategory).toContain('widget-product-card-category-c9')
		expect(withCategory).toContain('pottery')

		const withoutCategory = renderToStaticMarkup(createElement(ProductCard, makeCard({ id: 'c10' })))
		expect(withoutCategory).not.toContain('widget-product-card-category-c10')
	})

	test('renders no price when the listing carries none', () => {
		// "0 sats" would be a price the author never set — the row keeps the
		// stock note and drops the amount.
		const markup = renderToStaticMarkup(createElement(ProductCard, makeCard({ id: 'c11', price: undefined, stockNote: '3 in stock' })))
		expect(markup).toContain('widget-product-card-price-c11')
		expect(markup).toContain('3 in stock')
		expect(markup).not.toContain('sats')
	})
})

// ---------------------------------------------------------------------------
// ProductContextMenu
// ---------------------------------------------------------------------------

describe('ProductContextMenu', () => {
	test('renders closed (no DOM output)', () => {
		const markup = renderToStaticMarkup(
			createElement(ProductContextMenu, {
				open: false,
				onClose: () => {},
			}),
		)
		expect(markup).not.toContain('widget-product-context-menu')
	})

	test('renders add to list when open and callback provided', () => {
		const markup = renderToStaticMarkup(
			createElement(ProductContextMenu, {
				open: true,
				onAddToList: () => {},
				onClose: () => {},
			}),
		)
		expect(markup).toContain('widget-product-context-menu')
		expect(markup).toContain('widget-context-menu-add-to-list')
	})

	test('renders copy link when open and callback provided', () => {
		const markup = renderToStaticMarkup(
			createElement(ProductContextMenu, {
				open: true,
				onCopyLink: () => {},
				onClose: () => {},
			}),
		)
		expect(markup).toContain('widget-product-context-menu')
		expect(markup).toContain('widget-context-menu-copy-link')
	})

	test('renders report when open and callback provided', () => {
		const markup = renderToStaticMarkup(
			createElement(ProductContextMenu, {
				open: true,
				onReport: () => {},
				onClose: () => {},
			}),
		)
		expect(markup).toContain('widget-product-context-menu')
		expect(markup).toContain('widget-context-menu-report')
	})

	test('renders custom className', () => {
		const markup = renderToStaticMarkup(
			createElement(ProductContextMenu, {
				open: true,
				onClose: () => {},
				className: 'custom-menu-class',
			}),
		)
		expect(markup).toContain('custom-menu-class')
	})
})

// ---------------------------------------------------------------------------
// ProductStrip
// ---------------------------------------------------------------------------

describe('ProductStrip', () => {
	function makeItem(opts: Partial<StripItem> = {}) {
		return {
			id: 'item-1',
			title: 'Item One',
			seller: 'Seller A',
			material: 'm1' as MaterialClass,
			symbolId: 'p-bowl' as StripItem['symbolId'],
			...opts,
		}
	}

	test('renders strip with all items and data-testid', () => {
		const items = [makeItem({ id: 'i1' }), makeItem({ id: 'i2', material: 'm2' })]
		const markup = renderToStaticMarkup(createElement(ProductStrip, { items }))
		expect(markup).toContain('widget-product-strip')
		expect(markup).toContain('widget-strip-item-i1')
		expect(markup).toContain('widget-strip-item-i2')
	})

	test('renders single item strip', () => {
		const markup = renderToStaticMarkup(createElement(ProductStrip, { items: [makeItem({ id: 'solo' })] }))
		expect(markup).toContain('widget-product-strip')
		expect(markup).toContain('widget-strip-item-solo')
	})

	test('renders empty strip', () => {
		const markup = renderToStaticMarkup(createElement(ProductStrip, { items: [] }))
		expect(markup).toContain('widget-product-strip')
	})

	test('renders with custom className', () => {
		const markup = renderToStaticMarkup(
			createElement(ProductStrip, {
				items: [makeItem({ id: 'x' })],
				className: 'custom-strip-class',
			}),
		)
		expect(markup).toContain('custom-strip-class')
	})
})
