import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { computeBidPosition, deltaForPosition, positionForDelta } from '@platform/web/auctions/catalogue/bidMath'
import { CatalogueDetailView, CatalogueLivePip, type CatalogueDetailViewProps } from './catalogue-detail-view'

const auction = {
	id: 'lot-42',
	title: 'A vintage chronograph',
	seller: 'ab'.repeat(32),
	description: 'A described lot.',
	startingBid: 1_000,
	minIncrement: 100,
	endTime: 1_600,
	status: 'open',
	fundingMode: 'custodial_reservation_v1',
}

const bids = [
	{ id: 'b1', bidder: 'aa'.repeat(32), amount: 1_000, committedAt: 1_200 },
	{ id: 'b2', bidder: 'aa'.repeat(32), amount: 200, committedAt: 1_300 },
]
const rules = { startingBid: 1_000, minIncrement: 100, highBid: 1_200, leaderBidId: 'b2' }

function render(overrides: Partial<CatalogueDetailViewProps> = {}): string {
	const viewerPubkey = overrides.viewerPubkey ?? null
	const bidPosition = computeBidPosition(rules, bids, viewerPubkey ?? '')
	return renderToStaticMarkup(
		createElement(CatalogueDetailView, {
			auction,
			bids,
			viewerPubkey,
			bidPosition,
			positionInput: String(bidPosition.minNextPosition),
			onPositionInput: () => {},
			preview: { delta: bidPosition.minDelta, resultingPosition: bidPosition.minNextPosition, belowMinimum: false },
			isSubmitting: false,
			onSubmitBid: () => {},
			submitError: null,
			submitSuccess: null,
			now: 1_400,
			...overrides,
		}),
	)
}

describe('CatalogueDetailView', () => {
	test('states the money is fake — not optional', () => {
		const html = render()
		expect(html).toContain('FAKE_MONEY_ONLY')
		expect(html).toContain('catalogue-fake-money')
	})

	test('counts down against the committed block time', () => {
		expect(render()).toContain('3m 20s')
	})

	test('the deferred live surface renders nothing without a feed', () => {
		expect(renderToStaticMarkup(createElement(CatalogueLivePip, { feedUrl: null }))).toBe('')
		expect(renderToStaticMarkup(createElement(CatalogueLivePip, { feedUrl: '/stream.m3u8' }))).toContain(
			'catalogue-live-pip',
		)
		// And through the detail view the pip is absent by default.
		expect(render()).not.toContain('catalogue-live-pip')
	})

	test('shows the leader position as the price, from committed state', () => {
		const html = render()
		expect(html).toContain('catalogue-price')
		expect(html).toContain('>1200<')
		expect(html).toContain('2 bids')
	})

	test('the bid hint states the resulting total and the delta, so nothing is hidden', () => {
		// A challenger at minimum: total 1,300, delta 1,300 (they hold nothing).
		const html = render({ viewerPubkey: 'cc'.repeat(32) })
		expect(html).toContain('catalogue-bid-hint')
		expect(html).toContain('Minimum <b>1300</b> sats total')
		expect(html).toContain('holding <b>1300</b> sats in total')
	})

	test('the leader bidding the minimum pays only the increment', () => {
		const me = 'aa'.repeat(32)
		const html = render({ viewerPubkey: me })
		// Leader holds 1,200; the next total is 1,300; the delta is 100.
		expect(html).toContain('holding <b>1300</b> sats in total')
		expect(() => deltaForPosition(1_300, rules, bids, me)).not.toThrow()
		expect(deltaForPosition(1_300, rules, bids, me)).toBe(100)
		expect(positionForDelta(100, rules, bids, me)).toBe(1_300)
	})

	test('disables the submit button below the minimum', () => {
		const html = render({ preview: { delta: 0, resultingPosition: 1_000, belowMinimum: true } })
		expect(html).toContain('catalogue-submit-bid')
		expect(html).toContain('disabled')
	})

	test('an ended auction hides the bid form and names the close', () => {
		const html = render({ auction: { ...auction, status: 'closed' }, now: 2_000 })
		expect(html).not.toContain('catalogue-submit-bid')
		expect(html).toContain('ended')
		expect(html).toContain('Final price')
	})

	test('surfaces the refusal in the status line, and the Q&A honesty notice', () => {
		const html = render({ submitError: 'Minimum bid is 1300 sats' })
		expect(html).toContain('catalogue-bid-error')
		expect(html).toContain('Minimum bid is 1300 sats')
		expect(html).toContain('catalogue-qa-notice')
	})

	test('orders the feed newest-first by committed time', () => {
		const html = render()
		const first = html.indexOf('+200')
		const second = html.indexOf('+1000')
		expect(first).toBeGreaterThan(-1)
		expect(second).toBeGreaterThan(-1)
		expect(first).toBeLessThan(second)
	})
})
