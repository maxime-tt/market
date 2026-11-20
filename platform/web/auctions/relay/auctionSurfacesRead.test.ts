/**
 * Tests for the 1440-series auction-surface adapter
 * (`platform/web/auctions/relay/auctionSurfacesRead.ts`).
 *
 * No network: every relay is a fake `AsyncIterable` over the *real* arena read
 * (`createArenaAuctionRead`), so what is exercised is the chain a route uses —
 * gate, canonical-version resolution, projection, divergence — with the socket
 * replaced.
 *
 * Pubkeys here are short and non-hex on purpose: they are opaque strings to the
 * adapter, and a 64-hex literal in a test file is indistinguishable from a key
 * to the pre-commit scanner.
 */
import { describe, expect, test } from 'bun:test'
import { finalizeEvent, getPublicKey } from 'nostr-tools'
import type { EventFilter, EventStreamItem, NostrEventLike } from '@sdk/core'
import {
	ARENA_AUCTION_BID_KIND,
	ARENA_AUCTION_CREATE_KIND,
	ARENA_LOT_STATE_KIND,
	ARENA_STATE_COMMITMENT_KIND,
	ARENA_VERDICT_KIND,
	ARENA_VERDICT_SCHEMA,
} from '@sdk/commerce/auctions/constants'
import {
	arenaLotFilters,
	arenaLotFollowUpFilters,
	createArenaAuctionRead,
	decodeArenaEvent,
	followedAuctionViews,
	projectArenaEvents,
	type ArenaAuctionRead,
	type ArenaAuctionSnapshot,
	type ArenaAuctionView,
	type ArenaRelayOpen,
	type ArenaRelayOpenFactory,
	type ArenaRelayOpenOptions,
	type ArenaReadHealth,
} from '@platform/web/auctions/relay/arenaAuctionRead'
import { makeCreateAdmitEvent } from './arenaCreateAdmitFixture'
import { nextCreateAcceptanceState } from './arenaAuctionCreate'
import { resolveArenaLot } from './arenaLotRead'
import { createAcceptanceStepper } from '@ui/auction/arena/create-stepper'
import {
	arenaSurfaceRelayCounts,
	arenaSurfaceStatus,
	auctionCreateDerivedEndsAt,
	auctionEndsAt,
	auctionPhase,
	collectArenaSurfacesRead,
	divergenceFor,
	endSourceOf,
	findAuction,
	toAuctionCardModel,
	toAuctionDetailModel,
	toVerdictPanelModel,
} from './auctionSurfacesRead'

const SELLER_A = 'seller-alice'
const BIDDER_ONE = 'bidder-one'
const BIDDER_TWO = 'bidder-two'

let idCounter = 0
function nextId(prefix = 'evt'): string {
	idCounter += 1
	return `${prefix}-${idCounter}`
}

function createEvent(
	over: { id?: string; pubkey?: string; created_at?: number; d?: string; e?: string | null } = {},
	content: Record<string, unknown> = {},
): NostrEventLike {
	const d = over.d ?? (content.auction_id as string) ?? 'lot-1'
	const tags: string[][] = [['d', d]]
	if (over.e) tags.push(['e', over.e])
	return {
		id: over.id ?? nextId('create'),
		pubkey: over.pubkey ?? SELLER_A,
		created_at: over.created_at ?? 1000,
		kind: ARENA_AUCTION_CREATE_KIND,
		tags,
		content: JSON.stringify({
			auction_id: d,
			title: `Lot ${d}`,
			startPrice: 1000,
			durationSec: 3600,
			mode: 'fixed',
			...content,
		}),
	}
}

function bidEvent(over: { auctionId?: string; amount?: unknown; pubkey?: string; created_at?: number } = {}): NostrEventLike {
	return {
		id: nextId('bid'),
		pubkey: over.pubkey ?? BIDDER_ONE,
		created_at: over.created_at ?? 1100,
		kind: ARENA_AUCTION_BID_KIND,
		tags: [],
		content: JSON.stringify({ auction_id: over.auctionId ?? 'lot-1', amount: over.amount ?? 100 }),
	}
}

function verdictEvent(
	over: { auctionId?: string; outcome?: string; height?: number; validator?: string; payout?: string } = {},
): NostrEventLike {
	const auctionId = over.auctionId ?? 'lot-1'
	const height = over.height ?? 10
	const validator = over.validator ?? 'validator-one'
	return {
		id: nextId('verdict'),
		pubkey: validator,
		created_at: 1300,
		kind: ARENA_VERDICT_KIND,
		tags: [
			['auction', auctionId],
			['height', String(height)],
			['hash', 'beef'],
			['p', validator],
		],
		content: JSON.stringify({
			schema: ARENA_VERDICT_SCHEMA,
			auction_id: auctionId,
			outcome: over.outcome ?? 'winner',
			height,
			block_hash: 'beef',
			derived_from: 'committed_state',
			bid_id: 'bid-from-content',
			...(over.payout ? { payout_token_sha256: over.payout } : {}),
		}),
	}
}

interface FakeRelayOptions {
	events?: NostrEventLike[]
	fail?: string
	/** Yield `events`, then hold the stream open (no EOSE) until the read aborts it. */
	hang?: boolean
	/**
	 * The relay's socket truth when the read asks at its deadline
	 * (`init.relayConnected`). Default `true`, or `false` for a fake whose stream
	 * throws on open. `false` + `hang` is the measured never-connected relay.
	 */
	connected?: boolean
}

