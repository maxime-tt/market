/**
 * ui/appbar/app-bar-view.test.tsx — the app bar's presentation.
 *
 * The bar takes every piece as a slot, so these cases assert the layout
 * contract the frame depends on: one root, the slots where they are placed, and
 * the phone-safety rules (`min-w-0` on the search wrapper, `hidden sm:flex` on
 * the list) that keep the bar from widening the page.
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

	test('the nav list yields its width to the field on a phone', () => {
		const markup = renderToStaticMarkup(createElement(AppBarView, { brand: BRAND, navItems: NAV }))
		const nav = markup.slice(markup.indexOf('data-slot="app-bar-nav"'), markup.indexOf('>', markup.indexOf('data-slot="app-bar-nav"')))
		expect(nav).toContain('hidden sm:flex')
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

		// A flex item's automatic minimum is its content's min-content width, so
		// without `min-w-0` this slot refuses to shrink below the search field
		// inside it and the whole page is pushed wider than the viewport.
		const slot = markup.slice(
			markup.indexOf('data-slot="search-slot"'),
			markup.indexOf('</div>', markup.indexOf('data-slot="search-slot"')),
		)
		expect(slot).toContain('flex-1')
		expect(slot).toContain('min-w-0')
	})

	test('renders the account slot', () => {
		const markup = renderToStaticMarkup(
			createElement(AppBarView, { brand: BRAND, accountSlot: createElement('div', { 'data-slot': 'test-account' }, 'account') }),
		)
		expect(markup).toContain('data-slot="account-slot"')
		expect(markup).toContain('test-account')
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
