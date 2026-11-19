/**
 * ui/appbar/app-bar-view.test.tsx — the app bar's presentation.
 *
 * The bar takes every piece as a slot, so these cases assert the layout
 * contract the frame depends on: one root, the slots where they are placed, and
 * the phone-safety rules (`min-w-0` on the search wrapper) that keep the bar from
 * widening the page. The centring is a structural fact — three equal tracks — so
 * it is pinned as classes, not as a pixel measurement (jsdom has no layout).
 *
 * Identity (instance name, logo) and the nav data live in the host; they are
 * covered by `platform/web/layout/AppBar.test.tsx`.
 */

import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AppBarView } from './app-bar-view'

/** A stand-in for the wordmark anchor the host builds. */
const BRAND = createElement('a', { href: '/', 'data-slot': 'wordmark-link' }, 'Test Market')

/** A stand-in for the shared nav list the host builds. */
const NAV = [createElement('a', { key: 'products', href: '/products' }, 'Products')]

/** The opening tag of the element that carries `marker`, as written. */
function openingTag(markup: string, marker: string): string {
	const at = markup.indexOf(marker)
	if (at === -1) return ''
	return markup.slice(markup.lastIndexOf('<', at), markup.indexOf('>', at))
}

describe('AppBarView', () => {
	test('renders one bar root with the brand slot', () => {
		const markup = renderToStaticMarkup(createElement(AppBarView, { brand: BRAND }))

		expect(markup).toContain('data-slot="app-bar"')
		expect(markup).toContain('data-testid="widget-app-bar"')
		expect(markup).toContain('data-slot="wordmark-link"')
		expect(markup.split('<header').length - 1).toBe(1)
	})

	test('renders the nav items inside one nav', () => {
		const markup = renderToStaticMarkup(createElement(AppBarView, { brand: BRAND, navItems: NAV }))

		expect(markup).toContain('data-slot="app-bar-nav"')
		expect(markup).toContain('href="/products"')
		expect(markup.split('<nav').length - 1).toBe(1)
	})

	test('lays the three slots out as three equal tracks, so the field is centred in the bar', () => {
		const markup = renderToStaticMarkup(
			createElement(AppBarView, {
				brand: BRAND,
				navItems: NAV,
				searchSlot: createElement('div', { 'data-slot': 'test-search' }, 'search'),
				accountSlot: createElement('div', { 'data-slot': 'test-account' }, 'account'),
			}),
		)
		const bar = openingTag(markup, 'data-slot="app-bar"')

		expect(bar).toContain('grid')
		// Equal side tracks are what makes the middle track's centre the bar's
		// centre — with unequal ones the field would again be centred in the space
		// left over after the brand/nav and the account cluster.
		expect(bar).toContain('sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]')
		// On a phone the brand keeps its width and the field takes the remainder.
		expect(bar).toContain('grid-cols-[auto_minmax(0,1fr)_auto]')

		// Each slot is pinned to its track, so a missing slot cannot shift the
		// others into the middle or off the end.
		expect(openingTag(markup, 'data-slot="app-bar-left"')).toContain('col-start-1')
		expect(openingTag(markup, 'data-slot="search-slot"')).toContain('col-start-2')
		expect(openingTag(markup, 'data-slot="account-slot"')).toContain('col-start-3')
	})

	test('the nav list is hidden until the bar can hold it beside a centred field', () => {
		const markup = renderToStaticMarkup(createElement(AppBarView, { brand: BRAND, navItems: NAV }))
		const nav = openingTag(markup, 'data-slot="app-bar-nav"')

		// A third of the bar has to fit the brand and the whole list before the list
		// can sit beside a centred field; below that the host's menu carries it.
		expect(nav).toContain('hidden')
		expect(nav).toContain('xl:flex')
		// It wraps inside its lane instead of clipping a destination.
		expect(nav).toContain('flex-wrap')
	})

	test('omits the nav list when no items are given', () => {
		const markup = renderToStaticMarkup(createElement(AppBarView, { brand: BRAND }))
		expect(markup).not.toContain('data-slot="app-bar-nav"')
	})

	test('renders the search slot', () => {
		const markup = renderToStaticMarkup(
			createElement(AppBarView, { brand: BRAND, searchSlot: createElement('div', { 'data-slot': 'test-search' }, 'search') }),
		)
		expect(markup).toContain('data-slot="search-slot"')
		expect(markup).toContain('test-search')
	})

	test('the search slot can shrink, so nothing in it can widen the page', () => {
		const markup = renderToStaticMarkup(createElement(AppBarView, { brand: BRAND, searchSlot: createElement('div', null, 'f') }))
		const slot = openingTag(markup, 'data-slot="search-slot"')

		// A grid item's automatic minimum is its content's min-content width, so
		// without `min-w-0` this slot refuses to shrink below the search field
		// inside it and the whole page is pushed wider than the viewport. It must
		// sit on the *wrapper* — a `min-w-0` on the field alone cannot beat an
		// ancestor that still refuses to shrink.
		expect(slot).toContain('min-w-0')
		// `w-full` gives the field's own `w-full` a definite container to resolve
		// against; without it the field is sized by its content again.
		expect(slot).toContain('w-full')
		expect(slot).toContain('justify-center')
	})

	test('renders the account slot', () => {
		const markup = renderToStaticMarkup(
			createElement(AppBarView, { brand: BRAND, accountSlot: createElement('div', { 'data-slot': 'test-account' }, 'account') }),
		)
		expect(markup).toContain('data-slot="account-slot"')
		expect(markup).toContain('test-account')
		expect(openingTag(markup, 'data-slot="account-slot"')).toContain('justify-self-end')
	})

	test('on a phone the search takes its own full-width row, and the row collapses when empty', () => {
		const markup = renderToStaticMarkup(
			createElement(AppBarView, {
				brand: BRAND,
				navItems: NAV,
				searchSlot: createElement('div', { 'data-slot': 'test-search' }, 'search'),
				accountSlot: createElement('div', { 'data-slot': 'test-account' }, 'account'),
			}),
		)
		const bar = openingTag(markup, 'data-slot="app-bar"')

		// Two rows below `sm`; one from `sm` up.
		expect(bar).toContain('grid-rows-[auto_auto]')
		expect(bar).toContain('sm:grid-rows-1')
		// A `min-h`, not a fixed `h`: the phone bar grows by the field's own row.
		expect(bar).toContain('min-h-16')

		// The search leaves the middle track for a full-width second row on a
		// phone, and returns to the middle track from `sm` up.
		const slot = openingTag(markup, 'data-slot="search-slot"')
		expect(slot).toContain('col-start-1')
		expect(slot).toContain('col-end-3')
		expect(slot).toContain('row-start-2')
		expect(slot).toContain('sm:col-start-2')
		expect(slot).toContain('sm:col-end-3')
		expect(slot).toContain('sm:row-start-1')
		// The phone-safety rules stay on the slot.
		expect(slot).toContain('min-w-0')
		expect(slot).toContain('w-full')

		// The brand and the account cluster stay on the first row.
		expect(openingTag(markup, 'data-slot="app-bar-left"')).toContain('row-start-1')
		expect(openingTag(markup, 'data-slot="account-slot"')).toContain('row-start-1')

		// No field mounted ⇒ no second row and no extra height: the row is an
		// empty `auto` track, and the slot itself is not rendered.
		const bare = renderToStaticMarkup(createElement(AppBarView, { brand: BRAND, accountSlot: createElement('div', null, 'account') }))
		expect(bare).not.toContain('data-slot="search-slot"')
	})

	test('the brand can shrink, so a long instance name ellipsises instead of shearing', () => {
		const markup = renderToStaticMarkup(createElement(AppBarView, { brand: BRAND }))
		expect(openingTag(markup, 'data-slot="brand"')).toContain('min-w-0')
		expect(openingTag(markup, 'data-slot="brand"')).not.toContain('shrink-0')
	})

	test('accepts custom className', () => {
		const markup = renderToStaticMarkup(createElement(AppBarView, { brand: BRAND, className: 'custom-class' }))
		expect(markup).toContain('custom-class')
	})

	test('is token-driven, so the arena scope re-skins it without a branch', () => {
		const markup = renderToStaticMarkup(createElement(AppBarView, { brand: BRAND, className: 'custom-class' }))
		// The bar reads the widget role tokens and nothing pathname-dependent.
		expect(markup).toContain('bg-background')
		expect(markup).toContain('border-border-default')
		expect(markup).not.toContain('arena')
	})
})
