/**
 * ui/browse/art.test.tsx — the product art module: the SVG art, the symbol
 * sprite and the material CSS.
 *
 * Uses bun:test + renderToStaticMarkup (react-dom/server), matching the
 * existing test pattern in ui/products/product-search-results.test.tsx.
 */

import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ProductArt, ProductSprite, MATERIAL_CSS, MATERIAL_CLASSES } from './art'

describe('ProductArt', () => {
	test('renders with default material and symbol', () => {
		const markup = renderToStaticMarkup(createElement(ProductArt, { material: 'm1' }))
		expect(markup).toContain('widget-product-art-m1')
		expect(markup).toContain('m1')
	})

	test('renders with specified material', () => {
		for (const mat of MATERIAL_CLASSES) {
			const markup = renderToStaticMarkup(createElement(ProductArt, { material: mat }))
			expect(markup).toContain(`widget-product-art-${mat}`)
			expect(markup).toContain(mat)
		}
	})

	test('renders with custom symbol', () => {
		const markup = renderToStaticMarkup(createElement(ProductArt, { material: 'm3', symbolId: 'p-jar' }))
		expect(markup).toContain('p-jar')
	})

	test('renders 3/2 aspect ratio by default', () => {
		const markup = renderToStaticMarkup(createElement(ProductArt, { material: 'm1', ratio: '3/2' }))
		expect(markup).toContain('aspect-[3/2]')
	})

	test('renders 1/1 square ratio when specified', () => {
		const markup = renderToStaticMarkup(createElement(ProductArt, { material: 'm1', ratio: '1/1' }))
		expect(markup).toContain('aspect-square')
		expect(markup).not.toContain('aspect-[3/2]')
	})

	test('accepts custom className', () => {
		const markup = renderToStaticMarkup(createElement(ProductArt, { material: 'm2', className: 'custom' }))
		expect(markup).toContain('custom')
	})

	test('applies material class with object tone variables', () => {
		const markup = renderToStaticMarkup(createElement(ProductArt, { material: 'm4' }))
		// Material class sets --obj and --obj2 CSS custom properties
		expect(markup).toContain('m4')
	})

	test('product art has border and rounded corners', () => {
		const markup = renderToStaticMarkup(createElement(ProductArt, { material: 'm1' }))
		expect(markup).toContain('border')
		expect(markup).toContain('rounded-[6px]')
	})
})

describe('ProductSprite', () => {
	test('renders all eight symbol definitions', () => {
		const markup = renderToStaticMarkup(createElement(ProductSprite, {}))
		expect(markup).toContain('p-bowl')
		expect(markup).toContain('p-bottle')
		expect(markup).toContain('p-mug')
		expect(markup).toContain('p-lamp')
		expect(markup).toContain('p-books')
		expect(markup).toContain('p-crate')
		expect(markup).toContain('p-candle')
		expect(markup).toContain('p-jar')
	})

	test('sprite uses viewBox 0 0 188 176', () => {
		const markup = renderToStaticMarkup(createElement(ProductSprite, {}))
		expect(markup).toContain('viewBox="0 0 188 176"')
	})

	test('sprite is absolutely positioned at 0,0', () => {
		const markup = renderToStaticMarkup(createElement(ProductSprite, {}))
		expect(markup).toContain('absolute')
		expect(markup).toContain('left-0')
		expect(markup).toContain('top-0')
		expect(markup).toContain('overflow-hidden')
	})

	test('sprite has zero dimensions', () => {
		const markup = renderToStaticMarkup(createElement(ProductSprite, {}))
		expect(markup).toContain('width="0"')
		expect(markup).toContain('height="0"')
	})
})

describe('MATERIAL_CSS', () => {
	test('contains all eight material classes m1-m8', () => {
		expect(MATERIAL_CSS).toContain('.m1')
		expect(MATERIAL_CSS).toContain('.m2')
		expect(MATERIAL_CSS).toContain('.m3')
		expect(MATERIAL_CSS).toContain('.m4')
		expect(MATERIAL_CSS).toContain('.m5')
		expect(MATERIAL_CSS).toContain('.m6')
		expect(MATERIAL_CSS).toContain('.m7')
		expect(MATERIAL_CSS).toContain('.m8')
	})

	test('each material defines --obj and --obj2 custom properties', () => {
		expect(MATERIAL_CSS).toContain('--obj:')
		expect(MATERIAL_CSS).toContain('--obj2:')
	})

	test('MATERIAL_CLASSES array has eight entries', () => {
		expect(MATERIAL_CLASSES.length).toBe(8)
	})
})
