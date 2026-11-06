/**
 * platform/web/browse/BrowseIndexHost.close.test.tsx — the panel's close action.
 *
 * The split-view wiring (`BrowseIndexHost.test.tsx`) shows the panel with the
 * close affordance; this file answers the question that markup cannot: does the
 * button the host hands the panel actually clear the open product (`?p=`)?
 *
 * `SplitView` is stubbed as a pass-through that records its `detail` slot, so
 * the host's own element — the `ProductDetailPanel` with the props the host
 * wired — is reachable and its `onClose` can be invoked without a DOM renderer.
 * Everything else the host reads is stubbed for the same reason it is in the
 * sibling file: the assertion is about the wiring, not the relays.
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { createElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { BrowseProduct, BrowseProductDetail, BrowseSearchResult } from './browseProductMap'

const PUBKEY_A = 'a'.repeat(64)

/** The open product the panel renders, and the search result it came from. */
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

mock.module('@platform/web/browse/browseQuery', () => ({
	useBrowseSearch: () => ({ data: RESULTS, isLoading: false, isError: false }),
	useBrowseProductDetail: () => ({ data: DETAIL, isLoading: false, isError: false, refetch: () => {} }),
	useBrowseFacets: () => ({ data: null, isLoading: false, isError: false }),
}))

mock.module('@platform/web/browse/browseIndexFeed', () => ({
	useBrowseIndexFeed: () => ({ data: null, isLoading: false, isError: false }),
	feedStrips: () => [],
}))

mock.module('@platform/web/auth/authStore', () => ({
	useAuth: () => ({ user: null, isAuthenticated: false }),
}))

mock.module('@platform/web/utils/clipboard', () => ({
	copyToClipboard: async () => {},
}))

// The seller-identity seam and the price-display path are reads too; stubbed so
// the host builds its cards and panel without a QueryClient or NDK behind it.
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

// The split is a pass-through here: it records the detail element the host
// built, and renders it, so the real panel and the host's own props are both
// under test. The split's own layout is covered by `ui/browse/split-view.test.tsx`.
let detailSlot: ReactNode = null

mock.module('@ui/browse/split-view', () => ({
	SplitView: (props: { master?: ReactNode; detail?: ReactNode; className?: string }) => {
		detailSlot = props.detail ?? null
		return createElement('div', { 'data-slot': 'split-view' }, props.master, props.detail)
	},
}))

import { BrowseIndexHost, type BrowseSearchState } from './BrowseIndexHost'

function renderClose(options: { q?: string; tag?: string; p?: string; onNavigate: (search: BrowseSearchState) => void }) {
	return renderToStaticMarkup(
		createElement(BrowseIndexHost, {
			q: options.q ?? 'ceramic',
			tag: options.tag,
			p: options.p ?? 'ceramic-ball',
			onNavigate: options.onNavigate,
			onNavigateFeatured: () => {},
		}),
	)
}

beforeEach(() => {
	detailSlot = null
})

describe('BrowseIndexHost panel close', () => {
	test("the panel's close button clears the open product and keeps the search", () => {
		const navigated: BrowseSearchState[] = []
		renderClose({ onNavigate: (search) => navigated.push(search) })

		const panel = detailSlot as ReactElement<{ onClose?: () => void }> | null
		expect(panel?.props.onClose).toBeFunction()
		panel?.props.onClose?.()

		expect(navigated).toEqual([{ q: 'ceramic', p: undefined, tag: undefined }])
	})

	test('the close keeps the active tag, so the category browse stays put', () => {
		const navigated: BrowseSearchState[] = []
		renderClose({ q: '', tag: 'pottery', onNavigate: (search) => navigated.push(search) })

		const panel = detailSlot as ReactElement<{ onClose?: () => void }> | null
		panel?.props.onClose?.()

		expect(navigated).toEqual([{ q: '', p: undefined, tag: 'pottery' }])
	})
})
