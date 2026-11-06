/**
 * platform/web/browse/BrowseIndexHost.test.tsx — the split-view wiring.
 *
 * The question this host answers: does the route's `?p=` open the product panel
 * beside the results (and mark that card), or leave the plain grid? The reads
 * are stubbed so the assertion is about the host's wiring, not the relay.
 *
 * `mock.module` is consulted at import time, so the read hosts, auth and the
 * clipboard host are stubbed BEFORE `./BrowseIndexHost` is imported (per-file
 * under `bun test --isolate`, which the gate battery uses).
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { BrowseProduct, BrowseProductDetail, BrowseSearchResult } from './browseProductMap'
import type { BrowseIndexFeed } from './browseIndexFeed'

const PUBKEY_A = 'a'.repeat(64)
const PUBKEY_B = 'b'.repeat(64)

let searchData: BrowseSearchResult | null = null
let searchLoading = false
let searchError = false
let detailData: BrowseProductDetail | null = null
let detailLoading = false
let detailError = false

mock.module('@platform/web/browse/browseQuery', () => ({
	useBrowseSearch: () => ({ data: searchData, isLoading: searchLoading, isError: searchError }),
	useBrowseProductDetail: () => ({ data: detailData, isLoading: detailLoading, isError: detailError, refetch: () => {} }),
}))

// The idle index feed is a read of its own; it is stubbed here for the same
// reason the search read is — this test is about the host's wiring, and the
// feed's own grouping/counting is covered by `browseIndexFeed.test.ts`.
let feedData: BrowseIndexFeed | null = null
let feedLoading = false
let feedError = false

mock.module('@platform/web/browse/browseIndexFeed', () => ({
	useBrowseIndexFeed: () => ({ data: feedData, isLoading: feedLoading, isError: feedError }),
	// The real pure helpers: the strips the host renders are the shape under test.
	feedStrips: (products: readonly BrowseProduct[], limit: number) =>
		products.slice(0, limit).map((product) => ({
			id: product.id,
			title: product.title,
			seller: product.pubkey.slice(0, 8),
			material: 'm1',
			symbolId: 'p-bowl',
		})),
}))

mock.module('@platform/web/auth/authStore', () => ({
	useAuth: () => ({ user: null, isAuthenticated: false }),
}))

mock.module('@platform/web/utils/clipboard', () => ({
	copyToClipboard: async () => {},
}))

import { BrowseIndexHost } from './BrowseIndexHost'

const RESULTS: BrowseSearchResult = {
	products: [
		{
			id: 'ceramic-ball',
			eventId: 'evt-ceramic-ball',
			pubkey: PUBKEY_A,
			title: 'Handcrafted Ceramic Ball',
			price: 21000,
			stock: '76 in stock',
			categories: ['pottery'],
		},
		{
			id: 'pour-over',
			eventId: 'evt-pour-over',
			pubkey: PUBKEY_B,
			title: 'Ceramic Pour-Over Set',
			price: 34500,
			stock: '12 left',
			categories: ['pottery'],
		},
	],
	eose: ['wss://local'],
	pending: [],
}

const DETAIL: BrowseProductDetail = {
	id: 'ceramic-ball',
	eventId: 'evt-ceramic-ball',
	pubkey: PUBKEY_A,
	title: 'Handcrafted Ceramic Ball',
	price: 21000,
	stock: '76 in stock',
	categories: ['pottery'],
	description: 'Wood-fired stoneware, thrown and glazed by hand.',
	location: 'Porto',
	shipping: [{ costSats: 2400 }],
}

function renderHost(options: { q?: string; p?: string } = {}) {
	return renderToStaticMarkup(
		createElement(BrowseIndexHost, {
			q: options.q ?? 'ceramic',
			tag: undefined,
			p: options.p,
			onNavigate: () => {},
			onNavigateFeatured: () => {},
		}),
	)
}

beforeEach(() => {
	searchData = RESULTS
	searchLoading = false
	searchError = false
	detailData = DETAIL
	detailLoading = false
	detailError = false
	feedData = null
	feedLoading = false
	feedError = false
})

describe('BrowseIndexHost split view', () => {
	test('opens the product panel beside the results when ?p= is set', () => {
		const markup = renderHost({ p: 'ceramic-ball' })

		// the frame's master–detail split, with the panel in the detail pane
		expect(markup).toContain('data-slot="split-master"')
		expect(markup).toContain('data-slot="split-separator"')
		expect(markup).toContain('data-slot="split-detail"')
		expect(markup).toContain('data-slot="product-detail-panel"')
		expect(markup).toContain('data-state="ready"')

		// the open product's card is marked, the other is not
		expect(markup).toContain('data-testid="widget-product-card-ceramic-ball" data-selected="true"')
		expect(markup).toContain('data-testid="widget-product-card-pour-over" data-selected="false"')

		// the panel renders the read product — title, sats, stock, the real tags
		expect(markup).toContain('Handcrafted Ceramic Ball')
		expect(markup).toContain('21,000')
		expect(markup).toContain('76 in stock')
		expect(markup).toContain('Porto')
		expect(markup).toContain('2,400 sats')
		expect(markup).toContain('npub1')
	})

	test('leaves the plain results grid when ?p= is absent', () => {
		const markup = renderHost({ p: undefined })

		expect(markup).not.toContain('data-slot="split-master"')
		expect(markup).not.toContain('data-slot="product-detail-panel"')
		expect(markup).toContain('data-testid="widget-product-card-ceramic-ball"')
		expect(markup).toContain('data-testid="widget-product-card-pour-over"')
	})

	test('renders the panel loading state while the detail read is in flight', () => {
		detailData = null
		detailLoading = true

		const markup = renderHost({ p: 'ceramic-ball' })
		expect(markup).toContain('data-state="loading"')
	})

	test('renders the panel empty state when the coordinate resolves to no listing', () => {
		detailData = null

		const markup = renderHost({ p: 'missing-listing' })
		expect(markup).toContain('data-state="empty"')
		expect(markup).toContain('This listing is not on the relays')
	})

	test('renders the panel error state when the detail read fails', () => {
		detailData = null
		detailError = true

		const markup = renderHost({ p: 'ceramic-ball' })
		expect(markup).toContain('data-state="error"')
		expect(markup).toContain('data-testid="widget-product-detail-retry"')
	})

	test('shows no split while the search itself is still loading', () => {
		searchData = null
		searchLoading = true

		const markup = renderHost({ p: 'ceramic-ball' })
		expect(markup).not.toContain('data-slot="split-master"')
		expect(markup).toContain('data-slot="skeleton-card"')
	})

	// The click-through contract (ROUND3 §3.10): the URL carries the open
	// product, so `?p=` with no term is the results state with the panel open —
	// previously it fell back to the idle screen and dropped the panel.
	test('opens the panel for a bare ?p= deep link (no term, no tag)', () => {
		const markup = renderHost({ q: '', p: 'ceramic-ball' })
		expect(markup).not.toContain('data-testid="widget-browse-idle-ctas"')
		expect(markup).toContain('data-slot="split-master"')
		expect(markup).toContain('data-slot="product-detail-panel"')
	})

	test('renders the idle screen (no panel) when there is no term, no tag and no open product', () => {
		const markup = renderHost({ q: '', p: undefined })
		expect(markup).toContain('data-testid="widget-browse-idle-ctas"')
		expect(markup).not.toContain('data-slot="split-master"')
	})
})

describe('BrowseIndexHost idle index', () => {
	const FEED: BrowseIndexFeed = {
		rows: [
			{ category: 'Bitcoin', items: [RESULTS.products[0]] },
			{ category: 'Art', items: [RESULTS.products[1]] },
		],
		products: RESULTS.products,
		stats: { products: 2, sellers: 2, postedLast24h: 1, relays: 1 },
		eose: ['wss://local'],
		pending: [],
	}

	test('renders the hero stats, the wall strips and the category rows from the feed', () => {
		feedData = FEED

		const markup = renderHost({ q: '', p: undefined })

		// hero: measured facts, scoped wording
		expect(markup).toContain('2 items loaded from 2 sellers')
		expect(markup).toContain('1 posted in the last 24 hours')
		expect(markup).toContain('1 relay queried')

		// the category section and its rows
		expect(markup).toContain('data-testid="widget-category-rows"')
		expect(markup).toContain('data-testid="widget-category-row-Bitcoin"')
		expect(markup).toContain('data-testid="widget-category-row-Art"')
		expect(markup).toContain('data-testid="widget-category-row-see-all-Bitcoin"')

		// the row cards are the frame's row presentation: no top rule
		const cardStart = markup.indexOf('data-testid="widget-product-card-ceramic-ball"')
		const cardMarkup = markup.slice(cardStart, cardStart + 700)
		expect(cardMarkup).toContain('pt-4')
		expect(cardMarkup).not.toContain('border-t border-border-strong')

		// the wall strips are the feed's own listings
		expect(markup).toContain('Handcrafted Ceramic Ball')
	})

	test('states a category row count as loaded items, never the frame total', () => {
		feedData = FEED
		const markup = renderHost({ q: '', p: undefined })
		expect(markup).toContain('1 loaded')
		expect(markup).not.toContain('items live from')
	})

	test('shows no hero numbers before the feed has loaded', () => {
		feedData = null
		const markup = renderHost({ q: '', p: undefined })
		expect(markup).toContain('data-testid="widget-browse-idle-motd"')
		// The regression guard: with no read, no number renders. This is the
		// slot the fabricated "3,418 items … 38 relays" copy occupied. Only the
		// band's rendered text is checked — its class attributes carry px values.
		const attr = markup.indexOf('data-testid="widget-browse-idle-motd"')
		const motd = markup
			.slice(markup.lastIndexOf('<', attr), markup.indexOf('data-testid="widget-browse-idle-ctas"'))
			.replace(/<[^>]*>/g, '')
		expect(motd).not.toMatch(/\d/)
	})

	test('reports a failed category read instead of an empty section', () => {
		feedData = null
		feedError = true
		const markup = renderHost({ q: '', p: undefined })
		expect(markup).toContain('data-testid="widget-category-rows-error"')
	})

	test('shows the category placeholder row while the feed streams', () => {
		feedData = null
		feedLoading = true
		const markup = renderHost({ q: '', p: undefined })
		expect(markup).toContain('data-slot="skeleton-card"')
	})
})
