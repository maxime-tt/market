/**
 * Tests for the arena 1440-series read adapter (`arenaAuctionRead.ts`).
 *
 * No network, no relay: every relay is a fake `AsyncIterable`, so the cases
 * that matter — dead, slow, lying, empty — are all deterministic. The
 * production wiring (`createWebArenaAuctionRead`) is not exercised here; it is
 * four lines over `createWebRelayReadContext`, and a live read needs a running
 * relay, which this slice does not assume.
 *
 * Ids and pubkeys are deliberately short and non-hex: they are opaque strings to
 * the adapter, and a 64-hex literal in a test file is indistinguishable from a
 * key to the pre-commit scanner.
 */
import { describe, expect, test } from 'bun:test'
import { finalizeEvent, getPublicKey } from 'nostr-tools'

import type { EventFilter, EventStreamItem, NostrEventLike } from '@sdk/core'
import {
	ARENA_AUCTION_CREATE_KIND,
	ARENA_AUCTION_REFUND_KIND,
	ARENA_AUCTION_SETTLE_KIND,
	ARENA_LOT_STATE_KIND,
	ARENA_STATE_COMMITMENT_KIND,
	ARENA_VERDICT_KIND,
} from '@sdk/commerce/auctions/constants'
import { ARENA_REFUSAL_BAD_CONTENT } from '@platform/web/auctions/relay/arenaAnchor'
import { makeCreateAdmitEvent } from './arenaCreateAdmitFixture'
import {
	ARENA_READ_DRAIN_CEILING_MS,
	ARENA_READ_DRAIN_QUIET_MS,
	ARENA_READ_KINDS,
	ARENA_REFUSAL_BAD_IDENTITY,
	ARENA_REFUSAL_IMMUTABLE_CHANGED,
	ARENA_REFUSAL_NOT_SUPERSEDING_ROOT,
	ARENA_REFUSAL_UNBOUND_BID,
	ARENA_REFUSAL_UNEXPECTED_KIND,
	arenaAuctionFilters,
	arenaCreateAdmitFilter,
	arenaLotBidFilters,
	arenaLotCreateEventFilters,
	arenaLotFilters,
	arenaLotFollowUpFilters,
	createArenaAuctionRead,
	decodeArenaEvent,
	followedAuctionViews,
	projectArenaEvents,
	unadmittedCreateIds,
	type ArenaAuctionEvent,
	type ArenaAuctionRead,
	type ArenaRelayOpen,
	type ArenaRelayOpenFactory,
	type ArenaRelayOpenOptions,
	type ArenaReadStreamItem,
} from './arenaAuctionRead'
import { auctionListStatus, relayCounts } from '@platform/web/storefront/auctionListRead'
import { findImmutableChange } from '@sdk/commerce/auctions/arena'

// =========================================================================
// Fixtures
// =========================================================================

const SELLER_A = 'seller-alice'
const SELLER_B = 'seller-bob'

let idCounter = 0
function nextId(prefix = 'evt'): string {
	idCounter += 1
	return `${prefix}-${idCounter}`
}

interface EventSpec {
	kind: number
	pubkey?: string
	created_at?: number
	tags?: string[][]
	content?: unknown
	id?: string
}

function ev(spec: EventSpec): NostrEventLike {
	return {
		id: spec.id ?? nextId(),
		pubkey: spec.pubkey ?? SELLER_A,
		created_at: spec.created_at ?? 1000,
		kind: spec.kind,
		tags: spec.tags ?? [],
		content: typeof spec.content === 'string' ? spec.content : JSON.stringify(spec.content ?? {}),
	}
}

function createContent(over: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		auction_id: 'lot-1',
		title: 'A lot',
		startPrice: 1000,
		minIncrement: 10,
		durationSec: 3600,
		mode: 'fixed',
		...over,
	}
}

function createEvent(
	over: Partial<{ id: string; created_at: number; pubkey: string; d: string; e: string | null }> = {},
	content: Record<string, unknown> = {},
): NostrEventLike {
	const d = over.d ?? (content.auction_id as string) ?? 'lot-1'
	const tags: string[][] = [['d', d]]
	if (over.e) tags.push(['e', over.e])
	return ev({
		kind: ARENA_AUCTION_CREATE_KIND,
		pubkey: over.pubkey ?? SELLER_A,
		created_at: over.created_at ?? 1000,
		id: over.id,
		tags,
		content: createContent(content),
	})
}

function bidEvent(
	over: { auctionId?: string; amount?: number | string; a?: string; e?: string; pubkey?: string; created_at?: number; id?: string } = {},
): NostrEventLike {
	const tags: string[][] = []
	if (over.a) tags.push(['a', over.a])
	if (over.e) tags.push(['e', over.e])
	const content: Record<string, unknown> = {}
	if (over.auctionId !== undefined) content.auction_id = over.auctionId
	if (over.amount !== undefined) content.amount = over.amount
	return ev({
		kind: 1441,
		pubkey: over.pubkey ?? 'bidder-1',
		created_at: over.created_at ?? 1100,
		id: over.id,
		tags,
		content,
	})
}

function verdictEvent(
	over: {
		auctionId?: string
		bidId?: string
		outcome?: string
		height?: number
		hash?: string
		validator?: string
		created_at?: number
		id?: string
	} = {},
): NostrEventLike {
	const auctionId = over.auctionId ?? 'lot-1'
	const height = over.height ?? 10
	const hash = over.hash ?? 'beef'
	const tags: string[][] = [
		['auction', auctionId],
		['height', String(height)],
		['hash', hash],
		['p', over.validator ?? 'validator-1'],
	]
	if (over.bidId) tags.push(['bid', over.bidId])
	return ev({
		kind: ARENA_VERDICT_KIND,
		pubkey: over.validator ?? 'validator-1',
		created_at: over.created_at ?? 1200,
		id: over.id,
		tags,
		content: {
			schema: 'arena.verdict.v1',
			auction_id: auctionId,
			bid_id: over.bidId ?? null,
			outcome: over.outcome ?? 'winner',
			height,
			block_hash: hash,
			derived_from: 'committed_state',
		},
	})
}

function commitmentEvent(
	over: { height?: number; appHash?: string; validator?: string; created_at?: number; id?: string; time?: number | null } = {},
): NostrEventLike {
	const height = over.height ?? 10
	const appHash = over.appHash ?? 'cafe'
	const time = over.time === undefined ? 1700000000 : over.time
	return ev({
		kind: ARENA_STATE_COMMITMENT_KIND,
		pubkey: over.validator ?? 'validator-1',
		created_at: over.created_at ?? 1200,
		id: over.id,
		tags: [
			['height', String(height)],
			['hash', appHash],
			['p', over.validator ?? 'validator-1'],
		],
		content: { schema: 'arena.statecommit.v1', height, app_hash: appHash, time },
	})
}

const RECEIPT_SK = new Uint8Array(32).fill(7)
const RECEIPT_PUB = getPublicKey(RECEIPT_SK)

/** A signed kind-1443/1444 receipt, built from the chain's §3 contract. */
function receiptEvent(
	over: {
		kind?: number
		auctionId?: string
		bidId?: string
		height?: number
		hash?: string
		outcome?: string
		outputs?: unknown[]
		created_at?: number
	} = {},
): NostrEventLike {
	const kind = over.kind ?? ARENA_AUCTION_REFUND_KIND
	const isRefund = kind === ARENA_AUCTION_REFUND_KIND
	const auctionId = over.auctionId ?? 'lot-1'
	const bidId = over.bidId ?? 'bid-1'
	const height = over.height ?? 400
	const hash = over.hash ?? 'a'.repeat(64)
	const content = {
		schema: isRefund ? 'arena.refund.v1' : 'arena.settle.v1',
		auction_id: auctionId,
		bid_id: bidId,
		outcome: over.outcome ?? (isRefund ? 'refund' : 'settle'),
		height,
		block_hash: hash,
		settled_at: 1794999999,
		params_version: 'pv-1',
		out: over.outputs ?? [{ recipient: 'recip', amount: 1234, id: 'keyset' }],
	}
	return finalizeEvent(
		{
			kind,
			created_at: over.created_at ?? 1794999999,
			tags: [
				['auction', auctionId],
				['bid', bidId],
				['height', String(height)],
				['hash', hash],
			],
			content: JSON.stringify(content),
		},
		RECEIPT_SK,
	) as unknown as NostrEventLike
}

const LOT_STATE_SK = new Uint8Array(32).fill(13)
const LOT_STATE_PUB = getPublicKey(LOT_STATE_SK)

const ARENA_CONTENT_COORD = '1440:seller-alice:lot-1'

/** A signed kind-1449 committed end, built from the chain's live shape (§4). */
function lotStateEvent(
	over: {
		auctionId?: string
		endTime?: number
		originalEndTime?: number | null
		extensions?: number
		height?: number
		hash?: string
		created_at?: number
	} = {},
): NostrEventLike {
	const auctionId = over.auctionId ?? ARENA_CONTENT_COORD
	const endTime = over.endTime ?? 1795021627
	const originalEndTime = over.originalEndTime === undefined ? 1795021615 : over.originalEndTime
	const height = over.height ?? 1734
	const hash = over.hash ?? 'a8e25d2044c0be17413f822a4e867af5b4332f599c760dc6da180f604cb9542f'
	const content: Record<string, unknown> = {
		schema: 'arena.lot.v1',
		auction_id: auctionId,
		end_time: endTime,
		extensions: over.extensions ?? 1,
		height,
		block_hash: hash,
	}
	if (originalEndTime !== null) content.original_end_time = originalEndTime
	return finalizeEvent(
		{
			kind: 1449,
			created_at: over.created_at ?? 1795021527,
			tags: [
				['auction', auctionId],
				['height', String(height)],
				['hash', hash],
				['p', LOT_STATE_PUB],
			],
			content: JSON.stringify(content),
		},
		LOT_STATE_SK,
	) as unknown as NostrEventLike
}

/** A signed kind-1449 bid admission, built from the chain's live shape (R4). */
function bidAdmitEvent(
	over: {
		auctionId?: string
		bidId?: string
		bidder?: string
		amount?: number
		position?: number
		highBid?: string
		height?: number
		hash?: string
		created_at?: number
	} = {},
): NostrEventLike {
	const auctionId = over.auctionId ?? ARENA_CONTENT_COORD
	const bidId = over.bidId ?? 'a5fe7c6b27eff87d88d23f79b94e6f73cca8762c03db7e0e080b462839a778fe'
	const height = over.height ?? 3437
	const hash = over.hash ?? '7bc7495aa6e679d003d495f934287dfde352b6552dc2960bac77cbdac8636edf'
	const content: Record<string, unknown> = {
		schema: 'arena.bidadmit.v1',
		auction_id: auctionId,
		bid_id: bidId,
		bidder: over.bidder ?? '72e53882afc932d3cc34b67d4bc686d59d20bdea36f6a916fcf6eea2974d4ed5',
		amount: over.amount ?? 100,
		position: over.position ?? 105,
		high_bid: over.highBid ?? '50b13a5c47715c3f42ebc3fad3c4a9b5f78e5f48e4bd5f43f3c168d5216abe59',
		height,
		block_hash: hash,
	}
	return finalizeEvent(
		{
			kind: 1449,
			created_at: over.created_at ?? 1795021737,
			tags: [
				['e', bidId],
				['auction', auctionId],
				['height', String(height)],
				['hash', hash],
				['p', LOT_STATE_PUB],
			],
			content: JSON.stringify(content),
		},
		LOT_STATE_SK,
	) as unknown as NostrEventLike
}

/** A signed kind-1450 refusal, built from the chain's live shape (§4). */
function refusedEvent(
	over: {
		refusedEventId?: string
		reason?: string
		refusedKind?: number
		height?: number
		hash?: string
		created_at?: number
	} = {},
): NostrEventLike {
	const refusedEventId = over.refusedEventId ?? 'root-1'
	const reason = over.reason ?? 'title required (max 120 chars)'
	const height = over.height ?? 1749
	const hash = over.hash ?? '0210e491ea9750bc2673d5d5ab3cfad2adabab56dff0bf095ff2bc5fa9ba8fb6'
	const content = {
		schema: 'arena.refused.v1',
		event_id: refusedEventId,
		kind: over.refusedKind ?? 1440,
		reason,
		height,
		block_hash: hash,
	}
	return finalizeEvent(
		{
			kind: 1450,
			created_at: over.created_at ?? 1795021902,
			tags: [
				['e', refusedEventId],
				['height', String(height)],
				['hash', hash],
				['p', LOT_STATE_PUB],
			],
			content: JSON.stringify(content),
		},
		LOT_STATE_SK,
	) as unknown as NostrEventLike
}

interface FakeRelayOptions {
	events?: NostrEventLike[]
	/** Throw on open. */
	fail?: string
	/** Never yield and never end until aborted. */
	hang?: boolean
	/** Emit a caught-up that lists this relay as pending (never answered). */
	silent?: boolean
	/**
	 * The relay answered the REQ with a refusal (`CLOSED` naming a filter error,
	 * or a refusal `NOTICE`): the caught-up marker names it `refused`.
	 */
	refused?: string
	/** The relay's connection never established: the caught-up marker names it `unreachable`. */
	unreachable?: boolean
	/**
	 * What the relay's socket truth answers when the read asks it at its deadline
	 * (`init.relayConnected`). Default `true`, or `false` for a fake whose stream
	 * throws on open. `false` + `hang` models the measured cold-load case: a relay
	 * that never opened a socket, says nothing, and whose transport verdict
	 * arrives too late to be seen.
	 */
	connected?: boolean
}

