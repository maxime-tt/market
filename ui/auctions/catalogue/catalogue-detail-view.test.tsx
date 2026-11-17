import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ArenaAuctionDetailModel } from '@ui/auction/arena/model'
import { CatalogueDetailView, CatalogueLivePip, type CatalogueDetailViewProps } from './catalogue-detail-view'

/**
 * These cases pin the port's honesty rules: the arena read-model is the only
 * source, a field the read does not carry is dropped (never defaulted), and a
 * `null` end renders in words. The model is a literal, so a test renders any
 * read state without a relay.
 */
const bidder = 'aa'.repeat(32)

const model: ArenaAuctionDetailModel = {
	coordinate: '1440:ab:lot-42',
	seller: 'ab'.repeat(32),
	d: 'lot-42',
	title: 'A vintage chronograph',
	imageUrl: null,
	startingBid: 1_000,
	topBidTotal: 1_200,
	bidCount: 2,
	bidsWithoutAmount: 0,
	endsAt: 1_600,
	phase: 'open',
	verdict: null,
	verdictCount: 0,
	validatorCount: 0,
	divergent: false,
	relayCount: 2,
	description: 'A described lot.',
	minIncrement: 100,
	mode: 'antisnipe',
	windowSec: 60,
	durationSec: 600,
	sellerWallet: null,
	v4vSplit: null,
	versions: 1,
	rootEventId: 'r'.repeat(64),
	canonicalEventId: 'c'.repeat(64),
	rootCreatedAt: 1_000,
	bids: [
		{ eventId: 'b1', bidder, createdAt: 1_200, amount: 1_000, relays: ['r1'] },
		{ eventId: 'b2', bidder, createdAt: 1_300, amount: 200, relays: ['r1'] },
	],
	positions: [{ bidder, total: 1_200 }],
}

const relayHealth = { answered: 2, total: 2 }

function render(overrides: Partial<CatalogueDetailViewProps> = {}): string {
	return renderToStaticMarkup(
		createElement(CatalogueDetailView, {
			model,
			status: 'settled',
			relayHealth,
			now: 1_400,
			...overrides,
		}),
	)
}

describe('CatalogueDetailView', () => {
	test('states the escrow — the arena read has no funding mode to assert', () => {
		const html = render()
		expect(html).toContain('catalogue-escrow-notice')
		expect(html).toContain('escrow')
	})

	test('counts down against the read’s now, not the browser clock', () => {
		expect(render()).toContain('3m 20s')
	})

	test('shows the leader position as the price, from the read', () => {
		const html = render()
		expect(html).toContain('catalogue-price')
		expect(html).toContain('1,200')
		expect(html).toContain('catalogue-leader')
	})

	test('an auction with no stated end says so in words, never a 0', () => {
		const html = render({ model: { ...model, endsAt: null, phase: 'unknown' } })
		expect(html).toContain('End time unknown')
	})

	test('orders the bid feed newest-first by committed time', () => {
		const html = render()
		const first = html.indexOf('+200')
		const second = html.indexOf('+1,000')
		expect(first).toBeGreaterThan(-1)
		expect(second).toBeGreaterThan(-1)
		expect(first).toBeLessThan(second)
	})

	test('bidding is the host’s slot, not a form in this view', () => {
		const without = render()
		expect(without).not.toContain('catalogue-bid-slot')
		const withSlot = render({ bidPanel: createElement('div', { 'data-testid': 'host-bid-panel' }, 'bid') })
		expect(withSlot).toContain('catalogue-bid-slot')
		expect(withSlot).toContain('host-bid-panel')
	})

	test('the deferred live surface renders nothing without a feed', () => {
		expect(renderToStaticMarkup(createElement(CatalogueLivePip, { feedUrl: null }))).toBe('')
		expect(renderToStaticMarkup(createElement(CatalogueLivePip, { feedUrl: '/stream.m3u8' }))).toContain('catalogue-live-pip')
		expect(render()).not.toContain('catalogue-live-pip')
	})

	test('a lot the read has not delivered says the read state, not “missing”', () => {
		const html = render({ model: null, status: 'loading' })
		expect(html).toContain('catalogue-detail-state')
		expect(html).toContain('Reading this auction from relays')
	})

	test('renders the chain clock only in the host’s words, and says nothing without one', () => {
		expect(render()).not.toContain('catalogue-chain-clock')
		const html = render({ chainClockLabel: 'Chain time as of height 207, 12 s ago — stale' })
		expect(html).toContain('catalogue-chain-clock')
		expect(html).toContain('Chain time as of height 207, 12 s ago — stale')
	})
})
