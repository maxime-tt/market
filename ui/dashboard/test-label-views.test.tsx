import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { TestLabelButtonView, TestListingsToggleView } from './test-label-views'

const noop = () => {}

describe('TestListingsToggleView', () => {
	test('renders unchecked by default and checked when set', () => {
		const unchecked = renderToStaticMarkup(createElement(TestListingsToggleView, { checked: false, onCheckedChange: noop }))
		const checked = renderToStaticMarkup(createElement(TestListingsToggleView, { checked: true, onCheckedChange: noop }))
		expect(unchecked).not.toContain('checked=""')
		expect(checked).toContain('checked=""')
	})

	test('merges a className and accepts custom label copy', () => {
		const html = renderToStaticMarkup(
			createElement(TestListingsToggleView, { checked: false, onCheckedChange: noop, className: 'mt-4', label: 'Reveal tests' }),
		)
		expect(html).toContain('mt-4')
		expect(html).toContain('Reveal tests')
		expect(html).not.toContain('Show test listings')
	})
})

describe('TestLabelButtonView', () => {
	test('offers unmark for labeled items and mark otherwise', () => {
		const labeled = renderToStaticMarkup(
			createElement(TestLabelButtonView, { isLabeled: true, itemLabel: 'Auction', kindSlug: 'auction', onPress: noop }),
		)
		const unlabeled = renderToStaticMarkup(
			createElement(TestLabelButtonView, { isLabeled: false, itemLabel: 'Product', kindSlug: 'product', onPress: noop }),
		)
		expect(labeled).toContain('data-testid="unmark-test-label-auction-button"')
		expect(labeled).toContain('Unmark as Test Auction')
		expect(unlabeled).toContain('data-testid="mark-test-label-product-button"')
	})
})