function commitmentEvent(over: { height?: number; appHash?: string; validator?: string; time?: number | null } = {}): NostrEventLike {
	const height = over.height ?? 10
	const appHash = over.appHash ?? 'cafe'
	const time = over.time === undefined ? 1_700_000_000 : over.time
	return {
		id: nextId('commit'),
		pubkey: over.validator ?? 'validator-one',
		created_at: 1400,
		kind: ARENA_STATE_COMMITMENT_KIND,
		tags: [
			['height', String(height)],
			['hash', appHash],
			['p', over.validator ?? 'validator-one'],
		],
		content: JSON.stringify({ schema: 'arena.statecommit.v1', height, app_hash: appHash, time }),
	}
}

const LOT_STATE_SK = new Uint8Array(32).fill(17)
const LOT_STATE_PUB = getPublicKey(LOT_STATE_SK)

/** A signed kind-1449 committed end for a lot (the chain's live shape, §4). */
function lotStateEvent(over: { auctionId?: string; endTime?: number; extensions?: number; height?: number } = {}): NostrEventLike {
	const auctionId = over.auctionId ?? '1440:seller-alice:lot-1'
	const endTime = over.endTime ?? 1_000_500
	const height = over.height ?? 690
	const hash = 'a8e25d2044c0be17413f822a4e867af5b4332f599c760dc6da180f604cb9542f'
	return finalizeEvent(
		{
			kind: 1449,
			created_at: 1_795_021_527,
			tags: [
				['auction', auctionId],
				['height', String(height)],
				['hash', hash],
				['p', LOT_STATE_PUB],
			],
			content: JSON.stringify({
				schema: 'arena.lot.v1',
				auction_id: auctionId,
				end_time: endTime,
				original_end_time: 1_000_000,
				extensions: over.extensions ?? 1,
				height,
				block_hash: hash,
			}),
		},
		LOT_STATE_SK,
	) as unknown as NostrEventLike
}

/** A signed kind-1449 bid admission for a lot (the chain's live shape, R4). */
function bidAdmitEvent(
	over: { auctionId?: string; bidId?: string; amount?: number; position?: number; highBid?: string; height?: number } = {},
): NostrEventLike {
	const auctionId = over.auctionId ?? '1440:seller-alice:lot-1'
	const bidId = over.bidId ?? 'bid-1'
	const height = over.height ?? 3437
	const hash = '7bc7495aa6e679d003d495f934287dfde352b6552dc2960bac77cbdac8636edf'
	return finalizeEvent(
		{
			kind: 1449,
			created_at: 1_795_021_737,
			tags: [
				['e', bidId],
				['auction', auctionId],
				['height', String(height)],
				['hash', hash],
				['p', LOT_STATE_PUB],
			],
			content: JSON.stringify({
				schema: 'arena.bidadmit.v1',
				auction_id: auctionId,
				bid_id: bidId,
				bidder: 'bidder-one',
				amount: over.amount ?? 100,
				position: over.position ?? 105,
				high_bid: over.highBid ?? 'high-leg-1',
				height,
				block_hash: hash,
			}),
		},
		LOT_STATE_SK,
	) as unknown as NostrEventLike
}

/** A signed kind-1450 refusal of a create (the chain's live shape, §4). */
function refusedEvent(over: { refusedEventId?: string; reason?: string; height?: number; refusedKind?: number } = {}): NostrEventLike {
	const refusedEventId = over.refusedEventId ?? 'create-root'
	const reason = over.reason ?? 'title required (max 120 chars)'
	const height = over.height ?? 1749
	const hash = '0210e491ea9750bc2673d5d5ab3cfad2adabab56dff0bf095ff2bc5fa9ba8fb6'
	return finalizeEvent(
		{
			kind: 1450,
			created_at: 1_795_021_902,
			tags: [
				['e', refusedEventId],
				['height', String(height)],
				['hash', hash],
				['p', LOT_STATE_PUB],
			],
			content: JSON.stringify({
				schema: 'arena.refused.v1',
				event_id: refusedEventId,
				kind: over.refusedKind ?? 1440,
				reason,
				height,
				block_hash: hash,
			}),
		},
		LOT_STATE_SK,
	) as unknown as NostrEventLike
}

function fakeRelay(url: string, options: FakeRelayOptions): ArenaRelayOpen {
	return (_filters: readonly EventFilter[], opts: ArenaRelayOpenOptions) => ({
		async *[Symbol.asyncIterator](): AsyncIterator<EventStreamItem<NostrEventLike>> {
			if (options.fail) throw new Error(options.fail)
			for (const event of options.events ?? []) yield { type: 'event', event }
			if (options.hang) {
				if (!opts.signal?.aborted) {
					const { promise, resolve } = Promise.withResolvers<void>()
					opts.signal?.addEventListener('abort', () => resolve())
					await promise
				}
				return
			}
			yield { type: 'caught-up', info: { eose: [url], pending: [], complete: false } }
		},
	})
}

/**
 * A live read ends at its deadline, never at a settle marker, so a test that
 * consumes `events()` names the bound it needs. The fakes here resolve in
 * microtasks, which is why the default is short.
 *
 * The connect truth follows the fake's own shape — a relay whose stream throws
 * on open never had a socket, every other fake did — and a test that needs "the
 * transport cannot speak" passes its own probe.
 */
function readFrom(
	relays: Record<string, FakeRelayOptions>,
	deadlineMs = 200,
	relayConnected: (url: string) => boolean | null = (url) => {
		const relay = relays[url]
		if (relay === undefined) return true
		return relay.connected ?? relay.fail === undefined
	},
): ArenaAuctionRead {
	return createArenaAuctionRead({
		relays: Object.keys(relays),
		openRelay: (url) => fakeRelay(url, relays[url] ?? {}),
		deadlineMs,
		relayConnected,
	})
}

function health(over: Partial<ArenaReadHealth> = {}): ArenaReadHealth {
	const relays = over.relays ?? []
	return {
		relays,
		eose: [],
		answered: [],
		refused: [],
		unreachable: [],
		pending: [],
		failed: [],
		noRelaysReachable: relays.length === 0,
		empty: true,
		aborted: false,
		...over,
	}
}

