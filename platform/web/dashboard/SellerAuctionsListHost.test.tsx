/**
 * `SellerAuctionsListHost.test.tsx` — the seller dashboard's own-lots list.
 *
 * No network, no mint, no relay: fixtures are **real 1440 events** run through
 * the real decode + projection chain, and the read *state* is a prop, so every
 * state is rendered literally. The point under test is that this list is the
 * public read narrowed to one seller, with its own honest sentences — and that
 * "You have no auctions yet" is reachable only from a `settled` read.
 */
import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ARENA_AUCTION_CREATE_KIND } from '@sdk/commerce/auctions/constants'
import type { NostrEventLike } from '@sdk/core'
import {
	decodeArenaEvent,
	projectArenaEvents,
	type ArenaAuctionSnapshot,
	type ArenaReadHealth,
} from '@platform/web/auctions/relay/arenaAuctionRead'
import { SellerAuctionsListHost, sellerAuctionsSnapshot, sellerListEmptyMessage } from './SellerAuctionsListHost'
import { sellerAuctionHref } from './sellerAuctionHref'

const SELLER = 'seller-alice'
const OTHER_SELLER = 'seller-bob'

let idCounter = 0
function nextId(prefix: string): string {
	idCounter += 1
	return `${prefix}-${idCounter}`
}

function createEvent(over: { d?: string; seller?: string; created_at?: number; durationSec?: number | null } = {}): NostrEventLike {
	const d = over.d ?? 'lot-1'
	return {
		id: nextId('create'),
		pubkey: over.seller ?? SELLER,
		created_at: over.created_at ?? 1000,
		kind: ARENA_AUCTION_CREATE_KIND,
		tags: [['d', d]],
		content: JSON.stringify({
			auction_id: d,
			title: `Lot ${d}`,
			startPrice: 1000,
			minIncrement: 100,
			mode: 'fixed',
			...(over.durationSec === undefined
				? { durationSec: 3600 }
				: over.durationSec === null
					? {}
					: { durationSec: over.durationSec }),
		}),
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

const EMPTY = snapshotOf([])
const OWN_LOT = snapshotOf([createEvent({ d: 'mine-1', seller: SELLER, created_at: 2000 })])
const MIXED = snapshotOf([
	createEvent({ d: 'mine-1', seller: SELLER, created_at: 2000 }),
	createEvent({ d: 'theirs-1', seller: OTHER_SELLER, created_at: 3000 }),
])

const NOW = 2000
const HEALTH = { answered: 1, total: 2 }
const CARD = 'data-slot="arena-auction-card"'

function renderHost(over: Partial<Parameters<typeof SellerAuctionsListHost>[0]> = {}): string {
	return renderToStaticMarkup(
		createElement(SellerAuctionsListHost, {
			snapshot: OWN_LOT,
			status: 'settled',
			relayHealth: HEALTH,
			now: NOW,
			seller: SELLER,
			sort: 'newest',
			hideEnded: false,
			onSortChange: () => {},
			onToggleHideEnded: () => {},
			onReset: () => {},
			...over,
		}),
	)
}

describe('SellerAuctionsListHost — read states', () => {
	test('loading states the read and claims no count, and never "no auctions"', () => {
		const markup = renderHost({ snapshot: null, status: 'loading', relayHealth: { answered: 0, total: 2 } })
		expect(markup).toContain('Reading your auctions from relays')
		expect(markup).toContain('not that you have no auctions')
		expect(markup).not.toContain('You have no auctions yet')
		expect(markup).not.toContain(CARD)
	})

	test('settled with no lot of yours is the one state that says you have none', () => {
		const markup = renderHost({ snapshot: EMPTY, status: 'settled', relayHealth: { answered: 2, total: 2 } })
		expect(markup).toContain('You have no auctions yet.')
		expect(markup).toContain('data-state="settled"')
	})

	test('"You have no auctions yet" is reachable ONLY from settled', () => {
		for (const status of ['loading', 'incomplete', 'no-relays', 'error'] as const) {
			expect(renderHost({ snapshot: EMPTY, status })).not.toContain('You have no auctions yet')
		}
	})

	test('a settled read carrying only other sellers is "no auctions of yours", not "none exist"', () => {
		const markup = renderHost({ snapshot: MIXED, seller: SELLER, status: 'settled' })
		// Only the seller's own lot rendered; the other seller's lot is absent.
		expect(markup.split(CARD).length - 1).toBe(1)
		expect(markup).toContain('Lot mine-1')
		expect(markup).not.toContain('Lot theirs-1')
	})

	test('no relay answered is not "you have none", and states the relay health', () => {
		const markup = renderHost({ snapshot: EMPTY, status: 'no-relays', relayHealth: { answered: 0, total: 2 } })
		expect(markup).toContain('No relay answered')
		expect(markup).toContain('not the same as you having no auctions')
		expect(markup).toContain('0 of 2 relays answered')
	})

	test('an incomplete read keeps every lot that arrived and says the picture is partial', () => {
		const markup = renderHost({ snapshot: OWN_LOT, status: 'incomplete' })
		expect(markup).toContain(CARD)
		expect(markup).toContain('data-slot="seller-auctions-list-notice"')
		expect(markup).toContain('not the whole picture')
	})

	test('a settled read whose lots are all filtered out blames the filter, not the relays', () => {
		const onlyEnded = snapshotOf([createEvent({ d: 'ended', seller: SELLER, created_at: 1000, durationSec: 10 })])
		const markup = renderHost({ snapshot: onlyEnded, status: 'settled', hideEnded: true, relayHealth: { answered: 2, total: 2 } })
		expect(markup).toContain('No auctions match the current filter')
		expect(markup).not.toContain('You have no auctions yet')
		expect(markup).not.toContain(CARD)
	})

	test('every read state has its own sentence', () => {
		const statuses = ['loading', 'settled', 'incomplete', 'no-relays', 'error'] as const
		const titles = statuses.map((status) => sellerListEmptyMessage(status).title)
		expect(new Set(titles).size).toBe(statuses.length)
	})
})

describe('sellerAuctionsSnapshot', () => {
	test('narrows to one seller and preserves the rest of the snapshot', () => {
		const scoped = sellerAuctionsSnapshot(MIXED, SELLER)
		expect(scoped?.auctions.map((auction) => auction.d)).toEqual(['mine-1'])
		expect(scoped?.health).toBe(MIXED.health)
	})

	test('null in, null out — "not read yet" is not "read and empty"', () => {
		expect(sellerAuctionsSnapshot(null, SELLER)).toBeNull()
	})
})

describe('the card address is the dashboard lot route, scoped to the seller', () => {
	test('a lot links to /dashboard/products/auctions/<d>?seller=<seller>', () => {
		const markup = renderHost({ snapshot: OWN_LOT })
		expect(markup).toContain(`href="${sellerAuctionHref('mine-1', SELLER)}"`)
		expect(sellerAuctionHref('mine-1', SELLER)).toBe(`/dashboard/products/auctions/mine-1?seller=${SELLER}`)
	})

	test('a `d` needing escaping is escaped', () => {
		expect(sellerAuctionHref('a b/c', SELLER)).toBe(`/dashboard/products/auctions/a%20b%2Fc?seller=${SELLER}`)
	})
})