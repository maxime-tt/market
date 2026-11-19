/**
 * `platform/web/routes/auctionsIndexRoute.test.tsx` — the auctions index URL
 * contract.
 *
 * The index renders each lot's link with `arenaAuctionHref`, which is
 * `/auctions/<d>` (`ArenaAuctionsListHost`). These tests load the REAL route
 * tree and assert that the href the list renders resolves to the auction detail
 * route with the `d` tag as its param — so the link the list builds and the
 * destination the router owns cannot drift apart.
 *
 * The route tree is the real one, so this is also the check that `/auctions`
 * itself still resolves to the index after the rewrite.
 */

import { describe, expect, test } from 'bun:test'
import { createMemoryHistory, createRouter } from '@tanstack/react-router'
import { routeTree } from '../routeTree.gen'
import { arenaAuctionHref } from '@platform/web/auctions/relay/ArenaAuctionsListHost'

interface Match {
	routeId: string
	params: Record<string, string>
	search: Record<string, unknown>
}

/** Resolve a path against the app's own route tree, as the router would. */
async function resolve(path: string): Promise<Match[]> {
	const router = createRouter({
		routeTree,
		history: createMemoryHistory({ initialEntries: [path] }),
	})
	await router.load()
	return router.state.matches.map((match) => ({
		routeId: match.routeId,
		params: match.params as Record<string, string>,
		search: match.search as Record<string, unknown>,
	}))
}

describe('the auctions index route and the links it renders', () => {
	test('/auctions resolves to the index route', async () => {
		const matches = await resolve('/auctions')
		const last = matches[matches.length - 1]!
		expect(last.routeId).toBe('/auctions/')
	})

	test('the href a lot card carries resolves to the detail route with the `d` param', async () => {
		const href = arenaAuctionHref('lot-1')
		expect(href).toBe('/auctions/lot-1')

		const last = (await resolve(href)).at(-1)!
		expect(last.routeId).toBe('/auctions/$auctionId')
		expect(last.params.auctionId).toBe('lot-1')
	})

	test('a `d` with a space resolves to the same route, still as a single param', async () => {
		const last = (await resolve(arenaAuctionHref('my lot'))).at(-1)!
		expect(last.routeId).toBe('/auctions/$auctionId')
		expect(last.params.auctionId).toBe('my lot')
	})

	test('the card href carries the seller, and the detail route parses it as `?seller=`', async () => {
		const href = arenaAuctionHref('lot-1', 'seller-alice')
		expect(href).toBe('/auctions/lot-1?seller=seller-alice')

		const last = (await resolve(href)).at(-1)!
		expect(last.routeId).toBe('/auctions/$auctionId')
		expect(last.params.auctionId).toBe('lot-1')
		expect(last.search).toEqual({ seller: 'seller-alice' })
	})

	test('an escaped `d` and seller still arrive decoded on the detail route', async () => {
		const last = (await resolve(arenaAuctionHref('my lot', 'seller alice'))).at(-1)!
		expect(last.routeId).toBe('/auctions/$auctionId')
		expect(last.params.auctionId).toBe('my lot')
		expect(last.search).toEqual({ seller: 'seller alice' })
	})
})
