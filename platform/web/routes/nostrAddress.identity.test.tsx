/**
 * platform/web/routes/nostrAddress.identity.test.tsx — the NIP-05 page must gate on the auth
 * machine's identity, not on `ndk.activeUser`.
 *
 * Regression pinned here: `NostrAddressComponent` read `ndk?.activeUser?.pubkey`, which is
 * permanently `undefined`, so the early return rendered "Please connect your Nostr account" for
 * everyone — the whole page, including its paid NIP-05 purchase flow, was unreachable.
 *
 * The page is asserted through its two observable bodies, not through the hook: with a user the body
 * renders (the settings read is still loading, which is enough to prove the gate opened); signed out
 * the connect prompt renders. Same read for `vanity-url.tsx` and `profile.tsx` (identical three
 * lines) — covered by grep plus the review, not by two more route suites.
 */
import { describe, expect, mock, test } from 'bun:test'
import { Store } from '@tanstack/store'
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const PUBKEY = 'a1'.repeat(32)

interface AuthState {
	user: { pubkey: string } | null
}

const authState = new Store<AuthState>({ user: null })

mock.module('@platform/web/readContext', () => ({
	authStore: authState,
}))

mock.module('@platform/web/ndk/ndkStore', () => ({
	ndkActions: { getNDK: () => null },
}))

mock.module('@platform/web/app/dashboardTitle', () => ({
	useDashboardTitle: () => {},
}))

mock.module('@platform/web/config/publicConfigQuery', () => ({
	useConfigQuery: () => ({ data: { appPublicKey: 'app'.padEnd(64, '0'), appRelay: 'wss://relay.example' } }),
}))

mock.module('@platform/web/config/nip05Binding', () => ({
	useNip05Settings: () => ({ data: {}, isLoading: true }),
	getNip05ForPubkey: () => null,
	getExpiredNip05ForPubkey: () => [],
}))

mock.module('@sdk/config/nip05', () => ({
	nip05Actions: {
		isValidUsername: () => true,
		isReservedName: () => false,
		isUsernameAvailable: () => true,
	},
}))

mock.module('@platform/server/Nip05Manager', () => ({
	NIP05_PRICING: {},
}))

mock.module('@platform/web/payments/LightningPaymentProcessor', () => ({
	LightningPaymentProcessor: () => null,
}))

mock.module('@platform/web/payments/zapPurchase', () => ({
	purchaseNip05ForPubkey: async () => {
		throw new Error('the paid flow is not exercised by this identity test')
	},
}))

mock.module('sonner', () => ({
	toast: { success: () => {}, error: () => {} },
}))

const { Route } = await import('@platform/web/routes/_dashboard-layout/dashboard/account/nostr-address')

const Component = Route.options.component as () => ReactElement

function render(user: AuthState['user']): string {
	authState.setState(() => ({ user }))
	return renderToStaticMarkup(createElement(Component))
}

describe('nostr-address route — identity gate', () => {
	test('a signed-in user reaches the page body (no "connect your account" empty state)', () => {
		const markup = render({ pubkey: PUBKEY })

		expect(markup).toContain('Nostr Address (NIP-05)')
		expect(markup).not.toContain('Please connect your Nostr account')
	})

	test('a signed-out visitor gets the connect prompt', () => {
		const markup = render(null)

		expect(markup).toContain('Please connect your Nostr account')
	})

	test('signing in between renders opens the page (the identity is read per render)', () => {
		const signedOut = render(null)
		const signedIn = render({ pubkey: PUBKEY })

		expect(signedOut).toContain('Please connect your Nostr account')
		expect(signedIn).not.toContain('Please connect your Nostr account')
	})
})