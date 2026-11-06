/**
 * ui/browse/split-view.test.tsx — Unit tests for the master–detail split.
 *
 * Uses bun:test + renderToStaticMarkup (react-dom/server), matching the
 * existing pattern in ui/browse/product-card.test.tsx. `Group`/`Panel`/
 * `Separator` render server-side to plain divs, so the frame's structure
 * (two panels, a separator, the master/detail ratio) is assertable without a
 * browser.
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
		expect(markup).toContain('data-group="true"')
		expect(markup.match(/data-panel="true"/g)?.length).toBe(2)
		expect(markup).toContain('data-slot="split-master"')
		expect(markup).toContain('data-slot="split-detail"')
		expect(markup).toContain('data-slot="split-separator"')
	})

	test("separator is a resize handle with the frame's pill", () => {
		const markup = renderToStaticMarkup(createElement(SplitView, { master: null, detail: null }))
		expect(markup).toContain('role="separator"')
		expect(markup).toContain('aria-label="Resize panes"')
		expect(markup).toContain('data-slot="split-handle"')
	})

	test("panes default to the frame's 55/45 split", () => {
		const markup = renderToStaticMarkup(createElement(SplitView, { master: null, detail: null }))
		expect(markup).toContain('flex-basis:55%')
		expect(markup).toContain('flex-basis:45%')
	})

	test('honours a custom master share', () => {
		const markup = renderToStaticMarkup(createElement(SplitView, { master: null, detail: null, masterSize: 40 }))
		expect(markup).toContain('flex-basis:40%')
		expect(markup).toContain('flex-basis:60%')
	})

	test('applies extra classes to the wrapper', () => {
		const markup = renderToStaticMarkup(createElement(SplitView, { master: null, detail: null, className: 'h-[640px]' }))
		expect(markup).toContain('h-[640px]')
	})
})
