/**
 * ui/browse/product-strip.test.tsx — Unit tests for ProductStrip and StripItem.
 *
 * Uses bun:test + renderToStaticMarkup (react-dom/server), matching the
 * existing test pattern in ui/products/product-search-results.test.tsx.
 */

import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ProductStrip, type StripItem } from './product-strip'

const STRIP_ITEM: StripItem = {
	id: 'strip-1',
	title: 'Handcrafted Ceramic Ball',
	seller: 'atelier-norte',
	material: 'm1',
}

function makeStrip(opts: Partial<Parameters<typeof ProductStrip>[0]> = {}) {
	return {
		items: [STRIP_ITEM],
		...opts,
	}
}

describe('ProductStrip', () => {
	test('renders strip with data-testid', () => {
		const markup = renderToStaticMarkup(createElement(ProductStrip, makeStrip()))
		expect(markup).toContain('widget-product-strip')
		expect(markup).toContain('widget-strip-item-strip-1')
	})

	test('renders all items', () => {
		const items: StripItem[] = [
			{ id: 'a', title: 'A', seller: 's1', material: 'm1' },
			{ id: 'b', title: 'B', seller: 's2', material: 'm3' },
			{ id: 'c', title: 'C', seller: 's3', material: 'm5' },
		]
		const markup = renderToStaticMarkup(createElement(ProductStrip, { items }))
		expect(markup).toContain('widget-strip-item-a')
		expect(markup).toContain('widget-strip-item-b')
		expect(markup).toContain('widget-strip-item-c')
	})

	test('renders title and seller text', () => {
		const markup = renderToStaticMarkup(createElement(ProductStrip, makeStrip()))
		expect(markup).toContain('Handcrafted Ceramic Ball')
		expect(markup).toContain('atelier-norte')
	})

	test('renders with custom className', () => {
		const markup = renderToStaticMarkup(createElement(ProductStrip, makeStrip({ className: 'custom-strip-class' })))
		expect(markup).toContain('custom-strip-class')
	})

	test('renders with symbolId', () => {
		const item: StripItem = {
			id: 'sym-1',
			title: 'Test',
			seller: 'test',
			material: 'm2',
			symbolId: 'p-bowl',
		}
		const markup = renderToStaticMarkup(createElement(ProductStrip, { items: [item] }))
		expect(markup).toContain('widget-strip-item-sym-1')
	})

	test('single item renders correctly', () => {
		const markup = renderToStaticMarkup(createElement(ProductStrip, { items: [STRIP_ITEM], onSelect: () => {} }))
		expect(markup).toContain('widget-product-strip')
		expect(markup).not.toContain('widget-strip-item-strip-2')
	})

	test('empty items renders empty strip', () => {
		const markup = renderToStaticMarkup(createElement(ProductStrip, { items: [] }))
		expect(markup).toContain('widget-product-strip')
		expect(markup).not.toContain('widget-strip-item')
	})
})
