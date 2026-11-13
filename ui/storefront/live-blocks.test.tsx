/**
 * storefront/live-blocks.test.tsx — the live/derived block set.
 *
 * The regression this guards: the CMS could not express the browse home's live
 * surfaces (the wall strips, the measured line, the streamed grid). These are
 * props-only views — every number and listing arrives as props — so what is
 * under test is the view's own behaviour at rest, empty, loading and errored,
 * and, for the stats block, that it states a *measured* number and never a
 * literal.
 */

import { describe, expect, test } from 'bun:test'
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { StripItem } from '@ui/browse/product-strip'
import { StorefrontProvider } from './StorefrontContext'
import { ProductStripsBlock } from './blocks/ProductStripsBlock'
import { BrowseStatsBlock } from './blocks/BrowseStatsBlock'
import { BrowseFeedBlock, type BrowseFeedRow } from './blocks/BrowseFeedBlock'

const AUTHOR = 'a'.repeat(64)

const stripItem = (id: string): StripItem => ({
	id,
	title: `Product ${id}`,
	seller: 'atelier-norte',
	material: 'm1',
	symbolId: undefined,
	href: `/?p=${id}`,
	sellerHref: `/profile/${AUTHOR}`,
	price: 1200,
	priceCurrency: 'SATS',
})

const editing = (children: ReactElement) =>
	createElement(StorefrontProvider, { value: { pubkey: AUTHOR, isEditing: true }, children })

const card = (product: BrowseFeedRow) => createElement('div', { 'data-testid': `card-${product.id}` }, product.id)

describe('ProductStripsBlock (props-only view)', () => {
	const base = { title: 'Fresh from the market', limit: 16, reverse: false }

	test('renders the strip’s items at rest', () => {
		const markup = renderToStaticMarkup(
			createElement(ProductStripsBlock, { ...base, items: [stripItem('mug'), stripItem('bowl')], isLoading: false, isError: false }),
		)
		expect(markup).toContain('data-testid="widget-product-strip"')
		expect(markup).toContain('widget-strip-item-mug')
		expect(markup).toContain('Fresh from the market')
		expect(markup).toContain('atelier-norte')
	})

	test('honours the document’s limit', () => {
		const markup = renderToStaticMarkup(
			createElement(ProductStripsBlock, {
				...base,
				limit: 1,
				items: [stripItem('mug'), stripItem('bowl')],
				isLoading: false,
				isError: false,
			}),
		)
		expect(markup).toContain('widget-strip-item-mug')
		expect(markup).not.toContain('widget-strip-item-bowl')
	})

	test('empty renders nothing for a visitor and a hint in the editor', () => {
		expect(
			renderToStaticMarkup(createElement(ProductStripsBlock, { ...base, items: [], isLoading: false, isError: false })),
		).toBe('')
		expect(
			renderToStaticMarkup(editing(createElement(ProductStripsBlock, { ...base, items: null, isLoading: false, isError: false }))),
		).toContain('Live product strips appear here')
	})

	test('loading and error are reported, not flattened into empty', () => {
		const loading = renderToStaticMarkup(
			createElement(ProductStripsBlock, { ...base, items: null, isLoading: true, isError: false }),
		)
		expect(loading).toContain('storefront-product-strips-loading')

		const error = renderToStaticMarkup(
			createElement(ProductStripsBlock, { ...base, items: null, isLoading: false, isError: true }),
		)
		expect(error).toContain('storefront-product-strips-error')
	})
})

