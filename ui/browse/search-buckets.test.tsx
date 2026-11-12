/**
 * ui/browse/search-buckets.test.tsx — the bucket line and the capped-scan disclosure.
 *
 * Uses bun:test + renderToStaticMarkup (react-dom/server), matching the existing
 * pattern in `relay-error.test.tsx` and `product-detail-panel.test.tsx`. A click
 * is asserted against the component's own element tree — the handlers are not in
 * server markup, so "clicking the seller bucket narrows by the seller" can only
 * be shown by walking the tree and invoking the prop the browser would invoke.
 */

import { describe, expect, test } from 'bun:test'
import { createElement, isValidElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ScanTruncationNotice, SearchBucketLine, isBucketActive, type Bucket } from './search-buckets'

// ---------------------------------------------------------------------------
// Tree walking — the only way to reach a handler in a props-only component
// ---------------------------------------------------------------------------

interface WalkedElement {
	type: unknown
	props: Record<string, unknown>
}

/**
 * Depth-first walk over a component's element tree.
 *
 * `unknown` in and out on purpose: a React 19 component's return type is
 * `ReactNode | Promise<ReactNode>`, and this walker handles elements only — the
 * parameter states "anything the caller rendered" rather than narrowing a type
 * the component's own signature does not narrow.
 */
function walk(node: unknown, visit: (element: WalkedElement) => void): void {
	if (Array.isArray(node)) {
		for (const child of node) walk(child as unknown, visit)
		return
	}
	if (!isValidElement(node)) return
	const element = node as unknown as WalkedElement
	visit(element)
	walk(element.props.children, visit)
}

/** The first element whose `prop` equals `value` — a bucket pill, by its label. */
function findByProp(tree: unknown, prop: string, value: unknown): WalkedElement | undefined {
	let found: WalkedElement | undefined
	walk(tree, (element) => {
		if (!found && element.props[prop] === value) found = element
	})
	return found
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SELLER = 'b'.repeat(64)

const BUCKETS: Bucket[] = [
	{ dimension: 'category_tags', value: 'bitcoin', count: 1100, share: 0.65 },
	{ dimension: 'label_tags', value: 'satoshoes', count: 253, share: 0.15 },
	{ dimension: 'seller', value: SELLER, count: 264, share: 0.157, label: 'Satoshi Shoes' },
]

// ---------------------------------------------------------------------------
// The bucket line
// ---------------------------------------------------------------------------

describe('SearchBucketLine', () => {
	test('renders a tag group and a seller group', () => {
		const markup = renderToStaticMarkup(createElement(SearchBucketLine, { buckets: BUCKETS, query: 'bitcoin', onNarrow: () => {} }))

		expect(markup).toContain('data-group="tags"')
		expect(markup).toContain('data-group="sellers"')
		// Each group states what it is: a seller pill reading "Satoshi Shoes 264"
		// is otherwise indistinguishable from a tag.
		expect(markup).toContain('Tags')
		expect(markup).toContain('Sellers')
	})

	test('a seller bucket shows the display name and its own count', () => {
		const markup = renderToStaticMarkup(createElement(SearchBucketLine, { buckets: BUCKETS, query: 'bitcoin', onNarrow: () => {} }))

		expect(markup).toContain('Satoshi Shoes')
		expect(markup).toContain('264')
	})

	test('activating the seller bucket narrows by the seller value, not the name', () => {
		const narrowed: string[] = []
		const tree = SearchBucketLine({ buckets: BUCKETS, query: 'bitcoin', onNarrow: (value) => narrowed.push(value) })

		const pill = findByProp(tree, 'label', 'Satoshi Shoes')
		expect(pill).toBeDefined()
		;(pill?.props as { onChoose?: () => void }).onChoose?.()

		expect(narrowed).toEqual([SELLER])
	})

	test('activating a tag bucket narrows by the tag value — the same mechanism', () => {
		const narrowed: string[] = []
		const tree = SearchBucketLine({ buckets: BUCKETS, query: 'bitcoin', onNarrow: (value) => narrowed.push(value) })

		const pill = findByProp(tree, 'label', 'satoshoes')
		expect(pill).toBeDefined()
		;(pill?.props as { onChoose?: () => void }).onChoose?.()

		expect(narrowed).toEqual(['satoshoes'])
	})

	test('shows at most four buckets per group', () => {
		const many: Bucket[] = Array.from({ length: 7 }, (_, index) => ({
			dimension: 'category_tags',
			value: `tag-${index}`,
			count: 10 - index,
		}))
		const markup = renderToStaticMarkup(createElement(SearchBucketLine, { buckets: many, query: '', onNarrow: () => {} }))

		expect(markup).toContain('tag-3')
		expect(markup).not.toContain('tag-4')
	})

	test('a value the query already contains is the active state', () => {
		const markup = renderToStaticMarkup(
			createElement(SearchBucketLine, { buckets: BUCKETS, query: 'bitcoin satoshoes', onNarrow: () => {} }),
		)

		// The pill carries `aria-pressed` only when it matches the query, so the
		// assertion is on the pressed pill's own render, not on a class name.
		expect(markup).toContain('aria-pressed="true"')
	})

	test('fewer than two buckets renders no line — a lone pill is not a narrowing choice', () => {
		const markup = renderToStaticMarkup(createElement(SearchBucketLine, { buckets: [BUCKETS[0]], query: 'bitcoin', onNarrow: () => {} }))

		expect(markup).toBe('')
	})
})

describe('isBucketActive', () => {
	test('matches a whole token, never a prefix of another word', () => {
		expect(isBucketActive('art', 'art')).toBe(true)
		expect(isBucketActive('artisan market', 'art')).toBe(false)
		expect(isBucketActive('BITCOIN', 'bitcoin')).toBe(true)
	})

	test('matches a multi-word value as a phrase', () => {
		expect(isBucketActive('rare sats from japan', 'rare sats')).toBe(true)
	})
})

// ---------------------------------------------------------------------------
// The capped-scan disclosure
// ---------------------------------------------------------------------------

describe('ScanTruncationNotice', () => {
	test('states the cap and the way past it when the scan was truncated', () => {
		const markup = renderToStaticMarkup(
			createElement(ScanTruncationNotice, { truncated: true, scanned: 5000, total: 6000, onRefine: () => {} }),
		)

		expect(markup).toContain('data-slot="scan-truncation"')
		expect(markup).toContain('first 5,000')
		expect(markup).toContain('Refining')
		expect(markup).toContain('widget-scan-truncation-refine')
		// A disclosure with an affordance — never an error.
		expect(markup).not.toContain('data-slot="dead-search-error"')
		expect(markup).not.toContain('role="alert"')
	})

	test('renders nothing when the scan was not truncated', () => {
		const markup = renderToStaticMarkup(createElement(ScanTruncationNotice, { truncated: false, scanned: 1200, total: 1200 }))

		expect(markup).toBe('')
	})

	test('the refine affordance invokes the caller’s handler', () => {
		let refined = 0
		const tree = ScanTruncationNotice({ truncated: true, scanned: 5000, onRefine: () => (refined += 1) })
		const button = findByProp(tree, 'data-testid', 'widget-scan-truncation-refine')

		expect(button).toBeDefined()
		;(button?.props as { onClick?: () => void }).onClick?.()
		expect(refined).toBe(1)
	})
})
