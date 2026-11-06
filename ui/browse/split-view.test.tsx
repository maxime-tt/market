/**
 * ui/browse/split-view.test.tsx — Unit tests for the master–detail split.
 *
 * Uses bun:test + renderToStaticMarkup (react-dom/server), matching the
 * existing pattern in ui/browse/product-card.test.tsx. The split renders to
 * plain divs, so the frame's structure (two panes, the separator, the 55/45
 * ratio) is assertable without a browser — and so is the shift: the master's
 * animation and the detail's own, both keyed off the same width variable.
 */

import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SplitView } from './split-view'

describe('SplitView', () => {
	test('renders both panes and the separator', () => {
		const markup = renderToStaticMarkup(
			createElement(SplitView, {
				master: createElement('div', null, 'MASTER-LIST'),
				detail: createElement('div', null, 'DETAIL-PANEL'),
			}),
		)
		expect(markup).toContain('MASTER-LIST')
		expect(markup).toContain('DETAIL-PANEL')
		expect(markup).toContain('data-slot="split-master"')
		expect(markup).toContain('data-slot="split-detail"')
		expect(markup).toContain('data-slot="split-separator"')
	})

	test("separator is a resize handle with the frame's pill", () => {
		const markup = renderToStaticMarkup(createElement(SplitView, { master: null, detail: null }))
		expect(markup).toContain('role="separator"')
		expect(markup).toContain('aria-label="Resize panes"')
		expect(markup).toContain('data-slot="split-handle"')
		// Keyboard resize is the separator's own affordance, as the library's was.
		expect(markup).toContain('tabindex="0"')
	})

	test("panes default to the frame's 55/45 split", () => {
		const markup = renderToStaticMarkup(createElement(SplitView, { master: null, detail: null }))
		// The master's share is 55, so the detail pane the shift opens is 45 wide.
		expect(markup).toContain('--split-detail-width:45%')
		expect(markup).toContain('width:var(--split-detail-width)')
	})

	test('honours a custom master share', () => {
		const markup = renderToStaticMarkup(createElement(SplitView, { master: null, detail: null, masterSize: 40 }))
		expect(markup).toContain('--split-detail-width:60%')
	})

	test('the master shifts and the detail slides in, both from one variable', () => {
		const markup = renderToStaticMarkup(createElement(SplitView, { master: null, detail: null }))
		// The master's shift is the detail's width: it keeps its own width/columns.
		expect(markup).toContain('data-slot="split-shift"')
		expect(markup).toContain('transform:translateX(calc(-1 * var(--split-detail-width)))')
		expect(markup).toContain('split-master-shift')
		expect(markup).toContain('split-detail-in')
		// …and the motion is the injected keyframes, not a reflow of the grid.
		expect(markup).toContain('@keyframes split-detail-in')
	})

	test('applies extra classes to the wrapper', () => {
		const markup = renderToStaticMarkup(createElement(SplitView, { master: null, detail: null, className: 'h-[640px]' }))
		expect(markup).toContain('h-[640px]')
	})
})