function fakeRelay(url: string, options: FakeRelayOptions): ArenaRelayOpen {
	return (_filters: readonly EventFilter[], opts: ArenaRelayOpenOptions) => ({
		async *[Symbol.asyncIterator](): AsyncIterator<EventStreamItem<NostrEventLike>> {
			if (options.fail) throw new Error(options.fail)
			for (const event of options.events ?? []) {
				yield { type: 'event', event } as EventStreamItem<NostrEventLike>
			}
			if (options.hang) {
				if (!opts.signal?.aborted) {
					await new Promise<void>((resolve) => {
						opts.signal?.addEventListener('abort', () => resolve())
					})
				}
				return
			}
			yield {
				type: 'caught-up',
				info:
					options.refused !== undefined
						? { eose: [], pending: [url], complete: false, refused: [{ relay: url, reason: options.refused }] }
						: options.unreachable === true
							? { eose: [], pending: [url], complete: false, unreachable: [url] }
							: options.silent
								? { eose: [], pending: [url], complete: false }
								: { eose: [url], pending: [], complete: false },
			} as EventStreamItem<NostrEventLike>
		},
	})
}

/**
 * A live read now ends at its deadline, never at a settle marker, so a test
 * that consumes `events()` names the bound it needs. The fakes here resolve in
 * microtasks, so the default is deliberately short; the reads that are *about*
 * the bound pass their own (`60`, `40`).
 *
 * The connect truth defaults to the fake's own shape — a relay whose stream
 * throws on open never had a socket, every other fake did — and a test that
 * needs "the transport cannot speak" passes its own probe.
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

async function collect(stream: AsyncIterable<ArenaReadStreamItem>): Promise<ArenaReadStreamItem[]> {
	const items: ArenaReadStreamItem[] = []
	for await (const item of stream) items.push(item)
	return items
}

// =========================================================================
// The subscription itself
// =========================================================================

describe('the read seam', () => {
	test('asks for exactly the eight auction kinds and nothing else', () => {
		// One filter per kind group, each with its own limit: a single combined
		// filter is answered with the newest events across all kinds, which the
		// chain's 10 s commitments then fill entirely (measured live: 36 lots on
		// the relay, one lot on the page). The two state-half kinds (1449 the
		// committed end, 1450 a create's refusal) get their own budgets too.
		expect(arenaAuctionFilters()).toEqual([
			{ kinds: [1440], limit: 500 },
			{ kinds: [1441], limit: 500 },
			{ kinds: [1443, 1444], limit: 200 },
			{ kinds: [1445], limit: 200 },
			{ kinds: [1447], limit: 60 },
			{ kinds: [1449], limit: 200 },
			{ kinds: [1450], limit: 200 },
		])
		expect(ARENA_READ_KINDS).toEqual([1440, 1441, 1443, 1444, 1445, 1447, 1449, 1450])
	})

	test('opens one independent subscription per relay', async () => {
		const opened: string[] = []
		const read = createArenaAuctionRead({
			relays: ['wss://one', 'wss://two', 'wss://three'],
			openRelay: (url) => {
				opened.push(url)
				return fakeRelay(url, { events: [createEvent()] })
			},
		})
		await read.snapshot()
		expect(opened).toEqual(['wss://one', 'wss://two', 'wss://three'])
	})
})

// =========================================================================
// Dedupe, order, and the canonical 1440
// =========================================================================

describe('dedupe and order', () => {
	test('the same event from three relays is one event, with all three named', async () => {
		const create = createEvent({ id: 'shared-create', created_at: 1000 })
		const read = readFrom({
			'wss://a': { events: [create] },
			'wss://b': { events: [create] },
			'wss://c': { events: [create] },
		})
		const snapshot = await read.snapshot()

		expect(snapshot.auctions).toHaveLength(1)
		const view = snapshot.auctions[0]
		expect(view.canonicalEventId).toBe('shared-create')
		// The auction view carries the union of the relays that delivered it.
		expect(view.relays).toEqual(['wss://a', 'wss://b', 'wss://c'])
		expect(view.bids).toHaveLength(0)
	})

	test('auctions are newest first, ties to the lexically lowest event id', async () => {
		const older = createEvent({ id: 'older', created_at: 900 }, { auction_id: 'lot-old' })
		const tieB = createEvent({ id: 'tie-b', created_at: 1000 }, { auction_id: 'lot-b' })
		const tieA = createEvent({ id: 'tie-a', created_at: 1000 }, { auction_id: 'lot-a' })
		const read = readFrom({ 'wss://a': { events: [older, tieB, tieA] } })

		const snapshot = await read.snapshot()
		expect(snapshot.auctions.map((a) => a.canonicalEventId)).toEqual(['tie-a', 'tie-b', 'older'])
	})

	test('a 1440 whose d tag disagrees with its auction_id is refused, not reconciled', () => {
		const bad = createEvent({ d: 'lot-x' }, { auction_id: 'lot-y' })
		const decoded = decodeArenaEvent(bad, 'wss://a')
		expect(decoded.ok).toBe(false)
		if (!decoded.ok) expect(decoded.refusal.reason).toBe(ARENA_REFUSAL_BAD_IDENTITY)
	})

	test('a 1440 that names its identity only in the d tag is read, with d as the auction id', () => {
		// The chain's own client writes the identity once, in the tag. The spec
		// says `auction_id` IS the `d` value, so a create that states it once is
		// unambiguous — refusing it hid every lot created by that client.
		const dOnly = createEvent({ d: 'lot-tag' }, { auction_id: undefined })
		const decoded = decodeArenaEvent(dOnly, 'wss://a')
		expect(decoded.ok).toBe(true)
		if (decoded.ok && decoded.event.type === 'create') {
			expect(decoded.event.auctionId).toBe('lot-tag')
			expect(decoded.event.d).toBe('lot-tag')
			expect(decoded.event.content_.auctionId).toBe('lot-tag')
		}
	})

	test('a 1440 that names no identity at all is refused', () => {
		const anonymous = ev({
			id: 'anon-1',
			kind: ARENA_AUCTION_CREATE_KIND,
			pubkey: SELLER_A,
			created_at: 1000,
			tags: [],
			content: JSON.stringify(createContent({ auction_id: undefined })),
		})
		const decoded = decodeArenaEvent(anonymous, 'wss://a')
		expect(decoded.ok).toBe(false)
		if (!decoded.ok) expect(decoded.refusal.reason).toBe(ARENA_REFUSAL_BAD_CONTENT)
	})
})

describe('1440 is regular: latest version wins, behind the immutable check', () => {
	test('an edit to a mutable field supersedes the root', async () => {
		const root = createEvent({ id: 'v1', created_at: 1000 }, { title: 'Typo tittle' })
		const edit = createEvent({ id: 'v2', created_at: 2000, e: 'v1' }, { title: 'Correct title' })
		const read = readFrom({ 'wss://a': { events: [edit, root] } })

		const snapshot = await read.snapshot()
		expect(snapshot.auctions).toHaveLength(1)
		expect(snapshot.auctions[0].canonicalEventId).toBe('v2')
		expect(snapshot.auctions[0].content.title).toBe('Correct title')
		expect(snapshot.auctions[0].rootEventId).toBe('v1')
		expect(snapshot.auctions[0].versions).toBe(2)
		// The start time is the root's, not the edited version's: a display edit
		// must not move when the auction began (and therefore when it ends).
		expect(snapshot.auctions[0].rootCreatedAt).toBe(1000)
		expect(snapshot.auctions[0].createdAt).toBe(2000)
		expect(snapshot.rejectedCreates).toHaveLength(0)
	})

	test('the latest accepted edit wins, not merely the latest', async () => {
		const root = createEvent({ id: 'v1', created_at: 1000 }, { title: 'one' })
		const edit = createEvent({ id: 'v2', created_at: 2000, e: 'v1' }, { title: 'two' })
		const edit2 = createEvent({ id: 'v3', created_at: 3000, e: 'v1' }, { title: 'three' })
		const read = readFrom({ 'wss://a': { events: [root, edit, edit2] } })

		const snapshot = await read.snapshot()
		expect(snapshot.auctions[0].canonicalEventId).toBe('v3')
		expect(snapshot.auctions[0].content.title).toBe('three')
	})

	test('an edit that moves an immutable field is rejected and named', async () => {
		const root = createEvent({ id: 'v1', created_at: 1000 }, { startPrice: 1000 })
		// The classic attack the allow-list exists for: a "typo fix" that lowers the floor.
		const attack = createEvent({ id: 'v2', created_at: 2000, e: 'v1' }, { startPrice: 1 })
		const read = readFrom({ 'wss://a': { events: [root, attack] } })

		const snapshot = await read.snapshot()
		expect(snapshot.auctions[0].canonicalEventId).toBe('v1')
		expect(snapshot.auctions[0].content.startPrice).toBe(1000)
		expect(snapshot.rejectedCreates).toHaveLength(1)
		expect(snapshot.rejectedCreates[0].reason).toBe(ARENA_REFUSAL_IMMUTABLE_CHANGED)
		expect(snapshot.rejectedCreates[0].field).toBe('startPrice')
	})

	test('every frozen field is frozen, not just the money ones', async () => {
		const root = createEvent({ id: 'v1' })
		const attack = createEvent({ id: 'v2', created_at: 2000, e: 'v1' }, { mode: 'antisnipe' })
		const decodedRoot = decodeArenaEvent(root, 'wss://a')
		const decodedAttack = decodeArenaEvent(attack, 'wss://a')
		expect(decodedRoot.ok && decodedAttack.ok).toBe(true)
		if (decodedRoot.ok && decodedAttack.ok && decodedRoot.event.type === 'create' && decodedAttack.event.type === 'create') {
			expect(findImmutableChange(decodedRoot.event, decodedAttack.event)?.field).toBe('mode')
		}
	})

	test('a deeper version that does not name the root is ignored, never guessed at', async () => {
		const root = createEvent({ id: 'v1', created_at: 1000 }, { title: 'root' })
		const stray = createEvent({ id: 'v2', created_at: 2000 }, { title: 'stray' })
		const read = readFrom({ 'wss://a': { events: [root, stray] } })

		const snapshot = await read.snapshot()
		expect(snapshot.auctions[0].canonicalEventId).toBe('v1')
		expect(snapshot.auctions[0].content.title).toBe('root')
		expect(snapshot.rejectedCreates[0].reason).toBe(ARENA_REFUSAL_NOT_SUPERSEDING_ROOT)
	})

	test('two accepted versions at the same created_at resolve to the lowest id', async () => {
		const root = createEvent({ id: 'root', created_at: 1000 }, { title: 'root' })
		const a = createEvent({ id: 'aaa', created_at: 2000, e: 'root' }, { title: 'a' })
		const b = createEvent({ id: 'bbb', created_at: 2000, e: 'root' }, { title: 'b' })
		const read = readFrom({ 'wss://a': { events: [root, b, a] } })

		const snapshot = await read.snapshot()
		expect(snapshot.auctions[0].canonicalEventId).toBe('aaa')
	})
})

// =========================================================================
// Bids, verdicts, commitments
// =========================================================================

describe('bids', () => {
	test('a bid binds by coordinate, by root id, or by an unambiguous auction_id', async () => {
		const create = createEvent({ id: 'root-1' })
		const byCoordinate = bidEvent({ a: `1440:${SELLER_A}:lot-1`, amount: 100, created_at: 1100 })
		const byRoot = bidEvent({ e: 'root-1', amount: 200, created_at: 1200 })
		const byAuctionId = bidEvent({ auctionId: 'lot-1', amount: 300, created_at: 1300 })
		const read = readFrom({ 'wss://a': { events: [create, byCoordinate, byRoot, byAuctionId] } })

		const snapshot = await read.snapshot()
		expect(snapshot.auctions[0].bids).toHaveLength(3)
		// A bid chain reads forwards.
		expect(snapshot.auctions[0].bids.map((b) => b.createdAt)).toEqual([1100, 1200, 1300])
	})

	test('a bid naming no known auction is refused and counted, not attached to a guess', async () => {
		const create = createEvent({ id: 'root-1' })
		const stray = bidEvent({ a: '1440:someone-else:other-lot', amount: 50 })
		const read = readFrom({ 'wss://a': { events: [create, stray] } })

		const snapshot = await read.snapshot()
		expect(snapshot.auctions[0].bids).toHaveLength(0)
		expect(snapshot.refusals.some((r) => r.reason === ARENA_REFUSAL_UNBOUND_BID)).toBe(true)
	})

	test('positions sum the deltas per bidder, and the top bid is derived from them', async () => {
		const create = createEvent({ id: 'root-1' })
		const b1 = bidEvent({ e: 'root-1', amount: 500, pubkey: 'bidder-1', created_at: 1100 })
		const b2 = bidEvent({ e: 'root-1', amount: 200, pubkey: 'bidder-1', created_at: 1200 })
		const b3 = bidEvent({ e: 'root-1', amount: 600, pubkey: 'bidder-2', created_at: 1300 })
		const read = readFrom({ 'wss://a': { events: [create, b1, b2, b3] } })

		const snapshot = await read.snapshot()
		expect(snapshot.auctions[0].positions).toEqual({ 'bidder-1': 700, 'bidder-2': 600 })
		expect(snapshot.auctions[0].topBid).toEqual({ bidder: 'bidder-1', total: 700 })
		expect(snapshot.auctions[0].bidsWithoutAmount).toBe(0)
	})

	test('a leg a refund receipt names is dead and is not summed into the position', async () => {
		const create = createEvent({ id: 'root-1' })
		const live = bidEvent({ id: 'bid-live', e: 'root-1', amount: 500, pubkey: 'bidder-1', created_at: 1100 })
		const voided = bidEvent({ id: 'bid-voided', e: 'root-1', amount: 100, pubkey: 'bidder-1', created_at: 1200 })
		// The chain refunded `bid-voided`: kind 1443, naming that bid id.
		const refund = receiptEvent({ bidId: 'bid-voided', height: 400 })
		const snapshot = await readFrom({ 'wss://a': { events: [create, live, voided, refund] } }).snapshot()

		expect(snapshot.auctions[0].refundForBid['bid-voided']?.height).toBe(400)
		// The deltas alone would sum to 600; the dead leg is not part of a position.
		expect(snapshot.auctions[0].positions).toEqual({ 'bidder-1': 500 })
		expect(snapshot.auctions[0].topBid).toEqual({ bidder: 'bidder-1', total: 500 })
		// Both legs are still read as bids — the refund excludes, it does not erase.
		expect(snapshot.auctions[0].bids).toHaveLength(2)
	})

	test('a leg whose liveness the read cannot establish leaves the position unknown, never a partial sum', async () => {
		const create = createEvent({ id: 'root-1' })
		const leg = bidEvent({ id: 'bid-1', e: 'root-1', amount: 500, pubkey: 'bidder-1' })

		// `wss://broken` threw. A 1443 refund for this leg could have been on it, so
		// the read cannot say the leg is live: the position is unknown, not 500.
		const partial = await readFrom({
			'wss://a': { events: [create, leg] },
			'wss://broken': { fail: 'connection refused' },
		}).snapshot()
		expect(partial.health.failed).toEqual(['wss://broken'])
		expect(partial.auctions[0].positions).toEqual({ 'bidder-1': null })
		// No top position can be named either: an unknown position could be the top.
		expect(partial.auctions[0].topBid).toBeNull()

		// The same events with every relay answering: the leg is live and it sums.
		const whole = await readFrom({ 'wss://a': { events: [create, leg] } }).snapshot()
		expect(whole.health.failed).toEqual([])
		expect(whole.auctions[0].positions).toEqual({ 'bidder-1': 500 })
		expect(whole.auctions[0].topBid).toEqual({ bidder: 'bidder-1', total: 500 })
	})
})

describe('verdicts and commitments', () => {
	test('an anchored verdict lands on its auction; an unanchored one is ignored by name', async () => {
		const create = createEvent({ id: 'root-1' })
		const good = verdictEvent({ auctionId: 'lot-1', bidId: 'bid-9' })
		const unanchored = ev({
			kind: ARENA_VERDICT_KIND,
			pubkey: 'validator-2',
			tags: [['auction', 'lot-1']],
			// No height and no hash, in tags or content: this is the event a client MUST ignore.
			content: { schema: 'arena.verdict.v1', auction_id: 'lot-1', outcome: 'winner' },
		})
		const read = readFrom({ 'wss://a': { events: [create, good, unanchored] } })

		const snapshot = await read.snapshot()
		expect(snapshot.auctions[0].verdicts).toHaveLength(1)
		expect(snapshot.auctions[0].verdicts[0].bidId).toBe('bid-9')
		expect(snapshot.refusals.some((r) => r.reason === 'arena.unanchored')).toBe(true)
	})

	test('a verdict for an auction this read never saw is an orphan, not a crash and not a fake auction', async () => {
		const read = readFrom({ 'wss://a': { events: [verdictEvent({ auctionId: 'lot-unknown' })] } })
		const snapshot = await read.snapshot()
		expect(snapshot.auctions).toHaveLength(0)
		expect(snapshot.orphanVerdicts).toHaveLength(1)
	})

	test('two validators committing the same app hash is agreement; different hashes at one height is a fork', async () => {
		const agreeOne = commitmentEvent({ height: 42, appHash: 'aaaa', validator: 'validator-1' })
		const agreeTwo = commitmentEvent({ height: 42, appHash: 'aaaa', validator: 'validator-2' })
		const agreeing = await readFrom({
			'wss://a': { events: [agreeOne] },
			'wss://b': { events: [agreeTwo] },
		}).snapshot()
		expect(agreeing.highestCommitment?.height).toBe(42)
		expect(agreeing.commitmentForks).toHaveLength(0)

		const forkOne = commitmentEvent({ height: 42, appHash: 'aaaa', validator: 'validator-1' })
		const forkTwo = commitmentEvent({ height: 42, appHash: 'bbbb', validator: 'validator-2' })
		const forked = await readFrom({
			'wss://a': { events: [forkOne] },
			'wss://b': { events: [forkTwo] },
		}).snapshot()
		expect(forked.commitmentForks).toHaveLength(1)
		expect(forked.commitmentForks[0].byRelay).toEqual({ 'wss://a': ['aaaa'], 'wss://b': ['bbbb'] })
	})

	test('two commitments at one height with different times do not collapse, and the newest time wins', async () => {
		// The heartbeat publishes several ticks at one unchanged height; they share
		// `(validator, height, app_hash)` and differ only by `time`. Without `time` in
		// the identity they collapse to one entry and the *first* (oldest) wins, so the
		// clock would be as stale as the oldest tick. They must stay two, newest first.
		const older = commitmentEvent({ height: 50, appHash: 'aaaa', validator: 'validator-1', time: 1700000100 })
		const newer = commitmentEvent({ height: 50, appHash: 'aaaa', validator: 'validator-1', time: 1700000500 })
		const read = readFrom({ 'wss://a': { events: [older, newer] } })

		const snapshot = await read.snapshot()
		expect(snapshot.stateCommitments).toHaveLength(2)
		expect(snapshot.stateCommitments.map((c) => c.time)).toEqual([1700000500, 1700000100])
		expect(snapshot.highestCommitment?.time).toBe(1700000500)
	})

	test('at one height the stated newest time sorts ahead of a commitment with no time', async () => {
		const noTime = commitmentEvent({ height: 50, appHash: 'aaaa', validator: 'validator-1', time: null })
		const timed = commitmentEvent({ height: 50, appHash: 'aaaa', validator: 'validator-1', time: 1700000200 })
		const read = readFrom({ 'wss://a': { events: [noTime, timed] } })

		const snapshot = await read.snapshot()
		expect(snapshot.stateCommitments).toHaveLength(2)
		expect(snapshot.stateCommitments[0].time).toBe(1700000200)
		expect(snapshot.stateCommitments[1].time).toBeNull()
	})

	test('relays reporting different outcomes for one auction are flagged as divergent', async () => {
		const create = createEvent({ id: 'root-1' })
		const winnerOnA = verdictEvent({ auctionId: 'lot-1', outcome: 'winner', validator: 'validator-1' })
		const abortedOnB = verdictEvent({ auctionId: 'lot-1', outcome: 'aborted', validator: 'validator-1' })
		const read = readFrom({
			'wss://a': { events: [create, winnerOnA] },
			'wss://b': { events: [abortedOnB] },
		})

		const snapshot = await read.snapshot()
		expect(snapshot.verdictDivergence).toHaveLength(1)
		expect(snapshot.verdictDivergence[0].byRelay).toEqual({
			'wss://a': ['winner'],
			'wss://b': ['aborted'],
		})
	})
})

// =========================================================================
// A relay that is down, slow, or lying
// =========================================================================

describe('resilience', () => {
	test('one dead relay does not stall or empty the read', async () => {
		const read = readFrom({
			'wss://dead': { fail: 'connection refused' },
			'wss://alive': { events: [createEvent({ id: 'root-1' })] },
		})

		const snapshot = await read.snapshot()
		expect(snapshot.auctions).toHaveLength(1)
		expect(snapshot.health.failed).toEqual(['wss://dead'])
		// A connection that failed is a settled fact about that relay, not silence:
		// it is accounted `unreachable`, so it does not hold the read open.
		expect(snapshot.health.unreachable).toEqual(['wss://dead'])
		expect(snapshot.health.pending).not.toContain('wss://dead')
		expect(snapshot.health.eose).toEqual(['wss://alive'])
		expect(snapshot.health.noRelaysReachable).toBe(false)
		expect(snapshot.health.relays.find((r) => r.url === 'wss://dead')?.error).toBe('connection refused')
	})

	test('a relay that CLOSEs with a filter error is accounted for, not left pending', async () => {
		// Measured live 2026-11-19: nos.lol / nostr.mom / relay.nostr.net answer a
		// `#auction` REQ with `CLOSED … bad req: error parsing #auction: unindexed
		// tag filter`. The relay cannot serve the subscription — it has answered
		// the question, so the read must not keep waiting on it.
		const read = readFrom({
			'wss://refuser': { refused: 'bad req: error parsing #auction: unindexed tag filter' },
			'wss://alive': { events: [createEvent({ id: 'root-1' })] },
		})

		const items = await collect(read.events())
		const caughtUp = items.find((i) => i.type === 'caught-up')
		if (caughtUp?.type !== 'caught-up') throw new Error('no caught-up marker')
		expect(caughtUp.health.refused).toEqual(['wss://refuser'])
		expect(caughtUp.health.pending).toEqual([])
		expect(caughtUp.health.unreachable).toEqual([])
		expect(caughtUp.health.relays.find((r) => r.url === 'wss://refuser')?.status).toBe('refused')
		// The relay's own reason is kept, verbatim, for an operator log.
		expect(caughtUp.health.relays.find((r) => r.url === 'wss://refuser')?.error).toBe(
			'bad req: error parsing #auction: unindexed tag filter',
		)
		// Every relay is accounted for, so the read settles and the surface may
		// state the lot's phase instead of a partial-read sentence.
		expect(auctionListStatus(caughtUp.health)).toBe('settled')
	})

	test('a relay whose connection failed and was not recovered is accounted for', async () => {
		// Measured live 2026-11-19: relay.damus.io 503s its WebSocket upgrade, and
		// nostr.mom / nos.lol never open a socket. The transport names them
		// `unreachable` at its settle bound; the read must not leave them pending.
		const read = readFrom({
			'wss://never': { unreachable: true },
			'wss://alive': { events: [createEvent({ id: 'root-1' })] },
		})

		const items = await collect(read.events())
		const caughtUp = items.find((i) => i.type === 'caught-up')
		if (caughtUp?.type !== 'caught-up') throw new Error('no caught-up marker')
		expect(caughtUp.health.unreachable).toEqual(['wss://never'])
		expect(caughtUp.health.pending).toEqual([])
		expect(caughtUp.health.relays.find((r) => r.url === 'wss://never')?.status).toBe('unreachable')
		expect(auctionListStatus(caughtUp.health)).toBe('settled')
	})

	test('a genuinely silent relay inside the deadline still yields incomplete', async () => {
		// The honesty rule survives: a relay the transport has not classified — it
		// connected and said nothing — could still answer, so the read stays
		// incomplete rather than rendering a no-data verdict. The socket probe says
		// `true`, which is exactly what keeps it out of `unreachable`.
		const read = readFrom(
			{
				'wss://mute': { connected: true, silent: true, hang: true },
				'wss://alive': { events: [createEvent({ id: 'root-1' })] },
			},
			60,
		)

		const items: ArenaReadStreamItem[] = []
		for await (const item of read.events()) {
			items.push(item)
			if (item.type === 'caught-up') read.close()
		}
		const caughtUp = items.find((i) => i.type === 'caught-up')
		if (caughtUp?.type !== 'caught-up') throw new Error('no caught-up marker')
		expect(caughtUp.health.pending).toEqual(['wss://mute'])
		expect(caughtUp.health.refused).toEqual([])
		expect(caughtUp.health.unreachable).toEqual([])
		// Connected and silent is the read stopping its wait, not a relay verdict.
		expect(caughtUp.health.relays.find((r) => r.url === 'wss://mute')?.status).toBe('timeout')
		expect(auctionListStatus(caughtUp.health)).toBe('incomplete')
	})

	test('a relay whose socket never opened is unreachable at the deadline, not pending', async () => {
		// Measured live 2026-11-20 (lot d=612a25ed-2562-4575-b780-ecfa98d7f35a, 7
		// configured relays): the transport's own settle bound is armed when its
		// stream opens, so it fires *after* the read's deadline — its verdict never
		// arrived and the relays with no socket were frozen as `pending`. The lot
		// page read `incomplete` ("3 of 7 relays answered") on every cold run, where
		// the deployed baseline read `settled`. At its deadline the read asks the
		// transport's connect truth itself, and knows: no socket, cannot answer.
		const read = readFrom(
			{
				'wss://never': { connected: false, hang: true },
				'wss://alive': { events: [createEvent({ id: 'root-1' })] },
			},
			60,
		)

		const items = await collect(read.events())
		const caughtUp = items.find((i) => i.type === 'caught-up')
		if (caughtUp?.type !== 'caught-up') throw new Error('no caught-up marker')
		expect(caughtUp.health.relays.find((r) => r.url === 'wss://never')?.status).toBe('unreachable')
		expect(caughtUp.health.unreachable).toEqual(['wss://never'])
		expect(caughtUp.health.pending).toEqual([])
		// The counts stay honest: a relay that never answered is not answered, and
		// the word is `settled` with the count short of the total.
		expect(relayCounts(caughtUp.health)).toEqual({ answered: 1, total: 2 })
		expect(auctionListStatus(caughtUp.health)).toBe('settled')
	})

	test('a relay the transport gave up on is still unreachable when its socket is shut', async () => {
		// The transport's own fallback can only say "no EOSE", so it names a
		// never-connected relay `pending`; in production that marker lands after the
		// read's deadline. Whichever order the two arrive in, the read's own
		// classification at its deadline is a fact about the socket rather than an
		// estimate — so the relay ends `unreachable`: the give-up was the guess.
		const read = createArenaAuctionRead({
			relays: ['wss://never', 'wss://alive'],
			deadlineMs: 60,
			relayConnected: (url) => url !== 'wss://never',
			openRelay: (url) => (filters: readonly EventFilter[], opts: ArenaRelayOpenOptions) => {
				if (url !== 'wss://never') return fakeRelay(url, { events: [createEvent({ id: 'root-1' })] })(filters, opts)
				return {
					async *[Symbol.asyncIterator](): AsyncIterator<EventStreamItem<NostrEventLike>> {
						// The transport's fallback: no EOSE, so the marker can only call the
						// relay `pending`. The relay then stays open, as a live connection does.
						yield { type: 'caught-up', info: { eose: [], pending: [url], complete: false } }
						if (!opts.signal?.aborted) {
							const { promise, resolve } = Promise.withResolvers<void>()
							opts.signal?.addEventListener('abort', () => resolve())
							await promise
						}
					},
				}
			},
		})

		const items = await collect(read.events())
		const caughtUp = items.find((i) => i.type === 'caught-up')
		if (caughtUp?.type !== 'caught-up') throw new Error('no caught-up marker')
		expect(caughtUp.health.unreachable).toEqual(['wss://never'])
		expect(caughtUp.health.pending).toEqual([])
		expect(auctionListStatus(caughtUp.health)).toBe('settled')
	})

	test('a transport that cannot speak for a relay leaves it pending, not unreachable', async () => {
		// `null` is "no verdict", and the read may not invent one: with no connect
		// truth about that relay the silence reading stands, so the read stays
		// incomplete while the relay that answered still counts.
		const read = readFrom(
			{
				'wss://alive': { events: [createEvent({ id: 'root-1' })] },
				'wss://unknown': { hang: true },
			},
			40,
			() => null,
		)

		const items = await collect(read.events())
		const caughtUp = items.find((i) => i.type === 'caught-up')
		if (caughtUp?.type !== 'caught-up') throw new Error('no caught-up marker')
		expect(caughtUp.health.pending).toEqual(['wss://unknown'])
		expect(caughtUp.health.unreachable).toEqual([])
		expect(caughtUp.health.relays.find((r) => r.url === 'wss://unknown')?.status).toBe('timeout')
		expect(relayCounts(caughtUp.health)).toEqual({ answered: 1, total: 2 })
		expect(auctionListStatus(caughtUp.health)).toBe('incomplete')
	})

	test('the deadline classification ends nothing early: the pumps are aborted together at the bound', async () => {
		// The classification is a label, not an end. A relay that never connected is
		// settled `unreachable` *and* the relays that are still open stay open: the
		// read runs to its full deadline, then tears every subscription down at once,
		// and the caught-up marker is the last item.
		const aborted: string[] = []
		const read = createArenaAuctionRead({
			relays: ['wss://never', 'wss://mute'],
			deadlineMs: 60,
			relayConnected: (url) => url !== 'wss://never',
			openRelay: (url) => (_filters: readonly EventFilter[], opts: ArenaRelayOpenOptions) => ({
				async *[Symbol.asyncIterator](): AsyncIterator<EventStreamItem<NostrEventLike>> {
					// Both relays are silent; only their sockets differ. Neither stream
					// ends on its own, so only the deadline (and the teardown it triggers)
					// can finish this read.
					if (!opts.signal?.aborted) {
						const { promise, resolve } = Promise.withResolvers<void>()
						opts.signal?.addEventListener('abort', () => {
							aborted.push(url)
							resolve()
						})
						await promise
					}
				},
			}),
		})

		const started = Date.now()
		const items = await collect(read.events())
		expect(Date.now() - started).toBeGreaterThanOrEqual(50)
		expect(aborted).toEqual(['wss://never', 'wss://mute'])
		const caughtUp = items.at(-1)
		if (caughtUp?.type !== 'caught-up') throw new Error('no caught-up marker')
		expect(items.filter((i) => i.type === 'caught-up')).toHaveLength(1)
		expect(caughtUp.health.relays.find((r) => r.url === 'wss://never')?.status).toBe('unreachable')
		expect(caughtUp.health.relays.find((r) => r.url === 'wss://mute')?.status).toBe('timeout')
		expect(caughtUp.health.pending).toEqual(['wss://mute'])
	})

	test('a refused relay receives no follow-up REQ', async () => {
		// `arenaLotFollowUpFilters` opens a second REQ once the create is known —
		// but only on relays that can still serve it. A relay that refused the base
		// subscription must not be asked again.
		const opened = new Map<string, number>()
		const create = createEvent({ id: 'root-1', d: 'lot-1' })
		const read = createArenaAuctionRead({
			relays: ['wss://refuser', 'wss://alive'],
			// The live read ends at its deadline, not at a settle marker; the fakes
			// resolve in microtasks, so a short bound is all this needs.
			deadlineMs: 200,
			filters: arenaLotFilters(SELLER_A, 'lot-1'),
			followUpFilters: arenaLotFollowUpFilters(SELLER_A, 'lot-1'),
			openRelay: (url) => (filters, opts) => {
				opened.set(url, (opened.get(url) ?? 0) + 1)
				return fakeRelay(url, url === 'wss://refuser' ? { refused: 'bad req: unindexed tag filter' } : { events: [create] })(filters, opts)
			},
		})

		await collect(read.events())
		// The base REQ on both relays, plus the follow-up REQ on the alive relay only.
		expect(opened.get('wss://refuser')).toBe(1)
		expect(opened.get('wss://alive')).toBe(2)
	})

	test('one slow relay is dropped at the deadline and the partial result is returned', async () => {
		const read = readFrom(
			{
				'wss://slow': { hang: true },
				'wss://alive': { events: [createEvent({ id: 'root-1' })] },
			},
			60,
		)

		const started = Date.now()
		const snapshot = await read.snapshot()
		expect(Date.now() - started).toBeLessThan(2000)
		expect(snapshot.auctions).toHaveLength(1)
		expect(snapshot.health.relays.find((r) => r.url === 'wss://slow')?.status).toBe('timeout')
		expect(snapshot.health.pending).toEqual(['wss://slow'])
	})

	test('a relay that answers with no events is an honest empty, not a reachability failure', async () => {
		const read = readFrom({ 'wss://empty': { events: [] } })
		const snapshot = await read.snapshot()
		expect(snapshot.auctions).toHaveLength(0)
		expect(snapshot.health.empty).toBe(true)
		expect(snapshot.health.noRelaysReachable).toBe(false)
		expect(snapshot.health.eose).toEqual(['wss://empty'])
	})

	test('a lying relay cannot inject a kind it was never asked for, bad JSON, or an immutable flip', async () => {
		const root = createEvent({ id: 'v1', created_at: 1000 }, { startPrice: 1000 })
		const attack = createEvent({ id: 'v2', created_at: 2000, e: 'v1' }, { startPrice: 1 })
		const read = readFrom({
			'wss://liar': {
				events: [
					ev({ kind: 1, id: 'a-note', content: 'gm' }),
					ev({ kind: ARENA_AUCTION_CREATE_KIND, id: 'bad-json', content: '{not json' }),
					root,
					attack,
				],
			},
		})

		const snapshot = await read.snapshot()
		expect(snapshot.auctions).toHaveLength(1)
		expect(snapshot.auctions[0].canonicalEventId).toBe('v1')
		expect(snapshot.refusals.map((r) => r.reason)).toContain(ARENA_REFUSAL_UNEXPECTED_KIND)
		expect(snapshot.rejectedCreates.map((r) => r.reason)).toContain(ARENA_REFUSAL_IMMUTABLE_CHANGED)
		// Both the wrong-kind note and the unparseable create are counted against the liar.
		expect(snapshot.health.relays[0].refusals).toBe(2)
		expect(snapshot.health.relays[0].events).toBe(2)
	})

	test('no relay configured resolves to an honest empty, and says so', async () => {
		const read = createArenaAuctionRead({ relays: [], openRelay: () => fakeRelay('wss://x', {}) })
		const snapshot = await read.snapshot()
		expect(snapshot.auctions).toEqual([])
		expect(snapshot.health.relays).toEqual([])
		expect(snapshot.health.noRelaysReachable).toBe(true)
	})

	test('every relay failing resolves to an empty snapshot that names the failure', async () => {
		const read = readFrom({
			'wss://a': { fail: 'timeout' },
			'wss://b': { fail: 'dns' },
		})
		const snapshot = await read.snapshot()
		expect(snapshot.auctions).toEqual([])
		expect(snapshot.health.noRelaysReachable).toBe(true)
		expect(snapshot.health.failed).toEqual(['wss://a', 'wss://b'])
	})

	test('a relay that delivers but never reports EOSE counts as answered, with eose false', async () => {
		// Measured 2026-11-13: the web applesauce adapter never surfaces EOSE for a
		// ws:// relay, so "no EOSE" must not be read as "no answer".
		const read = readFrom({ 'wss://mute': { events: [createEvent({ id: 'root-1' })], silent: true } })
		const items = await collect(read.events())
		const caughtUp = items.find((i) => i.type === 'caught-up')
		expect(caughtUp?.type).toBe('caught-up')
		if (caughtUp?.type !== 'caught-up') return
		expect(caughtUp.health.eose).toEqual([])
		expect(caughtUp.health.answered).toEqual(['wss://mute'])
		expect(caughtUp.health.pending).toEqual([])
	})

	test('on a live read, a relay that is silent and delivers nothing is pending', async () => {
		const read = readFrom({ 'wss://mute': { events: [], silent: true } })
		const items = await collect(read.events())
		const caughtUp = items.find((i) => i.type === 'caught-up')
		if (caughtUp?.type !== 'caught-up') throw new Error('no caught-up marker')
		expect(caughtUp.health.answered).toEqual([])
		expect(caughtUp.health.pending).toEqual(['wss://mute'])
		expect(caughtUp.health.noRelaysReachable).toBe(true)
	})

	test('on a bounded read a silent relay is indistinguishable from an empty one — documented, not hidden', async () => {
		// The transport's bounded `fetchEvents` returns [] for a connection failure,
		// so a snapshot cannot tell "nothing to say" from "never connected". Use
		// `events()` when that distinction matters.
		const read = readFrom({ 'wss://mute': { events: [], silent: true } })
		const snapshot = await read.snapshot()
		expect(snapshot.health.relays[0].status).toBe('ok')
		expect(snapshot.health.empty).toBe(true)
	})

	test('a relay the transport gave up on that then delivers is counted as answered', async () => {
		// The transport's never-EOSE fallback gives up on a relay (a `caught-up`
		// naming it pending, with no EOSE). Measured live 2026-11-19, the relay that
		// carries the lot sent its first kind-1440 EVENT at 8759 ms, after the 8 s
		// fallback. The late answer is the answer — the give-up was a guess — and
		// under the deadline contract the read is still consuming that relay when it
		// arrives, so the event upgrades the relay to `ok` before the read ends.
		const read = createArenaAuctionRead({
			relays: ['wss://late'],
			deadlineMs: 200,
			openRelay: (url) => (_filters: readonly EventFilter[], _opts: ArenaRelayOpenOptions) => ({
				async *[Symbol.asyncIterator](): AsyncIterator<EventStreamItem<NostrEventLike>> {
					yield { type: 'caught-up', info: { eose: [], pending: [url], complete: false } }
					yield { type: 'event', event: createEvent({ id: 'root-1' }) }
					yield { type: 'caught-up', info: { eose: [url], pending: [], complete: false } }
				},
			}),
		})

		const items = await collect(read.events())
		const caughtUp = items.find((i) => i.type === 'caught-up')
		if (caughtUp?.type !== 'caught-up') throw new Error('no caught-up marker')
		expect(items.filter((i) => i.type === 'events')).toHaveLength(1)
		expect(caughtUp.health.answered).toEqual(['wss://late'])
		expect(caughtUp.health.pending).toEqual([])
		expect(caughtUp.health.relays[0].status).toBe('ok')
	})

	test('a read that received events does not report no-relays', async () => {
		// The relay delivered, then went quiet: no EOSE, no further answer, and the
		// read's deadline is what ends it. Recording it `timeout` made the health say
		// "no relay answered" for a read that plainly received events.
		const read = readFrom({ 'wss://slow': { events: [createEvent({ id: 'root-1' })], hang: true } }, 40)

		// A hanging relay never ends its own stream, so the read ends at its
		// deadline and emits the caught-up marker there — the last item a page
		// surface's collector sees before it closes the read
		// (`collectArenaSurfacesRead`).
		const items: ArenaReadStreamItem[] = []
		for await (const item of read.events()) {
			items.push(item)
			if (item.type === 'caught-up') read.close()
		}

		const caughtUp = items.find((i) => i.type === 'caught-up')
		if (caughtUp?.type !== 'caught-up') throw new Error('no caught-up marker')
		expect(items.filter((i) => i.type === 'events')).toHaveLength(1)
		expect(caughtUp.health.relays[0].status).toBe('ok')
		expect(caughtUp.health.answered).toEqual(['wss://slow'])
		expect(caughtUp.health.pending).toEqual([])
		expect(caughtUp.health.noRelaysReachable).toBe(false)
	})
})

// =========================================================================
// The live stream
// =========================================================================

describe('the live stream', () => {
	test('delivers events, then one caught-up marker, then ends', async () => {
		// The fake's stream ends after its EOSE, so `allDone` ends this read. A real
		// transport keeps the stream open (it delivered after its never-EOSE
		// fallback, measured 2026-11-19), so the deadline is the normal bound there.
		const read = readFrom({ 'wss://a': { events: [createEvent({ id: 'root-1' })] } })
		const items = await collect(read.events())

		const events = items.filter((i) => i.type === 'events')
		const caughtUp = items.filter((i) => i.type === 'caught-up')
		expect(events.length).toBeGreaterThan(0)
		expect(caughtUp).toHaveLength(1)
		expect(items.filter((i) => i.type === 'caught-up')).toHaveLength(1)
	})

	test('an event arriving after a relay’s EOSE, before the deadline, is still applied', async () => {
		// The ruling: EOSE is a boundary for the relay's own backlog, not for the
		// read. The connection stays open for the whole deadline, so a bid that
		// arrives *after* the relay said "caught up" is still delivered and still
		// lands in the model. The early settle gate this replaced ended the read at
		// EOSE, and that late bid was lost.
		const create = createEvent({ id: 'root-1' })
		const lateBid = bidEvent({ auctionId: 'lot-1', amount: 500, e: 'root-1', id: 'late-bid' })
		// Nothing in this test waits on a clock: the relay holds the bid back until
		// the read has taken the create, and the relay is left connected until the
		// read aborts it at its deadline. Both orderings are gates, not durations.
		const hasCreate = Promise.withResolvers<void>()
		const read = createArenaAuctionRead({
			relays: ['wss://slow-tail'],
			deadlineMs: 300,
			openRelay: (url) => (_filters: readonly EventFilter[], options: ArenaRelayOpenOptions) => ({
				async *[Symbol.asyncIterator](): AsyncIterator<EventStreamItem<NostrEventLike>> {
					yield { type: 'event', event: create }
					yield { type: 'caught-up', info: { eose: [url], pending: [], complete: false } }
					// The relay answered the REQ, then took its time over the bid …
					await hasCreate.promise
					yield { type: 'event', event: lateBid }
					// … and stayed connected, which is what a live relay does: the read
					// aborts it, and only at its deadline.
					const stayOpen = Promise.withResolvers<void>()
					options.signal?.addEventListener('abort', () => stayOpen.resolve(), { once: true })
					await stayOpen.promise
				},
			}),
		})

		const started = Date.now()
		const items: ArenaReadStreamItem[] = []
		for await (const item of read.events()) {
			items.push(item)
			// Release the bid only once the read holds the create: the EOSE is already
			// behind the pump by then, so the bid provably arrives after it.
			if (item.type === 'events') hasCreate.resolve()
		}
		const elapsed = Date.now() - started

		const delivered = items.filter((i) => i.type === 'events').flatMap((i) => i.events)
		expect(delivered.map((event) => event.id)).toEqual(['root-1', 'late-bid'])
		// Applied to the model, not merely seen on the wire: the late bid is in the
		// auction the projection produces from everything the read delivered.
		expect(projectArenaEvents(delivered).auctions[0].bids.map((bid) => bid.eventId)).toEqual(['late-bid'])
		// And the read ran to its deadline: EOSE ended no part of it.
		expect(elapsed).toBeGreaterThanOrEqual(250)

		const caughtUp = items.at(-1)
		if (caughtUp?.type !== 'caught-up') throw new Error('no caught-up marker')
		expect(caughtUp.health.answered).toEqual(['wss://slow-tail'])
		expect(caughtUp.health.pending).toEqual([])
	})

	test('a relay that never stops delivering is cut at the drain’s cap', async () => {
		// The drain is bounded by construction: past the deadline the pump stops
		// taking what the relay keeps delivering at `ARENA_READ_DRAIN_CEILING_MS`, so
		// a relay that never stops talking cannot keep the read alive — the run is
		// bounded by the deadline plus the drain, not by the relay's chatter. The fake
		// yields on an event-loop turn (never a clock), which is what lets the deadline
		// and the cap fire between two events.
		const read = createArenaAuctionRead({
			relays: ['wss://flood'],
			deadlineMs: 20,
			openRelay: () => () => ({
				async *[Symbol.asyncIterator](): AsyncIterator<EventStreamItem<NostrEventLike>> {
					// A wrong-kind event: refused by the gate immediately, so the flood
					// costs the read a refusal, not a projection.
					for (;;) {
						yield { type: 'event', event: ev({ kind: 1, content: 'gm' }) }
						await new Promise<void>((resolve) => setImmediate(resolve))
					}
				},
			}),
		})

		const started = Date.now()
		const items = await collect(read.events())
		const elapsed = Date.now() - started
		expect(elapsed).toBeGreaterThanOrEqual(ARENA_READ_DRAIN_CEILING_MS)
		expect(elapsed).toBeLessThan(ARENA_READ_DRAIN_CEILING_MS + ARENA_READ_DRAIN_QUIET_MS + 500)
		expect(items.filter((i) => i.type === 'caught-up')).toHaveLength(1)
		// The drain really did keep reading past the deadline: this is the chatter it
		// consumed before the cap stopped it.
		const caughtUp = items.at(-1)
		if (caughtUp?.type !== 'caught-up') throw new Error('no caught-up marker')
		expect(caughtUp.health.relays[0]?.refusals ?? 0).toBeGreaterThan(1)
	})

	test('close() ends an open read that would otherwise wait forever', async () => {
		const read = readFrom({ 'wss://slow': { hang: true } }, 60_000)
		const iterator = read.events()[Symbol.asyncIterator]()
		const pending = iterator.next()
		read.close()
		const first = await pending
		expect(first.done).toBe(false)
		if (!first.done) {
			const value = first.value
			expect(value.type).toBe('caught-up')
			if (value.type === 'caught-up') expect(value.health.aborted).toBe(true)
		}
		await iterator.return?.(undefined)
	})

	test('an aborted callers signal resolves a snapshot with what it has', async () => {
		const controller = new AbortController()
		const read = readFrom({ 'wss://slow': { hang: true } }, 60_000)
		const pending = read.snapshot({ signal: controller.signal })
		controller.abort()
		const snapshot = await pending
		expect(snapshot.health.aborted).toBe(true)
		expect(snapshot.auctions).toEqual([])
	})
})

// =========================================================================
// The drain: the deadline ends the read's wait, not its consumption
// =========================================================================

/**
 * A relay that answers in the measured shape of the arena REQ: it hands over
 * `head`, says it is caught up, and only then — `releaseAtMs` after the read
 * started, a few ms past the read's own deadline — releases `tail`. What the
 * drain reads is therefore what the transport is still holding *past* the
 * deadline, which is exactly the truncation the live read was measuring at 8 s:
 * kind-1449's window is shared by three schemas the chain publishes in bursts,
 * so the create-admissions a list needs are the tail of that one REQ's answer.
 *
 * The release is a timer rather than a gate because the read's deadline is a
 * timer too: this one is armed after the read's own and due later, so the tail
 * is provably delivered after the deadline and provably inside the drain's
 * quiet window. These reads are *about* the platform clock — the deadline and
 * the quiet window are `setTimeout`s the read itself arms — so a real delay is
 * the measurement here, not a guess at one.
 */
