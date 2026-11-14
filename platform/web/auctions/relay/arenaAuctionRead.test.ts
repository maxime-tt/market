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

import type { EventFilter, EventStreamItem, NostrEventLike } from '@sdk/core'
import {
	ARENA_AUCTION_CREATE_KIND,
	ARENA_STATE_COMMITMENT_KIND,
	ARENA_VERDICT_KIND,
} from '@sdk/commerce/auctions/constants'
import {
	ARENA_READ_KINDS,
	ARENA_REFUSAL_BAD_D,
	ARENA_REFUSAL_BAD_IDENTITY,
	ARENA_REFUSAL_IMMUTABLE_CHANGED,
	ARENA_REFUSAL_NOT_SUPERSEDING_ROOT,
	ARENA_REFUSAL_ROOT_CARRIES_E,
	ARENA_REFUSAL_UNBOUND_BID,
	ARENA_REFUSAL_UNEXPECTED_KIND,
	arenaAuctionFilters,
	createArenaAuctionRead,
	decodeArenaEvent,
	findImmutableChange,
	isValidArenaD,
	projectArenaEvents,
	resolveVerdicts,
	type ArenaAuctionRead,
	type ArenaCreateImmutableField,
	type ArenaRelayOpen,
	type ArenaRelayOpenOptions,
	type ArenaReadStreamItem,
	type ArenaVerdictView,
} from './arenaAuctionRead'

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
		title: 'A lot',
		startPrice: 1000,
		minIncrement: 10,
		mode: 'fixed',
		windowSec: 0,
		durationSec: 3600,
		sellerWallet: 'seller-wallet',
		...over,
	}
}

function createEvent(
	over: Partial<{ id: string; created_at: number; pubkey: string; d: string; e: string | null }> = {},
	content: Record<string, unknown> = {},
): NostrEventLike {
	const d = over.d ?? 'lot-1'
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
	if (over.auctionId !== undefined) content.auction = over.auctionId
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
	over: { auctionId?: string; bidId?: string; outcome?: string; height?: number; hash?: string; validator?: string; created_at?: number; id?: string } = {},
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
	over: { height?: number; appHash?: string; validator?: string; created_at?: number; id?: string } = {},
): NostrEventLike {
	const height = over.height ?? 10
	const appHash = over.appHash ?? 'cafe'
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
		content: { schema: 'arena.statecommit.v1', height, app_hash: appHash, time: 1700000000 },
	})
}

interface FakeRelayOptions {
	events?: NostrEventLike[]
	/** Throw on open. */
	fail?: string
	/** Never yield and never end until aborted. */
	hang?: boolean
	/** Emit a caught-up that lists this relay as pending (never answered). */
	silent?: boolean
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
				info: options.silent
					? { eose: [], pending: [url], complete: false }
					: { eose: [url], pending: [], complete: false },
			} as EventStreamItem<NostrEventLike>
		},
	})
}

