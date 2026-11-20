import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ArenaAuctionDetailModel } from '@ui/auction/arena/model'
import {
	ARENA_RING_LENGTH,
	ArenaLotView,
	arenaBidRows,
	arenaClock,
	arenaLadder,
	arenaRingOffset,
	type ArenaLotBidProps,
	type ArenaLotViewProps,
} from './arena-lot-view'

const alice = 'aa'.repeat(32)
const bob = 'bb'.repeat(32)

const model: ArenaAuctionDetailModel = {
	coordinate: '1440:ab:lot-42',
	seller: 'ab'.repeat(32),
	d: 'lot-42',
	title: 'A vintage chronograph',
	imageUrl: null,
	startingBid: 1_000,
	topBidTotal: 1_500,
	bidCount: 3,
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
	minIncrementBps: 200,
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
		{ eventId: 'b1', bidder: alice, createdAt: 1_200, amount: 1_000, relays: ['r1'] },
		{ eventId: 'b2', bidder: bob, createdAt: 1_250, amount: 1_100, relays: ['r1'] },
		{ eventId: 'b3', bidder: alice, createdAt: 1_300, amount: 500, relays: ['r1'] },
	],
	positions: [
		{ bidder: alice, total: 1_500 },
		{ bidder: bob, total: 1_100 },
	],
	receipts: [],
	refundsByBidder: { [bob]: 77 },
	settleReceipt: null,
	createRefusal: null,
	acceptance: { accepted: true, acceptedHeight: 4210, admitEventId: 'admit-event-1' },
	bidRefusals: {},
	admissions: {},
}

function bid(over: Partial<ArenaLotBidProps> = {}): ArenaLotBidProps {
	return {
		viewer: bob,
		check: { allowed: true, reason: 'ok', amount: 500, minimum: 1_600, ownPosition: 1_100 },
		blockedReason: null,
		amountInput: '1600',
		onAmountChange: () => {},
		pending: false,
		submission: { phase: 'idle' },
		onSubmit: () => {},
		onSubmitAmount: () => {},
		...over,
	}
}

function render(over: Partial<ArenaLotViewProps> = {}): string {
	return renderToStaticMarkup(
		createElement(ArenaLotView, { model, status: 'settled', relayHealth: { answered: 2, total: 2 }, now: 1_400, bid: bid(), ...over }),
	)
}

describe('arena lot helpers', () => {
	test('clock formats like the demo', () => {
		expect(arenaClock(63)).toBe('1:03')
		expect(arenaClock(3_725)).toBe('1:02:05')
		expect(arenaClock(2 * 86_400 + 4 * 3600)).toBe('2d 04h')
		expect(arenaClock(-5)).toBe('0:00')
	})

	test('ring empties as the lot runs down', () => {
		expect(arenaRingOffset(600, 600)).toBe(0)
		expect(arenaRingOffset(0, 600)).toBeCloseTo(ARENA_RING_LENGTH)
		expect(arenaRingOffset(300, 600)).toBeCloseTo(ARENA_RING_LENGTH / 2)
	})

	test('ladder targets positions and publishes deltas', () => {
		const steps = arenaLadder({ minimum: 1_600, ownPosition: 1_100 }, 100)
		expect(steps.map((s) => s.target)).toEqual([1_600, 1_800, 2_100])
		expect(steps.map((s) => s.delta)).toEqual([500, 700, 1_000])
		expect(arenaLadder({ minimum: null, ownPosition: null }, 100)).toEqual([])
		// No steps when the bidder's own position is not known: the delta cannot
		// be computed, so the ladder does not measure from a guessed zero.
		expect(arenaLadder({ minimum: 1_600, ownPosition: null }, 100)).toEqual([])
	})

	test("the leader's step is a real raise, not the 1-sat self-raise clamp", () => {
		// The floor for the bidder already at the top is the top itself
		// (`bid-rules.ts`: "a bidder improving their OWN standing need only reach
		// the top"), so `max(1, minimum − own)` would publish exactly 1 sat: legal
		// under R2-A, and not a step. Every step raises the leader's own position.
		const steps = arenaLadder({ minimum: 532, ownPosition: 532 }, 10)
		expect(steps.map((s) => s.target)).toEqual([542, 552, 582])
		expect(steps.map((s) => s.delta)).toEqual([10, 20, 50])
		// …and none of them is the clamp.
		expect(steps.every((s) => s.delta >= 10)).toBe(true)
	})

	test('bid rows carry the running position, newest first', () => {
		const rows = arenaBidRows(model)
		expect(rows.map((r) => r.eventId)).toEqual(['b3', 'b2', 'b1'])
		expect(rows[0]!.position).toBe(1_500)
	})

	test('a refunded leg adds nothing to the running position', () => {
		const rows = arenaBidRows({
			...model,
			receipts: [
				{
					eventId: 'r-1',
					bidId: 'b1',
					outcome: 'refund',
					height: 400,
					blockHash: 'beef',
					settledAt: 1,
					paramsVersion: 'pv-1',
					paramsVersionMismatch: null,
					outputs: [],
					total: 1_000,
					destinationCount: 0,
					outputsWithoutAmount: 0,
				},
			],
		})
		// b1 (1,000) is dead: alice's position after b3 is her live 500, not 1,500.
		expect(rows.map((r) => [r.eventId, r.position])).toEqual([
			['b3', 500],
			['b2', 1_100],
			['b1', 0],
		])
	})
})