function snapshotOf(events: NostrEventLike[], relay = 'wss://relay.one'): ArenaAuctionSnapshot {
	// Every create here is a lot the chain accepted: append its create-admission,
	// or the gate would (correctly) not follow it.
	const admits = events.filter((event) => event.kind === ARENA_AUCTION_CREATE_KIND).map((create) => makeCreateAdmitEvent(create))
	const decoded = [...events, ...admits].map((event) => {
		const result = decode(event, relay)
		if (!result.ok) throw new Error(`fixture refused: ${result.refusal.reason} ${result.refusal.detail}`)
		return result.event
	})
	return projectArenaEvents(decoded, health({ relays: [], noRelaysReachable: false }))
}

function decode(event: NostrEventLike, relay: string) {
	return decodeArenaEvent(event, relay)
}

function onlyAuction(snapshot: ArenaAuctionSnapshot): ArenaAuctionView {
	expect(snapshot.auctions).toHaveLength(1)
	return snapshot.auctions[0]
}

const CONTEXT = { now: 2000, status: 'settled' as const }

// =========================================================================
// Read state — one word, never a guess
// =========================================================================

describe('arenaSurfaceStatus', () => {
	test('no relay configured and no relay answered are both "no-relays"', () => {
		expect(arenaSurfaceStatus(health({ relays: [] }))).toBe('no-relays')
		// `summarizeHealth` sets this when no relay answered — mirrored here rather
		// than recomputed, because the adapter is the authority on its own health.
		const relay = { url: 'wss://a', status: 'timeout' as const, events: 0, refusals: 0, eose: false, error: null }
		expect(arenaSurfaceStatus(health({ relays: [relay], pending: ['wss://a'], noRelaysReachable: true }))).toBe('no-relays')
	})

	test('one relay still pending makes the read incomplete, even with data', () => {
		const ok = { url: 'wss://a', status: 'ok' as const, events: 3, refusals: 0, eose: true, error: null }
		const bad = { url: 'wss://b', status: 'timeout' as const, events: 0, refusals: 0, eose: false, error: null }
		expect(arenaSurfaceStatus(health({ relays: [ok, bad], answered: ['wss://a'], pending: ['wss://b'] }))).toBe('incomplete')
	})

	test('every relay answered is settled — the only state where an empty result is a verdict', () => {
		const ok = { url: 'wss://a', status: 'ok' as const, events: 0, refusals: 0, eose: true, error: null }
		expect(arenaSurfaceStatus(health({ relays: [ok], answered: ['wss://a'], empty: true }))).toBe('settled')
	})

	test('an aborted read is incomplete even if every relay had answered', () => {
		const ok = { url: 'wss://a', status: 'ok' as const, events: 1, refusals: 0, eose: true, error: null }
		expect(arenaSurfaceStatus(health({ relays: [ok], answered: ['wss://a'], aborted: true }))).toBe('incomplete')
	})

	test('relay counts are the two numbers a surface may state', () => {
		const ok = { url: 'wss://a', status: 'ok' as const, events: 1, refusals: 0, eose: true, error: null }
		const bad = { url: 'wss://b', status: 'error' as const, events: 0, refusals: 0, eose: false, error: 'boom' }
		expect(arenaSurfaceRelayCounts(health({ relays: [ok, bad], answered: ['wss://a'], failed: ['wss://b'] }))).toEqual({
			answered: 1,
			total: 2,
		})
	})
})

// =========================================================================
// End time and phase
// =========================================================================

describe('auctionEndsAt / auctionPhase', () => {
	test('a create with no duration has no end, and the phase says unknown rather than inventing one', () => {
		const auction = onlyAuction(snapshotOf([createEvent({}, { durationSec: undefined })]))
		expect(auction.content.durationSec).toBeNull()
		expect(auctionEndsAt(auction)).toBeNull()
		expect(auctionPhase(auction, 10_000)).toBe('unknown')
	})

	test('a zero duration is not treated as an instant end', () => {
		const auction = onlyAuction(snapshotOf([createEvent({}, { durationSec: 0 })]))
		expect(auctionEndsAt(auction)).toBeNull()
		expect(auctionPhase(auction, 10_000)).toBe('unknown')
	})

	test('the end is anchored to the root, so editing the title does not move it', () => {
		const root = createEvent({ id: 'create-root', created_at: 1000 })
		const update = createEvent({ e: 'create-root', created_at: 5000 }, { title: 'Edited title' })
		const auction = onlyAuction(snapshotOf([root, update]))
		expect(auction.createdAt).toBe(5000)
		expect(auction.rootCreatedAt).toBe(1000)
		expect(auctionEndsAt(auction)).toBe(1000 + 3600)
		expect(auctionPhase(auction, 2000)).toBe('open')
		expect(auctionPhase(auction, 5000)).toBe('ended')
	})
})

// =========================================================================
// The committed end and the create refusal — the chain's state half
// =========================================================================

