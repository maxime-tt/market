/**
 * ui/browse/split-view.test.tsx — Unit tests for the master–detail split.
 *
 * Uses bun:test + renderToStaticMarkup (react-dom/server), matching the
 * existing pattern in ui/browse/product-card.test.tsx. The split renders to
 * plain divs, so the frame's structure (two panes, the separator, the 55/45
 * ratio) is assertable without a browser — and so is the shrink: the master's
 * width and the detail's own animation, both keyed off the same width variable.
 */

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
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
		expect(markup).toContain('--split-detail-size:45%')
		// The number is the drag state; the *resolved* width is a variable in the
		// sheet so the phone's media query can pin it to 100%.
		expect(markup).toContain('[data-slot="split-view"] { --split-detail-width: var(--split-detail-size); }')
		expect(markup).toContain('lg:w-[var(--split-detail-width)]')
	})

	test('honours a custom master share', () => {
		const markup = renderToStaticMarkup(createElement(SplitView, { master: null, detail: null, masterSize: 40 }))
		expect(markup).toContain('--split-detail-size:60%')
	})

	test('the master shrinks and the detail slides in, both from one variable', () => {
		const markup = renderToStaticMarkup(createElement(SplitView, { master: null, detail: null }))
		// The master's width is the space the detail does not take: it reflows
		// rather than being translated out of the viewport.
		expect(markup).toContain('data-slot="split-master-pane"')
		// The width lives in the sheet's `lg` block now, so the phone can keep
		// the master at 100% (see the mobile tests below).
		expect(markup).toContain('width: calc(100% - var(--split-detail-width));')
		expect(markup).toContain('split-master-shrink')
		expect(markup).toContain('split-detail-in')
		// …and the motion is the injected keyframes, not a shift.
		expect(markup).toContain('@keyframes split-master-shrink')
		expect(markup).not.toContain('split-master-shift')
		expect(markup).not.toContain('translateX(calc(-1 * var(--split-detail-width)))')
	})

	test('marks the layout as a shrink, so a hidden panel never translates the master', () => {
		const markup = renderToStaticMarkup(createElement(SplitView, { master: null, detail: null }))
		// The reversal is explicit: the owner replaced the shift with a shrink,
		// because a translated master moved the hero search field off-centre.
		// Nothing in the split may offset the master horizontally.
		const masterPane = markup.slice(markup.indexOf('data-slot="split-master-pane"'), markup.indexOf('data-slot="split-master"'))
		expect(masterPane).not.toContain('translate')
		expect(masterPane).not.toContain('transform')
	})

	test('both panes are full-bleed — no side margins, only each pane’s own gutter', () => {
		const markup = renderToStaticMarkup(createElement(SplitView, { master: null, detail: null }))

		// The owner's deviation from the frame's `margin: 0 56px`: the split
		// carries no horizontal margin or padding of its own, so both panes reach
		// the viewport edges.
		const root = markup.slice(markup.indexOf('data-slot="split-view"'), markup.indexOf('data-slot="split-master-pane"'))
		expect(root).not.toContain('mx-')
		expect(root).not.toContain('px-')
		expect(root).not.toContain('margin')

		// Each pane keeps a symmetric inner gutter, so content is not glued to
		// the edge — the master's left and the detail's right included.
		const master = markup.slice(markup.indexOf('data-slot="split-master"'), markup.indexOf('data-slot="split-detail"'))
		expect(master).toContain('px-6.5')
		const detail = markup.slice(markup.indexOf('data-slot="split-detail"'), markup.indexOf('data-slot="split-separator"'))
		expect(detail).toContain('px-6.5')
	})

	test('applies extra classes to the wrapper', () => {
		const markup = renderToStaticMarkup(createElement(SplitView, { master: null, detail: null, className: 'h-[640px]' }))
		expect(markup).toContain('h-[640px]')
	})

	test('the detail is a full-width pushed view below `lg`, not a side pane', () => {
		const markup = renderToStaticMarkup(createElement(SplitView, { master: null, detail: null }))

		// Base (phone) shape: the pane covers the split — inset on every side and
		// the split's own width — and only gets the right-edge placement at `lg`.
		const detail = markup.slice(markup.indexOf('data-slot="split-detail"'), markup.indexOf('data-slot="split-separator"'))
		expect(detail).toContain('inset-0')
		expect(detail).toContain('w-full')
		expect(detail).toContain('lg:inset-y-0')
		expect(detail).toContain('lg:left-auto')
		expect(detail).toContain('lg:right-0')
		expect(detail).toContain('lg:border-l')
		// The right-edge placement must be unreachable below `lg`: `inset-y-0`
		// alone would leave `right-0` off and the pane would start at x=0 with
		// auto width… which is the pushed view. Assert the desktop shape is the
		// only one carrying the hairline and the explicit share.
		expect(detail).not.toMatch(/[^:]right-0/)

		// The split's own width resolves to 100% below 1024px, so the master is
		// never narrowed on a phone.
		expect(markup).toContain('@media (max-width: 1023.98px)')
		expect(markup).toContain('[data-slot="split-view"] { --split-detail-width: 100%; }')
	})

	test('the master keeps its whole width below `lg` and only shrinks above it', () => {
		const markup = renderToStaticMarkup(createElement(SplitView, { master: null, detail: null }))

		// The shrink is a desktop layout, so its width and animation live behind
		// the min-width query — never in the base rules, where it would squeeze
		// the list on a phone.
		const base = markup.slice(markup.indexOf('data-slot="split-master-pane"'), markup.indexOf('data-slot="split-master"'))
		expect(base).toContain('w-full')
		expect(base).not.toContain('animate-')
		// Covered by the pushed view, the master must leave the tab order and the
		// a11y tree on a phone — the split only exists with the detail open.
		expect(base).toContain('invisible')
		expect(base).toContain('lg:visible')

		expect(markup).toContain('@media (min-width: 1024px)')
		const desktop = markup.slice(markup.indexOf('@media (min-width: 1024px)'))
		expect(desktop).toContain('width: calc(100% - var(--split-detail-width))')
		expect(desktop).toContain('animation: split-master-shrink 300ms ease-out both')
		// Reduced motion keeps the end state, as the Tailwind class did.
		expect(markup).toContain('@media (min-width: 1024px) and (prefers-reduced-motion: reduce)')
	})

	test('the resize handle is a desktop-only affordance', () => {
		const markup = renderToStaticMarkup(createElement(SplitView, { master: null, detail: null }))
		const separator = markup.slice(markup.indexOf('data-slot="split-separator"'), markup.indexOf('data-slot="split-handle"'))

		// A 7px drag target must not exist on a phone: there is no divider in the
		// pushed view, and the handle would be a mis-tap magnet.
		expect(separator).toContain('hidden')
		expect(separator).toContain('lg:block')
	})

	test('renders the pushed view’s back bar only when the caller can dismiss', () => {
		const dismissible = renderToStaticMarkup(createElement(SplitView, { master: null, detail: null, onCloseDetail: () => {} }))
		expect(dismissible).toContain('data-slot="split-detail-back"')
		expect(dismissible).toContain('Back')
		// It is the phone's dismissal: the desktop split keeps the hairline × and
		// has no back bar of its own.
		expect(dismissible).toContain('lg:hidden')
		// The touch floor, per the audit's other findings.
		expect(dismissible).toContain('min-h-11')

		const notDismissible = renderToStaticMarkup(createElement(SplitView, { master: null, detail: null }))
		expect(notDismissible).not.toContain('data-slot="split-detail-back"')
	})

	test('the pushed view replaces the panel’s hairline close, which fails the touch floor', () => {
		const markup = renderToStaticMarkup(createElement(SplitView, { master: null, detail: null }))
		expect(markup).toContain('[data-slot="split-detail"] [data-slot="product-detail-header"] { display: none; }')
	})
})

describe('split-view geometry spec', () => {
	// The drawing is the durable reference the owner asked for: a committed sheet
	// with the fixed content column, the responsive panel and the gaps and
	// minimums annotated. These assertions keep it from drifting away from the
	// component it documents — every number in the sheet is one the component
	// holds, so changing the split has to change the drawing.
	const spec = readFileSync(new URL('./split-view-geometry.svg', import.meta.url), 'utf8')

	test('states the proportions and minimums the component enforces', () => {
		expect(spec).toContain('master · 55% default · min 30%')
		expect(spec).toContain('detail · 45% default · min 25% · max 70%')
		expect(spec).toContain('gutter 26px')
		expect(spec).toContain('hairline 1px · drag hit area 7px')
	})

	test('states the shrink and the breakpoint, not a translate', () => {
		expect(spec).toContain('shrink, never translate')
		expect(spec).toContain('below 1024px (lg)')
		expect(spec).not.toContain('translate(')
	})
})
