/**
 * `ui/auction/arena/bid-panel.test.tsx` — the bid entry surface and the detail
 * view's bid slot, rendered to static markup.
 *
 * Asserted here: markup, the words each state says, and the slot contract. Not
 * asserted: pixels, focus behaviour, and anything that needs a browser — no
 * dev server is started for this slice.
 *
 * The panel is props-only, so every state below is a literal: a blocked reason,
 * a failed check, a submission phase. Nothing is stubbed because nothing here
 * touches a relay (`ui/AGENTS.md:120`).
 */
import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ArenaBidPanel, bidButtonLabel, bidFloorLabel, isArenaBidSubmissionUnsuccessful, submissionLine, type ArenaBidSubmissionState } from './bid-panel'
import { ArenaAuctionDetail } from './auction-detail'
import { ARENA_BID_ADVISORY, checkArenaBid, type ArenaBidCheck, type ArenaBidderState } from './bid-rules'
import type { ArenaAuctionDetailModel } from './model'

const SELLER = 'seller-alice'
const BIDDER = 'bidder-bob'
const SIGNED_IN: ArenaBidderState = { pubkey: BIDDER, wallet: 'ready' }
const NOW = 2000

function detail(over: Partial<ArenaAuctionDetailModel> = {}): ArenaAuctionDetailModel {
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
		phase: 'open',
		verdict: null,
		verdictCount: 0,
		validatorCount: 0,
		divergent: false,
		relayCount: 2,
		description: null,
		minIncrement: 100,
		reserve: null,
		durationSeconds: 3600,
		lateBidWindowSeconds: null,
		lateBidExtensionSeconds: null,
		maxTotalExtensionSeconds: null,
		locktimeSeconds: null,
		fundingMode: null,
		versions: 1,
		rootEventId: 'root-event-1',
		canonicalEventId: 'root-event-1',
		rootCreatedAt: 1000,
		bids: [],
		positions: [],
		...over,
	}
}

function checkFor(model = detail(), raw = '1000', bidder = SIGNED_IN): ArenaBidCheck {
	return checkArenaBid({ model, status: 'settled', now: NOW, bidder, raw })
}

function panel(over: Partial<Parameters<typeof ArenaBidPanel>[0]> = {}): string {
	const model = over.model === undefined ? detail() : over.model
	const amountInput = over.amountInput ?? '1000'
	return renderToStaticMarkup(
		createElement(ArenaBidPanel, {
			model,
			readStatus: 'settled',
			check: model === null ? null : checkFor(model, amountInput),
			blockedReason: null,
			amountInput,
			onAmountChange: () => {},
			pending: false,
			submission: { phase: 'idle' },
			onSubmit: () => {},
			...over,
		}),
	)
}

// =========================================================================
// The entry surface
// =========================================================================

describe('ArenaBidPanel — the entry surface', () => {
	test('renders an amount input in sats, a button and the floor in words', () => {
		const html = panel()
		expect(html).toContain('data-slot="arena-bid-panel"')
		expect(html).toContain('id="arena-bid-amount"')
		expect(html).toContain('inputMode="numeric"')
		expect(html).toContain('>sats</span>')
		expect(html).toContain('Place bid')
		expect(html).toContain('Opening bid: at least 1,000 sats.')
	})

	test('the unit shown is sats — the unit stored', () => {
		const html = panel()
		expect(html).toContain('sats')
		expect(html.toLowerCase()).not.toContain('usd')
		expect(html.toLowerCase()).not.toContain('€')
	})

	test('the advisory is always present: a pre-check is not validity, and no funds move', () => {
		expect(panel()).toContain(ARENA_BID_ADVISORY)
	})

	test('an invalid amount disables the button and shows the reason as an alert', () => {
		const html = panel({ amountInput: '999' })
		expect(html).toContain('data-slot="arena-bid-invalid"')
		expect(html).toContain('role="alert"')
		expect(html).toContain('The lowest bid accepted here is 1,000 sats.')
		expect(html).toContain('disabled')
	})

	test('a decimal is refused in words, not rounded silently', () => {
		const html = panel({ amountInput: '1000.5' })
		expect(html).toContain('whole satoshis')
	})

	test('while pending the button says so and is disabled', () => {
		const html = panel({ pending: true })
		expect(html).toContain('Submitting…')
		expect(html).toContain('disabled')
	})

	test('the floor for a raise is stated, with the increment that produced it', () => {
		const model = detail({ bidCount: 1, topBidTotal: 1000 })
		expect(panel({ model, amountInput: '1100' })).toContain('Next bid: at least 1,100 sats.')
	})

	test('a bidder with a position is told that bids add to it', () => {
		const model = detail({ bidCount: 1, topBidTotal: 1000, positions: [{ bidder: BIDDER, total: 1000 }] })
		expect(panel({ model, amountInput: '100' })).toContain('Bids add to your position. Yours is 1,000 sats')
	})
})

