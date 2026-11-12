import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { CheckoutMainCard, CheckoutMobileSummaryCard, CheckoutSidebarCard } from './checkout-layout-views'

/**
 * The checkout card shells are frames: they must render the host's title and
 * children, gate content on the host's flags, and inject nothing of their own.
 * The route's primitive imports are what these components removed, so the tests
 * also pin that the cards really are Cards (the `data-slot` from the primitive).
 */

describe('CheckoutMobileSummaryCard', () => {
	test('renders the title and hides the content while collapsed', () => {
		const markup = renderToStaticMarkup(
			<CheckoutMobileSummaryCard title="Cart Summary" open={false} onToggle={() => {}}>
				<span data-testid="content">inside</span>
			</CheckoutMobileSummaryCard>,
		)

		expect(markup).toContain('data-slot="checkout-mobile-summary"')
		expect(markup).toContain('Cart Summary')
		expect(markup).toContain('aria-expanded="false"')
		expect(markup).not.toContain('data-testid="content"')
	})

	test('reveals the content and rotates the caret when expanded', () => {
		const markup = renderToStaticMarkup(
			<CheckoutMobileSummaryCard title="Payment Details" open onToggle={() => {}}>
				<span data-testid="content">inside</span>
			</CheckoutMobileSummaryCard>,
		)

		expect(markup).toContain('data-testid="content"')
		expect(markup).toContain('aria-expanded="true"')
		expect(markup).toContain('rotate-90')
	})

	test('is mobile-only and merges the host className', () => {
		const markup = renderToStaticMarkup(
			<CheckoutMobileSummaryCard title="t" open={false} onToggle={() => {}} className="mt-2">
				x
			</CheckoutMobileSummaryCard>,
		)
		expect(markup).toContain('lg:hidden')
		expect(markup).toContain('mt-2')
	})
})

describe('CheckoutMainCard', () => {
	test('renders the step title, the injected header controls and the children', () => {
		const markup = renderToStaticMarkup(
			<CheckoutMainCard title="Shipping Address" headerActions={<button type="button">Next</button>}>
				<form data-testid="form" />
			</CheckoutMainCard>,
		)

		expect(markup).toContain('data-slot="checkout-main-card"')
		expect(markup).toContain('Shipping Address')
		expect(markup).toContain('Next')
		expect(markup).toContain('data-testid="form"')
	})

	test('omits the header controls when the host injects none', () => {
		const markup = renderToStaticMarkup(<CheckoutMainCard title="Order Summary">x</CheckoutMainCard>)
		expect(markup).not.toContain('<button')
		expect(markup).toContain('Order Summary')
	})
})

describe('CheckoutSidebarCard', () => {
	test('is desktop-only and renders the title with its children', () => {
		const markup = renderToStaticMarkup(
			<CheckoutSidebarCard title="Cart Summary">
				<span data-testid="cart">cart</span>
			</CheckoutSidebarCard>,
		)

		expect(markup).toContain('data-slot="checkout-sidebar"')
		expect(markup).toContain('hidden lg:flex')
		expect(markup).toContain('Cart Summary')
		expect(markup).toContain('data-testid="cart"')
	})

	test('wraps the content in a scroll region only when asked', () => {
		const plain = renderToStaticMarkup(<CheckoutSidebarCard title="Payment Details">x</CheckoutSidebarCard>)
		expect(plain).not.toContain('data-slot="scroll-area"')

		const scrolled = renderToStaticMarkup(
			<CheckoutSidebarCard title="Cart Summary" scrollable>
				x
			</CheckoutSidebarCard>,
		)
		expect(scrolled).toContain('data-slot="scroll-area"')
	})
})
