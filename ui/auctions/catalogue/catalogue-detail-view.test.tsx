import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ArenaAuctionDetailModel, ArenaReceiptModel } from '@ui/auction/arena/model'
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
	endSource: 'create-derived',
	createDerivedEndsAt: 1_600,
	committedEndHeight: null,
	committedEndOrdinal: null,
	phase: 'open',
	verdict: null,
	verdictCount: 0,
	validatorCount: 0,
	divergent: false,
	relayCount: 2,
	description: 'A described lot.',
	media: [],
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
	receipts: [],
	refundsByBidder: {},
	settleReceipt: null,
	createRefusal: null,
	bidRefusals: {},
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

	test('the read-model carries no reserve or funding mode, and neither is rendered', () => {
		// The retired arena detail asserted the same absence; this keeps it pinned
		// to the view that replaced it (the arena read has neither field, `model.ts`).
		const html = render()
		expect(html).not.toContain('Reserve')
		expect(html).not.toContain('Funding mode')
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

	test('with no 1444 read the lot says “no receipt read”, never “not paid”', () => {
		const html = render()
		expect(html).toContain('catalogue-receipt')
		expect(html).toContain('no receipt read')
		expect(html).not.toContain('not paid')
		expect(html).not.toContain('paid ')
	})

	test('a settle receipt renders the money line, distinct from the verdict claim', () => {
		const settle: ArenaReceiptModel = {
			eventId: 's1',
			bidId: 'b2',
			outcome: 'settle',
			height: 900,
			blockHash: 'f'.repeat(64),
			settledAt: 1_500,
			paramsVersion: 'p1',
			paramsVersionMismatch: null,
			outputs: [
				{ recipient: 'seller', amount: 900, id: 'k' },
				{ recipient: 'v4v', amount: 100, id: 'k' },
			],
			total: 1_000,
			destinationCount: 2,
			outputsWithoutAmount: 0,
		}
		const html = render({ model: { ...model, settleReceipt: settle } })
		expect(html).toContain('paid 1,000 sats to 2 destinations at height 900')
		expect(html).not.toContain('no receipt read')
	})

	test('a single-destination settle reads “to the seller”, and a mismatched params version is flagged not hidden', () => {
		const settle: ArenaReceiptModel = {
			eventId: 's1',
			bidId: 'b2',
			outcome: 'settle',
			height: 901,
			blockHash: 'f'.repeat(64),
			settledAt: 1_500,
			paramsVersion: 'p2',
			paramsVersionMismatch: true,
			outputs: [{ recipient: 'seller', amount: 900, id: 'k' }],
			total: 900,
			destinationCount: 1,
			outputsWithoutAmount: 0,
		}
		const html = render({ model: { ...model, settleReceipt: settle } })
		expect(html).toContain('paid 900 sats to the seller at height 901')
		expect(html).toContain('different params version')
	})

	test('a refund receipt marks the bidder position “refunded at height N”', () => {
		const html = render({ model: { ...model, refundsByBidder: { [bidder]: 400 } } })
		expect(html).toContain('catalogue-refund-receipt')
		expect(html).toContain('refunded at height 400')
	})

	test('with no refund receipt the position carries no refund line', () => {
		expect(render()).not.toContain('catalogue-refund-receipt')
		expect(render()).not.toContain('refunded at height')
	})
})

// =========================================================================
// The committed end and the create refusal on the lot detail
// =========================================================================

describe('CatalogueDetailView — the committed end and the create refusal', () => {
	test('a create-derived end is labelled as create-derived', () => {
		const html = render()
		expect(html).toContain('catalogue-end-source')
		expect(html).toContain('create-derived end')
	})

	test('a committed end names the height and the per-bid ordinal, not a count', () => {
		const html = render({
			model: {
				...model,
				endsAt: 1_800,
				endSource: 'committed',
				createDerivedEndsAt: 1_600,
				committedEndHeight: 690,
				committedEndOrdinal: 2,
			},
		})
		expect(html).toContain('committed end at height 690')
		expect(html).toContain('extension 2 of this lot')
		expect(html).not.toContain('extended 2 times')
	})

	test('a lot whose create the chain refused renders the chain’s reason verbatim', () => {
		const html = render({
			model: { ...model, createRefusal: { reason: 'title required (max 120 chars)', height: 1749, refusalEventId: 'ref-1' } },
		})
		expect(html).toContain('catalogue-create-refused')
		expect(html).toContain('the chain refused this listing: title required (max 120 chars)')
	})

	test('a lot with no refusal read renders no refusal banner', () => {
		expect(render()).not.toContain('catalogue-create-refused')
	})
})
