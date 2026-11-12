/**
 * ui/browse/product-detail-panel.test.tsx — Unit tests for the split-view
 * detail pane: the frame's content and every read state.
 *
 * Uses bun:test + renderToStaticMarkup (react-dom/server), matching the
 * existing pattern in ui/browse/product-card.test.tsx.
 */

import { describe, expect, mock, test } from 'bun:test'
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ProductDetailPanel, type ProductDetailOption, type ProductDetailPanelProduct } from './product-detail-panel'
import type { MaterialClass } from './art'

function makeProduct(opts: Partial<ProductDetailPanelProduct> = {}): ProductDetailPanelProduct {
	return {
		id: 'handcrafted-ceramic-ball',
		title: 'Handcrafted Ceramic Ball',
		seller: 'abcdef01',
		sellerNpub: 'npub1q…7f3k',
		location: 'Porto',
		price: 21000,
		stockNote: '76 in stock',
		description: 'Wood-fired stoneware, thrown and glazed by hand.',
		material: 'm1' as MaterialClass,
		...opts,
	}
}

describe('ProductDetailPanel', () => {
	test('renders the frame content of the open panel', () => {
		const markup = renderToStaticMarkup(
			createElement(ProductDetailPanel, {
				state: 'ready',
				product: makeProduct(),
				onThreeDots: () => {},
				onHeart: () => {},
				onBuy: () => {},
				onAddToList: () => {},
			}),
		)
		expect(markup).toContain('data-testid="widget-product-detail-panel"')
		expect(markup).toContain('data-state="ready"')
		// art
		expect(markup).toContain('data-slot="product-detail-art"')
		// seller line — initials avatar, seller, elided npub · location
		expect(markup).toContain('data-slot="seller-avatar"')
		expect(markup).toContain('AB')
		expect(markup).toContain('abcdef01')
		expect(markup).toContain('npub1q…7f3k')
		expect(markup).toContain('· Porto')
		// title + the action row beside it
		expect(markup).toContain('Handcrafted Ceramic Ball')
		expect(markup).toContain('data-slot="product-detail-title"')
		expect(markup).toContain('data-slot="tools"')
		expect(markup).toContain('data-slot="tool-heart"')
		expect(markup).toContain('data-slot="tool-three-dots"')
		// price in sats + stock state
		expect(markup).toContain('21,000')
		expect(markup).toContain('sats')
		expect(markup).toContain('76 in stock')
		// description + spec row
		expect(markup).toContain('Wood-fired stoneware, thrown and glazed by hand.')
		expect(markup).toContain('Ships from')
		expect(markup).toContain('Listing')
		expect(markup).toContain('NIP-99 · kind 30402')
		// action row
		expect(markup).toContain('Buy with Lightning')
		expect(markup).toContain('Add to list')
	})

	test('the seller name and npub link to the seller page', () => {
		const pubkey = 'a'.repeat(64)
		const markup = renderToStaticMarkup(
			createElement(ProductDetailPanel, {
				state: 'ready',
				product: makeProduct({ sellerHref: `/profile/${pubkey}` }),
				onThreeDots: () => {},
			}),
		)
		// Both the display name and the elided npub are real anchors on the
		// profile route — the same convention `ui/nostr/identity.tsx` uses.
		expect(markup.split(`href="/profile/${pubkey}"`).length - 1).toBe(2)
		expect(markup).toContain('<a href=')
	})

	test('the tools sit beside the title (action row placement)', () => {
		const markup = renderToStaticMarkup(
			createElement(ProductDetailPanel, { state: 'ready', product: makeProduct(), onThreeDots: () => {} }),
		)
		const titleRow = markup.indexOf('data-slot="product-detail-titlerow"')
		const title = markup.indexOf('data-slot="product-detail-title"')
		const tools = markup.indexOf('data-slot="tools"')
		expect(titleRow).toBeGreaterThan(-1)
		expect(title).toBeGreaterThan(titleRow)
		expect(tools).toBeGreaterThan(title)
		// the tools are inside the title row, before the price row
		expect(tools).toBeLessThan(markup.indexOf('data-slot="product-detail-price"'))
	})

	test('renders shipping costs when the listing carries shipping options', () => {
		const markup = renderToStaticMarkup(
			createElement(ProductDetailPanel, {
				state: 'ready',
				product: makeProduct({ shipping: [{ costSats: 2400 }] }),
			}),
		)
		expect(markup).toContain('data-slot="spec-shipping"')
		expect(markup).toContain('2,400 sats')
	})

	test('omits the ships-from and shipping rows when the listing has neither', () => {
		const markup = renderToStaticMarkup(
			createElement(ProductDetailPanel, {
				state: 'ready',
				product: makeProduct({ location: undefined, shipping: undefined }),
			}),
		)
		expect(markup).not.toContain('data-slot="spec-ships-from"')
		expect(markup).not.toContain('data-slot="spec-shipping"')
		// the listing row is protocol fact and always renders
		expect(markup).toContain('data-slot="spec-listing"')
	})

	test('renders an unknown price as an em dash, not as zero sats', () => {
		const markup = renderToStaticMarkup(createElement(ProductDetailPanel, { state: 'ready', product: makeProduct({ price: undefined }) }))
		expect(markup).toContain('—')
		expect(markup).not.toContain('0 sats')
	})

	test("renders the listing's own image, with the art as the fallback", () => {
		const withImage = renderToStaticMarkup(
			createElement(ProductDetailPanel, {
				state: 'ready',
				product: makeProduct({ image: 'https://example.test/ball.png' }),
			}),
		)
		expect(withImage).toContain('data-slot="product-detail-art"')
		expect(withImage).toContain('src="https://example.test/ball.png"')

		const withoutImage = renderToStaticMarkup(createElement(ProductDetailPanel, { state: 'ready', product: makeProduct() }))
		expect(withoutImage).not.toContain('<img')
		expect(withoutImage).toContain('widget-product-art-m1')
	})

	test('renders the price unit the tag states, never "sats" on a fiat amount', () => {
		const markup = renderToStaticMarkup(
			createElement(ProductDetailPanel, { state: 'ready', product: makeProduct({ price: 53, currency: 'USD' }) }),
		)
		expect(markup).toContain('53')
		expect(markup).toContain('USD')
		expect(markup).not.toContain('53 sats')
	})

	test('renders the resolved seller name and picture, with the pubkey fallback', () => {
		const resolved = renderToStaticMarkup(
			createElement(ProductDetailPanel, {
				state: 'ready',
				product: makeProduct({ sellerName: 'Porto Ceramics', sellerPicture: 'https://example.test/a.png' }),
			}),
		)
		expect(resolved).toContain('Porto Ceramics')
		expect(resolved).toContain('src="https://example.test/a.png"')

		const fallback = renderToStaticMarkup(createElement(ProductDetailPanel, { state: 'ready', product: makeProduct() }))
		expect(fallback).toContain('AB')
		expect(fallback).toContain('abcdef01')
	})

	test('renders no action or tool without a callback (nothing inert)', () => {
		const markup = renderToStaticMarkup(createElement(ProductDetailPanel, { state: 'ready', product: makeProduct() }))
		expect(markup).not.toContain('data-slot="tools"')
		expect(markup).not.toContain('data-slot="product-detail-actions"')
		expect(markup).not.toContain('Buy with Lightning')
	})

	test('renders the context menu open with the shared menu items', () => {
		const markup = renderToStaticMarkup(
			createElement(ProductDetailPanel, {
				state: 'ready',
				product: makeProduct({ inList: true }),
				menuOpen: true,
				onThreeDots: () => {},
				onHeart: () => {},
				onAddToList: () => {},
				onCopyLink: () => {},
			}),
		)
		expect(markup).toContain('data-testid="widget-product-context-menu"')
		expect(markup).toContain('Add to list')
		expect(markup).toContain('Copy link')
		// heart reflects list membership
		expect(markup).toContain('aria-pressed="true"')
		expect(markup).toContain('aria-label="In a list"')
	})

	test('renders the loading state', () => {
		const markup = renderToStaticMarkup(createElement(ProductDetailPanel, { state: 'loading' }))
		expect(markup).toContain('data-state="loading"')
		expect(markup).toContain('data-slot="product-detail-loading"')
		expect(markup).toContain('aria-busy="true"')
		expect(markup).not.toContain('data-slot="product-detail-title"')
	})

	test('renders the empty state — the coordinate resolved to no listing', () => {
		const markup = renderToStaticMarkup(createElement(ProductDetailPanel, { state: 'empty' }))
		expect(markup).toContain('data-state="empty"')
		expect(markup).toContain('This listing is not on the relays')
	})

	test('renders the error state with a retry', () => {
		const markup = renderToStaticMarkup(createElement(ProductDetailPanel, { state: 'error', onRetry: () => {} }))
		expect(markup).toContain('data-state="error"')
		expect(markup).toContain('The listing could not be loaded')
		expect(markup).toContain('data-testid="widget-product-detail-retry"')
	})

	test('renders nothing but the pane shell in the ready state without a product', () => {
		const markup = renderToStaticMarkup(createElement(ProductDetailPanel, { state: 'ready' }))
		expect(markup).toContain('data-state="ready"')
		expect(markup).not.toContain('data-slot="product-detail-title"')
	})

	test('applies extra classes to the pane root', () => {
		const markup = renderToStaticMarkup(
			createElement(ProductDetailPanel, { state: 'ready', product: makeProduct(), className: 'custom-pane-class' }),
		)
		expect(markup).toContain('custom-pane-class')
	})

	test('renders the close affordance in the panel header, in every read state', () => {
		for (const state of ['loading', 'empty', 'error', 'ready'] as const) {
			const markup = renderToStaticMarkup(
				createElement(ProductDetailPanel, {
					state,
					product: state === 'ready' ? makeProduct() : undefined,
					onClose: () => {},
				}),
			)
			expect(markup).toContain('data-slot="product-detail-header"')
			expect(markup).toContain('data-slot="product-detail-close"')
			expect(markup).toContain('aria-label="Close product"')
		}
	})

	test('renders no close button without a callback (nothing inert)', () => {
		const markup = renderToStaticMarkup(createElement(ProductDetailPanel, { state: 'ready', product: makeProduct() }))
		expect(markup).not.toContain('data-slot="product-detail-close"')
	})

	test('the close button invokes the caller’s onClose', () => {
		const onClose = mock(() => {})
		// The component is props-only, so its own element tree is walkable: this is
		// the wiring the server markup cannot show (handlers are not rendered).
		const tree = ProductDetailPanel({ state: 'ready', product: makeProduct(), onClose })
		const button = findSlot(tree, 'product-detail-close')

		expect(button).toBeDefined()
		button?.props.onClick?.()
		expect(onClose).toHaveBeenCalledTimes(1)
	})
})

