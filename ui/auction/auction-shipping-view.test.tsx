import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AuctionShippingView } from './auction-shipping-view'

/**
 * `AuctionShippingView` moved out of the `auction-editor` monolith in T6.3 S5a.
 * The plan flagged that the existing editor spec never touched its four
 * degenerate `Available` branches, so this suite covers them explicitly, plus
 * the attached/available rows and their extra-cost errors.
 *
 * Adopting the shared `empty-state`/`loading-state` kit for these branches is
 * slice S5b (a declared visible change); S5a keeps the hand-rolled markup, so
 * this suite pins that markup's copy.
 *
 * Palette strings are guard-counted in `*.test.*` files, so the suite pins
 * structure and copy only.
 */
const noop = () => {}

const option = { id: '30406:me:std', name: 'Standard Post', price: '10', currency: 'USD', service: 'standard', carrier: 'DHL' }

const base = {
	attached: [],
	unselected: [],
	hasUser: true,
	isLoading: false,
	hasAnyOptions: true,
	extraCostErrors: {},
	onAdd: noop,
	onRemove: noop,
	onExtraCostChange: noop,
}

describe('AuctionShippingView', () => {
	test('separates attached and available options and renders the extra-cost error', () => {
		const markup = renderToStaticMarkup(
			createElement(AuctionShippingView, {
				...base,
				attached: [
					{ shippingRef: '30406:me:kept', extraCost: '5', option },
					{ shippingRef: '30406:me:gone', extraCost: '', option: null },
				],
				unselected: [option],
				extraCostErrors: { 0: 'Invalid extra cost' },
			}),
		)
		expect(markup).toContain('flex flex-col gap-6')
		expect(markup).toContain('Shipping Options')
		expect(markup).toContain('Attached')
		expect(markup).toContain('Standard Post')
		// The unresolved reference falls back to the placeholder.
		expect(markup).toContain('Unknown shipping option')
		expect(markup).toContain('Invalid extra cost')
		// `describeShipping` appends the ' · service · carrier' suffix.
		expect(markup).toContain('10 USD · standard · DHL')
		expect(markup).toContain('Extra cost (sats, optional)')
	})

	test('renders nothing in Attached when there are no attached options', () => {
		const markup = renderToStaticMarkup(createElement(AuctionShippingView, { ...base, unselected: [option] }))
		expect(markup).not.toContain('Attached')
		expect(markup).toContain('Available')
	})

	test('prompts to connect a wallet has no user', () => {
		const markup = renderToStaticMarkup(createElement(AuctionShippingView, { ...base, hasUser: false }))
		expect(markup).toContain('Connect your wallet to load your shipping options.')
	})

	test('shows the loading branch', () => {
		const markup = renderToStaticMarkup(createElement(AuctionShippingView, { ...base, isLoading: true }))
		expect(markup).toContain('Loading shipping options...')
	})

	test('shows the no-options branch with the shipping-options link', () => {
		const markup = renderToStaticMarkup(createElement(AuctionShippingView, { ...base, hasAnyOptions: false }))
		expect(markup).toContain('any shipping options yet')
		expect(markup).toContain('href="/dashboard/products/shipping-options"')
		expect(markup).toContain('shipping options')
	})

	test('shows the all-attached branch when nothing is left to add', () => {
		const markup = renderToStaticMarkup(createElement(AuctionShippingView, { ...base, hasAnyOptions: true, unselected: [] }))
		expect(markup).toContain('All of your shipping options are already attached.')
	})

	test('merges a host className without dropping or reordering its own', () => {
		const markup = renderToStaticMarkup(createElement(AuctionShippingView, { ...base, className: 'mt-2' }))
		expect(markup).toContain('flex flex-col gap-6 mt-2')
	})

	test('accepts the ref prop without altering the rendered markup', () => {
		const withRef = renderToStaticMarkup(createElement(AuctionShippingView, { ...base, ref: null }))
		expect(withRef).toContain('flex flex-col gap-6')
		expect(withRef).toContain('Shipping Options')
	})
})
