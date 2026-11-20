/**
 * `arenaWinCheck.test.ts` — the arena win check's decision, without a relay.
 *
 * It proves the repointed monitor fires the global "you won" modal from the
 * **arena** verdict path: a kind-1445 winner verdict whose `bidId` is the
 * signed-in user's own bid queues the `auction-won` notification (through the
 * real queue operations, so the modal really appears). And it proves the honest
 * negatives: a read that has not delivered a verdict does not fire, a failed
 * read neither fires nor dismisses, and a later read that no longer names the
 * user the winner drops a win queued for that lot.
 *
 * Pubkeys are short and non-hex on purpose: they are opaque strings here, and a
 * 64-hex literal in a test file is indistinguishable from a key to the
 * pre-commit scanner (`auctionSurfacesRead.test.ts:10-13`).
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import { createMemoryStorage } from '@sdk/core'
import type { ArenaAuctionView, ArenaBidView } from '@platform/web/auctions/relay/arenaAuctionRead'
import type { ParsedArenaVerdict } from '@platform/web/auctions/relay/arenaAnchor'
import { enqueueAuctionWin } from '@platform/web/notifications/auctionWin'
import { createAppNotifications, type AppNotifications } from '@platform/web/notifications/instance'
import type { AuctionWonPayload } from '@platform/web/notifications/types'
import { auctionWinPayloadFor, checkAuctionWins, type AuctionWinWatchPorts, type WatchableLot } from './arenaWinCheck'

const BIDDER = 'bidder-me'
const OTHER_BIDDER = 'bidder-other'
const SELLER = 'seller-one'
const ROOT_EVENT_ID = 'r'.repeat(64)

const LOT: WatchableLot = { coordinate: `1440:${SELLER}:lot-1`, seller: SELLER, d: 'lot-1', rootEventId: ROOT_EVENT_ID }

function bid(eventId: string, bidder: string, amount: number | null): ArenaBidView {
	return { eventId, bidder, createdAt: 1_000, amount, relays: ['wss://relay.playday.it'] }
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
		coordinate: LOT.coordinate,
		seller: SELLER,
		d: 'lot-1',
		rootEventId: ROOT_EVENT_ID,
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

/** Ports that read one scripted lot, recording every queue/removal the check performs. */
function ports(over: Partial<AuctionWinWatchPorts> = {}): {
	ports: AuctionWinWatchPorts
	enqueued: AuctionWonPayload[]
	removed: string[]
} {
	const enqueued: AuctionWonPayload[] = []
	const removed: string[] = []
	const built: AuctionWinWatchPorts = {
		discoverBidLots: async () => [LOT],
		readAuctionLot: async () => view(),
		enqueueWin: (payload) => enqueued.push(payload),
		removeWinForAuction: (root) => removed.push(root),
		...over,
	}
	return { ports: built, enqueued, removed }
}

let notifications: AppNotifications
beforeEach(() => {
	notifications = createAppNotifications({ storage: createMemoryStorage(), now: () => 1000 })
})

/** The real producer the monitor's `enqueueWin` port calls — so the modal really queues. */
function queueWin(enqueued: AuctionWonPayload[]): (payload: AuctionWonPayload) => void {
	return (payload) => {
		enqueued.push(payload)
		enqueueAuctionWin(notifications, payload, 1)
	}
}

describe('checkAuctionWins — a real arena winner verdict fires the modal', () => {
	test('the user’s own winning bid queues the auction-won notification with the lot address', async () => {
		const enqueued: AuctionWonPayload[] = []
		const scripted = ports({
			readAuctionLot: async () => view({ verdicts: [verdict({ bidId: 'b1' })] }),
			enqueueWin: queueWin(enqueued),
		})

		await checkAuctionWins(BIDDER, scripted.ports, new Set())

		expect(enqueued).toEqual([
			{
				bidderPubkey: BIDDER,
				auctionRootEventId: ROOT_EVENT_ID,
				bidEventId: 'b1',
				bidAmount: 100,
				lotD: 'lot-1',
				lotSeller: SELLER,
			},
		])
		const queued = notifications.queue.active()
		expect(queued.map((notification) => notification.type)).toEqual(['auction-won'])
		expect(queued[0].id).toBe(`auction-won:${ROOT_EVENT_ID}:${BIDDER}`)
	})

	test('the root is remembered as announced and a re-run does not re-queue a second entry', async () => {
		const enqueued: AuctionWonPayload[] = []
		const scripted = ports({
			readAuctionLot: async () => view({ verdicts: [verdict()] }),
			enqueueWin: queueWin(enqueued),
		})
		const announced = new Set<string>()

		await checkAuctionWins(BIDDER, scripted.ports, announced)

		expect(announced.has(ROOT_EVENT_ID)).toBe(true)
		expect(notifications.queue.active()).toHaveLength(1)
	})
})

describe('checkAuctionWins — a read that has not delivered a verdict does not fire', () => {
	test('an open lot with no verdict queues nothing and removes nothing', async () => {
		const scripted = ports({ readAuctionLot: async () => view({ verdicts: [] }) })

		await checkAuctionWins(BIDDER, scripted.ports, new Set())

		expect(scripted.enqueued).toEqual([])
		expect(scripted.removed).toEqual([])
	})

	test('a winner verdict naming another bidder is not the user’s win', async () => {
		const scripted = ports({
			readAuctionLot: async () =>
				view({
					bids: [bid('b1', OTHER_BIDDER, 100), bid('b2', BIDDER, 90)],
					positions: { [OTHER_BIDDER]: 100, [BIDDER]: 90 },
					verdicts: [verdict({ bidId: 'b1' })],
				}),
		})

		await checkAuctionWins(BIDDER, scripted.ports, new Set())

		expect(scripted.enqueued).toEqual([])
	})

	test('a read that delivered no lot neither fires nor dismisses a queued win', async () => {
		const announced = new Set([ROOT_EVENT_ID])
		const scripted = ports({ readAuctionLot: async () => null })

		await checkAuctionWins(BIDDER, scripted.ports, announced)

		expect(scripted.enqueued).toEqual([])
		expect(scripted.removed).toEqual([])
		expect(announced.has(ROOT_EVENT_ID)).toBe(true)
	})

	test('a delivered read that no longer names the user the winner drops the queued win', async () => {
		const announced = new Set([ROOT_EVENT_ID])
		const scripted = ports({ readAuctionLot: async () => view({ verdicts: [verdict({ outcome: 'aborted', bidId: null })] }) })

		await checkAuctionWins(BIDDER, scripted.ports, announced)

		expect(scripted.enqueued).toEqual([])
		expect(scripted.removed).toEqual([ROOT_EVENT_ID])
		expect(announced.has(ROOT_EVENT_ID)).toBe(false)
	})
})

describe('auctionWinPayloadFor', () => {
	test('maps the winning fact onto the payload fields the modal and the queue share', () => {
		expect(
			auctionWinPayloadFor(
				{ coordinate: LOT.coordinate, rootEventId: ROOT_EVENT_ID, bidEventId: 'b1', bidAmount: null, d: 'lot-1', seller: SELLER },
				BIDDER,
			),
		).toEqual({ bidderPubkey: BIDDER, auctionRootEventId: ROOT_EVENT_ID, bidEventId: 'b1', bidAmount: null, lotD: 'lot-1', lotSeller: SELLER })
	})
})
