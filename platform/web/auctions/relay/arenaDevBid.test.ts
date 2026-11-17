/**
 * The dev bid helper's **selection**, over a lot the seed published.
 *
 * `walletOps.placeDevBidOnSeededAuction` used to pick its own candidate from a
 * `kinds: [30408]` subscription and the retired tag set, which nothing publishes any
 * more — the seed writes arena 1440 creates — so it could never find a lot. It now
 * reads the lot surfaces' own arena read and asks `selectDevBidCandidate` (which asks
 * the panel's `checkArenaBid`) to choose. This test is that choice, end to end from a
 * fixture: a 1440 create from `scripts/gen_auctions.ts`, decoded the way the read
 * decodes it, projected, and selected.
 *
 * Only the selection is exercised. The money step (`assembleArenaBidFunding` locking
 * a real escrow through Coco, then `publishArenaBid`) is the app's own arena bid path
 * and is covered by `arenaBidFund.test.ts` / `arenaBidPublish.test.ts`; mocking a mint
 * and a Coco manager here would test the mocks.
 */
import { describe, expect, test } from 'bun:test'

import type { NostrEventLike } from '@sdk/core'
import { ARENA_AUCTION_KINDS } from '@sdk/commerce/auctions/constants'
import { buildAuctionBidTemplate, generateAuctionData, type GeneratedAuctionData } from '../../../../scripts/gen_auctions'
import {
	ARENA_READ_KINDS,
	decodeArenaEvent,
	projectArenaEvents,
	type ArenaAuctionEvent,
	type ArenaAuctionSnapshot,
} from './arenaAuctionRead'
import { selectDevBidCandidate } from './arenaDevBid'
import type { ArenaBidderState } from '@ui/auction/arena/bid-rules'

// Opaque strings, not keys: the selection reads the create's content and the bid
// rules, and never a secp256k1 point. Same style as `arenaAuctionRead.test.ts`.
const SELLER = 'seller-alice'
const OTHER_SELLER = 'seller-dave'
const SELLER_WALLET = 'seller-wallet-spend-key'
const BIDDER = 'bidder-bob'
const OTHER_BIDDER = 'bidder-carol'

const READY: ArenaBidderState = { pubkey: BIDDER, wallet: 'ready' }

function decode(event: NostrEventLike): ArenaAuctionEvent {
	const result = decodeArenaEvent(event, 'wss://relay.example')
	if (!result.ok) throw new Error(`the read refused a seeded event: ${result.refusal.reason} — ${result.refusal.detail}`)
	return result.event
}

/** One lot, from the seed's own fixture module. */
function seededLot(over: { seller?: string; status?: 'live' | 'ended'; durationSec?: number } = {}): GeneratedAuctionData {
	return generateAuctionData({
		sellerPubkey: over.seller ?? SELLER,
		sellerWallet: SELLER_WALLET,
		status: over.status ?? 'live',
		durationSec: over.durationSec ?? 3600,
	})
}

const lotEvent = (lot: GeneratedAuctionData, rootId: string, seller: string): NostrEventLike => ({
	id: rootId,
	pubkey: seller,
	kind: lot.kind,
	created_at: lot.created_at,
	tags: lot.tags,
	content: lot.content,
})

/** One bid on a lot, built by the seed's own bid builder (a delta, as the protocol reads it). */
const bidEvent = (lot: GeneratedAuctionData, rootId: string, bidder: string, amount: number, id: string): NostrEventLike => {
	const template = buildAuctionBidTemplate({
		auctionRootEventId: rootId,
		auctionCoordinate: lot.coordinate,
		auctionId: lot.auctionId,
		amount,
		createdAt: lot.created_at + 10,
	})
	return { id, pubkey: bidder, kind: template.kind, created_at: template.created_at, tags: template.tags, content: template.content }
}

const snapshotOf = (events: NostrEventLike[]): ArenaAuctionSnapshot => projectArenaEvents(events.map(decode))

