/**
 * ui/browse/seller-profile.test.tsx — Unit tests for the seller profile view.
 *
 * Uses bun:test + renderToStaticMarkup (react-dom/server), matching the
 * existing test pattern in ui/browse/product-card.test.tsx.
 */

import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ProductCard } from './product-card'
import { SellerProfileHeader, SellerProfileView } from './seller-profile'
import type { MaterialClass } from './art'

const NPUB = 'npub18x2s4kzqgsu37ykmq5g6m3h3qfqr8r3rjy3t9x3q4k3q8v4w4s9qj5s7k0'

function makeHeader(opts: Partial<Parameters<typeof SellerProfileHeader>[0]> = {}) {
	return {
		name: 'atelier-norte',
		...opts,
	}
}

function makeView(opts: Partial<Parameters<typeof SellerProfileView>[0]> = {}) {
	return {
		...makeHeader(),
		...opts,
	}
}

const CARD = {
	id: 'evt-1',
	title: 'Handcrafted Ceramic Ball',
	seller: 'atelier-norte · ships from PT',
	sellerPubkey: 'abcdef01',
	price: 21000,
	stockNote: '14 in stock',
	material: 'm1' as MaterialClass,
	category: 'pottery',
}

// ---------------------------------------------------------------------------
// SellerProfileHeader
// ---------------------------------------------------------------------------

describe('SellerProfileHeader', () => {
	test('renders name and the primary category beside it', () => {
		const markup = renderToStaticMarkup(createElement(SellerProfileHeader, makeHeader({ category: 'pottery' })))
		expect(markup).toContain('widget-seller-profile-header')
		expect(markup).toContain('atelier-norte')
		expect(markup).toContain('pottery')
	})

	test('renders the npub chip and its copy control', () => {
		const markup = renderToStaticMarkup(createElement(SellerProfileHeader, makeHeader({ npub: NPUB })))
		expect(markup).toContain('widget-seller-profile-npub')
		expect(markup).toContain(NPUB)
		expect(markup).toContain(`Copy npub ${NPUB}`)
	})

	test('joins the supplied reputation facts and renders none when given none', () => {
		const withFacts = renderToStaticMarkup(createElement(SellerProfileHeader, makeHeader({ facts: ['Joined Mar 2024'] })))
		expect(withFacts).toContain('widget-seller-profile-reputation')
		expect(withFacts).toContain('Joined Mar 2024')

		// No facts supplied → no fact line at all. The header never invents one,
		// and an unsupplied fact must not render as a zero or a placeholder.
		const withoutFacts = renderToStaticMarkup(createElement(SellerProfileHeader, makeHeader({ facts: [] })))
		expect(withoutFacts).not.toContain('widget-seller-profile-reputation')
		expect(withoutFacts).not.toContain('trades')
		expect(withoutFacts).not.toContain('zapped')
	})

	test('renders the ships-from line only when a location was resolved', () => {
		const withLocation = renderToStaticMarkup(createElement(SellerProfileHeader, makeHeader({ shipsFrom: 'Vila Nova de Gaia, PT' })))
		expect(withLocation).toContain('widget-seller-profile-ships-from')
		expect(withLocation).toContain('Ships from ')
		expect(withLocation).toContain('Vila Nova de Gaia, PT')

		const withoutLocation = renderToStaticMarkup(createElement(SellerProfileHeader, makeHeader()))
		expect(withoutLocation).not.toContain('widget-seller-profile-ships-from')
	})

	test('renders Contact only when the host supplies a handler', () => {
		const wired = renderToStaticMarkup(createElement(SellerProfileHeader, makeHeader({ onContact: () => {} })))
		expect(wired).toContain('widget-seller-profile-contact')

		const unwired = renderToStaticMarkup(createElement(SellerProfileHeader, makeHeader()))
		expect(unwired).not.toContain('widget-seller-profile-contact')
		expect(unwired).not.toContain('widget-seller-profile-affordances')
	})

	test('exposes the affordance slot for host-owned actions', () => {
		const markup = renderToStaticMarkup(
			createElement(
				SellerProfileHeader,
				makeHeader({ onContact: () => {}, affordances: createElement('span', { id: 'host-action' }, 'x') }),
			),
		)
		expect(markup).toContain('widget-seller-profile-affordances')
		expect(markup).toContain('host-action')
	})

	// The seam has no contact-list (NIP-02) read or write, so a Follow control
	// could only be a no-op. It is reported, not rendered.
	test('renders no Follow affordance', () => {
		const markup = renderToStaticMarkup(
			createElement(SellerProfileHeader, makeHeader({ npub: NPUB, facts: ['Joined Mar 2024'], onContact: () => {} })),
		)
		expect(markup.toLowerCase()).not.toContain('follow')
	})
})