function straddlingRelay(options: {
	head: NostrEventLike[]
	tail: NostrEventLike[]
	/** When to release the tail, counted from the read's start (ms). */
	releaseAtMs: number
	/** Emit the caught-up marker after the head — a relay that answered and kept delivering. */
	answered?: boolean
	/** Called once per REQ opened, so a test can count them. */
	calls?: (readonly EventFilter[])[]
}): ArenaRelayOpenFactory {
	return (url) => (filters) => {
		options.calls?.push(filters)
		const released = Promise.withResolvers<void>()
		setTimeout(released.resolve, options.releaseAtMs)
		return {
			async *[Symbol.asyncIterator](): AsyncIterator<EventStreamItem<NostrEventLike>> {
				for (const event of options.head) yield { type: 'event', event } as EventStreamItem<NostrEventLike>
				if (options.answered !== false) {
					yield {
						type: 'caught-up',
						info: { eose: [url], pending: [], complete: false },
					} as EventStreamItem<NostrEventLike>
				}
				await released.promise
				for (const event of options.tail) yield { type: 'event', event } as EventStreamItem<NostrEventLike>
			},
		}
	}
}

describe('the drain after the deadline', () => {
	test('an admission the transport is still holding when the deadline fires is applied', async () => {
		const deadlineMs = 60
		const create = createEvent({ id: 'drain-root', d: 'lot-drain' }, { auction_id: 'lot-drain' })
		const admit = makeCreateAdmitEvent(create)
		const read = createArenaAuctionRead({
			relays: ['wss://drain'],
			deadlineMs,
			openRelay: straddlingRelay({ head: [create], tail: [admit], releaseAtMs: deadlineMs + 5 }),
		})

		const started = Date.now()
		const items = await collect(read.events())
		const elapsed = Date.now() - started

		const delivered = items.filter((i) => i.type === 'events').flatMap((i) => i.events)
		// Applied to the model, not merely seen: the lot the chain accepted is followed.
		expect(followedAuctionViews(projectArenaEvents(delivered).auctions).map((view) => view.rootEventId)).toEqual(['drain-root'])
		// And the read still ended at its own deadline: the relay's EOSE settled
		// nothing, and the drain is one quiet window at most.
		expect(elapsed).toBeGreaterThanOrEqual(deadlineMs)
		expect(elapsed).toBeLessThan(deadlineMs + ARENA_READ_DRAIN_QUIET_MS)
	})

	test('a bounded read finishes its drain too, rather than ending at the deadline', async () => {
		const deadlineMs = 50
		const create = createEvent({ id: 'snap-root', d: 'lot-snap' }, { auction_id: 'lot-snap' })
		const admit = makeCreateAdmitEvent(create)
		const read = createArenaAuctionRead({
			relays: ['wss://snap'],
			deadlineMs,
			// No caught-up marker before the tail: a bounded read ends at one, and what
			// is under test here is what it does when the tail arrives instead.
			openRelay: straddlingRelay({
				head: [create],
				tail: [admit],
				releaseAtMs: deadlineMs + 5,
				answered: false,
			}),
		})

		const snapshot = await read.snapshot()
		expect(followedAuctionViews(snapshot.auctions).map((view) => view.rootEventId)).toEqual(['snap-root'])
	})

	test('a relay that goes quiet after the deadline ends the read at the quiet window, not the cap', async () => {
		// Nothing in hand is nothing to wait for: a relay that has said all it will
		// say does not cost the read the drain's whole cap.
		const deadlineMs = 40
		const read = readFrom({ 'wss://quiet': { events: [createEvent({ id: 'quiet-root' })], hang: true } }, deadlineMs)

		const started = Date.now()
		await collect(read.events())
		const elapsed = Date.now() - started

		expect(elapsed).toBeGreaterThanOrEqual(deadlineMs + ARENA_READ_DRAIN_QUIET_MS)
		expect(elapsed).toBeLessThan(deadlineMs + ARENA_READ_DRAIN_CEILING_MS)
	})

	test('a create read during the drain opens no new REQ', async () => {
		// The deadline is the read's contract, and the drain only finishes what the
		// read already asked for: a create whose follow-up filter would be a *new* REQ
		// arriving inside the drain opens none.
		const deadlineMs = 50
		const calls: (readonly EventFilter[])[] = []
		const create = createEvent({ id: 'late-root', d: 'late-lot' }, { auction_id: 'late-lot' })
		const read = createArenaAuctionRead({
			relays: ['wss://late'],
			deadlineMs,
			followUpFilters: arenaLotFollowUpFilters(SELLER_A, 'late-lot'),
			openRelay: straddlingRelay({
				head: [],
				tail: [create],
				releaseAtMs: deadlineMs + 5,
				calls,
			}),
		})

		const items = await collect(read.events())
		const delivered = items.filter((i) => i.type === 'events').flatMap((i) => i.events)
		expect(delivered.map((event) => event.id)).toEqual(['late-root'])
		expect(calls).toHaveLength(1)
	})
})

