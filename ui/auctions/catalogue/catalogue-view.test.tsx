/**
 * `catalogue-view.test.tsx` — the Layout A list and its lot card are honest
 * about the arena read.
 *
 * These cases were the retired `ui/auction/arena/auction-card.tsx` suite's
 * card-honesty assertions, re-pointed onto the ported Layout A card so the
 * behaviours they pin — an unstated end rendered in words, a count qualified
 * while the read runs, a partial sum that is never a `0` — stay asserted after
 * that file was retired. The card's *read-state* sentences (a `null` model) are
 * the host's job now and are asserted in the host suites
 * (`ArenaAuctionsListHost.test.tsx`, `SellerAuctionsListHost.test.tsx`).
 *
 * The card is props-only, so every case is a model literal and no relay exists.
 */
import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ARENA_UNKNOWN_END_LABEL, type ArenaAuctionCardModel, type ArenaSurfaceStatus } from '@ui/auction/arena/model'
import { CatalogueCards, CatalogueLotCard, CatalogueView } from './catalogue-view'

const SELLER = 'seller-alice'

function card(over: Partial<ArenaAuctionCardModel> = {}): ArenaAuctionCardModel {
	return {
		coordinate: `1440:${SELLER}:lot-1`,
		seller: SELLER,
		d: 'lot-1',
		title: 'A handmade mug',
		imageUrl: null,
		startingBid: 1000,
		topBidTotal: null,
		bidCount: 0,
		bidsWithoutAmount: 0,
		endsAt: 4600,
		endSource: 'create-derived',
		createDerivedEndsAt: 4600,
		committedEndHeight: null,
		committedEndOrdinal: null,
		phase: 'open',
		verdict: null,
		verdictCount: 0,
		validatorCount: 0,
		divergent: false,
		relayCount: 2,
		...over,
	}
}

const HEALTH = { answered: 1, total: 2 }

function renderCard(model: ArenaAuctionCardModel, status: ArenaSurfaceStatus = 'settled', now = 2000, href = '/auctions/lot-1'): string {
	return renderToStaticMarkup(createElement(CatalogueLotCard, { card: model, status, now, href }))
}

describe('CatalogueLotCard — what it may state', () => {
	test('a create with no duration renders an unknown end, not a made-up one', () => {
		const html = renderCard(card({ phase: 'unknown', endsAt: null }))
		expect(html).toContain(ARENA_UNKNOWN_END_LABEL)
		expect(html).not.toContain('LIVE')
		expect(html).not.toContain('ENDS')
	})

	test('an ended lot with no verdict states the phase, not an outcome', () => {
		const html = renderCard(card({ phase: 'ended', verdict: null }))
		expect(html).toContain('Ended')
		expect(html).not.toContain('winner')
	})

	test('an end that is in the past renders as ended, not a negative timer', () => {
		const html = renderCard(card({ endsAt: 1000 }), 'settled', 2000)
		expect(html).toContain('ended')
	})

	test('a read verdict is stated beside the phase', () => {
		const html = renderCard(card({ phase: 'ended', verdict: 'winner', verdictCount: 1, validatorCount: 1 }))
		expect(html).toContain('Ended')
		expect(html).toContain('winner')
	})

	test('a partial read says "so far", a finished one does not', () => {
		const loading = renderCard(card({ bidCount: 3, topBidTotal: 300 }), 'incomplete')
		expect(loading).toContain('3 bids so far')
		const settled = renderCard(card({ bidCount: 3, topBidTotal: 300 }), 'settled')
		expect(settled).toContain('3 bids')
		expect(settled).not.toContain('3 bids so far')
	})

	test('bids with no readable amount make the total unknown, never zero', () => {
		const html = renderCard(card({ bidCount: 2, bidsWithoutAmount: 1, topBidTotal: null }))
		expect(html).toContain('total unknown')
		expect(html).not.toContain('0 sats')
	})

	test('relay disagreement is flagged on the card', () => {
		const html = renderCard(card({ divergent: true, verdict: 'winner' }))
		expect(html).toContain('Relays disagree about this auction.')
	})

	test('the card links to the host-resolved href and carries the read state', () => {
		const html = renderCard(card(), 'incomplete', 2000, '/dashboard/products/auctions/lot-1?seller=x')
		expect(html).toContain('href="/dashboard/products/auctions/lot-1?seller=x"')
		expect(html).toContain('data-slot="arena-auction-card"')
		expect(html).toContain('data-state="incomplete"')
	})
})

describe('CatalogueCards / CatalogueView — one card per lot', () => {
	test('CatalogueCards renders the Layout A grid, one card per lot', () => {
		const cards = [card({ d: 'a' }), card({ d: 'b', coordinate: `1440:${SELLER}:b` })]
		const html = renderToStaticMarkup(
			createElement(CatalogueCards, { cards, status: 'settled', relayHealth: HEALTH, now: 2000, hrefFor: (c) => `/auctions/${c.d}` }),
		)
		expect(html.split('data-slot="arena-auction-card"').length - 1).toBe(2)
		expect(html).toContain('href="/auctions/a"')
		expect(html).toContain('href="/auctions/b"')
	})

	test('CatalogueView states the count and qualifies it while the read runs', () => {
		const html = renderToStaticMarkup(
			createElement(CatalogueView, {
				cards: [card()],
				status: 'loading',
				relayHealth: HEALTH,
				now: 2000,
				hrefFor: (c) => `/auctions/${c.d}`,
			}),
		)
		expect(html).toContain('catalogue-count')
		expect(html).toContain('1 lot so far')
		expect(html).toContain('catalogue-escrow-notice')
	})
})