// ---------------------------------------------------------------------------
// SellerProfileView
// ---------------------------------------------------------------------------

describe('SellerProfileView', () => {
	test('renders the status line, the header and the listings grid', () => {
		const markup = renderToStaticMarkup(
			createElement(
				SellerProfileView,
				makeView({ status: createElement('div', { id: 'relay-status' }, 'status') }),
				createElement(ProductCard, CARD),
			),
		)
		expect(markup).toContain('widget-seller-profile-view')
		expect(markup).toContain('relay-status')
		expect(markup).toContain('widget-seller-profile-header')
		expect(markup).toContain('widget-seller-profile-listings')
		expect(markup).toContain('widget-product-card-evt-1')
		expect(markup).toContain('widget-product-card-category-evt-1')
	})

	test('loading replaces the listing region, keeping the header', () => {
		const markup = renderToStaticMarkup(
			createElement(
				SellerProfileView,
				makeView({
					loading: createElement('div', { id: 'skeleton' }),
					empty: createElement('div', { id: 'empty' }),
				}),
				createElement(ProductCard, CARD),
			),
		)
		expect(markup).toContain('skeleton')
		expect(markup).not.toContain('empty')
		expect(markup).not.toContain('widget-product-card-evt-1')
		expect(markup).toContain('widget-seller-profile-header')
	})

	test('empty replaces the listing region when nothing is listed', () => {
		const markup = renderToStaticMarkup(
			createElement(SellerProfileView, makeView({ empty: createElement('div', { id: 'no-listings' }) }), createElement(ProductCard, CARD)),
		)
		expect(markup).toContain('no-listings')
		expect(markup).not.toContain('widget-product-card-evt-1')
		expect(markup).toContain('widget-seller-profile-header')
	})

	test('error replaces the listing region and keeps the header', () => {
		const markup = renderToStaticMarkup(
			createElement(
				SellerProfileView,
				makeView({ error: createElement('div', { id: 'listings-error' }) }),
				createElement(ProductCard, CARD),
			),
		)
		expect(markup).toContain('listings-error')
		expect(markup).not.toContain('widget-product-card-evt-1')
		expect(markup).toContain('widget-seller-profile-header')
		expect(markup).toContain('widget-seller-profile-listings')
	})

	// A failed read is not an empty seller: when a caller hands both (a
	// regression a host could introduce), the failure is what the region states.
	test('error wins over empty', () => {
		const markup = renderToStaticMarkup(
			createElement(
				SellerProfileView,
				makeView({
					error: createElement('div', { id: 'listings-error' }),
					empty: createElement('div', { id: 'no-listings' }),
				}),
			),
		)
		expect(markup).toContain('listings-error')
		expect(markup).not.toContain('no-listings')
	})

	test('loading wins over error', () => {
		const markup = renderToStaticMarkup(
			createElement(
				SellerProfileView,
				makeView({
					loading: createElement('div', { id: 'skeleton' }),
					error: createElement('div', { id: 'listings-error' }),
				}),
			),
		)
		expect(markup).toContain('skeleton')
		expect(markup).not.toContain('listings-error')
	})

	test('renders with a custom className', () => {
		const markup = renderToStaticMarkup(createElement(SellerProfileView, makeView({ className: 'custom-seller-class' })))
		expect(markup).toContain('custom-seller-class')
	})
})