// =========================================================================
// The pure projection is usable on its own
// =========================================================================

describe('projectArenaEvents', () => {
	test('projects a hand-built event list without any read', () => {
		const create = decodeArenaEvent(createEvent({ id: 'root-1' }), 'wss://a')
		const bid = decodeArenaEvent(bidEvent({ e: 'root-1', amount: 500 }), 'wss://a')
		expect(create.ok && bid.ok).toBe(true)
		if (!create.ok || !bid.ok) return

		const snapshot = projectArenaEvents([create.event, bid.event])
		expect(snapshot.auctions).toHaveLength(1)
		expect(snapshot.auctions[0].topBid).toEqual({ bidder: 'bidder-1', total: 500 })
		// No health passed: an empty one, not a throw.
		expect(snapshot.health.relays).toEqual([])
	})
})

// =========================================================================
// The money receipts are wired into the read (kinds 1443 / 1444)
// =========================================================================

describe('money receipts', () => {
	test('a signed refund receipt decodes and attaches to its auction', async () => {
		const create = createEvent({ id: 'root-1' })
		const receipt = receiptEvent({ bidId: 'bid-1', height: 400 })
		const read = readFrom({ 'wss://a': { events: [create, receipt] } })
		const snapshot = await read.snapshot()

		expect(snapshot.auctions).toHaveLength(1)
		const view = snapshot.auctions[0]
		expect(view.receipts).toHaveLength(1)
		expect(view.receipts[0].outcome).toBe('refund')
		expect(view.receipts[0].bidId).toBe('bid-1')
		expect(view.refundForBid['bid-1']?.height).toBe(400)
		expect(view.settleReceipt).toBeNull()
		// The receipt's relay is part of the auction's provenance.
		expect(view.relays).toContain('wss://a')
	})

	test('a settle receipt is the lot-level settle and the per-bid settle lookup', async () => {
		const create = createEvent({ id: 'root-1' })
		const settle = receiptEvent({ kind: ARENA_AUCTION_SETTLE_KIND, bidId: 'bid-9', height: 500 })
		const snapshot = await readFrom({ 'wss://a': { events: [create, settle] } }).snapshot()

		const view = snapshot.auctions[0]
		expect(view.settleReceipt?.bidId).toBe('bid-9')
		expect(view.settleReceipt?.outcome).toBe('settle')
		expect(view.settleForBid['bid-9']?.height).toBe(500)
	})

	test('the same move re-published at a later height is one receipt, the earliest', async () => {
		const create = createEvent({ id: 'root-1' })
		const early = receiptEvent({ height: 400 })
		const late = receiptEvent({ height: 407, created_at: 1_795_000_100 })
		const snapshot = await readFrom({ 'wss://a': { events: [create, late, early] } }).snapshot()

		expect(snapshot.auctions[0].receipts).toHaveLength(1)
		expect(snapshot.auctions[0].receipts[0].height).toBe(400)
	})

	test('a bad receipt is refused by name and counted in relay health, like every other kind', async () => {
		const create = createEvent({ id: 'root-1' })
		const unsigned = { ...receiptEvent(), sig: '' }
		const snapshot = await readFrom({ 'wss://a': { events: [create, unsigned] } }).snapshot()

		expect(snapshot.auctions[0].receipts).toEqual([])
		expect(snapshot.refusals.map((refusal) => refusal.reason)).toContain('arena.receipt.bad_signature')
		expect(snapshot.health.relays[0].refusals).toBe(1)
	})

	test('a receipt whose auction no create matches is an orphan, not attached', async () => {
		const create = createEvent({ id: 'root-1' })
		// A bare `d` that resolves to no auction is an orphan (a full coordinate
		// that matches no create simply never attaches, as with a verdict).
		const orphan = receiptEvent({ auctionId: 'ghost-lot' })
		const snapshot = await readFrom({ 'wss://a': { events: [create, orphan] } }).snapshot()

		expect(snapshot.orphanReceipts).toHaveLength(1)
		expect(snapshot.auctions[0].receipts).toEqual([])
	})

	test('decodeArenaEvent surfaces the receipt-specific refusal name', () => {
		const unsigned = { ...receiptEvent(), sig: '' }
		const decoded = decodeArenaEvent(unsigned, 'wss://a')
		expect(decoded.ok).toBe(false)
		if (!decoded.ok) expect(decoded.refusal.reason).toBe('arena.receipt.bad_signature')

		const badSchema = receiptEvent({ kind: ARENA_AUCTION_REFUND_KIND, outcome: 'settle' })
		const decodedBad = decodeArenaEvent(badSchema, 'wss://a')
		expect(decodedBad.ok).toBe(false)
		if (!decodedBad.ok) expect(decodedBad.refusal.reason).toBe('arena.receipt.bad_content')
	})
})