describe('selectDevBidCandidate over a seeded arena lot', () => {
	test('a seeded 1440 lot is selected and bid at its own opening price', () => {
		const lot = seededLot()
		expect(lot.kind).toBe(ARENA_AUCTION_KINDS.create)
		expect(ARENA_READ_KINDS).toContain(lot.kind)

		const snapshot = snapshotOf([lotEvent(lot, 'root-lot-1', SELLER)])
		const candidate = selectDevBidCandidate({ snapshot, status: 'settled', bidder: READY, now: lot.created_at + 1 })

		expect(snapshot.refusals).toEqual([])
		expect(candidate).not.toBeNull()
		expect(candidate?.view.coordinate).toBe(lot.coordinate)
		expect(candidate?.model.rootEventId).toBe('root-lot-1')
		expect(candidate?.model.seller).toBe(SELLER)
		// No bid read yet: the floor is the lot's `startPrice`, and the amount is the
		// delta that reaches it (there is no position to add to).
		expect(candidate?.check.allowed).toBe(true)
		expect(candidate?.check.minimum).toBe(lot.startPrice)
		expect(candidate?.check.amount).toBe(lot.startPrice)
	})

	test("the dev's preference raises the amount to the floor, never below it", () => {
		const lot = seededLot()
		// Someone else holds the opening position, so the floor is a raise.
		const snapshot = snapshotOf([lotEvent(lot, 'root-lot-1', SELLER), bidEvent(lot, 'root-lot-1', OTHER_BIDDER, lot.startPrice, 'bid-1')])
		const now = lot.created_at + 60
		const floor = lot.startPrice + lot.minIncrement

		const noPreference = selectDevBidCandidate({ snapshot, status: 'settled', bidder: READY, now })
		expect(noPreference?.check.amount).toBe(floor)
		expect(noPreference?.check.minimum).toBe(floor)

		// A preference under the floor is raised, exactly as the retired helper's
		// `Math.max` did: the dev path never publishes a bid the terms refuse.
		const tooLow = selectDevBidCandidate({ snapshot, status: 'settled', bidder: READY, now, preferredAmount: lot.startPrice })
		expect(tooLow?.check.amount).toBe(floor)

		const above = selectDevBidCandidate({ snapshot, status: 'settled', bidder: READY, now, preferredAmount: floor + 7 })
		expect(above?.check.amount).toBe(floor + 7)
		expect(above?.check.allowed).toBe(true)
	})

	test('a lot the bidder is selling is skipped, and the next biddable lot wins', () => {
		const own = seededLot({ seller: SELLER })
		const theirs = seededLot({ seller: OTHER_SELLER })
		const snapshot = snapshotOf([lotEvent(own, 'root-own', SELLER), lotEvent(theirs, 'root-theirs', OTHER_SELLER)])

		const asSeller = selectDevBidCandidate({
			snapshot,
			status: 'settled',
			bidder: { pubkey: SELLER, wallet: 'ready' },
			now: own.created_at + 1,
		})
		expect(asSeller?.model.rootEventId).toBe('root-theirs')

		// The bidder's own lot alone: nothing to bid on, and not a wrong lot chosen.
		const onlyOwn = selectDevBidCandidate({
			snapshot: snapshotOf([lotEvent(own, 'root-own', SELLER)]),
			status: 'settled',
			bidder: { pubkey: SELLER, wallet: 'ready' },
			now: own.created_at + 1,
		})
		expect(onlyOwn).toBeNull()
	})

	test('an ended lot is not selected', () => {
		const lot = seededLot({ status: 'ended' })
		const snapshot = snapshotOf([lotEvent(lot, 'root-lot-1', SELLER)])
		expect(selectDevBidCandidate({ snapshot, status: 'settled', bidder: READY, now: Math.floor(Date.now() / 1000) })).toBeNull()
	})

	test('a bidder whose wallet is not ready is not selected', () => {
		const lot = seededLot()
		const snapshot = snapshotOf([lotEvent(lot, 'root-lot-1', SELLER)])
		expect(
			selectDevBidCandidate({ snapshot, status: 'settled', bidder: { pubkey: BIDDER, wallet: 'unavailable' }, now: lot.created_at + 1 }),
		).toBeNull()
	})

	test('an empty read selects nothing', () => {
		expect(selectDevBidCandidate({ snapshot: projectArenaEvents([]), status: 'no-relays', bidder: READY, now: 1 })).toBeNull()
	})
})
