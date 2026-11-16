/**
 * `ArenaAuctionLotHost.test.tsx` — the `/auctions/<d>` detail experience.
 *
 * No network, no mint, no relay: every snapshot is a **real** projection
 * (`decodeArenaEvent` → `projectArenaEvents`) over fixture events, so what is
 * exercised is the chain the route runs — resolve the `d`, project the model,
 * compose the surfaces — with the socket and the identity/bid hosts doubled.
 *
 * The two doubled modules are first-party platform seams the host injects as
 * props (`AuctionBidHost`, `UserCardHost`); mocking them is what lets the real
 * `ui/auction/arena/*` surfaces render, so the term copy and the bid-slot
 * placement are asserted against the actual views, not against stubs.
 *
 * Pubkeys are short and non-hex on purpose: they are opaque strings here, and a
 * 64-hex literal in a test file is indistinguishable from a key to the
 * pre-commit scanner (`auctionSurfacesRead.test.ts:10-13`).
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
import { decodeArenaEvent, projectArenaEvents, type ArenaAuctionSnapshot } from './arenaAuctionRead'
import type { ArenaSurfacesReadState } from './auctionSurfacesRead'
import type { ArenaSurfaceStatus } from '@ui/auction/arena/model'

// The bid panel drags in the wallet, the signer and the escrow ports; the test
// only needs to know it was wired and handed the resolved model.
mock.module('@platform/web/auctions/relay/AuctionBidHost', () => ({
	AuctionBidHost: (props: { model: { coordinate: string } | null; readStatus: string }) =>
		createElement('div', {
			'data-testid': 'bid-host-stub',
			'data-coordinate': props.model?.coordinate ?? 'none',
			'data-read-status': props.readStatus,
		}),
}))

mock.module('@platform/web/profiles/userCardHosts', () => ({
	UserCardHost: (props: { pubkey?: string }) =>
		createElement('span', { 'data-testid': 'user-card-stub' }, props.pubkey ?? ''),
}))

// Imported after the mocks above (a static import is hoisted past `mock.module`).
let ArenaAuctionLotHost: (typeof import('./ArenaAuctionLotHost'))['ArenaAuctionLotHost']
let resolveArenaLot: (typeof import('./arenaLotRead'))['resolveArenaLot']
let lotHref: (typeof import('./arenaLotRead'))['lotHref']
beforeAll(async () => {
	;({ ArenaAuctionLotHost } = await import('./ArenaAuctionLotHost'))
	;({ resolveArenaLot, lotHref } = await import('./arenaLotRead'))
})

const SELLER_A = 'seller-alice'
const SELLER_B = 'seller-bob'
const BIDDER = 'bidder-one'

let idCounter = 0
function nextId(prefix = 'evt'): string {
	idCounter += 1
	return `${prefix}-${idCounter}`
}

function createEvent(
	over: { id?: string; pubkey?: string; created_at?: number; d?: string } = {},
	content: Record<string, unknown> = {},
): NostrEventLike {
	const d = over.d ?? (content.auction_id as string) ?? 'lot-1'
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
			durationSec: 3600,
			mode: 'fixed',
			...content,
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

function verdictEvent(over: { auctionId?: string; outcome?: string; height?: number; validator?: string } = {}): NostrEventLike {
	const auctionId = over.auctionId ?? 'lot-1'
	const height = over.height ?? 10
	const validator = over.validator ?? 'validator-one'
	return {
		id: nextId('verdict'),
		pubkey: validator,
		created_at: 1300,
		kind: ARENA_VERDICT_KIND,
		tags: [
			['auction', auctionId],
			['height', String(height)],
			['hash', 'beef'],
			['p', validator],
		],
		content: JSON.stringify({
			schema: ARENA_VERDICT_SCHEMA,
			auction_id: auctionId,
			outcome: over.outcome ?? 'winner',
			height,
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
		createElement(ArenaAuctionLotHost, {
			d: over.d ?? 'lot-1',
			seller: over.seller ?? null,
			now: over.now ?? 2000,
			read,
			onPublished: (_eventId: string) => {},
		}) as ReactNode,
	)
}

// =========================================================================
// Resolving the d
// =========================================================================

describe('resolveArenaLot', () => {
	test('one seller for the d is found', () => {
		const snapshot = snapshotOf([createEvent()])
		const lookup = resolveArenaLot(snapshot, 'lot-1')
		expect(lookup.kind).toBe('found')
	})

	test('two sellers sharing a d is ambiguous, listing both, guessing neither', () => {
		const snapshot = snapshotOf([createEvent({ pubkey: SELLER_A }), createEvent({ pubkey: SELLER_B })])
		const lookup = resolveArenaLot(snapshot, 'lot-1')
		expect(lookup.kind).toBe('ambiguous')
		if (lookup.kind !== 'ambiguous') return
		expect(lookup.candidates.map((candidate) => candidate.seller)).toEqual([SELLER_A, SELLER_B])
	})

	test('the ?seller disambiguator picks the named seller', () => {
		const snapshot = snapshotOf([createEvent({ pubkey: SELLER_A }), createEvent({ pubkey: SELLER_B })])
		const lookup = resolveArenaLot(snapshot, 'lot-1', SELLER_B)
		expect(lookup.kind).toBe('found')
		if (lookup.kind !== 'found') return
		expect(lookup.view.seller).toBe(SELLER_B)
	})

	test('a seller that does not have the d is missing, not the other seller lot', () => {
		const snapshot = snapshotOf([createEvent({ pubkey: SELLER_A })])
		expect(resolveArenaLot(snapshot, 'lot-1', SELLER_B).kind).toBe('missing')
	})

	test('a d nobody published is missing, and so is an unknown d with a seller filter', () => {
		const snapshot = snapshotOf([createEvent()])
		expect(resolveArenaLot(snapshot, 'nope').kind).toBe('missing')
		expect(resolveArenaLot(snapshot, 'nope', SELLER_A).kind).toBe('missing')
	})

	test('lotHref carries the d and the seller so the candidate address is unambiguous', () => {
		expect(lotHref('lot 1/x', SELLER_A)).toBe(`/auctions/${encodeURIComponent('lot 1/x')}?seller=${SELLER_A}`)
	})
})

// =========================================================================
// Found — the arena surfaces render from the real model
// =========================================================================

describe('ArenaAuctionLotHost — a found lot', () => {
	test('renders the detail with the bid panel in its slot and the verdict panel', () => {
		const markup = render(readState([createEvent()], 'settled'))
		expect(markup).toContain('data-slot="arena-auction-detail"')
		expect(markup).toContain('data-slot="arena-auction-detail-bid"')
		expect(markup).toContain('data-testid="bid-host-stub"')
		// The bid host was handed the resolved model and the read's own status.
		expect(markup).toContain('data-coordinate="1440:seller-alice:lot-1"')
		expect(markup).toContain('data-read-status="settled"')
		expect(markup).toContain('data-slot="arena-verdict-panel"')
		// The seller identity is host-injected, not a raw key.
		expect(markup).toContain('data-testid="user-card-stub"')
	})

	test('the terms come from the real create fields', () => {
		const markup = render(
			readState(
				[
					createEvent(
						{},
						{ title: 'Hand-woven rug', description: 'A rug from Oaxaca.', minIncrement: 25, mode: 'antisnipe', windowSec: 60 },
					),
				],
				'settled',
			),
		)
		expect(markup).toContain('Hand-woven rug')
		expect(markup).toContain('A rug from Oaxaca.')
		expect(markup).toContain('Starting bid')
		expect(markup).toContain('1,000 sats')
		expect(markup).toContain('Minimum increment')
		expect(markup).toContain('25 sats')
		expect(markup).toContain('antisnipe')
		expect(markup).toContain('Anti-snipe')
	})

	test('an unstated term reads as "not stated", never as a zero', () => {
		const markup = render(readState([createEvent({}, { mode: undefined, minIncrement: undefined, durationSec: undefined })], 'settled'))
		expect(markup).toContain('not stated')
		expect(markup).not.toContain('>0 sats')
	})

	test('a read bid and its derived position are shown, never as the outcome', () => {
		const markup = render(readState([createEvent(), bidEvent({ amount: 100 })], 'settled'))
		expect(markup).toContain('+100 sats')
		expect(markup).toContain('Positions (derived)')
		expect(markup).toContain('the verdict names the winner')
	})
})

// =========================================================================
// Not found — only ever from a settled read
// =========================================================================

describe('ArenaAuctionLotHost — an empty read', () => {
	test('settled says "no such auction" and renders no bid panel', () => {
		const markup = render(readState([], 'settled'))
		expect(markup).toContain('No such auction was read.')
		expect(markup).not.toContain('data-testid="bid-host-stub"')
		expect(markup).not.toContain('data-slot="arena-verdict-panel"')
	})

	test('loading says it is still reading, and never "no such auction"', () => {
		const markup = render(readState([], 'loading'))
		expect(markup).toContain('Reading this auction from relays')
		expect(markup).not.toContain('No such auction was read.')
	})

	test('incomplete says the read stopped early, and never "no such auction"', () => {
		const markup = render(readState([], 'incomplete'))
		expect(markup).toContain('The read stopped before every relay answered.')
		expect(markup).not.toContain('No such auction was read.')
	})

	test('no-relays says no relay answered, and never "no such auction"', () => {
		const markup = render(readState([], 'no-relays'))
		expect(markup).toContain('No relay answered')
		expect(markup).not.toContain('No such auction was read.')
	})

	test('error says it could not be read, and never "no such auction"', () => {
		const markup = render(readState([], 'error'))
		expect(markup).toContain('could not be read right now')
		expect(markup).not.toContain('No such auction was read.')
	})

	test('before the first result (no snapshot yet) it is a partial read, not a verdict', () => {
		const markup = render({ snapshot: null, status: 'loading', relayHealth: { answered: 0, total: 0 } })
		expect(markup).toContain('Reading this auction from relays')
		expect(markup).not.toContain('No such auction was read.')
	})
})

// =========================================================================
// Ambiguous — named and listed, never guessed
// =========================================================================

describe('ArenaAuctionLotHost — an ambiguous d', () => {
	test('lists both sellers with disambiguating links and renders no lot', () => {
		const markup = render(readState([createEvent({ pubkey: SELLER_A }), createEvent({ pubkey: SELLER_B })], 'settled'))
		expect(markup).toContain('data-slot="arena-lot-ambiguous"')
		expect(markup).toContain('More than one auction has this id')
		expect(markup).toContain(`/auctions/lot-1?seller=${SELLER_A}`)
		expect(markup).toContain(`/auctions/lot-1?seller=${SELLER_B}`)
		// It refused: no lot was chosen, so no detail and no bid panel.
		expect(markup).not.toContain('data-slot="arena-auction-detail"')
		expect(markup).not.toContain('data-testid="bid-host-stub"')
	})

	test('the ?seller param disambiguates to exactly one lot', () => {
		const markup = render(
			readState([createEvent({ pubkey: SELLER_A }, { title: 'Alice lot' }), createEvent({ pubkey: SELLER_B }, { title: 'Bob lot' })], 'settled'),
			{ seller: SELLER_B },
		)
		expect(markup).not.toContain('data-slot="arena-lot-ambiguous"')
		expect(markup).toContain('data-slot="arena-auction-detail"')
		expect(markup).toContain('Bob lot')
		expect(markup).not.toContain('Alice lot')
	})
})

// =========================================================================
// Verdicts flow through the panel model
// =========================================================================

describe('ArenaAuctionLotHost — verdicts', () => {
	test('a published verdict appears in the panel with its anchoring data', () => {
		const markup = render(readState([createEvent(), verdictEvent({ outcome: 'winner' })], 'settled'))
		expect(markup).toContain('data-slot="arena-verdict-panel"')
		expect(markup).toContain('height 10')
		expect(markup).toContain('Quorum is not implemented')
	})

	test('two disagreeing verdicts are shown as a disagreement the panel refuses to resolve', () => {
		const markup = render(
			readState([createEvent(), verdictEvent({ outcome: 'winner', validator: 'validator-one' }), verdictEvent({ outcome: 'cancelled', validator: 'validator-two' })], 'settled'),
		)
		expect(markup).toContain('data-slot="arena-verdict-disagreement"')
		expect(markup).toContain('does not pick one')
	})
})