// =========================================================================
// The state half is wired into the read (kinds 1449 / 1450)
// =========================================================================

describe('the state half — the committed end (1449) and refusals (1450)', () => {
	test('a committed end attaches to its auction and the lot view can read it', async () => {
		const create = createEvent({ id: 'root-1' })
		// The 1449's auction_id is the full coordinate the read produces.
		const lotState = lotStateEvent({ auctionId: '1440:seller-alice:lot-1', endTime: 1_000_500, height: 690, extensions: 1 })
		const snapshot = await readFrom({ 'wss://a': { events: [create, lotState] } }).snapshot()

		expect(snapshot.auctions).toHaveLength(1)
		const view = snapshot.auctions[0]
		expect(view.committedEnd?.endTime).toBe(1_000_500)
		expect(view.committedEnd?.height).toBe(690)
		expect(view.committedEnd?.extensionOrdinal).toBe(1)
		expect(view.committedEnds).toHaveLength(1)
		// The committed end is NOT the create-derived end.
		expect(view.rootCreatedAt + (view.content.durationSec ?? 0)).not.toBe(1_000_500)
		expect(view.relays).toContain('wss://a')
	})

	test('the committed end at the highest anchored height wins, deduped by (auction_id, end_time)', async () => {
		const create = createEvent({ id: 'root-1' })
		const first = lotStateEvent({
			auctionId: '1440:seller-alice:lot-1',
			endTime: 1_000_000,
			originalEndTime: 1_000_000,
			extensions: 0,
			height: 690,
		})
		const second = lotStateEvent({
			auctionId: '1440:seller-alice:lot-1',
			endTime: 1_000_012,
			originalEndTime: 1_000_000,
			extensions: 1,
			height: 720,
		})
		// A validator re-publishes the second end at a later height: one fact.
		const secondRepublished = lotStateEvent({
			auctionId: '1440:seller-alice:lot-1',
			endTime: 1_000_012,
			originalEndTime: 1_000_000,
			extensions: 1,
			height: 724,
			created_at: 1_795_021_600,
		})
		const snapshot = await readFrom({ 'wss://a': { events: [create, first, second, secondRepublished] } }).snapshot()

		const view = snapshot.auctions[0]
		expect(view.committedEnds).toHaveLength(2)
		expect(view.committedEnd?.endTime).toBe(1_000_012)
		expect(view.committedEnd?.height).toBe(720)
		expect(view.committedEnd?.extensionOrdinal).toBe(1)
	})

	test('no 1449 for the lot leaves committedEnd null, never the create-derived end', async () => {
		const create = createEvent({ id: 'root-1' })
		const snapshot = await readFrom({ 'wss://a': { events: [create] } }).snapshot()
		expect(snapshot.auctions[0].committedEnd).toBeNull()
		expect(snapshot.auctions[0].committedEnds).toEqual([])
	})

	test('a 1450 naming the create lands as the createRefusal and at the snapshot', async () => {
		const create = createEvent({ id: 'root-1' })
		const refusal = refusedEvent({ refusedEventId: 'root-1', reason: 'startPrice out of range (1..10000000)' })
		const snapshot = await readFrom({ 'wss://a': { events: [create, refusal] } }).snapshot()

		expect(snapshot.auctions[0].createRefusal?.reason).toBe('startPrice out of range (1..10000000)')
		expect(snapshot.refusedCreates).toHaveLength(1)
		expect(snapshot.refusedCreates[0].createEventId).toBe('root-1')
		expect(snapshot.refusedCreates[0].reason).toBe('startPrice out of range (1..10000000)')
	})

	test('a 1450 naming a BID lands as that bid’s refusal, with the chain’s words', async () => {
		// The chain records a bid it refused at delivery (the late family, the
		// block-time locktime floor, a duplicate) as a 1450 naming the kind-1441.
		// A bid refused at admission leaves no record — so this list is a fact
		// about what the chain said, never an inference about what it did not.
		const create = createEvent({ id: 'root-1' })
		const bid = bidEvent({ a: `1440:${SELLER_A}:lot-1`, amount: 100, created_at: 1100, id: 'bid-1' })
		const refusal = refusedEvent({
			refusedEventId: 'bid-1',
			refusedKind: 1441,
			reason: 'locktime below the floor for this lot: 1794924019 is under 1794924021',
		})
		const snapshot = await readFrom({ 'wss://a': { events: [create, bid, refusal] } }).snapshot()

		const view = snapshot.auctions[0]
		expect(view.bidRefusals).toHaveLength(1)
		expect(view.bidRefusals[0].createEventId).toBe('bid-1')
		expect(view.bidRefusals[0].reason).toBe('locktime below the floor for this lot: 1794924019 is under 1794924021')
		// A bid refusal is not the lot's create refusal.
		expect(view.createRefusal).toBeNull()
	})

	test('a create refusal is not attributed to a bid, and a bid refusal needs the bid', async () => {
		const create = createEvent({ id: 'root-1' })
		const bid = bidEvent({ a: `1440:${SELLER_A}:lot-1`, amount: 100, created_at: 1100, id: 'bid-1' })
		// A 1440 refusal, and a 1441 refusal for a bid this lot does not hold.
		const createRefusal = refusedEvent({ refusedEventId: 'root-1', refusedKind: 1440 })
		const otherBidRefusal = refusedEvent({ refusedEventId: 'bid-elsewhere', refusedKind: 1441 })
		const snapshot = await readFrom({ 'wss://a': { events: [create, bid, createRefusal, otherBidRefusal] } }).snapshot()

		const view = snapshot.auctions[0]
		expect(view.bidRefusals).toEqual([])
		expect(view.createRefusal?.reason).toBe('title required (max 120 chars)')
	})

	test('the refusal dedupes by (event_id, reason) at the earliest anchored height', async () => {
		const create = createEvent({ id: 'root-1' })
		const early = refusedEvent({ refusedEventId: 'root-1', height: 1745 })
		const late = refusedEvent({ refusedEventId: 'root-1', height: 1749, created_at: 1_795_021_950 })
		const snapshot = await readFrom({ 'wss://a': { events: [create, late, early] } }).snapshot()

		expect(snapshot.refusedCreates).toHaveLength(1)
		expect(snapshot.refusedCreates[0].height).toBe(1745)
	})

	test('a bad 1449 is refused by its own name and counted in relay health', async () => {
		const create = createEvent({ id: 'root-1' })
		const unsignedLotState = { ...lotStateEvent(), sig: '' }
		const snapshot = await readFrom({ 'wss://a': { events: [create, unsignedLotState] } }).snapshot()

		expect(snapshot.auctions[0].committedEnd).toBeNull()
		expect(snapshot.refusals.map((refusal) => refusal.reason)).toContain('arena.lot_state.bad_signature')
		expect(snapshot.health.relays[0].refusals).toBe(1)
	})

	test('a bad 1450 is refused by its own name', () => {
		const unsigned = { ...refusedEvent(), sig: '' }
		const decoded = decodeArenaEvent(unsigned, 'wss://a')
		expect(decoded.ok).toBe(false)
		if (!decoded.ok) expect(decoded.refusal.reason).toBe('arena.lot_state.bad_signature')
	})

	test('decodeArenaEvent decodes a 1449 and a 1450 to their own event types', () => {
		const decodedLot = decodeArenaEvent(lotStateEvent({ auctionId: '1440:seller-alice:lot-1' }), 'wss://a')
		expect(decodedLot.ok).toBe(true)
		if (decodedLot.ok) expect(decodedLot.event.type).toBe('lot-state')

		const decodedRefusal = decodeArenaEvent(refusedEvent(), 'wss://a')
		expect(decodedRefusal.ok).toBe(true)
		if (decodedRefusal.ok) expect(decodedRefusal.event.type).toBe('refused-fact')
	})

	test('a 1449 whose bare d matches no create is an orphan, not attached', async () => {
		const create = createEvent({ id: 'root-1' })
		const orphan = lotStateEvent({ auctionId: 'ghost-lot' })
		const snapshot = await readFrom({ 'wss://a': { events: [create, orphan] } }).snapshot()
		expect(snapshot.orphanLotStates).toHaveLength(1)
		expect(snapshot.auctions[0].committedEnd).toBeNull()
	})

	test('decodeArenaEvent dispatches kind 1449 on the schema: admission vs committed end', () => {
		const decodedAdmit = decodeArenaEvent(bidAdmitEvent({ auctionId: '1440:seller-alice:lot-1' }), 'wss://a')
		expect(decodedAdmit.ok).toBe(true)
		if (decodedAdmit.ok) expect(decodedAdmit.event.type).toBe('bid-admit')

		// The lot schema stays a committed end — the same kind, the other fact.
		const decodedLot = decodeArenaEvent(lotStateEvent({ auctionId: '1440:seller-alice:lot-1' }), 'wss://a')
		expect(decodedLot.ok).toBe(true)
		if (decodedLot.ok) expect(decodedLot.event.type).toBe('lot-state')
	})

	test('a tampered admission is refused by its own name, never read as a committed end', () => {
		const unsigned = { ...bidAdmitEvent(), sig: '' }
		const decoded = decodeArenaEvent(unsigned, 'wss://a')
		expect(decoded.ok).toBe(false)
		if (!decoded.ok) expect(decoded.refusal.reason).toBe('arena.bid_admit.bad_signature')
	})

	test('the admission attaches to its lot, keyed by bid id, and carries the chain’s position', async () => {
		const create = createEvent({ id: 'root-1' })
		const bid = bidEvent({ a: `1440:${SELLER_A}:lot-1`, amount: 100, created_at: 1100, id: 'bid-1' })
		const admission = bidAdmitEvent({
			auctionId: '1440:seller-alice:lot-1',
			bidId: 'bid-1',
			amount: 100,
			position: 105,
			height: 3437,
		})
		const snapshot = await readFrom({ 'wss://a': { events: [create, bid, admission] } }).snapshot()

		const view = snapshot.auctions[0]
		expect(view.admissions).toHaveLength(1)
		expect(view.admissions[0].bidId).toBe('bid-1')
		expect(view.admissions[0].position).toBe(105)
		expect(view.admissions[0].highBid).toBe('50b13a5c47715c3f42ebc3fad3c4a9b5f78e5f48e4bd5f43f3c168d5216abe59')
		expect(view.admissions[0].height).toBe(3437)
		expect(view.admissionForBid['bid-1'].position).toBe(105)
		// An admission is not a committed end: the two schemas never mix.
		expect(view.committedEnd).toBeNull()
	})

	test('the admission dedupes per bid id at the earliest anchored height', async () => {
		const create = createEvent({ id: 'root-1' })
		const early = bidAdmitEvent({ auctionId: '1440:seller-alice:lot-1', bidId: 'bid-1', height: 3437 })
		const late = bidAdmitEvent({ auctionId: '1440:seller-alice:lot-1', bidId: 'bid-1', height: 3490, created_at: 1_795_021_900 })
		const snapshot = await readFrom({ 'wss://a': { events: [create, late, early] } }).snapshot()

		const view = snapshot.auctions[0]
		expect(view.admissions).toHaveLength(1)
		expect(view.admissions[0].height).toBe(3437)
	})

	test('an admission whose coordinate matches no create is an orphan admission, not attached', async () => {
		const create = createEvent({ id: 'root-1' })
		const orphan = bidAdmitEvent({ auctionId: 'ghost-lot' })
		const snapshot = await readFrom({ 'wss://a': { events: [create, orphan] } }).snapshot()
		expect(snapshot.orphanAdmissions).toHaveLength(1)
		expect(snapshot.auctions[0].admissions).toEqual([])
	})
})

