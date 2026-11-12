/**
 * The protocol client over its real transport, against the running demo.
 *
 * Opt-in (`AUCTIONS_LIVE=1`): it publishes a real auction and a real bid into
 * the demo chain. Money is fake there, which is exactly why this is the only
 * place the whole path — sign, publish over HTTP, commit, reserve, bid — is
 * exercised end to end. Everything else in this directory runs on fakes.
 */

import { describe, expect, test } from 'bun:test'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools'
import { createAuctionsProtocolClient, AUCTION_KINDS } from './client'
import { createHttpPorts } from './httpPorts'

const LIVE = process.env.AUCTIONS_LIVE === '1'
// Inclusion is minutes on the demo chain (measured: a create committed 8+ minutes
// after an accepted tx). Only the slow lane pays that, and only on request.
const LIVE_COMMIT = process.env.AUCTIONS_LIVE_COMMIT === '1'
const BACKEND = process.env.AUCTIONS_BACKEND_URL ?? 'http://127.0.0.1:8080'

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** The committee commits out of band; poll the committed document until the id appears. */
async function waitForCommit(
	client: ReturnType<typeof createAuctionsProtocolClient>,
	auctionId: string,
	budgetMs = 420000,
): Promise<void> {
	const deadline = Date.now() + budgetMs
	while (Date.now() < deadline) {
		const state = await client.getState()
		if (state.auctions?.[auctionId]) return
		await wait(3000)
	}
	throw new Error(`auction ${auctionId} never committed within ${budgetMs}ms`)
}

describe('auctions protocol over HTTP (live demo)', () => {
	test.skipIf(!LIVE)('create, reserve and bid are accepted by consensus', async () => {
		// A seller cannot bid on their own auction, so the two roles are two keys.
		const sellerSecret = generateSecretKey()
		const bidderSecret = generateSecretKey()
		const bidder = { pubkey: getPublicKey(bidderSecret) }
		const httpPorts = createHttpPorts({ base: BACKEND, apiBase: '/api' })
		const asSeller = createAuctionsProtocolClient({
			...httpPorts,
			sign: async (template) => finalizeEvent(template as never, sellerSecret) as never,
		})
		const asBidder = createAuctionsProtocolClient({
			...httpPorts,
			sign: async (template) => finalizeEvent(template as never, bidderSecret) as never,
		})
		const client = asBidder

		const config = await client.getConfig()
		expect(config.chain_id).toBeTruthy()

		const auctionId = `proof-${Date.now()}`
		const created = await asSeller.createAuction({
			auctionId,
			title: 'Protocol proof lot',
			durationSeconds: 900,
			startingBid: 1000,
			minIncrement: 100,
			fundingMode: config.funding_mode ?? 'custodial_reservation_v1',
		})
		expect(created.kind).toBe(AUCTION_KINDS.create)

		if (LIVE_COMMIT) await waitForCommit(client, auctionId)

		const reservation = await client.reserve({
			auctionId,
			bidder: bidder.pubkey,
			amount: 1500,
		})
		expect(reservation).toBeTruthy()

		const bid = await client.placeBid({ auctionId, amountDelta: 1500, reservation })
		expect(bid.kind).toBe(AUCTION_KINDS.bid)

		if (!LIVE_COMMIT) return
		const deadline = Date.now() + 420000
		let committed = null as null | { bidder: string; amount: number }
		while (Date.now() < deadline && !committed) {
			const state = await client.getState()
			committed = Object.values(state.bids ?? {}).find((b) => b.auction_id === auctionId) ?? null
			if (!committed) await wait(3000)
		}
		expect(committed?.bidder).toBe(bidder.pubkey)
		expect(committed?.amount).toBe(1500)
	}, 900000)
})
