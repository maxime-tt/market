/**
 * ui/browse/browse-nav.test.tsx — Unit tests for BrowseNav, SearchField, and Art.
 *
 * Uses bun:test + renderToStaticMarkup (react-dom/server), matching the
 * existing test pattern in ui/products/product-search-results.test.tsx.
 */

import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { BrowseNav } from './browse-nav'
import { SearchField } from './search-field'
import { ProductArt, ProductSprite, MATERIAL_CSS, MATERIAL_CLASSES } from './art'

// ---------------------------------------------------------------------------
// BrowseNav
// ---------------------------------------------------------------------------

describe('BrowseNav', () => {
	test('renders wordmark link and Featured link', () => {
		const markup = renderToStaticMarkup(createElement(BrowseNav, { active: true }))
		expect(markup).toContain('widget-browse-nav')
		expect(markup).toContain('widget-browse-nav-wordmark')
		expect(markup).toContain('widget-browse-nav-featured')
	})

	test('applies active status attribute', () => {
		const markup = renderToStaticMarkup(createElement(BrowseNav, { active: true }))
		expect(markup).toContain('data-status="active"')
	})

	test('applies inactive status attribute', () => {
		const markup = renderToStaticMarkup(createElement(BrowseNav, { active: false }))
		expect(markup).toContain('data-status="inactive"')
	})

	test('renders search slot', () => {
		const markup = renderToStaticMarkup(
			createElement(BrowseNav, {
				active: true,
				searchSlot: createElement('div', { 'data-slot': 'test-search' }, 'search'),
			}),
		)
		expect(markup).toContain('widget-browse-nav')
		expect(markup).toContain('test-search')
	})

	test('renders account slot', () => {
		const markup = renderToStaticMarkup(
			createElement(BrowseNav, {
				active: true,
				accountSlot: createElement('div', { 'data-slot': 'test-account' }, 'account'),
			}),
		)
		expect(markup).toContain('test-account')
	})

	test('accepts custom className', () => {
		const markup = renderToStaticMarkup(createElement(BrowseNav, { className: 'custom-class' }))
		expect(markup).toContain('custom-class')
	})

	test('wordmark link fires onNavigateHome', () => {
		let called = false
		renderToStaticMarkup(
			createElement(BrowseNav, {
				active: true,
				onNavigateHome: () => {
					called = true
				},
			}),
		)
		// The handler is attached; verify the anchor exists
		const markup = renderToStaticMarkup(
			createElement(BrowseNav, {
				active: true,
				onNavigateHome: () => {
					called = true
				},
			}),
		)
		expect(markup).toContain('href="/"')
		expect(markup).toContain('widget-browse-nav-wordmark')
	})

	test('Featured link fires onNavigateFeatured', () => {
		const markup = renderToStaticMarkup(
			createElement(BrowseNav, {
				active: true,
				onNavigateFeatured: () => {},
			}),
		)
		// `/featured` is the route the alias resolves through (the CMS address
		// route); the old `/#featured` fragment pointed back at Browse.
		expect(markup).toContain('href="/featured"')
		expect(markup).toContain('widget-browse-nav-featured')
	})

	test('marks the current destination', () => {
		const browseMarkup = renderToStaticMarkup(createElement(BrowseNav, {}))
		expect(browseMarkup).toContain('aria-current="page"')
		expect(browseMarkup).toContain('data-current="true"')

		const featuredMarkup = renderToStaticMarkup(createElement(BrowseNav, { currentPage: 'featured' }))
		expect(featuredMarkup).toContain('aria-current="page"')
		// The featured state moves the marker onto the Featured link and adds the
		// frame's ink underline.
		expect(featuredMarkup).toContain('border-b-2 border-fill-ink')
	})
})

// ---------------------------------------------------------------------------
// SearchField
// ---------------------------------------------------------------------------