// =========================================================================
// A lot's bids: #a and #e
// =========================================================================

/**
 * A relay shaped like the measured one: the `#a` coordinate (106 chars for a
 * UUID `d`) is not in its index, so a base query answers only the create. The
 * bid, and the chain's kind-1450 refusal of the create, are answerable only
 * through the `#e` filter (the create's own id) — each by its own kind, the way
 * the relay's index actually answers.
 */
function lotRelay(options: {
	create: NostrEventLike | null
	bid: NostrEventLike | null
	/** Kind-1450 refusals the relay holds; each is answered only to a `#e` REQ for kind 1450. */
	refusals?: NostrEventLike[]
}): {
	open: ArenaRelayOpenFactory
	calls: (readonly EventFilter[])[]
} {
	const calls: (readonly EventFilter[])[] = []
	const open: ArenaRelayOpenFactory =
		(url: string): ArenaRelayOpen =>
		(filters: readonly EventFilter[]) => ({
			async *[Symbol.asyncIterator](): AsyncIterator<EventStreamItem<NostrEventLike>> {
				calls.push(filters)
				const id = options.create?.id ?? ''
				const events: NostrEventLike[] = []
				if (options.create !== null && filters.some((filter) => (filter['#d'] ?? []).length > 0)) events.push(options.create)
				if (
					options.bid !== null &&
					filters.some((filter) => (filter.kinds ?? []).includes(1441) && (filter['#e'] ?? []).includes(id))
				) {
					events.push(options.bid)
				}
				if (filters.some((filter) => (filter.kinds ?? []).includes(1450) && (filter['#e'] ?? []).includes(id))) {
					events.push(...(options.refusals ?? []))
				}
				for (const event of events) yield { type: 'event', event } as EventStreamItem<NostrEventLike>
				yield { type: 'caught-up', info: { eose: [url], pending: [], complete: false } } as EventStreamItem<NostrEventLike>
			},
		})
	return { open, calls }
}

