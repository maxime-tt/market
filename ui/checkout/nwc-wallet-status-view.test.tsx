import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NwcWalletStatusView } from './nwc-wallet-status-view'

describe('NwcWalletStatusView', () => {
	test('reports the connected wallet count and the shared footer', () => {
		const markup = renderToStaticMarkup(
			createElement(NwcWalletStatusView, {
				connected: true,
				connectedWalletCount: 2,
				settingsLink: createElement('a', { href: '/settings' }, 'settings'),
			}),
		)
		expect(markup).toContain('data-slot="nwc-wallet-status"')
		expect(markup).toContain('2 NWC wallets connected')
		expect(markup).toContain('bg-success')
		// One footer for both slots, not the two divergent sentences it replaced.
		expect(markup).toContain('Configure more wallets in settings')
	})

	test('uses the singular at one wallet and links to settings when disconnected', () => {
		const single = renderToStaticMarkup(
			createElement(NwcWalletStatusView, { connected: true, connectedWalletCount: 1, settingsLink: null }),
		)
		expect(single).toContain('1 NWC wallet connected')

		const off = renderToStaticMarkup(
			createElement(NwcWalletStatusView, {
				connected: false,
				connectedWalletCount: 0,
				settingsLink: createElement('a', { href: '/settings' }, 'settings'),
			}),
		)
		expect(off).toContain('Fast Payments available with NWC, setup in')
		expect(off).toContain('href="/settings"')
		expect(off).not.toContain('Configure more wallets')
	})

	test('merges host className', () => {
		const markup = renderToStaticMarkup(
			createElement(NwcWalletStatusView, { connected: false, connectedWalletCount: 0, settingsLink: null, className: 'mb-4' }),
		)
		expect(markup).toContain('mb-4')
	})
})