describe('the committed end and the create refusal', () => {
	test('with a 1449 the end is the committed end and the source says so', () => {
		const auction = onlyAuction(snapshotOf([createEvent({ id: 'create-root', created_at: 1000 }), lotStateEvent({ endTime: 1000 + 4000 })]))
		expect(auctionEndsAt(auction)).toBe(1000 + 4000)
		expect(endSourceOf(auction)).toBe('committed')
		expect(auctionCreateDerivedEndsAt(auction)).toBe(1000 + 3600)
	})

	test('without a 1449 the end is create-derived and the source says so', () => {
		const auction = onlyAuction(snapshotOf([createEvent({ id: 'create-root', created_at: 1000 })]))
		expect(auctionEndsAt(auction)).toBe(1000 + 3600)
		expect(endSourceOf(auction)).toBe('create-derived')
	})

	test('the card carries the committed end, its height and the per-bid ordinal', () => {
		const auction = onlyAuction(
			snapshotOf([
				createEvent({ id: 'create-root', created_at: 1000 }),
				lotStateEvent({ endTime: 1000 + 4000, height: 690, extensions: 2 }),
			]),
		)
		const card = toAuctionCardModel(auction, CONTEXT)
		expect(card.endsAt).toBe(1000 + 4000)
		expect(card.endSource).toBe('committed')
		expect(card.createDerivedEndsAt).toBe(1000 + 3600)
		expect(card.committedEndHeight).toBe(690)
		// The ordinal is an ordinal, never a count: the event said 2.
		expect(card.committedEndOrdinal).toBe(2)
	})

	test('the phase and countdown follow the committed end, not the create-derived one', () => {
		const auction = onlyAuction(snapshotOf([createEvent({ id: 'create-root', created_at: 1000 }), lotStateEvent({ endTime: 6000 })]))
		// The create-derived end (4600) has passed, but the committed end is 6000.
		expect(auctionPhase(auction, 5000)).toBe('open')
		expect(auctionPhase(auction, 6100)).toBe('ended')
	})

	test('a lot whose create the chain refused carries the chain reason verbatim', () => {
		const auction = onlyAuction(
			snapshotOf([
				createEvent({ id: 'create-root' }),
				refusedEvent({ refusedEventId: 'create-root', reason: 'startPrice out of range (1..10000000)' }),
			]),
		)
		const detail = toAuctionDetailModel(auction, CONTEXT)
		expect(detail.createRefusal?.reason).toBe('startPrice out of range (1..10000000)')
		expect(detail.createRefusal?.height).toBe(1749)
	})

	test('a bid the chain refused at delivery carries that bid’s reason, keyed by its event id', () => {
		// 24 of the 36 live 1450s name a kind-1441 (measured 2026-11-18): a bid the
		// chain decided at delivery IS committed state, and its reason is shown.
		const bid = bidEvent({ pubkey: BIDDER_ONE, amount: 100 })
		const auction = onlyAuction(
			snapshotOf([
				createEvent({ id: 'create-root' }),
				bid,
				refusedEvent({
					refusedEventId: bid.id,
					refusedKind: 1441,
					reason: 'locktime below the floor for this lot: 1794924019 is under 1794924021',
				}),
			]),
		)
		const detail = toAuctionDetailModel(auction, CONTEXT)
		expect(detail.bidRefusals[bid.id]?.reason).toBe('locktime below the floor for this lot: 1794924019 is under 1794924021')
		expect(detail.bidRefusals[bid.id]?.height).toBe(1749)
		// A bid refusal is not the lot's create refusal.
		expect(detail.createRefusal).toBeNull()
	})

	test('a bid with no refusal read has no entry — no reason is invented for it', () => {
		const bid = bidEvent({ pubkey: BIDDER_ONE, amount: 100 })
		const auction = onlyAuction(snapshotOf([createEvent({ id: 'create-root' }), bid]))
		expect(toAuctionDetailModel(auction, CONTEXT).bidRefusals).toEqual({})
	})

	test('a lot with no refusal read has a null createRefusal, never an invented reason', () => {
		const auction = onlyAuction(snapshotOf([createEvent({ id: 'create-root' })]))
		expect(toAuctionDetailModel(auction, CONTEXT).createRefusal).toBeNull()
	})

	test('a bid the chain admitted carries the admission, keyed by the bid’s event id', () => {
		const bid = bidEvent({ pubkey: BIDDER_ONE, amount: 100 })
		const auction = onlyAuction(
			snapshotOf([
				createEvent({ id: 'create-root' }),
				bid,
				bidAdmitEvent({ bidId: bid.id, amount: 100, position: 105, highBid: 'high-leg-1', height: 3437 }),
			]),
		)
		const detail = toAuctionDetailModel(auction, CONTEXT)
		expect(detail.admissions[bid.id]?.position).toBe(105)
		expect(detail.admissions[bid.id]?.highBid).toBe('high-leg-1')
		expect(detail.admissions[bid.id]?.height).toBe(3437)
		expect(detail.admissions[bid.id]?.bidId).toBe(bid.id)
		// An admission is not a committed end, and an end is not an admission.
		expect(auction.committedEnd).toBeNull()
	})

	test('a bid with no admission read has no entry — absence is not a refusal', () => {
		const bid = bidEvent({ pubkey: BIDDER_ONE, amount: 100 })
		const auction = onlyAuction(snapshotOf([createEvent({ id: 'create-root' }), bid]))
		expect(toAuctionDetailModel(auction, CONTEXT).admissions).toEqual({})
	})
})

// =========================================================================
// Card model
// =========================================================================