describe('a lot read whose bids are only findable by #e', () => {
	const ROOT = 'root-1'
	const COORD = '1440:seller-alice:lot-1'
	const create = createEvent({ id: ROOT })
	const bid = bidEvent({ auctionId: 'lot-1', amount: 500, a: COORD, e: ROOT })

	test('keeps #a and adds the #e variant when the create event id is known', () => {
		const filters = arenaLotFilters(SELLER_A, 'lot-1', ROOT)
		expect(filters).toContainEqual({ kinds: [1441], '#a': [COORD] })
		expect(filters).toContainEqual({ kinds: [1441], '#e': [ROOT] })
	})

	test('a lot with no event id keeps #a and states no #e filter at all', () => {
		const filters = arenaLotFilters(SELLER_A, 'lot-1')
		expect(filters).toContainEqual({ kinds: [1441], '#a': [COORD] })
		expect(filters.some((filter) => filter['#e'] !== undefined)).toBe(false)
		// `null` and the empty string are both "no id", never an empty `'#e': []`.
		expect(arenaLotBidFilters(SELLER_A, 'lot-1', null)).toEqual([{ kinds: [1441], '#a': [COORD] }])
		expect(arenaLotBidFilters(SELLER_A, 'lot-1', '')).toEqual([{ kinds: [1441], '#a': [COORD] }])
	})

	test('a bare d has no coordinate, so #e is the only bid filter once the create is known', () => {
		expect(arenaLotFilters(null, 'lot-1', ROOT)).toEqual([
			{ kinds: [1440], '#d': ['lot-1'] },
			{ kinds: [1441], '#e': [ROOT] },
		])
		expect(arenaLotFilters(null, 'lot-1')).toEqual([{ kinds: [1440], '#d': ['lot-1'] }])
	})

	test('the read opens a second REQ with #e and delivers the bid before caught-up', async () => {
		const relay = lotRelay({ create, bid })
		const read = createArenaAuctionRead({
			relays: ['wss://limited'],
			deadlineMs: 1000,
			filters: arenaLotFilters(SELLER_A, 'lot-1'),
			followUpFilters: arenaLotFollowUpFilters(SELLER_A, 'lot-1'),
			openRelay: relay.open,
		})
		const items = await collect(read.events())

		// Two REQs: the base one keeps #a; the follow-up is the create's own `#e`
		// address — its bids, and the chain's refusal of that create.
		expect(relay.calls).toHaveLength(2)
		expect(relay.calls[0]).toContainEqual({ kinds: [1441], '#a': [COORD] })
		expect(relay.calls[1]).toEqual([
			{ kinds: [1441], '#e': [ROOT] },
			{ kinds: [1450], '#e': [ROOT] },
		])

		const events = items.filter((item) => item.type === 'events').flatMap((item) => item.events)
		expect(events.map((event) => event.id)).toEqual([ROOT, bid.id])

		// The caught-up marker — where a page's collector stops reading — comes
		// after the follow-up's bid, so a bounded read sees it too.
		const types = items.map((item) => item.type)
		expect(types.lastIndexOf('events')).toBeLessThan(types.indexOf('caught-up'))
	})

	test('a lot whose create never arrives opens no second subscription', async () => {
		const relay = lotRelay({ create: null, bid })
		const read = createArenaAuctionRead({
			relays: ['wss://limited'],
			deadlineMs: 1000,
			filters: arenaLotFilters(SELLER_A, 'lot-1'),
			followUpFilters: arenaLotFollowUpFilters(SELLER_A, 'lot-1'),
			openRelay: relay.open,
		})
		await read.snapshot()
		expect(relay.calls).toHaveLength(1)
	})
})

// =========================================================================
// A lot's refusal: a 1450 has no coordinate, so the follow-up asks by #e
// =========================================================================

/**
 * A kind-1450 refusal that names this create is the **only** fact that refuses a
 * lot (`arenaAuctionRead.ts` `ArenaAuctionView.createRefusal`). It carries the
 * refused event's id in its `e` tag and no `auction` tag at all, so it cannot be
 * addressed by the coordinate or the `d` the base REQ filters on: the create's
 * own event id — knowable only after the create has been read — is its one
 * address, and the follow-up REQ is where it is asked for.
 */
describe('a lot’s create refusal is readable only by the create’s own id', () => {
	const ROOT = 'refused-root-1'
	const COORD = `1440:${SELLER_A}:lot-1`
	const create = createEvent({ id: ROOT })
	const bid = bidEvent({ auctionId: 'lot-1', amount: 500, a: COORD, e: ROOT, id: 'refused-bid' })
	const decoded = (event: NostrEventLike): ArenaAuctionEvent => {
		const result = decodeArenaEvent(event, 'wss://limited')
		if (!result.ok) throw new Error(`fixture refused: ${result.refusal.reason}`)
		return result.event
	}

	test('the base REQ cannot carry a 1450: a refusal names no coordinate and no `d`', () => {
		for (const filter of arenaLotFilters(SELLER_A, 'lot-1')) expect(filter.kinds ?? []).not.toContain(1450)
		// …while the create it must be read after is right there in that REQ.
		expect(arenaLotFilters(SELLER_A, 'lot-1')).toContainEqual({ kinds: [1440], '#d': ['lot-1'] })
	})

	test('the follow-up asks for the refusal by the create’s own id, beside the bids', () => {
		expect(arenaLotCreateEventFilters([ROOT, 'root-2'])).toEqual([
			{ kinds: [1441], '#e': [ROOT, 'root-2'] },
			{ kinds: [1450], '#e': [ROOT, 'root-2'] },
		])
		// No id is no filter: never an empty `'#e': []`.
		expect(arenaLotCreateEventFilters([])).toEqual([])
		expect(arenaLotCreateEventFilters([''])).toEqual([])
		expect(arenaLotFollowUpFilters(SELLER_A, 'lot-1')([decoded(create)])).toEqual([
			{ kinds: [1441], '#e': [ROOT] },
			{ kinds: [1450], '#e': [ROOT] },
		])
	})

	test('the refusal arrives in the lot’s own read, before caught-up', async () => {
		const refusal = refusedEvent({ refusedEventId: ROOT, reason: 'startPrice out of range (1..10000000)' })
		const relay = lotRelay({ create, bid, refusals: [refusal] })
		const read = createArenaAuctionRead({
			relays: ['wss://limited'],
			deadlineMs: 1000,
			filters: arenaLotFilters(SELLER_A, 'lot-1'),
			followUpFilters: arenaLotFollowUpFilters(SELLER_A, 'lot-1'),
			openRelay: relay.open,
		})
		const items = await collect(read.events())

		// The refusal rides in the same second REQ as the bids, addressed by the id.
		expect(relay.calls[1]).toEqual([
			{ kinds: [1441], '#e': [ROOT] },
			{ kinds: [1450], '#e': [ROOT] },
		])
		const events = items.filter((item) => item.type === 'events').flatMap((item) => item.events)
		expect(events.map((event) => event.id)).toEqual([ROOT, bid.id, refusal.id])

		// A page's collector stops at caught-up, so the refusal precedes it.
		const types = items.map((item) => item.type)
		expect(types.lastIndexOf('events')).toBeLessThan(types.indexOf('caught-up'))
	})

	test('the lot carries it as createRefusal, in the chain’s words, and the snapshot as a refused create', async () => {
		const refusal = refusedEvent({ refusedEventId: ROOT, reason: 'startPrice out of range (1..10000000)' })
		const read = createArenaAuctionRead({
			relays: ['wss://limited'],
			deadlineMs: 1000,
			filters: arenaLotFilters(SELLER_A, 'lot-1'),
			followUpFilters: arenaLotFollowUpFilters(SELLER_A, 'lot-1'),
			openRelay: lotRelay({ create, bid, refusals: [refusal] }).open,
		})
		const snapshot = await read.snapshot()

		const view = snapshot.auctions[0]
		expect(view.createRefusal?.createEventId).toBe(ROOT)
		expect(view.createRefusal?.reason).toBe('startPrice out of range (1..10000000)')
		expect(view.createRefusal?.height).toBe(1749)
		expect(snapshot.refusedCreates).toHaveLength(1)
	})

	test('a refusal naming a different create never refuses this lot', async () => {
		// A relay that answers the create's `#e` REQ with a refusal it holds for some
		// other event: the fact is read, and it is not this create's — the key is the
		// refused event id, never "the newest 1450 that arrived".
		const elsewhere = refusedEvent({ refusedEventId: 'another-create', reason: 'title required (max 120 chars)' })
		const read = createArenaAuctionRead({
			relays: ['wss://sloppy'],
			deadlineMs: 200,
			filters: arenaLotFilters(SELLER_A, 'lot-1'),
			followUpFilters: arenaLotFollowUpFilters(SELLER_A, 'lot-1'),
			openRelay:
				(url: string): ArenaRelayOpen =>
				(filters: readonly EventFilter[]) => ({
					async *[Symbol.asyncIterator](): AsyncIterator<EventStreamItem<NostrEventLike>> {
						const byD = filters.some((filter) => (filter['#d'] ?? []).length > 0)
						for (const event of byD ? [create] : [elsewhere]) yield { type: 'event', event } as EventStreamItem<NostrEventLike>
						yield { type: 'caught-up', info: { eose: [url], pending: [], complete: false } } as EventStreamItem<NostrEventLike>
					},
				}),
		})
		const snapshot = await read.snapshot()

		expect(snapshot.auctions[0].createRefusal).toBeNull()
		expect(snapshot.refusedCreates.map((fact) => fact.createEventId)).toEqual(['another-create'])
	})

	test('a refusal that fails the gate is refused by name, never surfaced', async () => {
		// Fail closed, the same discipline as every other kind: the parser verifies
		// the signature first, so an unsigned refusal is not a refusal.
		const tampered = { ...refusedEvent({ refusedEventId: ROOT }), sig: '' }
		const read = createArenaAuctionRead({
			relays: ['wss://limited'],
			deadlineMs: 1000,
			filters: arenaLotFilters(SELLER_A, 'lot-1'),
			followUpFilters: arenaLotFollowUpFilters(SELLER_A, 'lot-1'),
			openRelay: lotRelay({ create, bid, refusals: [tampered] }).open,
		})
		const snapshot = await read.snapshot()

		expect(snapshot.auctions[0].createRefusal).toBeNull()
		expect(snapshot.refusals.map((refusal) => refusal.reason)).toContain('arena.lot_state.bad_signature')
	})

	test('with no refusal read the lot has no createRefusal — no reason is invented', async () => {
		const read = createArenaAuctionRead({
			relays: ['wss://limited'],
			deadlineMs: 1000,
			filters: arenaLotFilters(SELLER_A, 'lot-1'),
			followUpFilters: arenaLotFollowUpFilters(SELLER_A, 'lot-1'),
			openRelay: lotRelay({ create, bid, refusals: [] }).open,
		})
		const snapshot = await read.snapshot()

		expect(snapshot.auctions[0].createRefusal).toBeNull()
		expect(snapshot.refusedCreates).toEqual([])
	})
})

// =========================================================================
// A discovery read: the acceptances its gate needs are asked for, not windowed
// =========================================================================

/**
 * A relay shaped like the measured one for the **whole arena**: kind 1449 is
 * answered from a `limit`-bounded window, so the slice carries no
 * create-admission at all, while the admission itself is answerable through the
 * `#e` filter on the create's own id.
 *
 * Measured on the live relay 2026-11-20: the newest 200 kind-1449 events held
 * 200 create-admissions just after the 09:47:41 burst, and 172 committed ends +
 * 28 bid admissions in the window before it. In that window every lot's
 * `createAdmit` was `null`, and the list rendered empty with all seven relays
 * healthy while the lot page still resolved its lot.
 */
function windowedArenaRelay(
	windowEvents: NostrEventLike[],
	admits: NostrEventLike[],
): { open: ArenaRelayOpenFactory; calls: (readonly EventFilter[])[] } {
	const calls: (readonly EventFilter[])[] = []
	const open: ArenaRelayOpenFactory =
		(url: string): ArenaRelayOpen =>
		(filters: readonly EventFilter[]) => ({
			async *[Symbol.asyncIterator](): AsyncIterator<EventStreamItem<NostrEventLike>> {
				calls.push(filters)
				const requested = new Set(filters.flatMap((filter) => filter['#e'] ?? []))
				const events =
					requested.size === 0
						? windowEvents
						: admits.filter((admit) => requested.has(admit.tags.find((tag) => tag[0] === 'e')?.[1] ?? ''))
				for (const event of events) yield { type: 'event', event } as EventStreamItem<NostrEventLike>
				yield { type: 'caught-up', info: { eose: [url], pending: [], complete: false } } as EventStreamItem<NostrEventLike>
			},
		})
	return { open, calls }
}

