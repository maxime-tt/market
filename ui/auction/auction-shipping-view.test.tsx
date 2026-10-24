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
 * T6.3 slice S5b adopted the shared `empty-state`/`loading-state`/`notice` kit
 * for those branches (a declared visible change), so the suite now also pins
 * the `data-slot` the adopted component renders. Copy is unchanged.
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
		// S5b: the branch is an `EmptyState` now.
		expect(markup).toContain('data-slot="empty-state"')
	})

	test('shows the loading branch', () => {
		const markup = renderToStaticMarkup(createElement(AuctionShippingView, { ...base, isLoading: true }))
		expect(markup).toContain('Loading shipping options...')
		// S5b: the branch is a `LoadingState` with an accessible status label.
		expect(markup).toContain('data-slot="loading-state"')
		expect(markup).toContain('role="status"')
		expect(markup).toContain('aria-label="Loading shipping options..."')
	})

	test('shows the no-options branch with the shipping-options link', () => {
		const markup = renderToStaticMarkup(createElement(AuctionShippingView, { ...base, hasAnyOptions: false }))
		expect(markup).toContain('any shipping options yet')
		expect(markup).toContain('href="/dashboard/products/shipping-options"')
		expect(markup).toContain('shipping options')
		// S5b: the branch is an `EmptyState`, and the `UiLink` is its action.
		expect(markup).toContain('data-slot="empty-state"')
		// The sentence survives byte-for-byte once the tags are stripped: the
		// title/description/action split must not drop a boundary space.
		const text = markup.replace(/<[^>]*>/g, '').replace(/&#x27;/g, "'")
		expect(text).toContain("You don't have any shipping options yet. Create some from the shipping options page, then come back here.")
	})

	test('shows the all-attached branch when nothing is left to add', () => {
		const markup = renderToStaticMarkup(createElement(AuctionShippingView, { ...base, hasAnyOptions: true, unselected: [] }))
		expect(markup).toContain('All of your shipping options are already attached.')
		// S5b: the branch is a `Notice` (info tone).
		expect(markup).toContain('data-slot="notice"')
		expect(markup).toContain('data-tone="info"')
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
