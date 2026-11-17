/**
 * The seed's arena fixtures, read back through the arena read.
 *
 * `scripts/seed.ts` used to publish the retired `cashu_p2pk_bidder_path_v1` 30408
 * listing family, which no live auction surface subscribes to (`arenaAuctionFilters`
 * asks for the 1440 series only) — so a seeded instance rendered an empty auction
 * feed. This is the narrow guard on the migrated shape: `scripts/gen_auctions.ts`
 * emits a kind-1440 create and a kind-1441 bid, the read decodes both without a
 * refusal, and the lot comes back with its seeded bid and position.
 *
 * It is deliberately *not* a test of `scripts/seed.ts` itself: the seed needs a relay
 * and five signers, and what can regress silently is the emitted shape, not the
 * publish loop. The retired kind numbers are pinned here (`30408`, `1023`, `1025`)
 * only where the assertion is that they cannot come back.
 */
import { describe, expect, test } from 'bun:test'

import type { NostrEventLike } from '@sdk/core'
import { ARENA_AUCTION_KINDS } from '@sdk/commerce/auctions/constants'
import { buildAuctionBidTemplate, generateAuctionData } from '../../../../scripts/gen_auctions'
import { ARENA_READ_KINDS, arenaAuctionCoordinate, decodeArenaEvent, projectArenaEvents, type ArenaAuctionEvent } from './arenaAuctionRead'

// Opaque strings, not keys: the builders validate shape, not secp256k1 (the read is
// told apart from the wire by `arenaAuctionRead` itself). Same style as
// `arenaAuctionRead.test.ts`, whose ids and pubkeys are non-hex on purpose.
const SELLER = 'seller-alice'
const SELLER_WALLET = 'seller-wallet-spend-key'
const BIDDER = 'bidder-bob'

/** The create content keys the retired tag protocol wrote — none may reappear. */
const RETIRED_CREATE_KEYS = [
	'price',
	'starting_bid',
	'bid_increment',
	'reserve',
	'max_end_at',
	'settlement_grace',
	'extension_rule',
	'key_scheme',
	'p2pk_xpub',
	'settlement_policy',
	'schema',
	'auditors',
	'auditor_quorum',
	'max_skew_sec',
] as const

/** The retired listing / bid / path-release kinds, named once. */
const RETIRED_30408_LISTING = 30408
const RETIRED_1023_BID = 1023
const RETIRED_1025_PATH_RELEASE = 1025

function decode(event: NostrEventLike): ArenaAuctionEvent {
	const result = decodeArenaEvent(event, 'wss://relay.example')
	if (!result.ok) throw new Error(`the read refused the seeded event: ${result.refusal.reason} — ${result.refusal.detail}`)
	return result.event
}

describe("the seed's lot fixtures (scripts/gen_auctions.ts)", () => {
	test('a seeded lot is a kind-1440 create, addressed the arena read’s way', () => {
		const lot = generateAuctionData({ sellerPubkey: SELLER, sellerWallet: SELLER_WALLET, status: 'live', durationSec: 3600 })

		expect(lot.kind).toBe(ARENA_AUCTION_KINDS.create)
		// The read only ever subscribes to these kinds, and 1440 is one of them.
		expect(ARENA_READ_KINDS).toContain(lot.kind)
		expect(lot.kind).not.toBe(RETIRED_30408_LISTING)

		// The coordinate is the read's own convention, derived from the kind constant.
		expect(lot.coordinate).toBe(`${ARENA_AUCTION_KINDS.create}:${SELLER}:${lot.auctionId}`)
		expect(lot.coordinate).toBe(arenaAuctionCoordinate(SELLER, lot.auctionId))

		// Identity written twice — `d` and `content.auction_id`. A disagreement is
		// `arena.bad_identity`, and the lot would silently not render.
		expect(lot.tags).toEqual([['d', lot.auctionId]])
		const content = JSON.parse(lot.content) as Record<string, unknown>
		expect(content.auction_id).toBe(lot.auctionId)
		expect(content.sellerWallet).toBe(SELLER_WALLET)
		expect(typeof content.startPrice).toBe('number')
		expect(typeof content.durationSec).toBe('number')
	})

	test('a seeded lot carries none of the retired 30408 tag furniture', () => {
		const lot = generateAuctionData({ sellerPubkey: SELLER, sellerWallet: SELLER_WALLET, status: 'live', durationSec: 3600 })
		const content = JSON.parse(lot.content) as Record<string, unknown>

		for (const retired of RETIRED_CREATE_KEYS) expect(content).not.toHaveProperty(retired)
		// `d` is the whole tag set: no `price`, no `p2pk_xpub`, no `auditors`, no `image` tags.
		expect(lot.tags.map((tag) => tag[0])).toEqual(['d'])
	})

	test('a seeded lot ends where the read says it does', () => {
		const lot = generateAuctionData({ sellerPubkey: SELLER, sellerWallet: SELLER_WALLET, status: 'live', durationSec: 3600 })
		// The arena has no `start_at`/`end_at`: the read derives the end from the root
		// create's `created_at` plus `content.durationSec`.
		expect(lot.endsAt).toBe(lot.created_at + 3600)
		expect(lot.endsAt).toBeGreaterThan(Math.floor(Date.now() / 1000))
	})

	test('an ended fixture is back-dated, so its end has passed', () => {
		const lot = generateAuctionData({ sellerPubkey: SELLER, sellerWallet: SELLER_WALLET, status: 'ended' })
		expect(lot.endsAt).toBeLessThan(Math.floor(Date.now() / 1000))
	})
})

