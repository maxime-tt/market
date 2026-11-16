/**
 * `auctionFulfilment.test.ts` — the pure winner/address helpers the fulfilment
 * panel is built on. No React, no query, no relay: the read model comes from the
 * real `decodeArenaEvent` → `projectArenaEvents` chain over fixture events.
 *
 * The load-bearing rule: the winner is the **highest-anchored** `winner` verdict,
 * not any older `winner` row beneath a newer disagreement.
 */
import { describe, expect, test } from 'bun:test'
import { ARENA_AUCTION_BID_KIND, ARENA_AUCTION_CREATE_KIND, ARENA_VERDICT_KIND, ARENA_VERDICT_SCHEMA } from '@sdk/commerce/auctions/constants'
import type { NostrEventLike } from '@sdk/core'
import { decodeArenaEvent, projectArenaEvents, type ArenaAuctionSnapshot } from '@platform/web/auctions/relay/arenaAuctionRead'
import { formatClaimAddress, winningBidderOf, winningVerdictOf } from './auctionFulfilment'

const SELLER = 'seller-alice'
const WINNER = 'bidder-winner'

let idCounter = 0
function nextId(prefix: string): string {
	idCounter += 1
	return `${prefix}-${idCounter}`
}

function createEvent(): NostrEventLike {
	return {
		id: nextId('create'),
		pubkey: SELLER,
		created_at: 1000,
		kind: ARENA_AUCTION_CREATE_KIND,
		tags: [['d', 'lot-1']],
		content: JSON.stringify({ auction_id: 'lot-1', title: 'Lot', startPrice: 1000, durationSec: 3600, mode: 'fixed' }),
	}
}

function bidEvent(id: string, pubkey = WINNER): NostrEventLike {
	return {
		id,
		pubkey,
		created_at: 1100,
		kind: ARENA_AUCTION_BID_KIND,
		tags: [],
		content: JSON.stringify({ auction_id: 'lot-1', amount: 500 }),
	}
}

function verdictEvent(over: { outcome: string; height: number; bidId?: string }): NostrEventLike {
	const validator = `validator-${over.height}`
	return {
		id: nextId('verdict'),
		pubkey: validator,
		created_at: 1300,
		kind: ARENA_VERDICT_KIND,
		tags: [
			['auction', 'lot-1'],
			['height', String(over.height)],
			['hash', 'beef'],
			['p', validator],
			...(over.bidId ? [['bid', over.bidId]] : []),
		],
		content: JSON.stringify({
			schema: ARENA_VERDICT_SCHEMA,
			auction_id: 'lot-1',
			outcome: over.outcome,
			height: over.height,
			block_hash: 'beef',
			derived_from: 'committed_state',
		}),
	}
}

function viewOf(events: NostrEventLike[]) {
	const decoded = events.map((event) => {
		const result = decodeArenaEvent(event, 'wss://relay.one')
		if (!result.ok) throw new Error(`fixture refused: ${result.refusal.reason} ${result.refusal.detail}`)
		return result.event
	})
	const snapshot: ArenaAuctionSnapshot = projectArenaEvents(decoded)
	return snapshot.auctions[0] ?? null
}

describe('winningVerdictOf', () => {
	test('null view and no verdicts give null', () => {
		expect(winningVerdictOf(null)).toBeNull()
		expect(winningVerdictOf(viewOf([createEvent()]))).toBeNull()
	})

	test('the highest-anchored winner verdict is returned', () => {
		const verdict = winningVerdictOf(viewOf([createEvent(), verdictEvent({ outcome: 'winner', height: 10, bidId: 'bid-x' })]))
		expect(verdict?.outcome).toBe('winner')
	})

	test('an older winner beneath a newer cancelled is a disagreement, not a win', () => {
		const view = viewOf([
			createEvent(),
			verdictEvent({ outcome: 'winner', height: 10, bidId: 'bid-x' }),
			verdictEvent({ outcome: 'cancelled', height: 20 }),
		])
		expect(winningVerdictOf(view)).toBeNull()
	})
})

describe('winningBidderOf', () => {
	test('maps the winner verdict’s bid id to the bidder', () => {
		const bidId = 'bid-winner'
		const view = viewOf([createEvent(), bidEvent(bidId), verdictEvent({ outcome: 'winner', height: 10, bidId })])
		expect(winningBidderOf(view)).toBe(WINNER)
	})

	test('a verdict with no bid id, or one naming an absent bid, has no bidder', () => {
		const noBid = viewOf([createEvent(), verdictEvent({ outcome: 'winner', height: 10 })])
		expect(winningBidderOf(noBid)).toBeNull()
		const missingBid = viewOf([createEvent(), verdictEvent({ outcome: 'winner', height: 10, bidId: 'absent' })])
		expect(winningBidderOf(missingBid)).toBeNull()
	})

	test('null view is null', () => {
		expect(winningBidderOf(null)).toBeNull()
	})
})

describe('formatClaimAddress', () => {
	test('joins the address and drops an empty additional line', () => {
		expect(
			formatClaimAddress({
				name: 'Satoshi Nakamoto',
				firstLineOfAddress: '123 Main Street',
				city: 'Los Angeles',
				zipPostcode: '90210',
				country: 'United States',
			}),
		).toBe('Satoshi Nakamoto\n123 Main Street\nLos Angeles 90210\nUnited States')
	})

	test('keeps a non-empty additional-information line', () => {
		expect(
			formatClaimAddress({
				name: 'A',
				firstLineOfAddress: 'B',
				additionalInformation: 'Apt 4B',
				city: 'C',
				zipPostcode: 'D',
				country: 'E',
			}),
		).toBe('A\nB\nApt 4B\nC D\nE')
	})
})