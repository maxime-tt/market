/**
 * platform/web/browse/BrowseIndexHost.category-row.test.tsx — a category row's
 * card opens the panel **in place**, exactly like a wall/strip tile.
 *
 * The defect: the row card's selection state included the row's category as
 * `tag`, which flipped `isIdle` off and swapped the page to the category's
 * results. Selecting a product from a row is a product selection, not a browse:
 * it must write only `?p=`, keep the home (strips, hero, rows) as the split's
 * master, and mount exactly one panel — the same contract the strip tile path
 * has (`BrowseIndexHost.test.tsx`'s bare `?p=` test).
 *
 * `ProductCard` is stubbed to record the `onSelect` the host wired, so the
 * click's own state write is asserted; everything else is stubbed for the same
 * reason as the sibling host tests (the assertion is about wiring, not relays).
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { BrowseProduct, BrowseProductDetail, BrowseSearchResult } from './browseProductMap'
import type { BrowseIndexFeed } from './browseIndexFeed'

const PUBKEY_A = 'a'.repeat(64)

const PRODUCT: BrowseProduct = {
	id: 'ceramic-ball',
	eventId: 'evt-ceramic-ball',
	pubkey: PUBKEY_A,
	title: 'Handcrafted Ceramic Ball',
	price: 21000,
	stock: '76 in stock',
	categories: ['pottery'],
}

const DETAIL: BrowseProductDetail = { ...PRODUCT, description: 'Wood-fired stoneware.', shipping: [] }
const RESULTS: BrowseSearchResult = { products: [PRODUCT], eose: ['wss://local'], pending: [] }
const FEED: BrowseIndexFeed = {
	rows: [{ category: 'Art', items: [PRODUCT] }],
	products: [PRODUCT],
	stats: { products: 1, sellers: 1, postedLast24h: 1, relays: 1 },
	eose: ['wss://local'],
	pending: [],
}

mock.module('@platform/web/browse/browseQuery', () => ({
	useBrowseSearch: () => ({ data: RESULTS, isLoading: false, isError: false }),
	useBrowseProductDetail: () => ({ data: DETAIL, isLoading: false, isError: false, refetch: () => {} }),
	useBrowseFamilyChildren: () => ({ data: null, isLoading: false, isError: false }),
	useBrowseFacets: () => ({ data: null, isLoading: false, isError: false }),
}))

mock.module('@platform/web/browse/browseIndexFeed', () => ({
	useBrowseIndexFeed: () => ({ data: FEED, isLoading: false, isError: false }),
	// The wall is out of scope here; the row cards are the surface under test.
	feedStrips: () => [],
}))

mock.module('@platform/web/auth/authStore', () => ({
	useAuth: () => ({ user: null, isAuthenticated: false }),
}))

mock.module('@platform/web/utils/clipboard', () => ({
	copyToClipboard: async () => {},
}))

mock.module('@platform/web/profiles/profileQuery', () => ({
	useProfile: () => ({ data: null }),
	useProfileNames: () => new Map<string, string>(),
	getNormalizedProfileDisplayName: () => null,
	getNormalizedProfilePicture: () => '',
}))

mock.module('@platform/web/products/PriceDisplayHost', () => ({
	usePriceDisplay: () => ({
		price: { isBitcoinCurrency: false, satsValue: null, fiatValue: null },
		isLoading: false,
		selectedCurrency: 'USD',
	}),
}))

/** The card's `onSelect`, recorded per product id by the stub below. */
const cardSelections = new Map<string, () => void>()

mock.module('@ui/browse/product-card', () => ({
	ProductCard: (props: { id: string; onSelect?: (id: string) => void }) => {
		cardSelections.set(props.id, () => props.onSelect?.(props.id))
		return createElement('div', { 'data-testid': `stub-card-${props.id}` })
	},
	// The detail panel shares these with the card; stubbed so the panel renders
	// without the real art/sprite implementation.
	ListingImage: () => null,
	ProductContextMenu: () => null,
	HeartIcon: () => null,
	ThreeDotsIcon: () => null,
	// `product-strip` imports this from the card module; keep the real semantics.
	isModifiedActivation: () => false,
}))

import { BrowseIndexHost, type BrowseSearchState } from './BrowseIndexHost'

function renderHost(search: { q: string; tag?: string; p?: string }, onNavigate: (state: BrowseSearchState) => void = () => {}) {
	return renderToStaticMarkup(
		createElement(BrowseIndexHost, {
			q: search.q,
			tag: search.tag,
			p: search.p,
			onNavigate,
			onNavigateFeatured: () => {},
		}),
	)
}

beforeEach(() => {
	cardSelections.clear()
})

describe('BrowseIndexHost category-row card', () => {
	test('selecting a row card writes only the product — no term, no tag', () => {
		const navigated: BrowseSearchState[] = []
		renderHost({ q: '' }, (state) => navigated.push(state))

		const select = cardSelections.get('ceramic-ball')
		expect(select).toBeFunction()
		select?.()

		expect(navigated).toHaveLength(1)
		expect(navigated[0]?.q).toBe('')
		expect(navigated[0]?.p).toBe('ceramic-ball')
		// The row's category must NOT ride along: a tag flips the page to results.
		expect(navigated[0]?.tag).toBeUndefined()
	})

	test('the resulting state keeps the home as the split master, with exactly one panel', () => {
		const markup = renderHost({ q: '', p: 'ceramic-ball' })

		// The home is still the base state…
		expect(markup).toContain('data-testid="widget-browse-idle-ctas"')
		expect(markup).toContain('data-testid="widget-category-rows"')

		// …inside the master pane, with a single panel beside it.
		// Element-anchored needles: the split injects a <style> naming its slots.
		expect(markup.split('<div data-slot="split-master"').length - 1).toBe(1)
		expect(markup.split('<div data-slot="split-detail"').length - 1).toBe(1)
		expect(markup.split('data-slot="product-detail-panel"').length - 1).toBe(1)

		const master = markup.slice(markup.indexOf('data-slot="split-master"'), markup.indexOf('data-slot="split-detail"'))
		expect(master).toContain('widget-browse-idle-ctas')
		expect(master).toContain('widget-category-rows')
	})
})
