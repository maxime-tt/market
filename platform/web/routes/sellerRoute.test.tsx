/**
 * platform/web/routes/sellerRoute.test.tsx — the seller URL contract.
 *
 * The seller page is a route, not a component: `platform/web/routes/profile.$profileId.tsx`
 * → `StorefrontOrProfilePage` → `ProfilePage` (the browse seller-profile kit).
 * Product surfaces link a seller name to it, and every one of them uses the
 * app's existing convention — `ui/nostr/identity.tsx`'s `ProfileNameView` and the
 * featured/user-card hosts all render `/profile/<identifier>`
 * (`/profile/${encodeURIComponent(pubkey)}`).
 *
 * These tests load the REAL route tree and assert that this href resolves to
 * that route (with the identifier as its param), so the convention and the route
 * cannot drift apart — and that the single-segment `/$vanityName` route does not
 * capture it, i.e. there is no second competing profile URL.
 */

import { describe, expect, test } from 'bun:test'
import { createMemoryHistory, createRouter } from '@tanstack/react-router'
import { npubEncode } from 'nostr-tools/nip19'
import { routeTree } from '../routeTree.gen'

/** A real seller pubkey (hex, 64 chars) — the shape the card/panel/strip carry. */
const SELLER_PUBKEY = '2e7afe3f9af8c3dc90d6e8acaf5d7aa926a54f0c22f1c555707309c059fe831b'

interface Match {
	routeId: string
	params: Record<string, string>
}

/** Resolve a path against the app's own route tree, as the router would. */
async function resolve(path: string): Promise<Match[]> {
	const router = createRouter({
		routeTree,
		history: createMemoryHistory({ initialEntries: [path] }),
	})
	await router.load()
	return router.state.matches.map((match) => ({ routeId: match.routeId, params: match.params as Record<string, string> }))
}

describe('seller links resolve to the seller page route', () => {
	test('the href a seller name is given resolves to /profile/$profileId with the pubkey', async () => {
		// Exactly what the card/panel/strip render for a seller name.
		const href = `/profile/${encodeURIComponent(SELLER_PUBKEY)}`

		const matches = await resolve(href)
		const last = matches[matches.length - 1]!

		expect(last.routeId).toBe('/profile/$profileId')
		expect(last.params.profileId).toBe(SELLER_PUBKEY)
	})

	test('a bare hex path is NOT captured by the single-segment vanity route', async () => {
		const ids = (await resolve(`/profile/${SELLER_PUBKEY}`)).map((match) => match.routeId)

		expect(ids).not.toContain('/$vanityName')
	})

	test('the vanity route still owns a single segment, so the two do not compete', async () => {
		const vanity = await resolve('/some-vanity-name')
		const last = vanity[vanity.length - 1]!

		expect(last.routeId).toBe('/$vanityName')
		expect(last.params.vanityName).toBe('some-vanity-name')
	})

	test('an npub identifier resolves to the same route (the profile route takes an identifier, not only hex)', async () => {
		const npub = npubEncode(SELLER_PUBKEY)

		const npubMatches = await resolve(`/profile/${npub}`)
		const last = npubMatches[npubMatches.length - 1]!

		expect(last.routeId).toBe('/profile/$profileId')
		expect(last.params.profileId).toBe(npub)
	})
})