describe('toAuctionCardModel', () => {
	test('sums bid deltas per bidder and names the top position', () => {
		const auction = onlyAuction(
			snapshotOf([
				createEvent(),
				bidEvent({ pubkey: BIDDER_ONE, amount: 100 }),
				bidEvent({ pubkey: BIDDER_TWO, amount: 250 }),
				bidEvent({ pubkey: BIDDER_ONE, amount: 200 }),
			]),
		)
		const card = toAuctionCardModel(auction, CONTEXT)
		expect(card.bidCount).toBe(3)
		expect(card.topBidTotal).toBe(300)
		expect(card.bidsWithoutAmount).toBe(0)
		expect(card.phase).toBe('open')
	})

	test('a bid with no readable amount is counted, never summed as zero', () => {
		const auction = onlyAuction(
			snapshotOf([createEvent(), bidEvent({ amount: 100 }), bidEvent({ amount: 'not-a-number', pubkey: BIDDER_TWO })]),
		)
		const card = toAuctionCardModel(auction, CONTEXT)
		expect(card.bidCount).toBe(2)
		expect(card.bidsWithoutAmount).toBe(1)
		expect(card.topBidTotal).toBe(100)
	})

	test('with no bids there is no total — null, not zero', () => {
		const card = toAuctionCardModel(onlyAuction(snapshotOf([createEvent()])), CONTEXT)
		expect(card.topBidTotal).toBeNull()
		expect(card.verdict).toBeNull()
		expect(card.verdictCount).toBe(0)
		expect(card.divergent).toBe(false)
	})

	test('the stated verdict is the highest-anchored one', () => {
		const auction = onlyAuction(
			snapshotOf([
				createEvent(),
				verdictEvent({ height: 10, outcome: 'cancelled', validator: 'validator-one' }),
				verdictEvent({ height: 20, outcome: 'winner', validator: 'validator-two' }),
			]),
		)
		const card = toAuctionCardModel(auction, CONTEXT)
		expect(card.verdict).toBe('winner')
		expect(card.verdictCount).toBe(2)
		expect(card.validatorCount).toBe(2)
	})
})

// =========================================================================
// Detail model
// =========================================================================

describe('toAuctionDetailModel', () => {
	test('keeps unstated terms null rather than filling them in', () => {
		const auction = onlyAuction(snapshotOf([createEvent({}, { mode: undefined, minIncrement: undefined })]))
		const detail = toAuctionDetailModel(auction, CONTEXT)
		// The protocol has no reserve; the terms a create may omit are mode/window/split.
		expect(detail.mode).toBeNull()
		expect(detail.windowSec).toBeNull()
		expect(detail.v4vSplit).toBeNull()
		expect(detail.minIncrement).toBeNull()
		expect(detail.startingBid).toBe(1000)
		expect(detail.versions).toBe(1)
		expect(detail.rootEventId).toBe(auction.rootEventId)
	})

	test('bids read forwards and positions are ordered by total', () => {
		const auction = onlyAuction(
			snapshotOf([
				createEvent(),
				bidEvent({ pubkey: BIDDER_TWO, amount: 50, created_at: 1200 }),
				bidEvent({ pubkey: BIDDER_ONE, amount: 300, created_at: 1100 }),
			]),
		)
		const detail = toAuctionDetailModel(auction, CONTEXT)
		expect(detail.bids.map((bid) => bid.createdAt)).toEqual([1100, 1200])
		expect(detail.positions).toEqual([
			{ bidder: BIDDER_ONE, total: 300 },
			{ bidder: BIDDER_TWO, total: 50 },
		])
	})

	test('counts every version, accepted or refused', () => {
		const root = createEvent({ id: 'create-root', created_at: 1000 })
		const accepted = createEvent({ e: 'create-root', created_at: 2000 }, { title: 'New title' })
		// Changes a frozen field: the read refuses it as an update, and the version count still counts it.
		const refused = createEvent({ e: 'create-root', created_at: 3000 }, { startPrice: 1 })
		const auction = onlyAuction(snapshotOf([root, accepted, refused]))
		const detail = toAuctionDetailModel(auction, CONTEXT)
		expect(detail.versions).toBe(3)
		expect(detail.canonicalEventId).toBe(accepted.id)
	})
})

// =========================================================================
// Verdict panel model
// =========================================================================

describe('toVerdictPanelModel', () => {
	test('one row per published verdict, no merging, no quorum', () => {
		const auction = onlyAuction(
			snapshotOf([
				createEvent(),
				verdictEvent({ height: 10, outcome: 'winner', validator: 'validator-one' }),
				verdictEvent({ height: 11, outcome: 'winner', validator: 'validator-one' }),
				verdictEvent({ height: 12, outcome: 'cancelled', validator: 'validator-two', payout: 'cafe' }),
			]),
		)
		const panel = toVerdictPanelModel(auction, CONTEXT)
		expect(panel.rows).toHaveLength(3)
		expect(panel.validatorCount).toBe(2)
		expect(panel.outcomes).toEqual(['cancelled', 'winner'])
		expect(panel.rows[0].height).toBe(12)
		expect(panel.rows[0].payoutTokenSha256).toBe('cafe')
		expect(panel.divergence).toBeNull()
	})

	test('a verdict with no p tag is surfaced with a null validator, not dropped', () => {
		const event = verdictEvent({ validator: 'validator-one' })
		// Remove the p tag: the parser reports validatorPubkey === null rather than refusing.
		event.tags = event.tags.filter((tag) => tag[0] !== 'p')
		const auction = onlyAuction(snapshotOf([createEvent(), event]))
		const panel = toVerdictPanelModel(auction, CONTEXT)
		expect(panel.rows).toHaveLength(1)
		expect(panel.rows[0].validator).toBeNull()
		expect(panel.validatorCount).toBe(1)
	})

	test('no verdicts is an empty panel that carries the lot phase, not a chain absence', () => {
		// The create states 3600s at 1000, so the lot ends at 4600; `CONTEXT.now` is 2000.
		const panel = toVerdictPanelModel(onlyAuction(snapshotOf([createEvent()])), CONTEXT)
		expect(panel.rows).toEqual([])
		expect(panel.outcomes).toEqual([])
		expect(panel.validatorCount).toBe(0)
		expect(panel.phase).toBe('open')
	})

	test('the phase is judged at the projection instant, so a passed end reads as ended', () => {
		const auction = onlyAuction(snapshotOf([createEvent()]))
		expect(toVerdictPanelModel(auction, { ...CONTEXT, now: 4600 }).phase).toBe('ended')
		expect(toVerdictPanelModel(auction, { ...CONTEXT, now: 4599 }).phase).toBe('open')
	})
})

