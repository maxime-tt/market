/**
 * platform/web/orders/ordersQuery.identity.test.ts — the orders read path must take the current
 * identity from the auth machine, not from `ndk.activeUser`.
 *
 * Regression pinned here: `fetchOrders` read `ndk.activeUser`, which nothing in this tree ever
 * assigns, so it threw "No active user" on every call and the dashboard order list was permanently
 * empty. `useOrders` read the same surface for its `enabled` flag, so even a correct `fetchOrders`
 * would never have been called.
 *
 * Both shapes are asserted:
 *  - one-shot (`fetchOrders` — a queryFn) reads `getCurrentPubkey()` at call time;
 *  - reactive (`useOrders` — `enabled` is a render-time decision) follows `authStore`.
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

let currentPubkey: string | null = PUBKEY

/** Filters handed to the relay read, so the assertions can look at what was actually requested. */
const capturedFilters: Record<string, unknown>[] = []

const actualReadContext = await import('@platform/web/readContext')
mock.module('@platform/web/readContext', () => ({
	// Everything the host's composition root exports, so unrelated importers in the graph link
	// cleanly; only the identity surface and the relay read are replaced.
	...actualReadContext,
	applesauceIo: {},
	authStore: authState,
	fetchNdkEventSet: async (_io: unknown, _ndk: unknown, filter: Record<string, unknown>) => {
		capturedFilters.push(filter)
		return new Set()
	},
	getCurrentPubkey: () => currentPubkey,
	mergeNdkEventSetsById: () => new Set(),
	rehydrateVerifiedNdkEvent: (event: unknown) => event,
}))

const actualPublishContext = await import('@platform/web/ndkPublishContext')
mock.module('@platform/web/ndkPublishContext', () => ({
	...actualPublishContext,
	getAppNdk: () => ({}),
}))

// `useOrders` decides `enabled` during render; capture the options it hands react-query.
let lastQueryOptions: { enabled?: boolean; queryFn?: unknown } | undefined

/**
 * Read the captured options through a call, not directly.
 *
 * The mock above assigns `lastQueryOptions` from another module, which the compiler cannot see, so
 * a direct read after a `lastQueryOptions = undefined` reset is narrowed to `undefined` (and its
 * `?.enabled` to `never`). A function boundary defeats that narrowing without weakening the type.
 */
const capturedOptions = (): { enabled?: boolean; queryFn?: unknown } | undefined => lastQueryOptions

const actualReactQuery = await import('@tanstack/react-query')
mock.module('@tanstack/react-query', () => ({
	...actualReactQuery,
	useQuery: (options: { enabled?: boolean; queryFn?: unknown }) => {
		lastQueryOptions = options
		return { data: undefined }
	},
}))

const { fetchOrders, useOrders } = await import('@platform/web/orders/ordersQuery')

function OrdersProbe(): ReactElement {
	const { data } = useOrders()
	return createElement('span', { 'data-has-data': String(data !== undefined) })
}

describe('fetchOrders — identity', () => {
	test('builds both order filters from the signed-in pubkey', async () => {
		currentPubkey = PUBKEY
		capturedFilters.length = 0

		await fetchOrders()

		expect(capturedFilters.length).toBeGreaterThanOrEqual(2)
		expect(capturedFilters[0].authors).toEqual([PUBKEY])
		expect(capturedFilters[1]['#p']).toEqual([PUBKEY])
	})

	test('throws "No active user" when nobody is signed in (no relay read attempted)', async () => {
		currentPubkey = null
		capturedFilters.length = 0

		await expect(fetchOrders()).rejects.toThrow('No active user')
		expect(capturedFilters).toHaveLength(0)
	})
})

describe('useOrders — the enabled flag follows the auth store', () => {
	test('enabled while a user is signed in', () => {
		authState.setState(() => ({ user: { pubkey: PUBKEY } }))
		lastQueryOptions = undefined

		renderToStaticMarkup(createElement(OrdersProbe))

		expect(capturedOptions()?.enabled).toBe(true)
	})

	test('disabled while signed out', () => {
		authState.setState(() => ({ user: null }))
		lastQueryOptions = undefined

		renderToStaticMarkup(createElement(OrdersProbe))

		expect(capturedOptions()?.enabled).toBe(false)
	})

	test('a login between renders flips it (it is read per render, not captured once)', () => {
		authState.setState(() => ({ user: null }))
		renderToStaticMarkup(createElement(OrdersProbe))
		const whileSignedOut = capturedOptions()?.enabled

		authState.setState(() => ({ user: { pubkey: PUBKEY } }))
		renderToStaticMarkup(createElement(OrdersProbe))
		const whileSignedIn = capturedOptions()?.enabled

		expect(whileSignedOut).toBe(false)
		expect(whileSignedIn).toBe(true)
	})
})