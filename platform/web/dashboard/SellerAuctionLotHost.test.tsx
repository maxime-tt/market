/**
 * `SellerAuctionLotHost.test.tsx` — the dashboard's read-only per-lot page.
 *
 * No network, no mint, no relay: every snapshot is a **real** projection over
 * fixture 1440 events. The fulfilment host (queries + the claim dialog) and the
 * identity host are doubled, so the real `ui/auction/arena/*` surfaces render
 * and the resolution rules — "not found" only from `settled`, an ambiguous `d`
 * listed rather than guessed — are asserted against the actual views.
 */
import { beforeAll, describe, expect, mock, test } from 'bun:test'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { NostrEventLike } from '@sdk/core'
import {
	ARENA_AUCTION_BID_KIND,
	ARENA_AUCTION_CREATE_KIND,
	ARENA_VERDICT_KIND,
	ARENA_VERDICT_SCHEMA,
} from '@sdk/commerce/auctions/constants'
import { decodeArenaEvent, projectArenaEvents, type ArenaAuctionSnapshot } from '@platform/web/auctions/relay/arenaAuctionRead'
import type { ArenaSurfacesReadState } from '@platform/web/auctions/relay/auctionSurfacesRead'
import type { ArenaSurfaceStatus } from '@ui/auction/arena/model'

// The fulfilment host pulls in the order/claim queries and the wallet — this
// test only needs to know it was handed the resolved lot.
mock.module('@platform/web/dashboard/AuctionFulfilmentHost', () => ({
	AuctionFulfilmentHost: (props: { view: { coordinate: string } | null }) =>
		props.view === null
			? null
			: createElement('div', { 'data-testid': 'fulfilment-stub', 'data-coordinate': props.view.coordinate }),
	winningBidderOf: () => null,
	formatClaimAddress: () => '',
}))

mock.module('@platform/web/profiles/userCardHosts', () => ({
	UserCardHost: (props: { pubkey?: string }) => createElement('span', { 'data-testid': 'user-card-stub' }, props.pubkey ?? ''),
}))

// Imported after the mocks above (a static import is hoisted past `mock.module`).
let SellerAuctionLotHost: (typeof import('./SellerAuctionLotHost'))['SellerAuctionLotHost']
let resolveArenaLot: (typeof import('@platform/web/auctions/relay/arenaLotRead'))['resolveArenaLot']
let sellerAuctionHref: (typeof import('./sellerAuctionHref'))['sellerAuctionHref']
beforeAll(async () => {
	;({ SellerAuctionLotHost } = await import('./SellerAuctionLotHost'))
	;({ resolveArenaLot } = await import('@platform/web/auctions/relay/arenaLotRead'))
	;({ sellerAuctionHref } = await import('./sellerAuctionHref'))
})

const SELLER_A = 'seller-alice'
const SELLER_B = 'seller-bob'
const BIDDER = 'bidder-one'

let idCounter = 0
function nextId(prefix = 'evt'): string {
	idCounter += 1
	return `${prefix}-${idCounter}`
}

function createEvent(over: { id?: string; pubkey?: string; created_at?: number; d?: string; durationSec?: number } = {}): NostrEventLike {
	const d = over.d ?? 'lot-1'
	return {
		id: over.id ?? nextId('create'),
		pubkey: over.pubkey ?? SELLER_A,
		created_at: over.created_at ?? 1000,
		kind: ARENA_AUCTION_CREATE_KIND,
		tags: [['d', d]],
		content: JSON.stringify({
			auction_id: d,
			title: `Lot ${d}`,
			startPrice: 1000,
			minIncrement: 25,
			durationSec: over.durationSec ?? 3600,
			mode: 'fixed',
		}),
	}
}

function bidEvent(): NostrEventLike {
	return {
		id: nextId('bid'),
		pubkey: BIDDER,
		created_at: 1100,
		kind: ARENA_AUCTION_BID_KIND,
		tags: [],
		content: JSON.stringify({ auction_id: 'lot-1', amount: 100 }),
	}
}

function verdictEvent(over: { outcome?: string } = {}): NostrEventLike {
	const validator = 'validator-one'
	return {
		id: nextId('verdict'),
		pubkey: validator,
		created_at: 1300,
		kind: ARENA_VERDICT_KIND,
		tags: [
			['auction', 'lot-1'],
			['height', '10'],
			['hash', 'beef'],
			['p', validator],
		],
		content: JSON.stringify({
			schema: ARENA_VERDICT_SCHEMA,
			auction_id: 'lot-1',
			outcome: over.outcome ?? 'winner',
			height: 10,
			block_hash: 'beef',
			derived_from: 'committed_state',
			bid_id: 'bid-from-content',
		}),
	}
}