describe('divergenceFor', () => {
	test('matches a divergence keyed by the bare d tag', () => {
		const auction = onlyAuction(snapshotOf([createEvent()]))
		const found = divergenceFor(auction, [{ auctionId: 'lot-1', byRelay: { 'wss://b': ['winner'], 'wss://a': ['cancelled'] } }])
		expect(found).not.toBeNull()
		expect(found?.auctionId).toBe(auction.coordinate)
		expect(found?.byRelay['wss://a']).toEqual(['cancelled'])
	})

	test('matches a divergence keyed by the full coordinate', () => {
		const auction = onlyAuction(snapshotOf([createEvent()]))
		const found = divergenceFor(auction, [{ auctionId: auction.coordinate, byRelay: { 'wss://a': ['winner'], 'wss://b': ['cancelled'] } }])
		expect(found?.auctionId).toBe(auction.coordinate)
	})

	test('an unrelated auction id is not matched — no fuzzy attribution', () => {
		const auction = onlyAuction(snapshotOf([createEvent()]))
		expect(divergenceFor(auction, [{ auctionId: 'lot-2', byRelay: { 'wss://a': ['winner'] } }])).toBeNull()
	})

	test('two relays reporting different outcomes produce a divergence on the real read', async () => {
		const read = readFrom({
			'wss://a': {
				events: [createEvent({ id: 'create-1' }), makeCreateAdmitEvent(createEvent({ id: 'create-1' })), verdictEvent({ outcome: 'winner', validator: 'validator-one' })],
			},
			'wss://b': {
				events: [createEvent({ id: 'create-1' }), makeCreateAdmitEvent(createEvent({ id: 'create-1' })), verdictEvent({ outcome: 'cancelled', validator: 'validator-two' })],
			},
		})
		const snapshot = await read.snapshot()
		expect(snapshot.verdictDivergence).toHaveLength(1)
		const auction = onlyAuction(snapshot)
		const panel = toVerdictPanelModel(auction, { ...CONTEXT, divergences: snapshot.verdictDivergence })
		expect(panel.divergence).not.toBeNull()
		expect(panel.outcomes).toEqual(['cancelled', 'winner'])
	})
})

// =========================================================================
// collectArenaSurfacesRead — the whole chain with the socket replaced
// =========================================================================

