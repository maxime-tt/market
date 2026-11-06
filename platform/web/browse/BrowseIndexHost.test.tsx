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
import type { BrowseFacet, BrowseProduct, BrowseProductDetail, BrowseSearchResult } from './browseProductMap'
import type { BrowseIndexFeed } from './browseIndexFeed'

const PUBKEY_A = 'a'.repeat(64)
const PUBKEY_B = 'b'.repeat(64)

let searchData: BrowseSearchResult | null = null
let searchLoading = false
let searchError = false
let facetsData: BrowseFacet[] | null = null
let facetsEnabled = false
let facetsQueryArg = ''
let detailData: BrowseProductDetail | null = null
let detailLoading = false
let detailError = false
/** The arguments the host handed the detail read (id and the hit's relays). */
let detailReadArgs: { id?: string; relays?: readonly string[] } | null = null

mock.module('@platform/web/browse/browseQuery', () => ({
	useBrowseSearch: () => ({ data: searchData, isLoading: searchLoading, isError: searchError }),
	useBrowseProductDetail: (id?: string, relays?: readonly string[]) => {
		detailReadArgs = { id, relays }
		return { data: detailData, isLoading: detailLoading, isError: detailError, refetch: () => {} }
	},
	// The facet probe is a read of its own; stubbed here so the host's pill
	// derivation is what the test asserts, not the provider round trip. It also
	// records whether the host asked for it, and with what.
	useBrowseFacets: (query: string, enabled: boolean) => {
		facetsEnabled = enabled
		facetsQueryArg = query
		return { data: facetsData, isLoading: false, isError: false }
	},
}))

// The seller-identity seam and the price-display path are reads too; stubbed so
// the host renders the props-only card without a QueryClient or NDK behind it.
let profileName: string | null = null
let profilePicture = ''

mock.module('@platform/web/profiles/profileQuery', () => ({
	useProfile: () => ({ data: profileName || profilePicture ? { profile: { display_name: profileName, picture: profilePicture } } : null }),
	getNormalizedProfileDisplayName: (profile: { display_name?: string | null } | null | undefined) => profile?.display_name ?? null,
	getNormalizedProfilePicture: (profile: { picture?: string } | null | undefined) => profile?.picture ?? '',
}))