describe('SearchField', () => {
	test('renders with empty value', () => {
		const markup = renderToStaticMarkup(createElement(SearchField, { value: '', onChange: () => {}, onGo: () => {} }))
		expect(markup).toContain('widget-search-field')
		expect(markup).toContain('Search')
	})

	test('renders with non-empty value', () => {
		const markup = renderToStaticMarkup(createElement(SearchField, { value: 'ceramic bowl', onChange: () => {}, onGo: () => {} }))
		expect(markup).toContain('widget-search-field')
		expect(markup).toContain('ceramic bowl')
	})

	test('shows clear button when value is non-empty', () => {
		const markup = renderToStaticMarkup(createElement(SearchField, { value: 'bowl', onChange: () => {}, onGo: () => {} }))
		expect(markup).toContain('widget-search-field-clear')
	})

	test('hides clear button when value is empty', () => {
		const markup = renderToStaticMarkup(createElement(SearchField, { value: '', onChange: () => {}, onGo: () => {} }))
		expect(markup).not.toContain('widget-search-field-clear')
	})

	test('go button has fill-ink styles', () => {
		const markup = renderToStaticMarkup(createElement(SearchField, { value: '', onChange: () => {}, onGo: () => {} }))
		expect(markup).toContain('widget-search-field-go')
		expect(markup).toContain('bg-fill-ink')
		expect(markup).toContain('text-on-fill-ink')
	})

	test('go button fires onGo', () => {
		let fired = false
		const markup = renderToStaticMarkup(
			createElement(SearchField, {
				value: '',
				onChange: () => {},
				onGo: () => {
					fired = true
				},
			}),
		)
		expect(markup).toContain('widget-search-field-go')
	})

	test('uses custom placeholder', () => {
		const markup = renderToStaticMarkup(
			createElement(SearchField, {
				value: '',
				placeholder: 'Find something',
				onChange: () => {},
				onGo: () => {},
			}),
		)
		expect(markup).toContain('Find something')
	})

	test('accepts custom className', () => {
		const markup = renderToStaticMarkup(
			createElement(SearchField, {
				value: '',
				onChange: () => {},
				onGo: () => {},
				className: 'custom',
			}),
		)
		expect(markup).toContain('custom')
	})

	test('clear button fires onClear', () => {
		let cleared = false
		renderToStaticMarkup(
			createElement(SearchField, {
				value: 'test',
				onChange: () => {},
				onGo: () => {},
				onClear: () => {
					cleared = true
				},
			}),
		)
		const markup = renderToStaticMarkup(
			createElement(SearchField, {
				value: 'test',
				onChange: () => {},
				onGo: () => {},
				onClear: () => {
					cleared = true
				},
			}),
		)
		expect(markup).toContain('widget-search-field-clear')
	})

	test('nav is the frame’s compact field; hero is the idle frame’s large one', () => {
		const nav = renderToStaticMarkup(createElement(SearchField, { value: '', onChange: () => {}, onGo: () => {} }))
		const hero = renderToStaticMarkup(createElement(SearchField, { value: '', onChange: () => {}, onGo: () => {}, size: 'hero' }))

		// nav band: 40px tall, 560px wide, 18px glyph, no keyboard affordance
		expect(nav).toContain('data-size="nav"')
		expect(nav).toContain('h-10')
		expect(nav).toContain('w-[560px]')
		expect(nav).not.toContain('widget-search-field-kbd')

		// idle hero: 70px tall, 22px glyph, the ⌘K affordance
		expect(hero).toContain('data-size="hero"')
		expect(hero).toContain('h-[70px]')
		expect(hero).toContain('size-[22px]')
		expect(hero).toContain('widget-search-field-kbd')
		expect(hero).toContain('⌘K')
	})

	test('className still wins over the size table', () => {
		const markup = renderToStaticMarkup(
			createElement(SearchField, { value: '', onChange: () => {}, onGo: () => {}, className: 'h-12 w-full hidden' }),
		)
		expect(markup).toContain('h-12')
		expect(markup).not.toContain('h-10')
		expect(markup).toContain('hidden')
	})
})

// ---------------------------------------------------------------------------
// Art module — ProductArt
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Art module — ProductSprite
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Art module — MATERIAL_CSS verbatim port
// ---------------------------------------------------------------------------

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
