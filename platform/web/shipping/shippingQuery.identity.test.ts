/**
 * platform/web/shipping/shippingQuery.identity.test.ts — the shipping-status mutation invalidates
 * the *current* user's order lists.
 *
 * Regression pinned here: `useUpdateShippingStatusMutation` captured `ndk?.activeUser?.pubkey` at
 * render time. Nothing in this tree assigns `activeUser`, so the value was permanently `undefined`
 * and the `orderKeys.byPubkey/byBuyer/bySeller` invalidations never fired — order lists kept showing
 * the previous shipping status.
 *
 * Two properties are asserted, and the second is the reason the read moved into `onSuccess`:
 *  - the invalidation keys are the signed-in pubkey's;
 *  - the identity is read when the mutation settles, so a mutation that lands after an account
 *    switch invalidates the *new* user's keys rather than a stale render-time capture.
 */
import { describe, expect, mock, test } from 'bun:test'
import { QueryClient } from '@tanstack/react-query'
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const PUBKEY = 'a1'.repeat(32)
const OTHER_PUBKEY = 'b2'.repeat(32)

let currentPubkey: string | null = PUBKEY

const actualReadContext = await import('@platform/web/readContext')
mock.module('@platform/web/readContext', () => ({
	...actualReadContext,
	getCurrentPubkey: () => currentPubkey,
}))

mock.module('sonner', () => ({
	toast: { success: () => {}, error: () => {} },
}))

interface MutationOptions {
	onSuccess?: (eventId: string, params: Record<string, unknown>) => Promise<void>
}

const queryClient = new QueryClient()
const invalidated: unknown[] = []
queryClient.invalidateQueries = (async (filters: { queryKey: unknown }) => {
	invalidated.push(filters.queryKey)
	return undefined
}) as unknown as typeof queryClient.invalidateQueries
queryClient.refetchQueries = (async () => undefined) as unknown as typeof queryClient.refetchQueries

let capturedOptions: MutationOptions | undefined

const actualReactQuery = await import('@tanstack/react-query')
mock.module('@tanstack/react-query', () => ({
	...actualReactQuery,
	useQueryClient: () => queryClient,
	useMutation: (options: MutationOptions) => {
		capturedOptions = options
		return {}
	},
}))

const { useUpdateShippingStatusMutation } = await import('@platform/web/shipping/shippingQuery')

function Probe(): ReactElement {
	useUpdateShippingStatusMutation()
	return createElement('span')
}

function settle(): Promise<void> {
	return capturedOptions?.onSuccess?.('order-event-id', {}) ?? Promise.resolve()
}

describe('useUpdateShippingStatusMutation — identity', () => {
	test('invalidates the signed-in pubkey keys after a successful status update', async () => {
		currentPubkey = PUBKEY
		invalidated.length = 0

		renderToStaticMarkup(createElement(Probe))
		await settle()

		const keys = invalidated.map((key) => JSON.stringify(key))
		expect(keys.some((key) => key.includes(PUBKEY))).toBe(true)
		expect(keys.some((key) => key.includes('byPubkey') || key.includes('byBuyer') || key.includes('bySeller'))).toBe(true)
	})

	test('reads the identity at settle time, not at render time (account switch)', async () => {
		currentPubkey = PUBKEY
		invalidated.length = 0

		renderToStaticMarkup(createElement(Probe))

		// A different account is signed in before the mutation settles.
		currentPubkey = OTHER_PUBKEY
		await settle()

		const keys = invalidated.map((key) => JSON.stringify(key))
		expect(keys.some((key) => key.includes(OTHER_PUBKEY))).toBe(true)
		expect(keys.some((key) => key.includes(PUBKEY))).toBe(false)
	})

	test('signed out: the global order keys are still invalidated, no pubkey keys', async () => {
		currentPubkey = null
		invalidated.length = 0

		renderToStaticMarkup(createElement(Probe))
		await settle()

		expect(invalidated.length).toBeGreaterThan(0)
		const keys = invalidated.map((key) => JSON.stringify(key))
		expect(keys.some((key) => key.includes('byPubkey') || key.includes('byBuyer') || key.includes('bySeller'))).toBe(false)
	})
})