describe('ArenaLotView', () => {
	test('renders the arena price, ring and ladder from the read', () => {
		const html = render()
		expect(html).toContain('A vintage chronograph')
		expect(html).toContain('1,500')
		expect(html).toContain('Current bid')
		expect(html).toContain('3:20')
		expect(html).toContain('1,600')
		expect(html).toContain('refunded')
		expect(html).toContain('LIVE')
	})

	test('an ended lot hides the controls and says why', () => {
		const html = render({
			now: 2_000,
			model: { ...model, phase: 'ended' },
			bid: bid({ blockedReason: 'ended', check: { allowed: false, reason: 'ended', amount: null, minimum: 1_600, ownPosition: 1_100 } }),
		})
		expect(html).toContain('ENDED')
		expect(html).toContain('Bidding has closed for this auction.')
		expect(html).not.toContain('arena-lot-ladder')
		expect(html).toContain('Top bid at close')
	})

	test('a signed-out viewer keeps the controls, inert', () => {
		const html = render({
			bid: bid({
				viewer: null,
				blockedReason: 'no-wallet',
				check: { allowed: false, reason: 'no-wallet', amount: null, minimum: 1_600, ownPosition: null },
			}),
		})
		expect(html).toContain('arena-lot-ladder')
		expect(html).toContain('Sign in to bid')
	})

	test('every ladder step shows the position it reaches and the delta that position publishes', () => {
		const html = render()
		// The floor is 1,600 for a bidder at 1,100, so Next reaches 1,600 — the
		// number the button shows and puts in the field — and publishes a 500 delta.
		expect(html).toContain('Next: reach position 1,600 sats, publishing 500 sats')
		expect(html).toContain('data-publishes="500"')
		expect(html).toContain('data-reaches="1600"')
		expect(html).toContain('→ adds 500 sats')
		// The position the bidder means to hold is the big number on the button.
		expect(html).toContain('<b>1,600</b>')
		expect(html).not.toContain('<b>500</b>')
	})

	test('the swipe shows the position it reaches and publishes that position’s delta', () => {
		const html = render()
		expect(html).toContain('Swipe to bid: reach position 1,600 sats, publishing 500 sats')
		expect(html).toContain('data-publishes="500"')
		expect(html).toContain('adds 500')
	})

	test('a position the read could not determine is said in words, never summed', () => {
		const html = render({
			model: { ...model, positions: [{ bidder: alice, total: null }], topBidTotal: null },
		})
		expect(html).toContain('position not known')
		expect(html).toContain('The top position is not known')
		expect(html).toContain('not stated')
	})

	test('a missing lot renders the read state, not a zero', () => {
		const html = render({ model: null, status: 'loading' })
		expect(html).toContain('arena-lot-state')
		expect(html).not.toContain('0 sats')
	})

	test('a lot the chain has not accepted shows the banner and no bid controller', () => {
		// The bid controller is handed in ready to render, as the host does; the view
		// must null it for an unaccepted lot, because nothing on it may move money.
		const html = render({
			model: {
				...model,
				phase: 'unaccepted',
				acceptance: { accepted: false, acceptedHeight: null, admitEventId: null },
			},
		})
		expect(html).toContain('data-testid="arena-lot-acceptance"')
		expect(html).toContain('data-accepted="false"')
		expect(html).toContain('no relay carried a create-admission fact')
		expect(html).not.toContain('arena-lot-ladder')
		expect(html).not.toContain('Sign in to bid')
		expect(html).toContain('data-phase="unaccepted"')
	})

	test('no third-party hosts or Google in the view', () => {
		const html = render()
		expect(html).not.toMatch(/https?:\/\//)
	})
})

describe('arena lot gallery', () => {
	const photo = (n: number) => ({ type: 'image' as const, url: `https://img.example/${n}.jpg` })

	test('one photo shows the stage and no thumbnails', () => {
		const html = render({ model: { ...model, imageUrl: photo(1).url, media: [photo(1)] } })
		expect(html).toContain('src="https://img.example/1.jpg"')
		expect(html).not.toContain('data-testid="arena-lot-thumbs"')
	})

	test('several items show clickable thumbnails under the stage, the first selected', () => {
		const media = [photo(1), photo(2), photo(3), { type: 'video' as const, url: 'https://img.example/v.mp4' }]
		const html = render({ model: { ...model, imageUrl: photo(1).url, media } })
		expect(html).toContain('data-testid="arena-lot-thumbs"')
		expect(html.match(/class="arn-thumb[ "]/g)).toHaveLength(4)
		expect(html).toContain('aria-pressed="true"')
		expect(html).toContain('Video 4 of 4')
		expect(html).toContain('1 / 4')
		expect(html.indexOf('arena-lot-stage')).toBeLessThan(html.indexOf('arena-lot-thumbs'))
	})

	test('a host that sends no media list still shows imageUrl', () => {
		const { media: _drop, ...rest } = { ...model, imageUrl: photo(9).url }
		const html = render({ model: rest as typeof model })
		expect(html).toContain('src="https://img.example/9.jpg"')
	})
})