describe('collectArenaSurfacesRead', () => {
	test('two relays delivering the same auction settles, with both relays recorded as provenance', async () => {
		const create = createEvent({ id: 'create-shared' })
		const admit = makeCreateAdmitEvent(create)
		const read = readFrom({
			'wss://a': { events: [create, admit] },
			'wss://b': { events: [create, admit] },
		})
		const state = await collectArenaSurfacesRead(read)
		expect(state.status).toBe('settled')
		expect(state.relayHealth).toEqual({ answered: 2, total: 2 })
		expect(state.snapshot?.auctions).toHaveLength(1)
		const card = toAuctionCardModel(state.snapshot!.auctions[0], { now: 2000, status: state.status })
		expect(card.relayCount).toBe(2)
	})

	test('one dead relay keeps the data and is accounted, so the read settles', async () => {
		const read = readFrom({
			'wss://a': { events: [createEvent({ id: 'create-1' }), makeCreateAdmitEvent(createEvent({ id: 'create-1' }))] },
			'wss://b': { fail: 'connection refused' },
		})
		const state = await collectArenaSurfacesRead(read)
		// The connection failure is an answer about that relay, not silence: nothing
		// is left pending in the health, so the surface may state the lot's phase.
		expect(state.status).toBe('settled')
		expect(state.relayHealth).toEqual({ answered: 1, total: 2 })
		expect(state.snapshot?.auctions).toHaveLength(1)
		expect(state.snapshot?.health.failed).toEqual(['wss://b'])
		expect(state.snapshot?.health.unreachable).toEqual(['wss://b'])
		expect(state.snapshot?.health.pending).toEqual([])
	})

	test('a relay that delivers and then stays connected ends at the deadline', async () => {
		// A live relay keeps its socket open, and a transport that never surfaces
		// EOSE keeps it open anyway. The read ends at its deadline — never at a
		// relay's boundary — and the surface still reports the answered lot.
		const read = readFrom({ 'wss://answered': { events: [createEvent({ id: 'create-1' })], hang: true } }, 150)
		const started = Date.now()
		const state = await collectArenaSurfacesRead(read)
		expect(Date.now() - started).toBeGreaterThanOrEqual(120)
		expect(state.status).toBe('settled')
		expect(state.relayHealth).toEqual({ answered: 1, total: 1 })
		expect(state.snapshot?.auctions).toHaveLength(1)
		expect(state.snapshot?.health.pending).toEqual([])
	})

	test('a relay whose socket never opened settles the surface, with the count short of the total', async () => {
		// The measured cold-load shape (2026-11-20, lot d=612a25ed…, 7 configured
		// relays): the ones that never opened a socket were frozen `pending`, so the
		// surface read `incomplete` ("3 of 7 relays answered") where the deployed
		// baseline read `settled`. A relay with no socket cannot answer: it is
		// `unreachable`, and the count stays honest — short of the total.
		const state = await collectArenaSurfacesRead(
			readFrom(
				{
					'wss://a': { events: [createEvent({ id: 'create-1' })] },
					'wss://never': { connected: false, hang: true },
				},
				60,
			),
		)
		expect(state.status).toBe('settled')
		expect(state.relayHealth).toEqual({ answered: 1, total: 2 })
		expect(state.snapshot?.health.unreachable).toEqual(['wss://never'])
		expect(state.snapshot?.health.pending).toEqual([])
		expect(state.snapshot?.auctions).toHaveLength(1)
	})

	test('a relay that connected and stayed silent keeps the surface incomplete', async () => {
		// The other half of the rule: an open socket that says nothing could still
		// answer, so the surface may not state the lot's phase.
		const state = await collectArenaSurfacesRead(
			readFrom(
				{
					'wss://a': { events: [createEvent({ id: 'create-1' })] },
					'wss://mute': { connected: true, hang: true },
				},
				60,
			),
		)
		expect(state.status).toBe('incomplete')
		expect(state.relayHealth).toEqual({ answered: 1, total: 2 })
		expect(state.snapshot?.health.pending).toEqual(['wss://mute'])
		expect(state.snapshot?.health.unreachable).toEqual([])
	})

	test('no relays configured answers "nothing", not "no auctions"', async () => {
		const state = await collectArenaSurfacesRead(readFrom({}))
		expect(state.status).toBe('no-relays')
		expect(state.snapshot?.auctions).toEqual([])
		expect(state.snapshot?.health.noRelaysReachable).toBe(true)
	})

	test('healthy relays with nothing to say settle to an empty auction list', async () => {
		const state = await collectArenaSurfacesRead(readFrom({ 'wss://a': {}, 'wss://b': {} }))
		expect(state.status).toBe('settled')
		expect(state.snapshot?.auctions).toEqual([])
	})

	test('progress arrives while reading, flagged loading and never as a count of what exists', async () => {
		const seen: string[] = []
		const read = readFrom({ 'wss://a': { events: [createEvent({ id: 'create-1' })] } })
		await collectArenaSurfacesRead(read, { onProgress: (state) => seen.push(state.status) })
		expect(seen.length).toBeGreaterThan(0)
		expect(seen.every((status) => status === 'loading')).toBe(true)
	})

	test('a refused create never reaches a surface', async () => {
		const badCreate = createEvent({ id: 'create-bad' }, { startPrice: 'free' })
		// Drops the `d` tag while keeping content.auction_id, which is legal; the
		// refusal case is bad JSON, so replace the content outright.
		badCreate.content = 'not json'
		const state = await collectArenaSurfacesRead(readFrom({ 'wss://a': { events: [badCreate, createEvent({ id: 'create-good' })] } }))
		expect(state.snapshot?.auctions).toHaveLength(1)
		expect(state.snapshot?.refusals.some((refusal) => refusal.reason === 'arena.bad_content')).toBe(true)
	})

	test('the read state carries the chain clock anchored on the commitments the read saw', async () => {
		const state = await collectArenaSurfacesRead(
			readFrom({ 'wss://a': { events: [createEvent(), commitmentEvent({ height: 30, time: 1_699_999_000 })] } }),
		)
		expect(state.chainClock?.height).toBe(30)
		expect(state.chainClock?.time).toBe(1_699_999_000)
		expect(state.chainClock?.ageSec).not.toBeNull()
		// The rules clock is the same anchored instant.
		expect(state.chainClock?.rulesHeight).toBe(30)
	})

	test('a kind-1449 window with no admission still yields a followed lot, asked for by its create id', async () => {
		// The measured defect (2026-11-20): kind 1449 carries three schemas, and the
		// relay's newest slice can hold committed ends and bid admissions alone — so
		// a read reports every create and not one acceptance, and a gate that
		// requires one lists nothing on a healthy relay. The collector asks the read
		// for exactly the acceptances it is missing, by the create's own id, and
		// projects once more before it states a final status.
		const create = createEvent({ id: 'create-windowed' })
		const admit = makeCreateAdmitEvent(create)
		const calls: (readonly EventFilter[])[] = []
		const read = createArenaAuctionRead({
			relays: ['wss://windowed'],
			deadlineMs: 150,
			openRelay:
				(url: string): ArenaRelayOpen =>
				(filters: readonly EventFilter[]) => ({
					async *[Symbol.asyncIterator](): AsyncIterator<EventStreamItem<NostrEventLike>> {
						calls.push(filters)
						const requested = new Set(filters.flatMap((filter) => filter['#e'] ?? []))
						const events = requested.size === 0 ? [create] : [admit]
						for (const event of events) yield { type: 'event', event } as EventStreamItem<NostrEventLike>
						yield {
							type: 'caught-up',
							info: { eose: [url], pending: [], complete: false },
						} as EventStreamItem<NostrEventLike>
					},
				}),
		})

		const state = await collectArenaSurfacesRead(read)
		expect(state.status).toBe('settled')
		expect(state.snapshot?.auctions).toHaveLength(1)
		expect(state.snapshot?.auctions[0]?.createAdmit?.eventId).toBe(admit.id)
		expect(followedAuctionViews(state.snapshot!.auctions)).toHaveLength(1)
		// Two REQs: the whole-arena base set, then the one acceptance by create id.
		expect(calls).toHaveLength(2)
		expect(calls[1]).toEqual([{ kinds: [ARENA_LOT_STATE_KIND], '#e': [create.id] }])
	})

	test('with no commitment the chain clock is honestly unknown, never zero or now', async () => {
		const state = await collectArenaSurfacesRead(readFrom({ 'wss://a': { events: [createEvent()] } }))
		expect(state.chainClock?.time).toBeNull()
		expect(state.chainClock?.height).toBeNull()
		expect(state.chainClock?.freshness).toBe('unknown')
	})
})

// =========================================================================
// A refused lot: the panel and the lot page reach the chain's own words
// =========================================================================

