/**
 * ui/browse/list-views.test.tsx — Unit tests for RelayIndicator,
 * DeadSearchError, ListRow, and ListDetail.
 *
 * Uses bun:test + renderToStaticMarkup (react-dom/server), matching the
 * existing test pattern in ui/products/product-search-results.test.tsx.
 */

import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
	RelayIndicator,
	DeadSearchError,
	ListRow,
	ListDetail,
	type RelayDetail,
	type ListDetailProps,
	type ListRowItem,
} from './list-views'

// ---------------------------------------------------------------------------
// RelayIndicator
// ---------------------------------------------------------------------------

describe('RelayIndicator', () => {
	test('renders minimal indicator with responded count', () => {
		const markup = renderToStaticMarkup(
			createElement(RelayIndicator, {
				responded: 3,
				totalProducts: 42,
			}),
		)
		expect(markup).toContain('widget-relay-indicator')
		expect(markup).toContain('3 relays responded')
		expect(markup).toContain('42')
	})

	test('renders expand button when onToggle provided with relays', () => {
		const relays: RelayDetail[] = [
			{ relay: 'wss://r1.example', count: 10, status: 'responded' },
			{ relay: 'wss://r2.example', count: 0, status: 'timeout' },
		]
		const markup = renderToStaticMarkup(
			createElement(RelayIndicator, {
				responded: 3,
				totalProducts: 42,
				relays,
				onToggle: () => {},
			}),
		)
		expect(markup).toContain('widget-relay-indicator-expand')
	})

	test('renders summary counts from relays array', () => {
		const relays: RelayDetail[] = [
			{ relay: 'wss://r1.example', count: 10, status: 'responded' },
			{ relay: 'wss://r2.example', count: 0, status: 'timeout' },
			{ relay: 'wss://r3.example', count: 0, status: 'refused' },
		]
		const markup = renderToStaticMarkup(
			createElement(RelayIndicator, {
				responded: 1,
				totalProducts: 10,
				relays,
			}),
		)
		expect(markup).toContain('widget-relay-indicator')
		expect(markup).toContain('1 relay responded')
	})

	test('renders with custom className', () => {
		const markup = renderToStaticMarkup(
			createElement(RelayIndicator, {
				responded: 2,
				totalProducts: 20,
				className: 'custom-indicator-class',
			}),
		)
		expect(markup).toContain('custom-indicator-class')
	})
})

// ---------------------------------------------------------------------------
// DeadSearchError
// ---------------------------------------------------------------------------

describe('DeadSearchError', () => {
	test('renders error panel with default message', () => {
		const markup = renderToStaticMarkup(
			createElement(DeadSearchError, {
				totalRelays: 3,
				timeoutCount: 2,
				refusedCount: 1,
			}),
		)
		expect(markup).toContain('widget-dead-search-error')
		expect(markup).toContain('All relays failed')
	})

	test('renders error panel with custom message', () => {
		const markup = renderToStaticMarkup(
			createElement(DeadSearchError, {
				totalRelays: 2,
				timeoutCount: 2,
				refusedCount: 0,
				message: 'Custom error message',
			}),
		)
		expect(markup).toContain('widget-dead-search-error')
		expect(markup).toContain('Custom error message')
	})

	test('renders retry button when onRetry provided', () => {
		const markup = renderToStaticMarkup(
			createElement(DeadSearchError, {
				totalRelays: 3,
				timeoutCount: 3,
				refusedCount: 0,
				onRetry: () => {},
			}),
		)
		expect(markup).toContain('widget-dead-search-error-retry')
	})

	test('renders with custom className', () => {
		const markup = renderToStaticMarkup(
			createElement(DeadSearchError, {
				totalRelays: 1,
				timeoutCount: 1,
				refusedCount: 0,
				className: 'custom-error-class',
			}),
		)
		expect(markup).toContain('custom-error-class')
	})
})

// ---------------------------------------------------------------------------
// ListRow
// ---------------------------------------------------------------------------

describe('ListRow', () => {
	function makeItem(opts: Partial<ListRowItem> = {}) {
		return {
			id: 'list-1',
			name: 'My List',
			itemCount: 5,
			privacy: 'public',
			...opts,
		} as ListRowItem
	}

	test('renders list row with all info', () => {
		const markup = renderToStaticMarkup(createElement(ListRow, { item: makeItem() }))
		expect(markup).toContain('widget-list-row-list-1')
		expect(markup).toContain('My List')
		expect(markup).toContain('5 items')
		expect(markup).toContain('list-row-arrow')
	})

	test('renders privacy chip for private list', () => {
		const markup = renderToStaticMarkup(
			createElement(ListRow, {
				item: makeItem({ id: 'list-2', name: 'Secret List', privacy: 'private' }),
			}),
		)
		expect(markup).toContain('widget-list-row-list-2')
		expect(markup).toContain('Private')
	})

	test('renders with custom className', () => {
		const markup = renderToStaticMarkup(
			createElement(ListRow, {
				item: makeItem({ id: 'list-3', name: 'Test' }),
				className: 'custom-list-row-class',
			}),
		)
		expect(markup).toContain('custom-list-row-class')
	})
})

// ---------------------------------------------------------------------------
// ListDetail
// ---------------------------------------------------------------------------

describe('ListDetail', () => {
	test('renders list detail with all sections', () => {
		const markup = renderToStaticMarkup(
			createElement(ListDetail, {
				name: 'Test List',
				privacyLabel: 'Public',
				owner: 'Test Seller',
				ownerNpub: 'npub1test',
				itemCount: 10,
				shownItems: 10,
				totalItems: 10,
			}),
		)
		expect(markup).toContain('widget-list-detail')
		expect(markup).toContain('list-eyebrow')
		expect(markup).toContain('list-head')
		expect(markup).toContain('Test List')
		expect(markup).toContain('widget-list-detail-add-items')
		expect(markup).toContain('widget-list-detail-copy-link')
	})

	test('renders with privacy chip', () => {
		const markup = renderToStaticMarkup(
			createElement(ListDetail, {
				name: 'Private List',
				privacyLabel: 'Private',
				owner: 'OwnerName',
				ownerNpub: 'npub1owner',
				itemCount: 5,
				shownItems: 5,
				totalItems: 5,
			}),
		)
		expect(markup).toContain('widget-list-detail')
		expect(markup).toContain('Private')
	})

	test('renders owner and npub', () => {
		const markup = renderToStaticMarkup(
			createElement(ListDetail, {
				name: 'Owner List',
				owner: 'OwnerName',
				ownerNpub: 'npub1abc',
				itemCount: 1,
				shownItems: 1,
				totalItems: 1,
			}),
		)
		expect(markup).toContain('widget-list-detail')
		expect(markup).toContain('OwnerName')
		expect(markup).toContain('npub1abc')
	})

	test('renders with custom className', () => {
		const markup = renderToStaticMarkup(
			createElement(ListDetail, {
				name: 'Custom',
				owner: 'OwnerName',
				ownerNpub: 'npub1owner',
				itemCount: 1,
				shownItems: 1,
				totalItems: 1,
				className: 'custom-list-detail-class',
			}),
		)
		expect(markup).toContain('custom-list-detail-class')
	})
})
