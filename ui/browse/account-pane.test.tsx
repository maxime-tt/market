/**
 * ui/browse/account-pane.test.tsx — Unit tests for AccountPane.
 *
 * Uses bun:test + renderToStaticMarkup (react-dom/server), matching the
 * existing test pattern in ui/products/product-search-results.test.tsx.
 */

import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AccountPane } from './account-pane'

function makePane(opts: Partial<Parameters<typeof AccountPane>[0]> = {}) {
	return {
		name: 'Test User',
		npub: 'npub1test123',
		avatarInitial: 'TU',
		signedInWith: 'NostrSigner',
		balance: 10000,
		onTopUp: () => {},
		onWithdraw: () => {},
		onTransactions: () => {},
		onConnectNWC: () => {},
		onOrders: () => {},
		onNotifications: () => {},
		onSavedLists: () => {},
		onSignOut: () => {},
		...opts,
	}
}

// ---------------------------------------------------------------------------
// AccountPane
// ---------------------------------------------------------------------------

describe('AccountPane', () => {
	test('renders account pane with all sections', () => {
		const markup = renderToStaticMarkup(createElement(AccountPane, makePane()))
		expect(markup).toContain('widget-account-pane')
		expect(markup).toContain('widget-account-pane-top-up')
		expect(markup).toContain('widget-account-pane-withdraw')
		expect(markup).toContain('widget-account-pane-transactions')
		expect(markup).toContain('widget-account-pane-connect-nwc')
		expect(markup).toContain('widget-account-pane-orders')
		expect(markup).toContain('widget-account-pane-notifications')
		expect(markup).toContain('widget-account-pane-saved-lists')
		expect(markup).toContain('widget-account-pane-sign-out')
		expect(markup).toContain('widget-account-pane-sign-out-btn')
	})

	test('renders with balance amount', () => {
		const markup = renderToStaticMarkup(createElement(AccountPane, makePane({ balance: 123456 })))
		expect(markup).toContain('widget-account-pane')
		expect(markup).toContain('123,456')
	})

	test('renders with avatar initial', () => {
		const markup = renderToStaticMarkup(createElement(AccountPane, makePane({ avatarInitial: 'TU' })))
		expect(markup).toContain('widget-account-pane')
		expect(markup).toContain('TU')
	})

	test('renders with sign-in method', () => {
		const markup = renderToStaticMarkup(createElement(AccountPane, makePane({ signedInWith: 'Alby' })))
		expect(markup).toContain('Alby')
	})

	test('renders with custom className', () => {
		const markup = renderToStaticMarkup(createElement(AccountPane, makePane({ className: 'custom-pane-class' })))
		expect(markup).toContain('custom-pane-class')
	})

	test('renders with npub display', () => {
		const markup = renderToStaticMarkup(createElement(AccountPane, makePane({ npub: 'npub1abcdef123456' })))
		expect(markup).toContain('npub1abcdef123456')
	})
})
