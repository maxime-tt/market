/**
 * `featuredAuctionLots.test.ts` — the featured-auctions entries against the real
 * arena projection.
 *
 * No network, no relay: every snapshot is a **real** projection
 * (`decodeArenaEvent` → `projectArenaEvents`) over fixture create events, and the
 * read's `status` is handed in literally because that is what the hook publishes.
 * What is asserted is the three-way outcome — a delivered lot, a lot the settled
 * read does not carry, and a coordinate the read has not decided about yet —
 * plus the picker's vocabulary.
 *
 * Pubkeys are short and non-hex on purpose: they are opaque strings here, and a
 * 64-hex literal in a test file is indistinguishable from a key to the pre-commit
 * scanner.
 */

import { describe, expect, test } from 'bun:test'
import type { NostrEventLike } from '@sdk/core'
import { ARENA_AUCTION_CREATE_KIND } from '@sdk/commerce/auctions/constants'
import { decodeArenaEvent, projectArenaEvents, type ArenaAuctionEvent } from '@platform/web/auctions/relay/arenaAuctionRead'
import {
	featuredAuctionCards,
	featuredAuctionOptions,
	featuredAuctionReadNotice,
	resolveFeaturedAuctionEntries,
	type FeaturedAuctionRead,
} from './featuredAuctionLots'

const SELLER = 'seller-alice'
const NOW = 1_700_000_000

let idCounter = 0

function createEvent(d: string, content: Record<string, unknown> = {}): NostrEventLike {
	idCounter += 1
	return {
		id: `create-${idCounter}`,
		pubkey: SELLER,
		created_at: NOW - 60,
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

function decoded(events: readonly NostrEventLike[]): ArenaAuctionEvent[] {
	return events.map((event) => {
		const result = decodeArenaEvent(event, 'wss://relay.test')
		if (!result.ok) throw new Error(`fixture refused: ${result.refusal.reason}`)
		return result.event
	})
}

function readOf(events: readonly NostrEventLike[], status: FeaturedAuctionRead['status'] = 'settled'): FeaturedAuctionRead {
	return {
		snapshot: projectArenaEvents(decoded(events)),
		status,
		relayHealth: { answered: 1, total: 1 },
	}
}

describe('resolveFeaturedAuctionEntries', () => {
	test('a published lot resolves to its own card, in list order', () => {
		const read = readOf([createEvent('lot-a'), createEvent('lot-b')])
		const entries = resolveFeaturedAuctionEntries(
			[`1440:${SELLER}:lot-b`, `1440:${SELLER}:lot-a`],
			read,
			NOW,
		)
		expect(entries.map((entry) => entry.kind)).toEqual(['lot', 'lot'])
		expect(entries.map((entry) => (entry.kind === 'lot' ? entry.card.coordinate : null))).toEqual([
			`1440:${SELLER}:lot-b`,
			`1440:${SELLER}:lot-a`,
		])
		expect(entries[0].kind === 'lot' ? entries[0].card.title : null).toBe('Lot lot-b')
	})

	test('a retired 30408 coordinate is not a lot, even when the seller has a 1440 lot', () => {
		const read = readOf([createEvent('lot-a')])
		const entries = resolveFeaturedAuctionEntries([`30408:${SELLER}:lot-a`], read, NOW)
		expect(entries).toEqual([{ kind: 'missing', coordinate: `30408:${SELLER}:lot-a` }])
	})

	test('a settled read that does not carry the coordinate reports it missing', () => {
		const read = readOf([createEvent('lot-a')])
		expect(resolveFeaturedAuctionEntries([`1440:${SELLER}:gone`], read, NOW)).toEqual([
			{ kind: 'missing', coordinate: `1440:${SELLER}:gone` },
		])
	})

	test('an unsettled read reports the same coordinate unread, not missing', () => {
		const read = readOf([], 'no-relays')
		expect(resolveFeaturedAuctionEntries([`1440:${SELLER}:lot-a`], read, NOW)).toEqual([
			{ kind: 'unread', coordinate: `1440:${SELLER}:lot-a` },
		])
	})

	test('no entries is an empty list, not a placeholder row', () => {
		expect(resolveFeaturedAuctionEntries([], readOf([createEvent('lot-a')]), NOW)).toEqual([])
	})
})

describe('featuredAuctionOptions', () => {
	test('offers every published lot except the ones already featured', () => {
		const read = readOf([createEvent('lot-a'), createEvent('lot-b')])
		expect(featuredAuctionOptions(read, [`1440:${SELLER}:lot-a`])).toEqual([
			{ coordinate: `1440:${SELLER}:lot-b`, label: 'Lot lot-b' },
		])
	})

	test('offers nothing before the read delivers a snapshot', () => {
		expect(featuredAuctionOptions({ snapshot: null, status: 'loading', relayHealth: { answered: 0, total: 0 } }, [])).toEqual([])
	})

	test('every published lot already featured leaves the options empty', () => {
		const read = readOf([createEvent('lot-a')])
		expect(featuredAuctionOptions(read, [`1440:${SELLER}:lot-a`])).toEqual([])
	})
})

describe('featuredAuctionCards', () => {
	test('carries only delivered lots, so an unreadable entry renders no card', () => {
		const read = readOf([createEvent('lot-a')])
		const cards = featuredAuctionCards([`1440:${SELLER}:lot-a`, `1440:${SELLER}:gone`], read, NOW)
		expect(cards.map((card) => card.coordinate)).toEqual([`1440:${SELLER}:lot-a`])
	})
})

describe('featuredAuctionReadNotice', () => {
	test('a settled read states nothing about itself', () => {
		expect(featuredAuctionReadNotice(readOf([]))).toBeNull()
	})

	test('every unsettled state gets its own sentence', () => {
		const loading = featuredAuctionReadNotice({ snapshot: null, status: 'loading', relayHealth: { answered: 0, total: 1 } })
		const noRelays = featuredAuctionReadNotice({ snapshot: null, status: 'no-relays', relayHealth: { answered: 0, total: 1 } })
		const error = featuredAuctionReadNotice({ snapshot: null, status: 'error', relayHealth: { answered: 0, total: 1 } })
		const incomplete = featuredAuctionReadNotice({ snapshot: null, status: 'incomplete', relayHealth: { answered: 1, total: 2 } })
		expect(noRelays).toContain('not the same as there being none')
		expect(incomplete).toContain('1/2')
		expect(new Set([loading, noRelays, error, incomplete]).size).toBe(4)
	})
})