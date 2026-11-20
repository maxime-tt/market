/**
 * `arenaWinRead.test.ts` — the winner fact the global "you won" monitor watches.
 *
 * These cases pin the trigger's honesty: a win fires only when the read's
 * **latest** verdict names `winner` and its `bidId` resolves to a bid the
 * signed-in user authored. A read that has not delivered a verdict (no
 * `verdicts`), a non-winner verdict, a verdict naming another bidder's bid, and
 * a verdict whose `bidId` the read holds no bid for all answer `null` — never a
 * win invented from a partial read.
 *
 * Pubkeys are short and non-hex on purpose: they are opaque strings here, and a
 * 64-hex literal in a test file is indistinguishable from a key to the
 * pre-commit scanner (`auctionSurfacesRead.test.ts:10-13`).
 */
import { describe, expect, test } from 'bun:test'
import type { ArenaAuctionView, ArenaBidView } from '@platform/web/auctions/relay/arenaAuctionRead'
import type { ParsedArenaVerdict } from '@platform/web/auctions/relay/arenaAnchor'
import { arenaWinFactFor } from './arenaWinRead'

const BIDDER = 'bidder-me'
const OTHER_BIDDER = 'bidder-other'
const SELLER = 'seller-one'

function bid(eventId: string, bidder: string, amount: number | null, createdAt = 1_000): ArenaBidView {
	return { eventId, bidder, createdAt, amount, relays: ['wss://relay.playday.it'] }
}

function verdict(over: Partial<ParsedArenaVerdict> = {}): ParsedArenaVerdict {
	return {
		eventId: 'v1',
		auctionId: 'lot-1',
		bidId: 'b1',
		outcome: 'winner',
		payoutTokenSha256: null,
		height: 1282,
		blockHash: 'AB'.repeat(32),
		derivedFrom: 'committed_state',
		validatorPubkey: 'validator-one',
		...over,
	}
}

function view(over: Partial<ArenaAuctionView> = {}): ArenaAuctionView {
	const bids = over.bids ?? [bid('b1', BIDDER, 100)]
	return {
		coordinate: `1440:${SELLER}:lot-1`,
		seller: SELLER,
		d: 'lot-1',
		rootEventId: 'r'.repeat(64),
		canonicalEventId: 'c'.repeat(64),
		createdAt: 1_000,
		rootCreatedAt: 900,
		content: { auctionId: 'lot-1', title: 'A lot', image: null } as ArenaAuctionView['content'],
		versions: 1,
		bids,
		positions: { [BIDDER]: 100 },
		topBid: { bidder: BIDDER, total: 100 },
		bidsWithoutAmount: 0,
		verdicts: [],
		receipts: [],
		refundForBid: {},
		settleForBid: {},
		settleReceipt: null,
		committedEnd: null,
		committedEnds: [],
		createRefusal: null,
		bidRefusals: [],
		admissions: [],
		admissionForBid: {},
		relays: ['wss://relay.playday.it'],
		...over,
	}
}

describe('arenaWinFactFor — a real winner verdict for the user’s own bid fires', () => {
	test('the latest winner verdict naming the user’s bid yields the lot identity and the winning bid', () => {
		const fact = arenaWinFactFor(view({ verdicts: [verdict({ bidId: 'b1' })] }), BIDDER)
		expect(fact).toEqual({
			coordinate: `1440:${SELLER}:lot-1`,
			rootEventId: 'r'.repeat(64),
			bidEventId: 'b1',
			bidAmount: 100,
			d: 'lot-1',
			seller: SELLER,
		})
	})

	test('the winning bid’s delta stands in when the position could not be derived', () => {
		const fact = arenaWinFactFor(
			view({ bids: [bid('b1', BIDDER, 250)], positions: { [BIDDER]: null }, verdicts: [verdict({ bidId: 'b1' })] }),
			BIDDER,
		)
		expect(fact?.bidAmount).toBe(250)
	})
})

describe('arenaWinFactFor — a read that has not delivered a verdict does not fire', () => {
	test('no verdicts at all is not a win', () => {
		expect(arenaWinFactFor(view({ verdicts: [] }), BIDDER)).toBeNull()
	})

	test('the latest verdict being a non-winner outcome is not a win', () => {
		expect(arenaWinFactFor(view({ verdicts: [verdict({ outcome: 'aborted' })] }), BIDDER)).toBeNull()
	})

	test('a winner verdict naming another bidder’s bid is not the user’s win', () => {
		const otherBidView = view({
			bids: [bid('b1', OTHER_BIDDER, 100), bid('b2', BIDDER, 90)],
			positions: { [OTHER_BIDDER]: 100, [BIDDER]: 90 },
			verdicts: [verdict({ bidId: 'b1' })],
		})
		expect(arenaWinFactFor(otherBidView, BIDDER)).toBeNull()
	})

	test('a winner verdict whose bidId the read holds no bid for is not a win', () => {
		expect(arenaWinFactFor(view({ bids: [bid('b2', BIDDER, 100)], verdicts: [verdict({ bidId: 'b1' })] }), BIDDER)).toBeNull()
	})

	test('a newer contradicting verdict above an older winner is a disagreement, not a win', () => {
		// The read sorts verdicts height-descending; the latest row is the authority.
		const contradicted = view({ verdicts: [verdict({ eventId: 'v2', outcome: 'aborted', bidId: null }), verdict({ eventId: 'v1' })] })
		expect(arenaWinFactFor(contradicted, BIDDER)).toBeNull()
	})

	test('a signed-out bidder never matches', () => {
		expect(arenaWinFactFor(view({ verdicts: [verdict()] }), '')).toBeNull()
	})
})
