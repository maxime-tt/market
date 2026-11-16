/**
 * `BidderPositionsHost.test.tsx` — the bidder dashboard's own bids.
 *
 * Fixtures are real 1440/1441 events through the real projection. The point
 * under test is the trimmed surface: which lots you bid on, your derived
 * position when the read carries one, the lot's state — and, crucially, that the
 * retired reclaim/collateral machinery is absent.
 */
import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ARENA_AUCTION_BID_KIND, ARENA_AUCTION_CREATE_KIND } from '@sdk/commerce/auctions/constants'
import type { NostrEventLike } from '@sdk/core'
import {
	decodeArenaEvent,
	projectArenaEvents,
	type ArenaAuctionSnapshot,
	type ArenaReadHealth,
} from '@platform/web/auctions/relay/arenaAuctionRead'
import { BidderPositionsHost, bidderLotsEmptyMessage, selectBidderLots } from './BidderPositionsHost'

const SELLER = 'seller-alice'
const BIDDER = 'bidder-one'
const OTHER_BIDDER = 'bidder-two'

let idCounter = 0
function nextId(prefix: string): string {
	idCounter += 1
	return `${prefix}-${idCounter}`
}

function createEvent(over: { d?: string; created_at?: number; durationSec?: number | null } = {}): NostrEventLike {
	const d = over.d ?? 'lot-1'
	return {
		id: nextId('create'),
		pubkey: SELLER,
		created_at: over.created_at ?? 1000,
		kind: ARENA_AUCTION_CREATE_KIND,
		tags: [['d', d]],
		content: JSON.stringify({
			auction_id: d,
			title: `Lot ${d}`,
			startPrice: 1000,
			durationSec: over.durationSec === undefined ? 3600 : over.durationSec,
			mode: 'fixed',
		}),
	}
}

function bidEvent(over: { auctionId?: string; amount?: unknown; pubkey?: string; created_at?: number } = {}): NostrEventLike {
	return {
		id: nextId('bid'),
		pubkey: over.pubkey ?? BIDDER,
		created_at: over.created_at ?? 1100,
		kind: ARENA_AUCTION_BID_KIND,
		tags: [],
		content: JSON.stringify({ auction_id: over.auctionId ?? 'lot-1', amount: over.amount ?? 100 }),
	}
}

function healthOf(over: Partial<ArenaReadHealth> = {}): ArenaReadHealth {
	return {
		relays: [],
		eose: [],
		answered: [],
		pending: [],
		failed: [],
		noRelaysReachable: false,
		empty: true,
		aborted: false,
		...over,
	}
}

function snapshotOf(events: NostrEventLike[]): ArenaAuctionSnapshot {
	const decoded = events.map((event) => {
		const result = decodeArenaEvent(event, 'wss://relay.one')
		if (!result.ok) throw new Error(`fixture refused: ${result.refusal.reason} ${result.refusal.detail}`)
		return result.event
	})
	return projectArenaEvents(decoded, healthOf())
}

const NOW = 2000
const HEALTH = { answered: 1, total: 2 }
const ROW = 'data-slot="bidder-lot-row"'

function renderHost(over: Partial<Parameters<typeof BidderPositionsHost>[0]> = {}): string {
	return renderToStaticMarkup(
		createElement(BidderPositionsHost, {
			snapshot: snapshotOf([createEvent(), bidEvent({ amount: 100 }), bidEvent({ amount: 200 })]),
			status: 'settled',
			relayHealth: HEALTH,
			now: NOW,
			bidder: BIDDER,
			...over,
		}),
	)
}

describe('selectBidderLots', () => {
	test('keeps only lots that carry a bid from the bidder, in the read order', () => {
		const snapshot = snapshotOf([
			createEvent({ d: 'bid-on', created_at: 2000 }),
			createEvent({ d: 'not-mine', created_at: 3000 }),
			bidEvent({ auctionId: 'bid-on' }),
			bidEvent({ auctionId: 'not-mine', pubkey: OTHER_BIDDER }),
		])
		const lots = selectBidderLots(snapshot, BIDDER, NOW)
		expect(lots.map((lot) => lot.d)).toEqual(['bid-on'])
	})

	test('your position is the summed deltas; a bid with no readable amount is not summed as zero', () => {
		const summed = selectBidderLots(snapshotOf([createEvent(), bidEvent({ amount: 100 }), bidEvent({ amount: 200 })]), BIDDER, NOW)
		expect(summed[0].yourPosition).toBe(300)
		expect(summed[0].yourBidCount).toBe(2)

		const unreadable = selectBidderLots(snapshotOf([createEvent(), bidEvent({ amount: 'not-a-number' })]), BIDDER, NOW)
		expect(unreadable[0].yourPosition).toBeNull()
		expect(unreadable[0].bidsWithoutAmount).toBe(1)
		expect(unreadable[0].yourBidCount).toBe(1)
	})

	test('the lot state is its phase and, when present, its verdict', () => {
		const ended = selectBidderLots(snapshotOf([createEvent({ created_at: 1000, durationSec: 10 }), bidEvent()]), BIDDER, NOW)
		expect(ended[0].phase).toBe('ended')
		const endless = selectBidderLots(snapshotOf([createEvent({ durationSec: null }), bidEvent()]), BIDDER, NOW)
		expect(endless[0].phase).toBe('unknown')
	})
})

describe('BidderPositionsHost — the trimmed surface', () => {
	test('a lot you bid on renders with your derived position and its state', () => {
		const markup = renderHost()
		expect(markup).toContain(ROW)
		expect(markup).toContain('Lot lot-1')
		expect(markup).toContain('Your position')
		expect(markup).toContain('300 sats')
		expect(markup).toContain('Your bids')
		expect(markup).toContain('2 bids')
	})

	test('a bid with no readable amount reads "not stated", never "0 sats"', () => {
		const markup = renderHost({ snapshot: snapshotOf([createEvent(), bidEvent({ amount: 'not-a-number' })]) })
		expect(markup).toContain('not stated')
		expect(markup).not.toContain('>0 sats')
	})

	test('the retired reclaim / collateral machinery is gone from the page', () => {
		const markup = renderHost()
		for (const retired of ['Reclaim', 'reclaim', 'Locked collateral', 'Refresh wallet state', 'orphaned', 'PendingToken']) {
			expect(markup).not.toContain(retired)
		}
	})

	test('a settled read with no bid of yours says you have no bids', () => {
		const markup = renderHost({ snapshot: snapshotOf([createEvent(), bidEvent({ pubkey: OTHER_BIDDER })]), status: 'settled' })
		expect(markup).toContain('You have no bids.')
		expect(markup).not.toContain(ROW)
	})

	test('"You have no bids" is reachable ONLY from settled', () => {
		for (const status of ['loading', 'incomplete', 'no-relays', 'error'] as const) {
			expect(renderHost({ snapshot: snapshotOf([]), status })).not.toContain('You have no bids')
		}
	})

	test('every read state has its own sentence', () => {
		const statuses = ['loading', 'settled', 'incomplete', 'no-relays', 'error'] as const
		expect(new Set(statuses.map((status) => bidderLotsEmptyMessage(status).title)).size).toBe(statuses.length)
	})
})