// =========================================================================
// The honest blocking states
// =========================================================================

describe('ArenaBidPanel — no disabled button without a sentence', () => {
	const cases: { reason: NonNullable<Parameters<typeof ArenaBidPanel>[0]['blockedReason']>; label: string; copy: string }[] = [
		{ reason: 'ended', label: 'Bidding closed', copy: 'Bidding has closed' },
		{ reason: 'own-auction', label: 'Your auction', copy: 'This is your auction' },
		{ reason: 'no-wallet', label: 'Sign in to bid', copy: 'Sign in with a wallet to bid' },
		{ reason: 'wallet-unavailable', label: 'Wallet not ready', copy: 'wallet is not ready' },
		{ reason: 'end-unknown', label: 'No end time stated', copy: 'states no end time' },
		{ reason: 'concluded', label: 'Auction concluded', copy: 'A verdict has been published' },
		{ reason: 'auction-not-read', label: 'Auction not read', copy: 'could not be read' },
	]

	for (const { reason, label, copy } of cases) {
		test(`${reason}: the button says why and the panel explains it`, () => {
			const html = panel({ blockedReason: reason })
			expect(html).toContain(label)
			expect(html).toContain(copy)
			// The input is inert but still visible: the bidder can see the terms.
			expect(html).toContain('id="arena-bid-amount"')
		})
	}

	test('a not-yet-open auction is its own state', () => {
		expect(bidButtonLabel('not-started', checkFor(), false)).toBe('Not open yet')
	})

	test('the no-wallet case does not claim the wallet is broken', () => {
		expect(panel({ blockedReason: 'no-wallet' })).not.toContain('unlock')
		expect(panel({ blockedReason: 'wallet-unavailable' })).toContain('Unlock it')
	})
})

describe('ArenaBidPanel — an auction that was not read', () => {
	test('renders the reading state instead of an empty form', () => {
		const html = renderToStaticMarkup(
			createElement(ArenaBidPanel, {
				model: null,
				readStatus: 'loading',
				check: null,
				blockedReason: 'auction-not-read',
				amountInput: '',
				onAmountChange: () => {},
				pending: false,
				submission: { phase: 'idle' },
				onSubmit: () => {},
			}),
		)
		expect(html).toContain('Reading the auction’s terms from relays…')
		expect(html).toContain('could not be read')
	})
})

// =========================================================================
// After publishing: optimistic but honest
// =========================================================================