mock.module('@platform/web/products/PriceDisplayHost', () => ({
	usePriceDisplay: () => ({
		price: { isBitcoinCurrency: false, satsValue: null, fiatValue: null },
		isLoading: false,
		selectedCurrency: 'USD',
	}),
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

/**
 * A search hit as the RabbitHole client records it: the product plus the relays
 * the listing was seen on (`hits[].relays_seen`). Typed here as an intersection
 * so the literal is checked whatever `BrowseProduct` gains.
 */
type BrowseProductWithRelays = BrowseProduct & { relays?: string[] }

const CERAMIC_BALL: BrowseProductWithRelays = {
	id: 'ceramic-ball',
	eventId: 'evt-ceramic-ball',
	pubkey: PUBKEY_A,
	title: 'Handcrafted Ceramic Ball',
	price: 21000,
	stock: '76 in stock',
	categories: ['pottery'],
	relays: ['wss://rabbithole-a', 'wss://rabbithole-b'],
}

const POUR_OVER: BrowseProductWithRelays = {
	id: 'pour-over',
	eventId: 'evt-pour-over',
	pubkey: PUBKEY_B,
	title: 'Ceramic Pour-Over Set',
	price: 34500,
	stock: '12 left',
	categories: ['pottery'],
}

const RESULTS: BrowseSearchResult = {
	products: [CERAMIC_BALL, POUR_OVER],
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

function renderHost(options: { q?: string; p?: string; tag?: string } = {}) {
	return renderToStaticMarkup(
		createElement(BrowseIndexHost, {
			q: options.q ?? 'ceramic',
			tag: options.tag,
			p: options.p,
			onNavigate: () => {},
			onNavigateFeatured: () => {},
		}),
	)
}

beforeEach(() => {
	detailReadArgs = null
	searchData = RESULTS
	searchLoading = false
	searchError = false
	facetsData = null
	facetsEnabled = false
	facetsQueryArg = ''
	detailData = DETAIL
	detailLoading = false
	detailError = false
	feedData = null
	feedLoading = false
	feedError = false
	profileName = null
	profilePicture = ''
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

	test('reads the open listing from the relays its search hit was seen on', () => {
		renderHost({ p: 'ceramic-ball' })

		expect(detailReadArgs?.id).toBe('ceramic-ball')
		expect(detailReadArgs?.relays).toEqual(['wss://rabbithole-a', 'wss://rabbithole-b'])
	})

	test('leaves the detail read on the app context when the hit recorded no relays', () => {
		renderHost({ p: 'pour-over' })

		expect(detailReadArgs?.id).toBe('pour-over')
		expect(detailReadArgs?.relays).toBeUndefined()
	})

	test('the open panel carries its own close affordance', () => {
		const markup = renderHost({ p: 'ceramic-ball' })

		expect(markup).toContain('data-slot="product-detail-close"')
		expect(markup).toContain('aria-label="Close product"')
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

// ---------------------------------------------------------------------------
// Facet pills — the server's own counts, stable across filter selection
// ---------------------------------------------------------------------------

const SUGGESTED: BrowseFacet[] = [
	{ field: 'category_tags', value: 'pottery', count: 120, coverage: 0.3, filter: 'category_tags = "pottery"' },
	{ field: 'category_tags', value: 'ceramics', count: 94, filter: 'category_tags = "ceramics"' },
	{ field: 'currency', value: 'USD', count: 61, filter: 'currency = "USD"' },
]

describe('BrowseIndexHost facet pills', () => {
	test("renders the probe's market counts, not a count of the loaded window", () => {
		facetsData = SUGGESTED
		const markup = renderHost()

		// Two products loaded, but the pill states the market count (120).
		expect(markup).toContain('data-testid="widget-tag-badge-pottery"')
		expect(markup).toContain('120')
		expect(markup).toContain('data-testid="widget-tag-badge-USD"')
		expect(markup).toContain('61')
	})

	test('asks the unfiltered probe for the pills on a results state', () => {
		facetsData = SUGGESTED
		renderHost({ q: 'ceramic' })
		expect(facetsEnabled).toBe(true)
		expect(facetsQueryArg).toBe('ceramic')

		// No term and no tag: the idle index, not a results state — no probe.
		renderHost({ q: '' })
		expect(facetsEnabled).toBe(false)
	})

	test('keeps the pill list on the unfiltered probe while a filter is selected', () => {
		// A filtered search answers with its own, rotated facet list — the host
		// must not use it for the pills.
		searchData = {
			...RESULTS,
			suggested: [{ field: 'category_tags', value: 'rotated-away', count: 3 }],
		}
		facetsData = SUGGESTED

		const markup = renderHost({ tag: 'pottery' })

		expect(markup).toContain('data-testid="widget-tag-badge-pottery"')
		expect(markup).toContain('data-testid="widget-tag-badge-ceramics"')
		// The rotated set never renders.
		expect(markup).not.toContain('widget-tag-badge-rotated-away')
	})

	test('reveals the rest of the list from a real control, capped at six pills', () => {
		const eight: BrowseFacet[] = Array.from({ length: 8 }, (_, i) => ({
			field: 'category_tags',
			value: `cat-${i + 1}`,
			count: 100 - i,
			filter: `category_tags = "cat-${i + 1}"`,
		}))
		facetsData = eight

		const markup = renderHost()

		// Collapsed: the first six pills plus a real button to reveal the rest.
		expect(markup).toContain('data-testid="widget-tag-badge-cat-6"')
		expect(markup).not.toContain('data-testid="widget-tag-badge-cat-7"')
		expect(markup).toContain('data-testid="widget-browse-facets-more"')
		expect(markup).toContain('aria-expanded="false"')
		expect(markup).not.toContain('>more</span>')
	})

	test('shows no pills when the source states no facets', () => {
		facetsData = null
		const markup = renderHost()
		expect(markup).not.toContain('data-slot="browse-facets"')
	})
})

// ---------------------------------------------------------------------------
// Seller identity — the profile seam, with the pubkey fallback
// ---------------------------------------------------------------------------

describe('BrowseIndexHost seller identity', () => {
	test('renders the resolved seller name and picture when the profile resolves', () => {
		profileName = 'Porto Ceramics'
		profilePicture = 'https://example.test/avatar.png'

		const markup = renderHost()
		expect(markup).toContain('Porto Ceramics')
		expect(markup).toContain('src="https://example.test/avatar.png"')
	})

	test('falls back to the pubkey prefix and the tinted disc when no profile resolves', () => {
		const markup = renderHost()
		expect(markup).toContain('aaaaaaaa')
		expect(markup).toContain('data-slot="seller-avatar"')
		expect(markup).toContain('avatar-tint-')
	})
})

// ---------------------------------------------------------------------------
// The listing's own image and price unit reach the card
// ---------------------------------------------------------------------------

describe('BrowseIndexHost listing truth', () => {
	test("renders the listing's image tag as the shot, with art only as the fallback", () => {
		searchData = {
			...RESULTS,
			products: [{ ...RESULTS.products[0], image: 'https://example.test/mug.png' }, RESULTS.products[1]],
		}

		const markup = renderHost()
		expect(markup).toContain('src="https://example.test/mug.png"')
		// The imageless listing keeps the deterministic art tile.
		expect(markup).toContain('widget-product-art-')
	})

	test('renders a fiat listing in its own unit, never as sats', () => {
		searchData = {
			...RESULTS,
			products: [{ ...RESULTS.products[0], price: 53, currency: 'USD', image: undefined }, RESULTS.products[1]],
		}

		const markup = renderHost()
		expect(markup).toContain('53.00')
		expect(markup).toContain('USD')
		expect(markup).not.toContain('53 sats')
	})
})
