/**
 * `FeaturedAuctionsEditor.test.tsx` — the admin featured-auctions tab's two
 * states, rendered from a real arena projection.
 *
 * No network, no relay: the entries and the picker options come from
 * `resolveFeaturedAuctionEntries` / `featuredAuctionOptions` over a snapshot
 * projected from fixture create events, exactly as the route derives them. The
 * assertions are about what the surface is allowed to claim: an empty list says
 * it is empty, a published lot renders as a lot, and an entry whose lot the
 * settled read does not carry says so instead of rendering a blank card.
 */

import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { NostrEventLike } from '@sdk/core'
import { ARENA_AUCTION_CREATE_KIND } from '@sdk/commerce/auctions/constants'
import { decodeArenaEvent, projectArenaEvents } from '@platform/web/auctions/relay/arenaAuctionRead'
import { FeaturedAuctionsEditor } from './FeaturedAuctionsEditor'
import {
	featuredAuctionOptions,
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

function readOf(events: readonly NostrEventLike[], status: FeaturedAuctionRead['status'] = 'settled'): FeaturedAuctionRead {
	const decoded = events.map((event) => {
		const result = decodeArenaEvent(event, 'wss://relay.test')
		if (!result.ok) throw new Error(`fixture refused: ${result.refusal.reason}`)
		return result.event
	})
	return { snapshot: projectArenaEvents(decoded), status, relayHealth: { answered: 1, total: 1 } }
}

function renderEditor(read: FeaturedAuctionRead, featured: readonly string[], options = featuredAuctionOptions(read, featured)): string {
	return renderToStaticMarkup(
		createElement(FeaturedAuctionsEditor, {
			entries: resolveFeaturedAuctionEntries(featured, read, NOW),
			options,
			read,
			picked: '',
			onPickChange: () => {},
			onAdd: () => {},
			onRemove: () => {},
			onMoveUp: () => {},
			onMoveDown: () => {},
			isAdding: false,
			isReordering: false,
			isRemoving: false,
		}),
	)
}

describe('FeaturedAuctionsEditor — empty state', () => {
	test('no curated entries and no published lot says both, and offers no picker', () => {
		const markup = renderEditor(readOf([]), [])
		expect(markup).toContain('No featured auctions yet')
		expect(markup).toContain('No published auctions to feature')
		expect(markup).not.toContain('Choose a published auction')
	})

	test('a read that answered nothing does not claim there are no lots', () => {
		const markup = renderEditor(readOf([], 'no-relays'), [])
		expect(markup).toContain('No relay answered')
		expect(markup).toContain('not the same as there being none')
		expect(markup).not.toContain('No published auctions to feature')
	})
})

describe('FeaturedAuctionsEditor — populated state', () => {
	test('a published lot renders with its title and starting bid', () => {
		const read = readOf([createEvent('lot-a')])
		const markup = renderEditor(read, [`1440:${SELLER}:lot-a`])
		expect(markup).toContain('Lot lot-a')
		expect(markup).toContain('Starting bid 1000 sats')
		expect(markup).not.toContain('No featured auctions yet')
	})

	test('a second published lot is offered in the picker, the featured one is not', () => {
		const read = readOf([createEvent('lot-a'), createEvent('lot-b')])
		const featured = [`1440:${SELLER}:lot-a`]
		const options = featuredAuctionOptions(read, featured)
		const markup = renderEditor(read, featured, options)
		expect(options.map((option) => option.coordinate)).toEqual([`1440:${SELLER}:lot-b`])
		expect(markup).toContain('Choose a published auction')
		expect(markup).not.toContain('No published auctions to feature')
	})

	test('an entry whose lot the settled read does not carry says so and keeps Remove', () => {
		const read = readOf([createEvent('lot-a')])
		const markup = renderEditor(read, [`1440:${SELLER}:gone`])
		expect(markup).toContain('Auction no longer published')
		expect(markup).toContain(`1440:${SELLER}:gone`)
		expect(markup).toContain('Remove')
		expect(markup).not.toContain('Starting bid')
	})

	test('an entry the read has not decided about is not accused of being unpublished', () => {
		const markup = renderEditor(readOf([], 'incomplete'), [`1440:${SELLER}:lot-a`])
		expect(markup).toContain('Auction not read yet')
		expect(markup).not.toContain('Auction no longer published')
	})
})