describe('submissionLine — what the bidder is told between click and relay', () => {
	test('publishing says nothing has been acknowledged yet', () => {
		const line = submissionLine({ phase: 'publishing', amount: 1200 })!
		expect(line.title).toContain('1,200 sats')
		expect(line.detail).toContain('Nothing has been acknowledged yet')
	})

	test('presumed names the ACK count and refuses to call it an outcome', () => {
		const line = submissionLine({ phase: 'presumed', amount: 1000, eventId: 'ev-1', acceptedBy: ['wss://a'], totalRelays: 3 })!
		expect(line.title).toContain('Bid presumed placed — 1 of 3 relays acknowledged it.')
		expect(line.detail).toContain('not “won”')
		expect(line.detail).toContain('no money has moved')
		expect(line.tone).toBe('warning')
	})

	test('seen is storage, not an outcome', () => {
		const line = submissionLine({ phase: 'seen', amount: 1000, eventId: 'ev-1', acceptedBy: ['wss://a', 'wss://b'], totalRelays: 2 })!
		expect(line.title).toContain('Bid seen on the read')
		expect(line.detail).toContain('That is storage, not an outcome')
	})

	test('unpublished is a failure that names the relays’ answer', () => {
		const line = submissionLine({ phase: 'unpublished', amount: 1000, eventId: 'ev-1', reason: 'No relay accepted it — wss://a (blocked).' })!
		expect(line.title).toContain('not published')
		expect(line.detail).toContain('blocked')
		expect(line.tone).toBe('error')
	})

	test('failed is a failure, and nothing was published', () => {
		const line = submissionLine({ phase: 'failed', amount: 1000, reason: 'Your wallet did not sign the bid.' })!
		expect(line.detail).toContain('Nothing was published')
	})

	test('idle says nothing at all', () => {
		expect(submissionLine({ phase: 'idle' })).toBeNull()
	})

	test('only unpublished and failed are unsuccessful — presumed is not', () => {
		const states: ArenaBidSubmissionState[] = [
			{ phase: 'idle' },
			{ phase: 'publishing', amount: 1 },
			{ phase: 'presumed', amount: 1, eventId: 'e', acceptedBy: ['a'], totalRelays: 1 },
			{ phase: 'seen', amount: 1, eventId: 'e', acceptedBy: ['a'], totalRelays: 1 },
			{ phase: 'unpublished', amount: 1, eventId: 'e', reason: 'x' },
			{ phase: 'failed', amount: 1, reason: 'x' },
		]
		expect(states.filter(isArenaBidSubmissionUnsuccessful).map((state) => state.phase)).toEqual(['unpublished', 'failed'])
	})

	test('the panel renders the submission block with its phase as a data attribute', () => {
		const html = panel({ submission: { phase: 'unpublished', amount: 1000, eventId: 'ev-1', reason: 'No relay accepted it.' } })
		expect(html).toContain('data-slot="arena-bid-submission"')
		expect(html).toContain('data-phase="unpublished"')
		expect(html).toContain('not published')
	})
})

describe('bidButtonLabel and bidFloorLabel', () => {
	test('a missing auction reads as reading terms, not as an enabled bid', () => {
		expect(bidButtonLabel(null, null, false)).toBe('Reading terms…')
	})

	test('an unstated starting bid is stated as unstated', () => {
		expect(bidFloorLabel(detail({ startingBid: null }), checkFor(detail({ startingBid: null })))).toBe('This auction published no starting bid.')
	})
})

// =========================================================================
// The detail view's slot
// =========================================================================

describe('ArenaAuctionDetail — the bid slot', () => {
	test('renders the host panel between the terms and the bids', () => {
		const html = renderToStaticMarkup(
			createElement(ArenaAuctionDetail, {
				model: detail(),
				status: 'settled',
				relayHealth: { answered: 2, total: 2 },
				bidPanel: createElement(ArenaBidPanel, {
					model: detail(),
					readStatus: 'settled',
					check: checkFor(),
					blockedReason: null,
					amountInput: '1000',
					onAmountChange: () => {},
					pending: false,
					submission: { phase: 'idle' },
					onSubmit: () => {},
				}),
			}),
		)
		expect(html).toContain('data-slot="arena-auction-detail-bid"')
		expect(html).toContain('data-slot="arena-bid-panel"')
		const termsAt = html.indexOf('Terms, as published')
		const bidAt = html.indexOf('data-slot="arena-auction-detail-bid"')
		const bidsAt = html.indexOf('>Bids<')
		expect(termsAt).toBeGreaterThan(-1)
		expect(bidAt).toBeGreaterThan(termsAt)
		expect(bidsAt).toBeGreaterThan(bidAt)
	})

	test('omitting the slot renders nothing in its place — no placeholder implying bidding exists', () => {
		const html = renderToStaticMarkup(
			createElement(ArenaAuctionDetail, { model: detail(), status: 'settled', relayHealth: { answered: 2, total: 2 } }),
		)
		expect(html).not.toContain('arena-auction-detail-bid')
		expect(html).not.toContain('Place a bid')
	})
})