// ---------------------------------------------------------------------------
// Option picker — a family's variations, per-option price/stock/images
// ---------------------------------------------------------------------------

function makeOption(opts: Partial<ProductDetailOption> = {}): ProductDetailOption {
	return {
		dTag: 'trail-runner-42',
		label: '42',
		available: true,
		price: 120,
		currency: 'SATS',
		stockNote: '2 in stock',
		...opts,
	}
}

describe('ProductDetailPanel option picker', () => {
	test('offers every variation, marking an out-of-stock one UNAVAILABLE rather than removing it', () => {
		const markup = renderToStaticMarkup(
			createElement(ProductDetailPanel, {
				state: 'ready',
				product: makeProduct({ title: 'Trail Runner' }),
				options: [makeOption(), makeOption({ dTag: 'trail-runner-43', label: '43', available: false, stockNote: undefined })],
				onSelectOption: () => {},
			}),
		)

		expect(markup).toContain('data-slot="product-detail-options"')
		// Both options are offered — the sold-out size is not removed.
		expect(markup).toContain('data-testid="widget-product-detail-option-trail-runner-42"')
		expect(markup).toContain('data-testid="widget-product-detail-option-trail-runner-43"')
		// The unavailable one states it, and is inert.
		expect(markup).toContain('data-available="false"')
		expect(markup).toContain('Unavailable')
	})

	test('uses the variation’s spec label, never the d-tag', () => {
		const markup = renderToStaticMarkup(
			createElement(ProductDetailPanel, {
				state: 'ready',
				product: makeProduct(),
				// The label is what a buyer reads; the d-tag is only the key.
				options: [makeOption({ dTag: 'trail-runner-42', label: '42' })],
				onSelectOption: () => {},
			}),
		)
		expect(markup).toContain('<span data-slot="option-label">42</span>')
		expect(markup).not.toContain('trail-runner-42</span>')
	})

	test('marks the selected option selected', () => {
		const markup = renderToStaticMarkup(
			createElement(ProductDetailPanel, {
				state: 'ready',
				product: makeProduct(),
				options: [makeOption({ dTag: 'trail-runner-42' }), makeOption({ dTag: 'trail-runner-43', label: '43' })],
				selectedOptionDTag: 'trail-runner-43',
				onSelectOption: () => {},
			}),
		)
		const selected = markup.slice(markup.indexOf('widget-product-detail-option-trail-runner-43'))
		expect(selected).toContain('data-selected="true"')
		expect(selected).toContain('aria-pressed="true"')
		// The other option is not selected.
		const other = markup.slice(markup.indexOf('widget-product-detail-option-trail-runner-42'))
		expect(other).toContain('data-selected="false"')
	})

	test('shows the selected variation’s price and stock, replacing the family range', () => {
		const markup = renderToStaticMarkup(
			createElement(ProductDetailPanel, {
				state: 'ready',
				product: makeProduct({ title: 'Trail Runner', price: 100, priceMin: 100, priceMax: 150, stockNote: 'parent stock' }),
				options: [makeOption({ price: 120, stockNote: '2 in stock' })],
				selectedOptionDTag: 'trail-runner-42',
				onSelectOption: () => {},
			}),
		)
		// The option's amount/stock win; the range is gone once an option is chosen.
		expect(markup).toContain('120')
		expect(markup).toContain('2 in stock')
		expect(markup).not.toContain('100 – 150')
		expect(markup).not.toContain('parent stock')
	})

	test('shows the selected variation’s image, inheriting the parent gallery when it has none', () => {
		const withImage = renderToStaticMarkup(
			createElement(ProductDetailPanel, {
				state: 'ready',
				product: makeProduct({ image: 'https://example.test/parent.png' }),
				options: [makeOption({ image: 'https://example.test/forty-two.png' })],
				selectedOptionDTag: 'trail-runner-42',
				onSelectOption: () => {},
			}),
		)
		expect(withImage).toContain('src="https://example.test/forty-two.png"')
		expect(withImage).not.toContain('src="https://example.test/parent.png"')

		const withoutImage = renderToStaticMarkup(
			createElement(ProductDetailPanel, {
				state: 'ready',
				product: makeProduct({ image: 'https://example.test/parent.png' }),
				options: [makeOption({ image: undefined })],
				selectedOptionDTag: 'trail-runner-42',
				onSelectOption: () => {},
			}),
		)
		expect(withoutImage).toContain('src="https://example.test/parent.png"')
	})

	test('an explicit selection that is gone marks nothing selected — never a sibling', () => {
		const markup = renderToStaticMarkup(
			createElement(ProductDetailPanel, {
				state: 'ready',
				product: makeProduct({ price: 100, priceMin: 100, priceMax: 150 }),
				options: [makeOption({ dTag: 'trail-runner-42' }), makeOption({ dTag: 'trail-runner-43', label: '43' })],
				// The buyer's choice, which has since disappeared from the family.
				selectedOptionDTag: 'trail-runner-gone',
				onSelectOption: () => {},
			}),
		)
		// No option silently becomes the selection…
		expect(markup).not.toContain('data-selected="true"')
		// …and the panel states the family range rather than adopting a sibling's price.
		expect(markup).toContain('100 – 150')
	})

	test('an available option is interactive, an unavailable one is disabled', () => {
		const markup = renderToStaticMarkup(
			createElement(ProductDetailPanel, {
				state: 'ready',
				product: makeProduct(),
				options: [
					makeOption({ dTag: 'trail-runner-42', available: true }),
					makeOption({ dTag: 'trail-runner-43', label: '43', available: false, stockNote: undefined }),
				],
				onSelectOption: () => {},
			}),
		)
		const available = markup.slice(
			markup.indexOf('data-testid="widget-product-detail-option-trail-runner-42"'),
			markup.indexOf('data-testid="widget-product-detail-option-trail-runner-43"'),
		)
		// The available option carries no `disabled` — it can be picked.
		expect(available).not.toContain('disabled')
		// The unavailable one is inert.
		const unavailable = markup.slice(markup.indexOf('data-testid="widget-product-detail-option-trail-runner-43"'))
		expect(unavailable).toContain('disabled')
	})
})

/**
 * The first element carrying `data-slot="<slot>"`, so a test can reach a
 * rendered element's props (the handler) without a DOM renderer. The tree is
 * synchronous; a function component's return type also admits a promise, which
 * none of these components return.
 */
function findSlot(node: ReactNode | Promise<ReactNode>, slot: string): ReactElement<{ onClick?: () => void }> | undefined {
	if (Array.isArray(node)) {
		for (const child of node) {
			const found = findSlot(child, slot)
			if (found) return found
		}
		return undefined
	}
	if (!isValidElement(node)) return undefined

	const element = node as unknown as ReactElement<{ 'data-slot'?: string; children?: ReactNode; onClick?: () => void }>
	if (element.props['data-slot'] === slot) return element
	return findSlot(element.props.children, slot)
}
