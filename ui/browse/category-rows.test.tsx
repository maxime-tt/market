/**
 * browse/category-rows.test.tsx — the browse-by-category section.
 *
 * The frame's row anatomy and its card treatment (`V3PpdwmvGG`): a category
 * header with a count and a `See all →`, closed by a strong rule, over four
 * across; and the section's own read states (placeholder row while streaming,
 * one honest line when the read failed).
 *
 * The count is the loaded item count, labelled `loaded` — the frame's
 * market-wide "412 items" is not a number this app can measure.
 */

import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { CategoryRow, CategoryRows } from './category-rows'
import { ProductCard } from './product-card'

describe('CategoryRow', () => {
	test('renders the frame header: title, loaded count, see-all, strong rule', () => {
		const markup = renderToStaticMarkup(
			createElement(CategoryRow, { title: 'Bitcoin', count: 412, onSeeAll: () => {} }, createElement('div', null, 'card')),
		)
		expect(markup).toContain('data-testid="widget-category-row-Bitcoin"')
		expect(markup).toContain('Bitcoin')
		expect(markup).toContain('412 loaded')
		expect(markup).toContain('data-testid="widget-category-row-see-all-Bitcoin"')
		expect(markup).toContain('See all →')
		expect(markup).toContain('border-border-strong')
	})

	test('renders no count when none is given, rather than a zero', () => {
		const markup = renderToStaticMarkup(createElement(CategoryRow, { title: 'Art' }, createElement('div', null, 'card')))
		expect(markup).not.toContain('loaded')
		expect(markup).not.toContain('data-slot="category-row-count"')
	})

	test('renders no see-all link without a handler', () => {
		const markup = renderToStaticMarkup(createElement(CategoryRow, { title: 'Art' }, createElement('div', null, 'card')))
		expect(markup).not.toContain('See all')
	})

	test('lays the items out four across on desktop', () => {
		const markup = renderToStaticMarkup(createElement(CategoryRow, { title: 'Art' }, createElement('div', null, 'card')))
		expect(markup).toContain('lg:grid-cols-4')
	})
})

describe('CategoryRows', () => {
	test('renders the rows it is given', () => {
		const markup = renderToStaticMarkup(
			createElement(
				CategoryRows,
				null,
				createElement(CategoryRow, { key: 'Bitcoin', title: 'Bitcoin' }, createElement('div', null, 'card')),
			),
		)
		expect(markup).toContain('data-testid="widget-category-rows"')
		expect(markup).toContain('data-testid="widget-category-row-Bitcoin"')
	})

	test('shows a placeholder row while the feed streams', () => {
		const markup = renderToStaticMarkup(createElement(CategoryRows, { isLoading: true }))
		expect(markup).toContain('data-slot="skeleton-card"')
		expect(markup).not.toContain('data-testid="widget-category-rows-error"')
	})

	test('reports a failed read instead of an empty section', () => {
		const markup = renderToStaticMarkup(createElement(CategoryRows, { isError: true }))
		expect(markup).toContain('data-testid="widget-category-rows-error"')
		expect(markup).toContain('no relay answered')
	})

	test('renders nothing beyond the section when every category is empty', () => {
		const markup = renderToStaticMarkup(createElement(CategoryRows, null))
		expect(markup).toContain('data-testid="widget-category-rows"')
		expect(markup).not.toContain('data-slot="category-row"')
	})
})

describe('the row card treatment', () => {
	const card = (presentation: 'grid' | 'row') =>
		renderToStaticMarkup(
			createElement(ProductCard, {
				id: 'p1',
				title: 'Speckled Bowl',
				seller: 'atelier',
				sellerPubkey: 'abcdef01',
				material: 'm1',
				presentation,
			}),
		)

	test('a row card carries no top rule; a grid card does', () => {
		expect(card('row')).not.toContain('border-t border-border-strong')
		expect(card('grid')).toContain('border-t border-border-strong')
	})

	test('a row card uses the 16/9 shot and the tighter title scale', () => {
		expect(card('row')).toContain('aspect-[16/9]')
		expect(card('row')).toContain('text-[14px]')
		expect(card('grid')).toContain('aspect-[3/2]')
	})

	test('both presentations keep the price row hairline the frames draw', () => {
		expect(card('row')).toContain('border-t border-border-default')
		expect(card('grid')).toContain('border-t border-border-default')
	})
})
