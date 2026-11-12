import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ProductRowPicker } from './ProductRowPicker'

/**
 * The picker was committed truncated (a missing `</div>` closed a ternary but
 * not its wrapper), which made the file a hard syntax error for every `tsc`
 * run — and, because `tsc` stops at the first syntax error, silently hid the
 * rest of the project's type errors too.
 *
 * These tests are structural on purpose: they fail if the JSX stops being
 * balanced, and they pin the one behaviour that matters — a picked listing is
 * expressed as an explicit `30402:<pubkey>:<d>` coordinate, never a title.
 */

const render = (props: { onPick?: (c: string) => void; initialCoordinate?: string } = {}): string =>
	renderToStaticMarkup(
		createElement(ProductRowPicker, {
			onPick: props.onPick ?? (() => {}),
			initialCoordinate: props.initialCoordinate,
		}),
	)

describe('ProductRowPicker', () => {
	test('renders at rest without results', () => {
		const markup = render()
		expect(markup).toContain('Enter a search term to find products')
	})

	test('the search field is present and empty', () => {
		const markup = render()
		expect(markup).toContain('placeholder="Search for a product..."')
	})

	// The bug that was fixed: the results wrapper and the selected-product
	// block are siblings. A missing closing tag collapses one into the other,
	// so this asserts the selection block renders as its own sibling element.
	test('an initial coordinate renders the selected block as a sibling', () => {
		const coordinate = `30402:${'ab'.repeat(32)}:a-listing`
		const markup = render({ initialCoordinate: coordinate })
		expect(markup).toContain('Selected Product')
	})

	test('no coordinate means no selected block', () => {
		const markup = render({ initialCoordinate: undefined })
		expect(markup).not.toContain('Selected Product')
	})

	// Editing an existing page whose listing is not in the current results
	// must not silently drop the reference: the coordinate stays visible and
	// the row says it could not be resolved.
	test('a selected coordinate is shown even when it is not in the results', () => {
		const coordinate = `30402:${'cd'.repeat(32)}:not-in-results`
		const markup = render({ initialCoordinate: coordinate })
		expect(markup).toContain('Selected Product')
		expect(markup).toContain(coordinate)
		expect(markup).toContain('Not in the current results')
	})
})