function readFrom(relays: Record<string, FakeRelayOptions>, deadlineMs = 5000): ArenaAuctionRead {
	return createArenaAuctionRead({
		relays: Object.keys(relays),
		openRelay: (url) => fakeRelay(url, relays[url] ?? {}),
		deadlineMs,
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
	test('asks for exactly the four auction kinds and nothing else', () => {
		expect(arenaAuctionFilters()).toEqual([{ kinds: [1440, 1441, 1445, 1447] }])
		expect(ARENA_READ_KINDS).toEqual([1440, 1441, 1445, 1447])
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
		const older = createEvent({ id: 'older', created_at: 900, d: 'lot-old' })
		const tieB = createEvent({ id: 'tie-b', created_at: 1000, d: 'lot-b' })
		const tieA = createEvent({ id: 'tie-a', created_at: 1000, d: 'lot-a' })
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

	test('a supersession that changes sellerWallet is REFUSED, and the field is named', async () => {
		// The payout destination is the money field that matters most: an accepted
		// edit here would let a seller redirect a settled escrow, and the reader
		// would show the redirect as canonical.
		const root = createEvent({ id: 'v1', created_at: 1000 }, { sellerWallet: 'seller-wallet-one' })
		const attack = createEvent({ id: 'v2', created_at: 2000, e: 'v1' }, { sellerWallet: 'attacker-wallet' })
		const snapshot = await readFrom({ 'wss://a': { events: [root, attack] } }).snapshot()

		expect(snapshot.auctions[0].canonicalEventId).toBe('v1')
		expect(snapshot.auctions[0].content.sellerWallet).toBe('seller-wallet-one')
		expect(snapshot.rejectedCreates).toHaveLength(1)
		expect(snapshot.rejectedCreates[0].reason).toBe(ARENA_REFUSAL_IMMUTABLE_CHANGED)
		expect(snapshot.rejectedCreates[0].field).toBe('sellerWallet')
	})

	test('a supersession that changes the V4V split is REFUSED', async () => {
		const root = createEvent(
			{ id: 'v1', created_at: 1000 },
			{
				v4vSplit: [
					{ role: 'validator', recipientPubkey: 'validator-wallet', allocationBps: 200 },
					{ role: 'v4v', recipientPubkey: 'v4v-wallet', allocationBps: 300 },
				],
			},
		)
		const reprice = createEvent(
			{ id: 'v2', created_at: 2000, e: 'v1' },
			{
				v4vSplit: [
					{ role: 'validator', recipientPubkey: 'validator-wallet', allocationBps: 200 },
					{ role: 'v4v', recipientPubkey: 'v4v-wallet', allocationBps: 5000 },
				],
			},
		)
		const reorder = createEvent(
			{ id: 'v3', created_at: 3000, e: 'v1' },
			{
				v4vSplit: [
					{ role: 'v4v', recipientPubkey: 'v4v-wallet', allocationBps: 300 },
					{ role: 'validator', recipientPubkey: 'validator-wallet', allocationBps: 200 },
				],
			},
		)
		const snapshot = await readFrom({ 'wss://a': { events: [root, reprice, reorder] } }).snapshot()

		expect(snapshot.auctions[0].canonicalEventId).toBe('v1')
		expect(snapshot.auctions[0].content.v4vSplit?.map((row) => row.allocationBps)).toEqual([200, 300])
		expect(snapshot.rejectedCreates.map((reject) => reject.field)).toEqual(['v4vSplit', 'v4vSplit'])
		expect(snapshot.rejectedCreates.every((reject) => reject.reason === ARENA_REFUSAL_IMMUTABLE_CHANGED)).toBe(true)
	})

	test('a supersession that changes mode is REFUSED', async () => {
		// Flipping a fixed lot to antisnipe would move its end time, which is a
		// bidder-locked value: the window resets the clock the bid priced against.
		const root = createEvent({ id: 'v1', created_at: 1000 }, { mode: 'fixed' })
		const attack = createEvent({ id: 'v2', created_at: 2000, e: 'v1' }, { mode: 'antisnipe', windowSec: 120 })
		const snapshot = await readFrom({ 'wss://a': { events: [root, attack] } }).snapshot()

		expect(snapshot.auctions[0].canonicalEventId).toBe('v1')
		expect(snapshot.auctions[0].content.mode).toBe('fixed')
		expect(snapshot.rejectedCreates).toHaveLength(1)
		expect(snapshot.rejectedCreates[0].field).toBe('mode')
	})

	test('a supersession that touches only title, description and image is ACCEPTED', async () => {
		const root = createEvent({ id: 'v1', created_at: 1000 })
		const edit = createEvent(
			{ id: 'v2', created_at: 2000, e: 'v1' },
			{ title: 'Corrected title', description: 'Corrected description', image: 'https://example.test/lot.png' },
		)
		const snapshot = await readFrom({ 'wss://a': { events: [root, edit] } }).snapshot()

		expect(snapshot.auctions[0].canonicalEventId).toBe('v2')
		expect(snapshot.auctions[0].content.title).toBe('Corrected title')
		expect(snapshot.auctions[0].content.description).toBe('Corrected description')
		expect(snapshot.auctions[0].content.image).toBe('https://example.test/lot.png')
		// The money and time fields came from the root and did not move.
		expect(snapshot.auctions[0].content.startPrice).toBe(1000)
		expect(snapshot.auctions[0].content.sellerWallet).toBe('seller-wallet')
		expect(snapshot.rejectedCreates).toHaveLength(0)
	})

	test('every frozen field is frozen, not just the money ones', async () => {
		const root = createEvent({ id: 'v1' })
		const decodedRoot = decodeArenaEvent(root, 'wss://a')
		expect(decodedRoot.ok).toBe(true)
		if (!decodedRoot.ok || decodedRoot.event.type !== 'create') return

		const flips: Array<[Record<string, unknown>, ArenaCreateImmutableField]> = [
			[{ startPrice: 2 }, 'startPrice'],
			[{ minIncrement: 11 }, 'minIncrement'],
			[{ mode: 'antisnipe' }, 'mode'],
			[{ windowSec: 60 }, 'windowSec'],
			[{ durationSec: 7200 }, 'durationSec'],
			[{ sellerWallet: 'other-wallet' }, 'sellerWallet'],
			[{ v4vSplit: [{ role: 'v4v', recipientPubkey: 'v4v-wallet', allocationBps: 100 }] }, 'v4vSplit'],
		]
		for (const [override, field] of flips) {
			const attack = createEvent({ id: 'v2', created_at: 2000, e: 'v1' }, override)
			const decodedAttack = decodeArenaEvent(attack, 'wss://a')
			expect(decodedAttack.ok).toBe(true)
			if (!decodedAttack.ok || decodedAttack.event.type !== 'create') continue
			expect(findImmutableChange(decodedRoot.event, decodedAttack.event)?.field).toBe(field)
		}
	})

	test('a numeric field rewritten as a string is the same value, not a change', async () => {
		// A producer's type wobble (`"1000"` for `1000`) must not read as an edit:
		// the chain compares integers, and so does this gate.
		const root = createEvent({ id: 'v1', created_at: 1000 }, { startPrice: 1000 })
		const edit = createEvent({ id: 'v2', created_at: 2000, e: 'v1' }, { startPrice: '1000', title: 'same price' })
		const snapshot = await readFrom({ 'wss://a': { events: [root, edit] } }).snapshot()

		expect(snapshot.auctions[0].canonicalEventId).toBe('v2')
		expect(snapshot.rejectedCreates).toHaveLength(0)
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
// The (seller, d) identity and the root e tag
// =========================================================================

describe('the (seller, d) identity and the root e tag', () => {
	test('the d grammar is exactly [A-Za-z0-9_-]{1,64}', () => {
		expect(isValidArenaD('lot-1')).toBe(true)
		expect(isValidArenaD('a')).toBe(true)
		expect(isValidArenaD('A_b-9')).toBe(true)
		expect(isValidArenaD('x'.repeat(64))).toBe(true)
		expect(isValidArenaD('')).toBe(false)
		expect(isValidArenaD('x'.repeat(65))).toBe(false)
		expect(isValidArenaD('two words')).toBe(false)
		expect(isValidArenaD('1440:seller:d')).toBe(false)
		expect(isValidArenaD('lot.1')).toBe(false)
	})

	test('a create with no usable d is refused by name, not given a made-up identity', () => {
		for (const d of ['two words', 'x'.repeat(65), 'lot.1']) {
			const decoded = decodeArenaEvent(createEvent({ d }), 'wss://a')
			expect(decoded.ok).toBe(false)
			if (!decoded.ok) expect(decoded.refusal.reason).toBe(ARENA_REFUSAL_BAD_D)
		}
		const noD = ev({ kind: ARENA_AUCTION_CREATE_KIND, tags: [], content: { title: 'no d' } })
		const decoded = decodeArenaEvent(noD, 'wss://a')
		expect(decoded.ok).toBe(false)
		if (!decoded.ok) expect(decoded.refusal.reason).toBe(ARENA_REFUSAL_BAD_D)
	})

	test('the FIRST 1440 for a (seller, d) is the root and carries NO e tag', async () => {
		const snapshot = await readFrom({ 'wss://a': { events: [createEvent({ id: 'root-1', d: 'lot-1' })] } }).snapshot()
		expect(snapshot.auctions).toHaveLength(1)
		expect(snapshot.auctions[0].rootEventId).toBe('root-1')
	})

	test('a first 1440 that carries an e tag is refused, not promoted to root', async () => {
		const claimed = createEvent({ id: 'claims-a-root', created_at: 1000, e: 'root-that-does-not-exist' })
		const snapshot = await readFrom({ 'wss://a': { events: [claimed] } }).snapshot()

		expect(snapshot.auctions).toHaveLength(0)
		expect(snapshot.rejectedCreates).toHaveLength(1)
		expect(snapshot.rejectedCreates[0].reason).toBe(ARENA_REFUSAL_ROOT_CARRIES_E)
	})

	test('a later 1440 must name the ROOT, not the version it last saw', async () => {
		// A bid binds to the root, so an edit chain that points at the previous
		// version would detach every bid placed against the auction.
		const root = createEvent({ id: 'root-1', created_at: 1000 }, { title: 'one' })
		const first = createEvent({ id: 'edit-1', created_at: 2000, e: 'root-1' }, { title: 'two' })
		const chained = createEvent({ id: 'edit-2', created_at: 3000, e: 'edit-1' }, { title: 'three' })
		const snapshot = await readFrom({ 'wss://a': { events: [root, first, chained] } }).snapshot()

		expect(snapshot.auctions[0].canonicalEventId).toBe('edit-1')
		expect(snapshot.auctions[0].content.title).toBe('two')
		expect(snapshot.rejectedCreates).toHaveLength(1)
		expect(snapshot.rejectedCreates[0].reason).toBe(ARENA_REFUSAL_NOT_SUPERSEDING_ROOT)
		expect(snapshot.rejectedCreates[0].eventId).toBe('edit-2')
	})

	test('the identity is (seller, d): the same d under two sellers is two auctions', async () => {
		const alice = createEvent({ id: 'alice-root', pubkey: SELLER_A, d: 'shared-d' })
		const bob = createEvent({ id: 'bob-root', pubkey: SELLER_B, d: 'shared-d' })
		const snapshot = await readFrom({ 'wss://a': { events: [alice, bob] } }).snapshot()

		expect(snapshot.auctions).toHaveLength(2)
		expect(snapshot.auctions.map((auction) => auction.coordinate).sort()).toEqual([
			`1440:${SELLER_A}:shared-d`,
			`1440:${SELLER_B}:shared-d`,
		])
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

describe('verdicts are append-only and resolve latest-per-validator', () => {
	test('a later verdict from the same validator is a NEW statement, not a replacement', async () => {
		const create = createEvent({ id: 'root-1' })
		const first = verdictEvent({
			auctionId: 'lot-1',
			outcome: 'winner',
			validator: 'validator-1',
			height: 10,
			bidId: 'bid-9',
			created_at: 1200,
			id: 'verdict-early',
		})
		const later = verdictEvent({
			auctionId: 'lot-1',
			outcome: 'cancelled',
			validator: 'validator-1',
			height: 20,
			created_at: 1300,
			id: 'verdict-late',
		})
		const snapshot = await readFrom({ 'wss://a': { events: [create, first, later] } }).snapshot()

		const view = snapshot.auctions[0]
		// Both events are kept: kind 1445 is regular, so nothing is replaced.
		expect(view.verdicts).toHaveLength(2)
		expect(view.verdicts[0].eventId).toBe('verdict-late')
		// One current claim per validator, and it is the later one.
		expect(view.latestVerdicts).toHaveLength(1)
		expect(view.latestVerdicts[0].outcome).toBe('cancelled')
		expect(view.resolvedVerdict?.outcome).toBe('cancelled')
		expect(view.resolvedVerdict?.height).toBe(20)
	})

	test('the fold is a quorum over each validator latest anchored verdict', async () => {
		const create = createEvent({ id: 'root-1' })
		const v1 = verdictEvent({ outcome: 'winner', validator: 'validator-1', height: 10, created_at: 1200 })
		const v2 = verdictEvent({ outcome: 'winner', validator: 'validator-2', height: 10, created_at: 1210 })
		const v3 = verdictEvent({ outcome: 'aborted', validator: 'validator-3', height: 10, created_at: 1220 })
		const snapshot = await readFrom({ 'wss://a': { events: [create, v1, v2, v3] } }).snapshot()

		const view = snapshot.auctions[0]
		expect(view.latestVerdicts).toHaveLength(3)
		expect(view.resolvedVerdict?.outcome).toBe('winner')
		expect(view.resolvedVerdict?.signers).toEqual(['validator-1', 'validator-2'])
		expect(view.resolvedVerdict?.validatorCount).toBe(3)
	})

	test('a validator that later contradicts itself counts once, on its latest statement', async () => {
		const create = createEvent({ id: 'root-1' })
		const v1Early = verdictEvent({ outcome: 'winner', validator: 'validator-1', height: 10, created_at: 1200 })
		const v1Late = verdictEvent({ outcome: 'aborted', validator: 'validator-1', height: 11, created_at: 1300 })
		const v2 = verdictEvent({ outcome: 'winner', validator: 'validator-2', height: 10, created_at: 1210 })
		const v3 = verdictEvent({ outcome: 'winner', validator: 'validator-3', height: 10, created_at: 1220 })
		const snapshot = await readFrom({ 'wss://a': { events: [create, v1Early, v1Late, v2, v3] } }).snapshot()

		const view = snapshot.auctions[0]
		// Three published verdicts, four events: validator-1's early `winner` is
		// history, and counts for nothing.
		expect(view.verdicts).toHaveLength(4)
		expect(view.latestVerdicts).toHaveLength(3)
		expect(view.resolvedVerdict?.outcome).toBe('winner')
		expect(view.resolvedVerdict?.signers).toEqual(['validator-2', 'validator-3'])
		expect(view.resolvedVerdict?.validatorCount).toBe(3)
	})

	test('resolveVerdicts takes the modal outcome, ties broken lexicographically', () => {
		const base = {
			auctionId: '1440:seller:lot-1',
			bidId: null,
			payoutTokenSha256: null,
			blockHash: 'beef',
			derivedFrom: 'committed_state',
			relays: ['wss://a'],
		}
		const claim = (validatorPubkey: string, outcome: ArenaVerdictView['outcome'], createdAt: number): ArenaVerdictView => ({
			...base,
			validatorPubkey,
			outcome,
			height: 10,
			eventId: `${validatorPubkey}-${createdAt}`,
			createdAt,
		})
		const tie = resolveVerdicts([claim('v-one', 'winner', 1000), claim('v-two', 'aborted', 1000), claim('v-three', 'cancelled', 1000)])
		// 'aborted' < 'cancelled' < 'winner': deterministic, not editorial.
		expect(tie.resolved?.outcome).toBe('aborted')
		expect(resolveVerdicts([]).resolved).toBeNull()
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
		expect(snapshot.health.pending).toContain('wss://dead')
		expect(snapshot.health.eose).toEqual(['wss://alive'])
		expect(snapshot.health.noRelaysReachable).toBe(false)
		expect(snapshot.health.relays.find((r) => r.url === 'wss://dead')?.error).toBe('connection refused')
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
})

// =========================================================================
// The live stream
// =========================================================================

describe('the live stream', () => {
	test('delivers events, then one caught-up marker, then ends', async () => {
		const read = readFrom({ 'wss://a': { events: [createEvent({ id: 'root-1' })] } })
		const items = await collect(read.events())

		const events = items.filter((i) => i.type === 'events')
		const caughtUp = items.filter((i) => i.type === 'caught-up')
		expect(events.length).toBeGreaterThan(0)
		expect(caughtUp).toHaveLength(1)
		expect(items.filter((i) => i.type === 'caught-up')).toHaveLength(1)
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