describe("the seed's bid fixtures (scripts/gen_auctions.ts)", () => {
	test('a seeded bid is a kind-1441 bound by both `a` and the root `e`', () => {
		const lot = generateAuctionData({ sellerPubkey: SELLER, sellerWallet: SELLER_WALLET, status: 'live', durationSec: 3600 })
		const amount = lot.startPrice + lot.minIncrement
		const bid = buildAuctionBidTemplate({
			auctionRootEventId: 'root-lot-1',
			auctionCoordinate: lot.coordinate,
			auctionId: lot.auctionId,
			amount,
			createdAt: lot.created_at + 60,
		})

		expect(bid.kind).toBe(ARENA_AUCTION_KINDS.bid)
		expect(ARENA_READ_KINDS).toContain(bid.kind)
		expect(bid.kind).not.toBe(RETIRED_1023_BID)
		expect(bid.kind).not.toBe(RETIRED_1025_PATH_RELEASE)

		expect(bid.tags).toEqual([
			['e', 'root-lot-1'],
			['a', lot.coordinate],
		])
		// An unfunded fixture: the amount and the two bindings, and nothing that
		// pretends to be escrow the seed could not fund.
		expect(JSON.parse(bid.content)).toEqual({ auction: lot.coordinate, auction_id: lot.auctionId, amount })
	})

	test('the read scores a seeded lot and its seeded bid', () => {
		const lot = generateAuctionData({ sellerPubkey: SELLER, sellerWallet: SELLER_WALLET, status: 'live', durationSec: 3600 })
		const amount = lot.startPrice + lot.minIncrement
		const bid = buildAuctionBidTemplate({
			auctionRootEventId: 'root-lot-1',
			auctionCoordinate: lot.coordinate,
			auctionId: lot.auctionId,
			amount,
			createdAt: lot.created_at + 60,
		})

		const snapshot = projectArenaEvents([
			decode({ id: 'root-lot-1', pubkey: SELLER, kind: lot.kind, created_at: lot.created_at, tags: lot.tags, content: lot.content }),
			decode({ id: 'bid-1', pubkey: BIDDER, kind: bid.kind, created_at: bid.created_at, tags: bid.tags, content: bid.content }),
		])

		expect(snapshot.refusals).toEqual([])
		expect(snapshot.rejectedCreates).toEqual([])
		expect(snapshot.auctions).toHaveLength(1)

		const [view] = snapshot.auctions
		expect(view.coordinate).toBe(lot.coordinate)
		expect(view.seller).toBe(SELLER)
		expect(view.rootEventId).toBe('root-lot-1')
		expect(view.content.startPrice).toBe(lot.startPrice)
		expect(view.rootCreatedAt + (view.content.durationSec ?? 0)).toBe(lot.endsAt)
		// The surfaces that used to stay empty: the bid list, the position and the top bid.
		expect(view.bids.map((entry) => entry.bidder)).toEqual([BIDDER])
		expect(view.positions).toEqual({ [BIDDER]: amount })
		expect(view.topBid).toEqual({ bidder: BIDDER, total: amount })
		expect(view.bidsWithoutAmount).toBe(0)
	})
})
