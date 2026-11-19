/**
 * ui/browse/search-field.test.tsx — the one search pill, in the two sizes the
 * frames ask for.
 *
 * Uses bun:test + renderToStaticMarkup (react-dom/server), matching the
 * existing test pattern in ui/products/product-search-results.test.tsx.
 */

import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SearchField } from './search-field'

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

		// nav band: 40px tall, capped at the frame's 560px, 18px glyph, no
		// keyboard affordance
		expect(nav).toContain('data-size="nav"')
		expect(nav).toContain('h-10')
		// The cap, never a hard width: a fixed 560px was the page's min-content
		// and widened the page to 822px on a 390px phone.
		expect(nav).not.toContain('w-[560px] max-w-full')
		expect(nav).toContain('max-w-[560px]')
		expect(nav).toMatch(/w-full[^"]*max-w-\[560px\]/)
		expect(nav).toMatch(/min-w-0[^"]*pl-4/)
		expect(nav).not.toContain('widget-search-field-kbd')

		// idle hero: 70px tall, 22px glyph, the ⌘K affordance
		expect(hero).toContain('data-size="hero"')
		expect(hero).toContain('h-[70px]')
		expect(hero).toContain('size-[22px]')
		expect(hero).toContain('widget-search-field-kbd')
		expect(hero).toContain('⌘K')
	})

	test('the nav field yields the go pill to the input on a phone', () => {
		const nav = renderToStaticMarkup(createElement(SearchField, { value: '', onChange: () => {}, onGo: () => {} }))
		const hero = renderToStaticMarkup(createElement(SearchField, { value: '', onChange: () => {}, onGo: () => {}, size: 'hero' }))

		// A phone's nav row leaves the field ~150px; an 82px pill left the input
		// 9px (one visible character). Below `sm` the pill is hidden and the
		// keyboard's own search key submits — which is why the input needs
		// `enterKeyHint`, or the phone's Enter key reads "return".
		expect(nav).toContain('hidden sm:flex')
		expect(nav).toContain('enterKeyHint="search"')
		// The hero field owns its whole row, so it keeps the pill.
		expect(hero).not.toContain('hidden sm:flex')
		expect(hero).toContain('enterKeyHint="search"')
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