/**
 * The lot page and the create form's acceptance panel read through the **same**
 * shell (`useArenaLotRead`: `arenaLotFilters` + `arenaLotFollowUpFilters`), so
 * the whole chain — the read, the route's own resolver, the projection, the
 * form's transition and the stepper — is proven here with the socket replaced.
 *
 * A kind-1450 refusal is not in the base REQ: it names the refused event's id and
 * carries no `auction` coordinate and no `d`, so the only address a lot read has
 * for it is the create's own event id, in the follow-up. Without that REQ the
 * refusal for the very lot a page is watching never arrives — which is what made
 * the lot page's refusal copy and the stepper's `refused` state unreachable.
 */
describe('a refused lot: the panel and the lot page reach the chain’s own words', () => {
	const D = 'lot-refused'
	const create = createEvent({ id: 'create-refused', d: D })
	const refusal = refusedEvent({ refusedEventId: create.id, reason: 'title required (max 120 chars)' })
	const published = {
		phase: 'published' as const,
		eventId: create.id,
		coordinate: `1440:${SELLER_A}:${D}`,
		acceptedBy: ['wss://limited'],
		totalRelays: 1,
	}

	/**
	 * A relay that answers by the tags it indexes, like the live one: the lot's
	 * `#d` with the create, a `#e` REQ for kind 1450 with the refusal it holds, and
	 * nothing for a request it has no event for (the admission REQ included).
	 */
	function panelRelay(held: NostrEventLike | null): { open: ArenaRelayOpenFactory; calls: (readonly EventFilter[])[] } {
		const calls: (readonly EventFilter[])[] = []
		const open: ArenaRelayOpenFactory =
			(url: string): ArenaRelayOpen =>
			(filters: readonly EventFilter[]) => ({
				async *[Symbol.asyncIterator](): AsyncIterator<EventStreamItem<NostrEventLike>> {
					calls.push(filters)
					const byD = filters.some((filter) => (filter['#d'] ?? []).includes(D))
					const wantsRefusal =
						held !== null &&
						filters.some((filter) => (filter.kinds ?? []).includes(1450) && (filter['#e'] ?? []).includes(create.id))
					const answer = byD ? [create] : wantsRefusal ? [held] : []
					for (const event of answer) yield { type: 'event', event } as EventStreamItem<NostrEventLike>
					yield { type: 'caught-up', info: { eose: [url], pending: [], complete: false } } as EventStreamItem<NostrEventLike>
				},
			})
		return { open, calls }
	}

	test('the lot read asks by the create’s own id, and both surfaces reach the chain’s words', async () => {
		const relay = panelRelay(refusal)
		const read = createArenaAuctionRead({
			relays: ['wss://limited'],
			deadlineMs: 150,
			filters: arenaLotFilters(SELLER_A, D),
			followUpFilters: arenaLotFollowUpFilters(SELLER_A, D),
			openRelay: relay.open,
		})
		const state = await collectArenaSurfacesRead(read)
		expect(state.status).toBe('settled')

		// The base REQ (call 0) cannot carry the refusal; the follow-up, opened once
		// the create arrived, is the one that asks for it — by the create's own id.
		expect(relay.calls[0]?.some((filter) => (filter.kinds ?? []).includes(1450))).toBe(false)
		expect(relay.calls[1]).toContainEqual({ kinds: [1450], '#e': [create.id] })

		const lookup = resolveArenaLot(state.snapshot!, D, SELLER_A)
		if (lookup.kind !== 'found') throw new Error(`expected the lot to resolve, got ${lookup.kind}`)
		const detail = toAuctionDetailModel(lookup.view, { now: 2000, status: state.status })
		// What the lot page's banner states, verbatim (`createAcceptanceNotice` →
		// `createRefusalLabel`), and why it offers nothing that moves money.
		expect(detail.createRefusal?.reason).toBe('title required (max 120 chars)')
		expect(detail.phase).toBe('unaccepted')

		const next = nextCreateAcceptanceState({ previous: published, view: lookup.view, createEventId: create.id })
		expect(next.phase).toBe('refused')
		if (next.phase !== 'refused') throw new Error('expected the refusal to move the panel')
		expect(next.reason).toBe('title required (max 120 chars)')
		const stepper = createAcceptanceStepper(next)
		expect(stepper.steps.map((step) => [step.key, step.status])).toEqual([
			['publish', 'done'],
			['accept', 'failed'],
		])
		expect(stepper.steps[1].detail).toBe('the chain refused this listing: title required (max 120 chars)')
	})

	test('with no refusal read the panel does not move: still reading, never refused', async () => {
		const relay = panelRelay(null)
		const read = createArenaAuctionRead({
			relays: ['wss://limited'],
			deadlineMs: 150,
			filters: arenaLotFilters(SELLER_A, D),
			followUpFilters: arenaLotFollowUpFilters(SELLER_A, D),
			openRelay: relay.open,
		})
		const state = await collectArenaSurfacesRead(read)

		const lookup = resolveArenaLot(state.snapshot!, D, SELLER_A)
		if (lookup.kind !== 'found') throw new Error(`expected the lot to resolve, got ${lookup.kind}`)
		expect(toAuctionDetailModel(lookup.view, { now: 2000, status: state.status }).createRefusal).toBeNull()

		// Neither fact read: the same state comes back, and the acceptance step
		// still animates — an absent refusal is never rendered as one.
		expect(nextCreateAcceptanceState({ previous: published, view: lookup.view, createEventId: create.id })).toBe(published)
		expect(createAcceptanceStepper(published).steps[1].status).toBe('active')
	})
})

describe('findAuction', () => {
	test('finds by coordinate and answers null for an auction the read did not deliver', () => {
		const snapshot = snapshotOf([createEvent()])
		const auction = snapshot.auctions[0]
		expect(findAuction(snapshot, auction.coordinate)?.coordinate).toBe(auction.coordinate)
		expect(findAuction(snapshot, `1440:${SELLER_A}:missing`)).toBeNull()
	})
})
