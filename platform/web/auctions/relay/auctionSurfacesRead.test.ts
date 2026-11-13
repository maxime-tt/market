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
import type { EventFilter, EventStreamItem, NostrEventLike } from '@sdk/core'
import {
	ARENA_AUCTION_BID_KIND,
	ARENA_AUCTION_CREATE_KIND,
	ARENA_VERDICT_KIND,
	ARENA_VERDICT_SCHEMA,
} from '@sdk/commerce/auctions/constants'
import {
	createArenaAuctionRead,
	decodeArenaEvent,
	projectArenaEvents,
	type ArenaAuctionRead,
	type ArenaAuctionSnapshot,
	type ArenaAuctionView,
	type ArenaRelayOpen,
	type ArenaRelayOpenOptions,
	type ArenaReadHealth,
} from '@platform/web/auctions/relay/arenaAuctionRead'
import {
	arenaSurfaceRelayCounts,
	arenaSurfaceStatus,
	auctionEndsAt,
	auctionPhase,
	collectArenaSurfacesRead,
	divergenceFor,
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
			starting_bid: 1000,
			duration_seconds: 3600,
			funding_mode: 'cashu_sigall_v1',
			...content,
		}),
	}
}

function bidEvent(
	over: { auctionId?: string; amount?: unknown; pubkey?: string; created_at?: number } = {},
): NostrEventLike {
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
}

function fakeRelay(url: string, options: FakeRelayOptions): ArenaRelayOpen {
	return (_filters: readonly EventFilter[], _opts: ArenaRelayOpenOptions) => ({
		async *[Symbol.asyncIterator](): AsyncIterator<EventStreamItem<NostrEventLike>> {
			if (options.fail) throw new Error(options.fail)
			for (const event of options.events ?? []) yield { type: 'event', event }
			yield { type: 'caught-up', info: { eose: [url], pending: [], complete: false } }
		},
	})
}

function readFrom(relays: Record<string, FakeRelayOptions>): ArenaAuctionRead {
	return createArenaAuctionRead({
		relays: Object.keys(relays),
		openRelay: (url) => fakeRelay(url, relays[url] ?? {}),
		deadlineMs: 2000,
	})
}

function health(over: Partial<ArenaReadHealth> = {}): ArenaReadHealth {
	const relays = over.relays ?? []
	return {
		relays,
		eose: [],
		answered: [],
		pending: [],
		failed: [],
		noRelaysReachable: relays.length === 0,
		empty: true,
		aborted: false,
		...over,
	}
}

function snapshotOf(events: NostrEventLike[], relay = 'wss://relay.one'): ArenaAuctionSnapshot {
	const decoded = events.map((event) => {
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
		expect(
			arenaSurfaceStatus(health({ relays: [relay], pending: ['wss://a'], noRelaysReachable: true })),
		).toBe('no-relays')
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
		const auction = onlyAuction(snapshotOf([createEvent({}, { duration_seconds: undefined })]))
		expect(auction.content.durationSeconds).toBeNull()
		expect(auctionEndsAt(auction)).toBeNull()
		expect(auctionPhase(auction, 10_000)).toBe('unknown')
	})

	test('a zero duration is not treated as an instant end', () => {
		const auction = onlyAuction(snapshotOf([createEvent({}, { duration_seconds: 0 })]))
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
		const auction = onlyAuction(snapshotOf([createEvent({}, { reserve: undefined, min_increment: undefined })]))
		const detail = toAuctionDetailModel(auction, CONTEXT)
		expect(detail.reserve).toBeNull()
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
		const refused = createEvent({ e: 'create-root', created_at: 3000 }, { starting_bid: 1 })
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

	test('no verdicts is an empty panel, which the view must read as unknown', () => {
		const panel = toVerdictPanelModel(onlyAuction(snapshotOf([createEvent()])), CONTEXT)
		expect(panel.rows).toEqual([])
		expect(panel.outcomes).toEqual([])
		expect(panel.validatorCount).toBe(0)
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
		const found = divergenceFor(auction, [
			{ auctionId: auction.coordinate, byRelay: { 'wss://a': ['winner'], 'wss://b': ['cancelled'] } },
		])
		expect(found?.auctionId).toBe(auction.coordinate)
	})

	test('an unrelated auction id is not matched — no fuzzy attribution', () => {
		const auction = onlyAuction(snapshotOf([createEvent()]))
		expect(divergenceFor(auction, [{ auctionId: 'lot-2', byRelay: { 'wss://a': ['winner'] } }])).toBeNull()
	})

	test('two relays reporting different outcomes produce a divergence on the real read', async () => {
		const read = readFrom({
			'wss://a': { events: [createEvent({ id: 'create-1' }), verdictEvent({ outcome: 'winner', validator: 'validator-one' })] },
			'wss://b': { events: [createEvent({ id: 'create-1' }), verdictEvent({ outcome: 'cancelled', validator: 'validator-two' })] },
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
		const read = readFrom({
			'wss://a': { events: [create] },
			'wss://b': { events: [create] },
		})
		const state = await collectArenaSurfacesRead(read)
		expect(state.status).toBe('settled')
		expect(state.relayHealth).toEqual({ answered: 2, total: 2 })
		expect(state.snapshot?.auctions).toHaveLength(1)
		const card = toAuctionCardModel(state.snapshot!.auctions[0], { now: 2000, status: state.status })
		expect(card.relayCount).toBe(2)
	})

	test('one dead relay keeps the data and reports the read incomplete', async () => {
		const read = readFrom({
			'wss://a': { events: [createEvent({ id: 'create-1' })] },
			'wss://b': { fail: 'connection refused' },
		})
		const state = await collectArenaSurfacesRead(read)
		expect(state.status).toBe('incomplete')
		expect(state.relayHealth).toEqual({ answered: 1, total: 2 })
		expect(state.snapshot?.auctions).toHaveLength(1)
		expect(state.snapshot?.health.failed).toEqual(['wss://b'])
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
		const badCreate = createEvent({ id: 'create-bad' }, { starting_bid: 'free' })
		// Drops the `d` tag while keeping content.auction_id, which is legal; the
		// refusal case is bad JSON, so replace the content outright.
		badCreate.content = 'not json'
		const state = await collectArenaSurfacesRead(readFrom({ 'wss://a': { events: [badCreate, createEvent({ id: 'create-good' })] } }))
		expect(state.snapshot?.auctions).toHaveLength(1)
		expect(state.snapshot?.refusals.some((refusal) => refusal.reason === 'arena.bad_content')).toBe(true)
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