describe('BrowseStatsBlock (props-only view)', () => {
	const base = { align: 'center' as const }

	test('states the measured numbers it was handed', () => {
		const markup = renderToStaticMarkup(
			createElement(BrowseStatsBlock, {
				...base,
				stats: { products: 5, sellers: 2, postedLast24h: 1, relays: 3 },
				isLoading: false,
				isError: false,
			}),
		)
		expect(markup).toContain('5 items loaded from 2 sellers')
		expect(markup).toContain('1 posted in the last 24 hours')
		expect(markup).toContain('3 relays queried')
	})

	test('formats the two-number line the browse home test pins', () => {
		// BrowseIndexHost.test.tsx asserts exactly this string from `feed.stats`
		// `{ products: 2, sellers: 2 }`. The block must reproduce it verbatim.
		const markup = renderToStaticMarkup(
			createElement(BrowseStatsBlock, { ...base, stats: { products: 2, sellers: 2 }, isLoading: false, isError: false }),
		)
		expect(markup).toContain('2 items loaded from 2 sellers')
	})

	test('a different measurement states a different number — it is not a literal', () => {
		const one = renderToStaticMarkup(
			createElement(BrowseStatsBlock, { ...base, stats: { products: 7, sellers: 3 }, isLoading: false, isError: false }),
		)
		const two = renderToStaticMarkup(
			createElement(BrowseStatsBlock, { ...base, stats: { products: 12, sellers: 4 }, isLoading: false, isError: false }),
		)
		expect(one).not.toBe(two)
		expect(one).toContain('7 items loaded from 3 sellers')
		expect(two).toContain('12 items loaded from 4 sellers')
	})

	test('singular counts read as English', () => {
		const markup = renderToStaticMarkup(
			createElement(BrowseStatsBlock, { ...base, stats: { products: 1, sellers: 1, relays: 1 }, isLoading: false, isError: false }),
		)
		expect(markup).toContain('1 item loaded from 1 seller')
		expect(markup).toContain('1 relay queried')
	})

	test('with nothing measured it states nothing (no placeholder copy)', () => {
		expect(
			renderToStaticMarkup(createElement(BrowseStatsBlock, { ...base, stats: undefined, isLoading: false, isError: false })),
		).toBe('')
		expect(
			renderToStaticMarkup(createElement(BrowseStatsBlock, { ...base, stats: {}, isLoading: false, isError: false })),
		).toBe('')
	})
})

describe('BrowseFeedBlock (props-only view)', () => {
	const base = { title: 'This week', limit: 24, columns: 3 as const, emptyMessage: 'Nothing loaded yet.' }

	const product = (id: string): BrowseFeedRow => ({ id })

	test('renders one host card per loaded product', () => {
		const markup = renderToStaticMarkup(
			createElement(BrowseFeedBlock, {
				...base,
				products: [product('mug'), product('bowl')],
				isLoading: false,
				isError: false,
				renderProduct: card,
			}),
		)
		expect(markup).toContain('data-testid="storefront-browse-feed"')
		expect(markup).toContain('card-mug')
		expect(markup).toContain('card-bowl')
		expect(markup).toContain('This week')
	})

	test('honours the document’s limit', () => {
		const markup = renderToStaticMarkup(
			createElement(BrowseFeedBlock, {
				...base,
				limit: 1,
				products: [product('mug'), product('bowl')],
				isLoading: false,
				isError: false,
				renderProduct: card,
			}),
		)
		expect(markup).toContain('card-mug')
		expect(markup).not.toContain('card-bowl')
	})

	test('empty states the author’s message; loading and error are distinct', () => {
		const empty = renderToStaticMarkup(
			createElement(BrowseFeedBlock, { ...base, products: [], isLoading: false, isError: false, renderProduct: card }),
		)
		expect(empty).toContain('Nothing loaded yet.')

		const loading = renderToStaticMarkup(
			createElement(BrowseFeedBlock, { ...base, products: null, isLoading: true, isError: false, renderProduct: card }),
		)
		expect(loading).toContain('storefront-browse-feed-loading')

		const error = renderToStaticMarkup(
			createElement(BrowseFeedBlock, { ...base, products: null, isLoading: false, isError: true, renderProduct: card }),
		)
		expect(error).toContain('storefront-browse-feed-error')
		expect(error).not.toContain('Nothing loaded yet.')
	})
})