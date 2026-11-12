/**
 * ui/browse/product-strip.test.tsx — Unit tests for ProductStrip and StripItem.
 *
 * Uses bun:test + renderToStaticMarkup (react-dom/server), matching the
 * existing test pattern in ui/products/product-search-results.test.tsx.
 *
 * Two things are pinned here beyond the markup: the tile carries the listing's
 * own image (with the deterministic art as the fallback), and the loop is a
 * real duplicated track — the animation translates by exactly one run's width,
 * so the row has no seam and no end.
 */

import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ProductStrip, stripRunCount, type StripItem } from './product-strip'

const STRIP_ITEM: StripItem = {
	id: 'strip-1',
	title: 'Handcrafted Ceramic Ball',
	seller: 'atelier-norte',
	material: 'm1',
	href: '/?p=strip-1',
}

function makeStrip(opts: Partial<Parameters<typeof ProductStrip>[0]> = {}) {
	return {
		items: [STRIP_ITEM],
		...opts,
	}
}

/** How many times a tile's own test id appears — the loop's duplicated runs. */
function countOccurrences(markup: string, needle: string): number {
	return markup.split(needle).length - 1
}

describe('ProductStrip', () => {
	test('renders strip with data-testid', () => {
		const markup = renderToStaticMarkup(createElement(ProductStrip, makeStrip()))
		expect(markup).toContain('widget-product-strip')
		expect(markup).toContain('widget-strip-item-strip-1')
	})

	test('renders all items', () => {
		const items: StripItem[] = [
			{ id: 'a', title: 'A', seller: 's1', material: 'm1', href: '/?p=a' },
			{ id: 'b', title: 'B', seller: 's2', material: 'm3', href: '/?p=b' },
			{ id: 'c', title: 'C', seller: 's3', material: 'm5', href: '/?p=c' },
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
			href: '/?p=sym-1',
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

describe('ProductStrip — the listing’s own shot', () => {
	test('renders the listing image when it carries one', () => {
		const item: StripItem = { ...STRIP_ITEM, image: 'https://cdn.example/bowl.jpg' }
		const markup = renderToStaticMarkup(createElement(ProductStrip, { items: [item] }))
		expect(markup).toContain('src="https://cdn.example/bowl.jpg"')
		expect(markup).toContain('alt="Handcrafted Ceramic Ball"')
	})

	test('falls back to the deterministic art when the listing has no image', () => {
		const markup = renderToStaticMarkup(createElement(ProductStrip, makeStrip()))
		expect(markup).not.toContain('<img')
		// The art tile is the material class + the sprite symbol, as on the card.
		expect(markup).toContain('widget-product-art-m1')
		expect(markup).toContain('href="#p-')
	})

	test('renders the price in the listing’s own unit, and no price line when it has none', () => {
		const priced: StripItem = { ...STRIP_ITEM, price: 21000, priceCurrency: 'USD' }
		const withPrice = renderToStaticMarkup(createElement(ProductStrip, { items: [priced] }))
		expect(withPrice).toContain('data-slot="strip-price"')
		expect(withPrice).toContain('21,000 USD')

		const withoutPrice = renderToStaticMarkup(createElement(ProductStrip, makeStrip()))
		expect(withoutPrice).not.toContain('data-slot="strip-price"')
	})

	test('a sats listing spells its unit as sats, never a guessed currency', () => {
		const sats: StripItem = { ...STRIP_ITEM, price: 1200 }
		const markup = renderToStaticMarkup(createElement(ProductStrip, { items: [sats] }))
		expect(markup).toContain('1,200 sats')
	})
})

describe('ProductStrip — the loop', () => {
	test('the track repeats the run, so the animation has something to land on', () => {
		const items: StripItem[] = [
			{ id: 'a', title: 'A', seller: 's1', material: 'm1', href: '/?p=a' },
			{ id: 'b', title: 'B', seller: 's2', material: 'm2', href: '/?p=b' },
		]
		const markup = renderToStaticMarkup(createElement(ProductStrip, { items }))
		const runs = stripRunCount(items.length)
		expect(runs).toBeGreaterThanOrEqual(2)
		// Every tile is rendered once per run — the duplicate is the loop's seam.
		expect(countOccurrences(markup, 'data-item-id="a"')).toBe(runs)
		expect(countOccurrences(markup, 'data-slot="strip-run"')).toBe(runs)
		// The extra runs are the same products, not more of them: hidden from AT.
		expect(countOccurrences(markup, 'data-clone="true"')).toBe(runs - 1)
		expect(countOccurrences(markup, 'aria-hidden="true"')).toBeGreaterThanOrEqual(runs - 1)
	})

	test('the shift is one run’s share of the track, so the loop is seamless', () => {
		const items: StripItem[] = [
			{ id: 'a', title: 'A', seller: 's1', material: 'm1', href: '/?p=a' },
			{ id: 'b', title: 'B', seller: 's2', material: 'm2', href: '/?p=b' },
		]
		const markup = renderToStaticMarkup(createElement(ProductStrip, { items }))
		const runs = stripRunCount(items.length)
		expect(markup).toContain(`--strip-shift:-${(100 / runs).toFixed(4)}%`)
		expect(markup).toContain('@keyframes strip-drift')
		expect(markup).toContain('translate3d(var(--strip-shift, -50%), 0, 0)')
	})

	test('the drift is a slow linear loop that pauses under the pointer', () => {
		const markup = renderToStaticMarkup(createElement(ProductStrip, makeStrip()))
		expect(markup).toContain('animate-[strip-drift_58s_linear_infinite]')
		expect(markup).toContain('group-hover/strip:[animation-play-state:paused]')
		expect(markup).toContain('motion-reduce:animate-none')
	})

	test('reverse drifts the other way, as the frame alternates its rows', () => {
		const markup = renderToStaticMarkup(createElement(ProductStrip, makeStrip({ reverse: true })))
		expect(markup).toContain('animate-[strip-drift_72s_linear_infinite_reverse]')
	})

	test('a one-item strip still gets a second run to loop onto', () => {
		expect(stripRunCount(1)).toBeGreaterThanOrEqual(2)
		expect(stripRunCount(0)).toBeGreaterThanOrEqual(2)
	})
})

describe('ProductStrip — the frame’s band', () => {
	test('the band is full-bleed and the tiles are the frame’s 188×176', () => {
		const markup = renderToStaticMarkup(createElement(ProductStrip, makeStrip()))
		// Full-bleed: the root spans its parent and clips the drift, with no
		// horizontal margin or padding of its own.
		expect(markup).toContain('w-full')
		expect(markup).toContain('overflow-hidden')
		expect(markup).not.toContain('mx-auto')
		expect(markup).not.toContain('px-4')
		// The frame's tile size.
		expect(markup).toContain('w-[188px]')
		expect(markup).toContain('h-[176px]')
	})

	test('a tile is a real anchor that reports its product', () => {
		const markup = renderToStaticMarkup(createElement(ProductStrip, makeStrip()))
		// The tile's cover link is a real href — hover previews, middle-click and
		// open-in-new-tab are the browser's own; there is no button role or tab
		// order on the article itself.
		expect(markup).toContain('href="/?p=strip-1"')
		expect(markup).toContain('data-item-id="strip-1"')
		expect(markup).not.toContain('role="button"')
		expect(markup).not.toContain('tabindex="0"')
		// The duplicated runs are out of the tab order.
		expect(markup).toContain('tabindex="-1"')
	})

	test('the hover seller is its own profile link, above the tile link', () => {
		const item: StripItem = {
			...STRIP_ITEM,
			sellerHref: `/profile/${encodeURIComponent('a'.repeat(64))}`,
		}
		const markup = renderToStaticMarkup(createElement(ProductStrip, { items: [item] }))
		expect(markup).toContain(`href="/profile/${'a'.repeat(64)}"`)
		expect(markup).toContain('pointer-events-auto')
	})
})
