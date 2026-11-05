/**
 * ui/browse/list-views.test.tsx — Unit tests for ListRow and ListDetail.
 *
 * Uses bun:test + renderToStaticMarkup (react-dom/server), matching the
 * existing test pattern in ui/products/product-search-results.test.tsx.
 */

import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ListRow, ListDetail, type ListDetailProps, type ListRowItem } from './list-views'

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