function snapshotOf(events: NostrEventLike[]): ArenaAuctionSnapshot {
	const decoded = events.map((event) => {
		const result = decodeArenaEvent(event, 'wss://relay.one')
		if (!result.ok) throw new Error(`fixture refused: ${result.refusal.reason} ${result.refusal.detail}`)
		return result.event
	})
	return projectArenaEvents(decoded)
}

function readState(events: NostrEventLike[], status: ArenaSurfaceStatus, relayHealth = { answered: 1, total: 1 }): ArenaSurfacesReadState {
	return { snapshot: snapshotOf(events), status, relayHealth }
}

function render(read: ArenaSurfacesReadState, over: { d?: string; seller?: string | null; now?: number } = {}): string {
	return renderToStaticMarkup(
		createElement(SellerAuctionLotHost, {
			d: over.d ?? 'lot-1',
			seller: over.seller ?? null,
			now: over.now ?? 2000,
			read,
		}) as ReactNode,
	)
}

describe('resolveArenaLot (shared rule)', () => {
	test('one seller for the d is found; two is ambiguous; none is missing', () => {
		expect(resolveArenaLot(snapshotOf([createEvent()]), 'lot-1').kind).toBe('found')
		expect(resolveArenaLot(snapshotOf([createEvent({ pubkey: SELLER_A }), createEvent({ pubkey: SELLER_B })]), 'lot-1').kind).toBe(
			'ambiguous',
		)
		expect(resolveArenaLot(snapshotOf([createEvent()]), 'nope').kind).toBe('missing')
	})
})

describe('SellerAuctionLotHost — found', () => {
	test('renders the detail and the verdict panel, and offers no bid slot', () => {
		const markup = render(readState([createEvent(), verdictEvent()], 'settled'))
		expect(markup).toContain('data-slot="arena-auction-detail"')
		expect(markup).toContain('data-slot="arena-verdict-panel"')
		// Read-only: the bid panel slot is deliberately absent.
		expect(markup).not.toContain('data-slot="arena-auction-detail-bid"')
		// The fulfilment panel was handed the resolved lot.
		expect(markup).toContain('data-testid="fulfilment-stub"')
		expect(markup).toContain('data-coordinate="1440:seller-alice:lot-1"')
		// Identity is host-injected, never a raw key.
		expect(markup).toContain('data-testid="user-card-stub"')
	})

	test('a read bid is shown as a derived position, never as the outcome', () => {
		const markup = render(readState([createEvent(), bidEvent()], 'settled'))
		expect(markup).toContain('Positions (derived)')
		expect(markup).toContain('the verdict names the winner')
	})
})

describe('SellerAuctionLotHost — not found only from a settled read', () => {
	test('settled says "no such auction"', () => {
		const markup = render(readState([], 'settled'))
		expect(markup).toContain('No such auction was read.')
		expect(markup).not.toContain('data-testid="fulfilment-stub"')
	})

	test('every unfinished state refuses to say "no such auction"', () => {
		const expectations: Array<[ArenaSurfaceStatus, string]> = [
			['loading', 'Reading this auction from relays'],
			['incomplete', 'The read stopped before every relay answered.'],
			['no-relays', 'No relay answered'],
			['error', 'could not be read right now'],
		]
		for (const [status, sentence] of expectations) {
			const markup = render(readState([], status))
			expect(markup).toContain(sentence)
			expect(markup).not.toContain('No such auction was read.')
		}
	})

	test('before the first result (no snapshot) it is a partial read, not a verdict', () => {
		const markup = render({ snapshot: null, status: 'loading', relayHealth: { answered: 0, total: 0 } })
		expect(markup).toContain('Reading this auction from relays')
		expect(markup).not.toContain('No such auction was read.')
	})
})

describe('SellerAuctionLotHost — an ambiguous d', () => {
	test('lists both sellers with disambiguating dashboard links and renders no lot', () => {
		const markup = render(readState([createEvent({ pubkey: SELLER_A }), createEvent({ pubkey: SELLER_B })], 'settled'))
		expect(markup).toContain('data-slot="seller-lot-ambiguous"')
		expect(markup).toContain('More than one auction has this id')
		expect(markup).toContain(`href="${sellerAuctionHref('lot-1', SELLER_A)}"`)
		expect(markup).toContain(`href="${sellerAuctionHref('lot-1', SELLER_B)}"`)
		expect(markup).not.toContain('data-slot="arena-auction-detail"')
	})

	test('the ?seller param picks exactly one lot', () => {
		const markup = render(
			readState([createEvent({ pubkey: SELLER_A }, ), createEvent({ pubkey: SELLER_B })], 'settled'),
			{ seller: SELLER_B },
		)
		expect(markup).not.toContain('data-slot="seller-lot-ambiguous"')
		expect(markup).toContain('data-slot="arena-auction-detail"')
		expect(markup).toContain('data-coordinate="1440:seller-bob:lot-1"')
	})
})