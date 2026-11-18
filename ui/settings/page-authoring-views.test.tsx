import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PageChromeControl, PageLabelChips, type PageLabelView } from './page-authoring-views'

/**
 * The presentation-intent surface: a page row says which of the two looks the
 * page has, and the builder's control is a switch over exactly those two values.
 *
 * Rendered to static markup, as the rest of this cluster's tests are — the
 * value here is that the state is *visible*, not that a click handler fires
 * (the builder owns the handler and the draft write).
 */

/** A row, as the host's `describePage` produces it. */
const label = (over: Partial<PageLabelView> = {}): PageLabelView => ({
	name: 'featured-13-11-2026',
	authorLabel: 'deadbeef…cafe',
	enabled: true,
	isDefault: false,
	chrome: 'app',
	...over,
})

describe('page authoring views — presentation intent', () => {
	test('a row says which of the two looks the page has', () => {
		expect(renderToStaticMarkup(createElement(PageLabelChips, { label: label() }))).toContain('App chrome')
		expect(renderToStaticMarkup(createElement(PageLabelChips, { label: label({ chrome: 'standalone' }) }))).toContain('Standalone')
	})

	test('the chrome control reflects the current intent and carries the switch the builder wires', () => {
		const on = renderToStaticMarkup(createElement(PageChromeControl, { chrome: 'app', onChange: () => {} }))
		expect(on).toContain('data-testid="page-chrome-toggle"')
		expect(on).toContain('aria-checked="true"')
		expect(on).toContain('App chrome')

		const off = renderToStaticMarkup(createElement(PageChromeControl, { chrome: 'standalone', onChange: () => {} }))
		expect(off).toContain('aria-checked="false"')
		expect(off).toContain('Standalone')
		// The hint states what opting out actually does — the author is choosing
		// whether the page keeps the app's header, footer, cart and navigation.
		expect(off).toContain('without the app')
	})

	test('the control is disabled while a publish is in flight', () => {
		const markup = renderToStaticMarkup(createElement(PageChromeControl, { chrome: 'app', onChange: () => {}, disabled: true }))
		expect(markup).toContain('disabled')
	})
})