describe('the acceptances a read is missing: kind 1449 is a window, not a set', () => {
	const create = createEvent({ id: 'root-1' })
	const admit = makeCreateAdmitEvent(create)
	const decoded = (event: NostrEventLike): ArenaAuctionEvent => {
		const result = decodeArenaEvent(event, 'wss://relay.one')
		if (!result.ok) throw new Error(`refused: ${result.refusal.reason}`)
		return result.event
	}

	test('the ids are the creates read that no admission names, deduped and in read order', () => {
		expect(unadmittedCreateIds([])).toEqual([])
		// Bids and admissions are not creates: they ask for nothing.
		expect(unadmittedCreateIds([decoded(bidEvent({ auctionId: 'lot-1' }))])).toEqual([])

		const other = createEvent({ id: 'root-2', d: 'lot-2' }, { auction_id: 'lot-2' })
		// A repeated create is one id; the admitted one is not asked for.
		expect(unadmittedCreateIds([decoded(create), decoded(other), decoded(create), decoded(admit)])).toEqual(['root-2'])
		// An admission for the other create covers it, and the answer is empty.
		expect(
			unadmittedCreateIds([decoded(create), decoded(other), decoded(admit), decoded(makeCreateAdmitEvent(other))]),
		).toEqual([])
	})

	test('the filter asks for the admissions by the create’s own id', () => {
		expect(arenaCreateAdmitFilter(['root-1', 'root-2'])).toEqual({ kinds: [ARENA_LOT_STATE_KIND], '#e': ['root-1', 'root-2'] })
	})

	test('asking for the missing acceptances opens one #e REQ and decodes what it answers', async () => {
		const relay = windowedArenaRelay([create], [admit])
		const read = createArenaAuctionRead({ relays: ['wss://windowed'], deadlineMs: 1000, openRelay: relay.open })

		const { events, refusals } = await read.missingCreateAdmissions([decoded(create)])
		expect(events.map((event) => event.id)).toEqual([admit.id])
		expect(refusals).toEqual([])
		expect(relay.calls).toHaveLength(1)
		expect(relay.calls[0]).toEqual([{ kinds: [ARENA_LOT_STATE_KIND], '#e': [create.id] }])
	})

	test('a read that already has every acceptance asks for nothing at all', async () => {
		const relay = windowedArenaRelay([create], [admit])
		const read = createArenaAuctionRead({ relays: ['wss://windowed'], deadlineMs: 1000, openRelay: relay.open })

		const { events, refusals } = await read.missingCreateAdmissions([decoded(create), decoded(admit)])
		expect(events).toEqual([])
		expect(refusals).toEqual([])
		// The one property that keeps this affordable: a complete read opens no REQ.
		expect(relay.calls).toHaveLength(0)
	})

	test('the read alone still follows nothing from that window — the window is not a set', async () => {
		const relay = windowedArenaRelay([create], [admit])
		const read = createArenaAuctionRead({ relays: ['wss://windowed'], deadlineMs: 1000, openRelay: relay.open })

		const snapshot = await read.snapshot()
		expect(snapshot.auctions).toHaveLength(1)
		expect(snapshot.auctions[0]?.createAdmit).toBeNull()
		expect(followedAuctionViews(snapshot.auctions)).toEqual([])
		// The relay still answered, and with the create: an empty followed list is
		// a statement about the window, not about the arena.
		expect(snapshot.health.empty).toBe(false)
	})
})

// =========================================================================
// A seller-less lot URL: the coordinate is the create's, found on read
// =========================================================================

/**
 * A relay answering by filter semantics, not by call order: a `#d` query is
 * answered with the create, an `#e` query with the bids, and an `#auction`
 * coordinate query with the receipts, verdicts and committed ends — the three
 * tags the relay actually indexes. That is what makes the seller-less case
 * measurable here: the base REQ cannot carry the coordinate (nobody knows the
 * seller yet), so the verdicts can only arrive if a coordinate REQ is opened
 * after the create.
 */
function coordinateLotRelay(options: {
	d: string
	create: NostrEventLike | null
	bids?: NostrEventLike[]
	coordinateEvents?: NostrEventLike[]
}): { open: ArenaRelayOpenFactory; calls: (readonly EventFilter[])[] } {
	const calls: (readonly EventFilter[])[] = []
	const open: ArenaRelayOpenFactory =
		(url: string): ArenaRelayOpen =>
		(filters: readonly EventFilter[]) => ({
			async *[Symbol.asyncIterator](): AsyncIterator<EventStreamItem<NostrEventLike>> {
				calls.push(filters)
				const answers: NostrEventLike[] = []
				const add = (event: NostrEventLike | null | undefined): void => {
					if (event && !answers.includes(event)) answers.push(event)
				}
				for (const filter of filters) {
					if ((filter['#d'] ?? []).includes(options.d)) add(options.create)
					if ((filter['#e'] ?? []).length > 0) for (const bid of options.bids ?? []) add(bid)
					if ((filter['#auction'] ?? []).length > 0) for (const event of options.coordinateEvents ?? []) add(event)
				}
				for (const event of answers) yield { type: 'event', event } as EventStreamItem<NostrEventLike>
				yield { type: 'caught-up', info: { eose: [url], pending: [], complete: false } } as EventStreamItem<NostrEventLike>
			},
		})
	return { open, calls }
}

const BARE_D = 'lot-1'
const BARE_COORD = '1440:seller-alice:lot-1'

/** The four things the issue measured on the live lot: a create, a bid, two verdicts, a receipt, a committed end. */
const BARE_CREATE = createEvent({ id: 'bare-root', d: BARE_D })
const BARE_BID = bidEvent({ auctionId: BARE_D, amount: 500, e: 'bare-root', id: 'bare-bid' })
const BARE_VERDICT_HIGH = verdictEvent({ auctionId: BARE_COORD, validator: 'validator-1', height: 3032, outcome: 'reserve_not_met' })
const BARE_VERDICT_LOW = verdictEvent({ auctionId: BARE_COORD, validator: 'validator-2', height: 3030, outcome: 'reserve_not_met' })
const BARE_RECEIPT = receiptEvent({ auctionId: BARE_COORD, bidId: 'bare-bid', kind: ARENA_AUCTION_REFUND_KIND })
const BARE_LOT_STATE = lotStateEvent({ auctionId: BARE_COORD, height: 3032 })

const COORDINATE_FILTER = {
	kinds: [ARENA_AUCTION_REFUND_KIND, ARENA_AUCTION_SETTLE_KIND, ARENA_VERDICT_KIND, ARENA_LOT_STATE_KIND],
	'#auction': [BARE_COORD],
}

describe('a lot URL with no seller reads its coordinate once the create arrives', () => {
	const coordinateEvents = [BARE_VERDICT_HIGH, BARE_VERDICT_LOW, BARE_RECEIPT, BARE_LOT_STATE]

	test('opens the #auction follow-up after the create and delivers verdicts, receipt and committed end', async () => {
		const relay = coordinateLotRelay({ d: BARE_D, create: BARE_CREATE, bids: [BARE_BID], coordinateEvents })
		const read = createArenaAuctionRead({
			relays: ['wss://limited'],
			deadlineMs: 1000,
			filters: arenaLotFilters(null, BARE_D),
			followUpFilters: arenaLotFollowUpFilters(null, BARE_D),
			openRelay: relay.open,
		})
		const snapshot = await read.snapshot()

		// The base REQ asks for the create and nothing else — a bare `d` cannot name
		// the coordinate. Without the follow-up this is the whole read, which is the
		// 0-verdict page.
		expect(relay.calls[0]).toEqual([{ kinds: [1440], '#d': [BARE_D] }])

		// The second REQ, opened because the create named its seller.
		expect(relay.calls).toHaveLength(2)
		expect(relay.calls[1]).toContainEqual(COORDINATE_FILTER)
		// The `#e` bid filter rides in the same second REQ, as before.
		expect(relay.calls[1]).toContainEqual({ kinds: [1441], '#e': ['bare-root'] })

		const view = snapshot.auctions[0]
		expect(view.coordinate).toBe(BARE_COORD)
		// Newest height first, ties to the validator key: the two verdicts are read
		// (they are what the panel counts) …
		expect(view.verdicts.map((verdict) => [verdict.validatorPubkey, verdict.height])).toEqual([
			['validator-1', 3032],
			['validator-2', 3030],
		])
		// … the money receipt and the committed end are read from the same REQ …
		expect(view.receipts).toHaveLength(1)
		expect(view.receipts[0].auctionId).toBe(BARE_COORD)
		expect(view.committedEnd?.auctionId).toBe(BARE_COORD)
		// … and so is the bid.
		expect(view.bids.map((bid) => bid.eventId)).toEqual(['bare-bid'])
	})

	test('delivers the coordinate data before caught-up, so a bounded read sees it', async () => {
		const relay = coordinateLotRelay({ d: BARE_D, create: BARE_CREATE, coordinateEvents })
		const read = createArenaAuctionRead({
			relays: ['wss://limited'],
			deadlineMs: 1000,
			filters: arenaLotFilters(null, BARE_D),
			followUpFilters: arenaLotFollowUpFilters(null, BARE_D),
			openRelay: relay.open,
		})
		const items = await collect(read.events())

		const verdictIds = items
			.filter((item) => item.type === 'events')
			.flatMap((item) => item.events)
			.filter((event) => event.type === 'verdict')
			.map((event) => event.id)
		expect(verdictIds).toHaveLength(2)

		const types = items.map((item) => item.type)
		expect(types.lastIndexOf('events')).toBeLessThan(types.indexOf('caught-up'))
	})

	test('a bare `d` whose create never arrives opens no coordinate REQ', async () => {
		const relay = coordinateLotRelay({ d: BARE_D, create: null, coordinateEvents })
		const read = createArenaAuctionRead({
			relays: ['wss://limited'],
			deadlineMs: 1000,
			filters: arenaLotFilters(null, BARE_D),
			followUpFilters: arenaLotFollowUpFilters(null, BARE_D),
			openRelay: relay.open,
		})
		await read.snapshot()
		expect(relay.calls).toHaveLength(1)
	})

	test("the coordinate is the create's own signer, never a seller the URL guessed", async () => {
		// The read is seller-less, so any create carrying this `d` is accepted —
		// and the coordinate it opens must be that create's, or the REQ would ask
		// for another seller's lot.
		const otherCreate = createEvent({ id: 'other-root', d: BARE_D, pubkey: SELLER_B })
		const followUp = arenaLotFollowUpFilters(null, BARE_D)
		const decoded = decodeArenaEvent(otherCreate, 'wss://limited')
		expect(decoded.ok).toBe(true)
		if (!decoded.ok) return

		expect(followUp([decoded.event])).toContainEqual({
			kinds: [ARENA_AUCTION_REFUND_KIND, ARENA_AUCTION_SETTLE_KIND, ARENA_VERDICT_KIND, ARENA_LOT_STATE_KIND],
			'#auction': [`1440:${SELLER_B}:${BARE_D}`],
		})
	})
})

describe('a seller-known lot read never sends the coordinate filter twice', () => {
	test('the follow-up is the #e bid filter alone; the coordinate filter stays in the base REQ', async () => {
		const relay = coordinateLotRelay({ d: BARE_D, create: BARE_CREATE, bids: [BARE_BID], coordinateEvents: [BARE_VERDICT_HIGH] })
		const read = createArenaAuctionRead({
			relays: ['wss://limited'],
			deadlineMs: 1000,
			filters: arenaLotFilters(SELLER_A, BARE_D),
			followUpFilters: arenaLotFollowUpFilters(SELLER_A, BARE_D),
			openRelay: relay.open,
		})
		await read.snapshot()

		expect(relay.calls).toHaveLength(2)
		expect(relay.calls[0]).toContainEqual(COORDINATE_FILTER)
		expect(relay.calls[1]).toEqual([
			{ kinds: [1441], '#e': ['bare-root'] },
			{ kinds: [1450], '#e': ['bare-root'] },
		])

		// Exactly one REQ carries the coordinate, across the whole read.
		const coordinateFilters = relay.calls.flat().filter((filter) => filter['#auction'] !== undefined)
		expect(coordinateFilters).toHaveLength(1)
	})

	test('a create signed by another seller is not this lot: no follow-up from it', () => {
		const followUp = arenaLotFollowUpFilters(SELLER_A, BARE_D)
		const otherCreate = createEvent({ id: 'other-root', d: BARE_D, pubkey: SELLER_B })
		const decoded = decodeArenaEvent(otherCreate, 'wss://limited')
		expect(decoded.ok).toBe(true)
		if (!decoded.ok) return

		expect(followUp([decoded.event])).toEqual([])
	})
})

describe('the lot gallery on read', () => {
	test('content.media is parsed, unsafe items dropped', async () => {
		const read = readFrom({
			'wss://a': {
				events: [
					createEvent(
						{ id: 'g1' },
						{
							image: 'https://img.example/front.jpg',
							media: [
								{ type: 'image', url: 'https://img.example/side.jpg' },
								{ type: 'image', url: 'javascript:alert(1)' },
								{ type: 'live', url: 'https://img.example/live.m3u8' },
							],
						},
					),
				],
			},
		})
		const snapshot = await read.snapshot()
		expect(snapshot.auctions[0].content.media).toEqual([
			{ type: 'image', url: 'https://img.example/side.jpg' },
			{ type: 'live', url: 'https://img.example/live.m3u8' },
		])
	})

	test('a create without media reads as an empty gallery', async () => {
		const read = readFrom({ 'wss://a': { events: [createEvent({ id: 'g2' })] } })
		const snapshot = await read.snapshot()
		expect(snapshot.auctions[0].content.media).toEqual([])
	})
})
