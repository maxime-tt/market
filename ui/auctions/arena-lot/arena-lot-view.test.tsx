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
}

function bid(over: Partial<ArenaLotBidProps> = {}): ArenaLotBidProps {
	return {
		viewer: bob,
		check: { allowed: true, reason: 'ok', amount: 500, minimum: 1_600, ownPosition: 1_100 },
		blockedReason: null,
		amountInput: '500',
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
	})

	test('bid rows carry the running position, newest first', () => {
		const rows = arenaBidRows(model)
		expect(rows.map((r) => r.eventId)).toEqual(['b3', 'b2', 'b1'])
		expect(rows[0]!.position).toBe(1_500)
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

	test('a signed-out viewer with sign-in wired gets live, full-colour controls', () => {
		const html = render({
			bid: bid({
				viewer: null,
				blockedReason: 'no-wallet',
				check: { allowed: false, reason: 'no-wallet', amount: null, minimum: 1_600, ownPosition: null },
				onSignIn: () => {},
			}),
		})
		const place = html.match(/<button[^>]*data-testid="arena-lot-place"[^>]*>/)?.[0] ?? ''
		expect(place).not.toContain('disabled')
		expect(html).toContain('Swipe to bid')
		expect(html).not.toMatch(/<button[^>]*disabled[^>]*aria-label="Next/)
	})

	test('a missing lot renders the read state, not a zero', () => {
		const html = render({ model: null, status: 'loading' })
		expect(html).toContain('arena-lot-state')
		expect(html).not.toContain('0 sats')
	})

	test('no third-party hosts or Google in the view', () => {
		const html = render()
		expect(html).not.toMatch(/https?:\/\//)
	})
})
