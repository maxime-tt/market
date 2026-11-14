/**
 * Tests for the storefront auction-list adapter (`auctionListRead.ts`).
 *
 * No network: every relay is a fake `AsyncIterable` over the *real* arena read
 * (`createArenaAuctionRead`), so what is exercised is the whole chain a page
 * uses — gate, projection, selection — with the socket replaced. Pubkeys here
 * are short and non-hex on purpose: they are opaque strings to the adapter, and
 * a 64-hex literal in a test file is indistinguishable from a key to the
 * pre-commit scanner.
 */
import { describe, expect, test } from 'bun:test'
import type { EventFilter, EventStreamItem, NostrEventLike } from '@sdk/core'
import {
	ARENA_AUCTION_CREATE_KIND,
	ARENA_VERDICT_KIND,
} from '@sdk/commerce/auctions/constants'
import {
	createArenaAuctionRead,
	decodeArenaEvent,
	projectArenaEvents,
	type ArenaAuctionRead,
	type ArenaRelayOpen,
	type ArenaRelayOpenOptions,
	type ArenaReadHealth,
} from '@platform/web/auctions/relay/arenaAuctionRead'
import {
	auctionListStatus,
	collectAuctionListRead,
	selectAuctionList,
	toAuctionListItem,
	type AuctionListSelection,
} from './auctionListRead'

const SELLER_A = 'seller-alice'
const SELLER_B = 'seller-bob'

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

function bidEvent(over: { auctionId?: string; amount?: number; pubkey?: string; created_at?: number; a?: string } = {}): NostrEventLike {
	const tags: string[][] = []
	if (over.a) tags.push(['a', over.a])
	return {
		id: nextId('bid'),
		pubkey: over.pubkey ?? 'bidder-1',
		created_at: over.created_at ?? 1100,
		kind: 1441,
		tags,
		content: JSON.stringify({ auction_id: over.auctionId ?? 'lot-1', amount: over.amount ?? 100 }),
	}
}

function verdictEvent(over: { auctionId?: string; outcome?: string; height?: number } = {}): NostrEventLike {
	const auctionId = over.auctionId ?? 'lot-1'
	return {
		id: nextId('verdict'),
		pubkey: 'validator-1',
		created_at: 1300,
		kind: ARENA_VERDICT_KIND,
		tags: [
			['auction', auctionId],
			['height', String(over.height ?? 10)],
			['hash', 'beef'],
			['p', 'validator-1'],
		],
		content: JSON.stringify({
			schema: 'arena.verdict.v1',
			auction_id: auctionId,
			outcome: over.outcome ?? 'winner',
			height: over.height ?? 10,
			block_hash: 'beef',
			derived_from: 'committed_state',
			bid_id: 'bid-1',
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

function selection(over: Partial<AuctionListSelection> = {}): AuctionListSelection {
	return { source: 'mine', seller: SELLER_A, coordinates: [], limit: 10, now: 0, ...over }
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

// =========================================================================
// The status mapping — one word, never a guess
// =========================================================================

describe('auctionListStatus', () => {
	test('every relay answered → settled', () => {
		const h = health({
			relays: [{ url: 'wss://a', status: 'ok', events: 1, refusals: 0, eose: true, error: null }],
			answered: ['wss://a'],
		})
		expect(auctionListStatus(h)).toBe('settled')
	})

	test('a relay that did not answer → incomplete, not empty', () => {
		const h = health({
			relays: [
				{ url: 'wss://a', status: 'ok', events: 1, refusals: 0, eose: true, error: null },
				{ url: 'wss://b', status: 'timeout', events: 0, refusals: 0, eose: false, error: null },
			],
			answered: ['wss://a'],
			pending: ['wss://b'],
		})
		expect(auctionListStatus(h)).toBe('incomplete')
	})

	test('no relay reachable → its own state, not "no auctions"', () => {
		expect(auctionListStatus(health({ noRelaysReachable: true }))).toBe('no-relays')
	})

	test('an aborted read is incomplete even if every relay had answered', () => {
		const h = health({
			relays: [{ url: 'wss://a', status: 'ok', events: 1, refusals: 0, eose: true, error: null }],
			answered: ['wss://a'],
			aborted: true,
		})
		expect(auctionListStatus(h)).toBe('incomplete')
	})
})

// =========================================================================
// The card model — what a visitor is told
// =========================================================================

describe('toAuctionListItem', () => {
	const view = {
		coordinate: '1440:seller-alice:lot-1',
		seller: SELLER_A,
		d: 'lot-1',
		rootEventId: 'root',
		canonicalEventId: 'root',
		createdAt: 1000,
		rootCreatedAt: 1000,
		content: {
			auctionId: 'lot-1',
			title: 'A lot',
			description: null,
			imageUrl: null,
			startingBid: 1000,
			minIncrement: 10,
			reserve: null,
			durationSeconds: 100,
			lateBidWindowSeconds: null,
			lateBidExtensionSeconds: null,
			maxTotalExtensionSeconds: null,
			locktimeSeconds: null,
			fundingMode: 'cashu_sigall_v1',
			sellerCocoPaymentPublicKey: null,
		},
		versions: 1,
		bids: [],
		positions: {},
		topBid: null,
		bidsWithoutAmount: 0,
		verdicts: [],
		relays: ['wss://a'],
	}

	test('open before the derived end, ended after it', () => {
		expect(toAuctionListItem(view, 1050).phase).toBe('open')
		expect(toAuctionListItem(view, 1200).phase).toBe('ended')
	})

	test('a create with no duration has no end to state', () => {
		const noDuration = { ...view, content: { ...view.content, durationSeconds: null } }
		const item = toAuctionListItem(noDuration, 9_999_999)
		expect(item.endsAt).toBeNull()
		expect(item.phase).toBe('unknown')
	})

	test('the end time follows the root create, not an edited version', () => {
		// Root at 1000 (start), a display edit at 5000 (canonical createdAt).
		// With a 100s duration the auction ended at 1100 — an edit must not
		// resurrect it.
		const edited = { ...view, createdAt: 5000, rootCreatedAt: 1000, versions: 2 }
		expect(toAuctionListItem(edited, 1500).phase).toBe('ended')
	})

	test('a verdict is carried through as relay-reported, and absent reads null', () => {
		const verdict = {
			auctionId: 'lot-1',
			bidId: 'bid-1',
			outcome: 'winner' as const,
			payoutTokenSha256: null,
			height: 10,
			blockHash: 'beef',
			derivedFrom: 'committed_state',
			validatorPubkey: 'validator-1',
		}
		expect(toAuctionListItem({ ...view, verdicts: [verdict] }, 1200).verdict).toBe('winner')
		expect(toAuctionListItem(view, 1200).verdict).toBeNull()
	})
})

// =========================================================================
// Selection — the page's authority
// =========================================================================

describe('selectAuctionList', () => {
	function snapshotWith(...events: NostrEventLike[]) {
		// Project through the real gate, so the fixtures are held to the same
		// rules a relay would be.
		const ok = events
			.map((event) => decodeArenaEvent(event, 'wss://a'))
			.flatMap((result) => (result.ok ? [result.event] : []))
		return projectArenaEvents(ok)
	}

	test('mine keeps only the page author\'s auctions, newest first', () => {
		const snapshot = snapshotWith(
			createEvent({ id: 'a1', pubkey: SELLER_A, created_at: 1000, d: 'one' }),
			createEvent({ id: 'b1', pubkey: SELLER_B, created_at: 2000, d: 'two' }),
			createEvent({ id: 'a2', pubkey: SELLER_A, created_at: 3000, d: 'three' }),
		)
		const { items } = selectAuctionList(snapshot, selection({ now: 1000 }))
		expect(items.map((item) => item.d)).toEqual(['three', 'one'])
	})

	test('picked keeps the document order and reports what was not delivered', () => {
		const snapshot = snapshotWith(
			createEvent({ id: 'a1', pubkey: SELLER_A, created_at: 1000, d: 'one' }),
			createEvent({ id: 'b1', pubkey: SELLER_B, created_at: 2000, d: 'two' }),
		)
		const { items, missing } = selectAuctionList(
			snapshot,
			selection({
				source: 'picked',
				seller: SELLER_A,
				now: 1000,
				coordinates: ['1440:seller-bob:two', '1440:seller-bob:absent', '1440:seller-alice:one'],
			}),
		)
		expect(items.map((item) => item.coordinate)).toEqual(['1440:seller-bob:two', '1440:seller-alice:one'])
		expect(items[0].seller).toBe(SELLER_B)
		expect(missing).toEqual(['1440:seller-bob:absent'])
	})

	test('limit truncates but does not reorder', () => {
		const snapshot = snapshotWith(
			createEvent({ id: 'a1', created_at: 1000, d: 'one' }),
			createEvent({ id: 'a2', created_at: 3000, d: 'three' }),
			createEvent({ id: 'a3', created_at: 2000, d: 'two' }),
		)
		const { items } = selectAuctionList(snapshot, selection({ now: 1000, limit: 2 }))
		expect(items.map((item) => item.d)).toEqual(['three', 'two'])
	})
})

// =========================================================================
// The read, end to end over fake relays
// =========================================================================

describe('collectAuctionListRead', () => {
	test('a healthy read settles, and the delivered auction is complete', async () => {
		const events = [
			createEvent({ id: 'root', created_at: 1000, d: 'lot-1' }),
			bidEvent({ auctionId: 'lot-1', amount: 150 }),
			verdictEvent({ auctionId: 'lot-1', outcome: 'winner' }),
		]
		const state = await collectAuctionListRead(readFrom({ 'wss://a': { events } }))

		expect(state.status).toBe('settled')
		expect(state.relayHealth).toEqual({ answered: 1, total: 1 })
		const { items } = selectAuctionList(state.snapshot!, selection({ now: 1200 }))
		expect(items).toHaveLength(1)
		expect(items[0].bidCount).toBe(1)
		expect(items[0].topBidTotal).toBe(150)
		expect(items[0].verdict).toBe('winner')
	})

	test('no relay configured is "no-relays", not an empty answer', async () => {
		const state = await collectAuctionListRead(readFrom({}))
		expect(state.status).toBe('no-relays')
		expect(state.relayHealth).toEqual({ answered: 0, total: 0 })
	})

	test('one dead relay beside a healthy one → incomplete, data kept', async () => {
		const state = await collectAuctionListRead(
			readFrom({
				'wss://a': { events: [createEvent({ id: 'root', d: 'lot-1' })] },
				'wss://b': { fail: 'connection refused' },
			}),
		)
		expect(state.status).toBe('incomplete')
		const { items } = selectAuctionList(state.snapshot!, selection({ now: 1000 }))
		expect(items).toHaveLength(1)
	})

	test('a relay that lies is refused by the gate and never becomes an auction', async () => {
		const lying = { ...createEvent({ id: 'bad', d: 'lot-1' }), content: 'not json' }
		const state = await collectAuctionListRead(readFrom({ 'wss://a': { events: [lying] } }))
		const { items } = selectAuctionList(state.snapshot!, selection({ now: 1000 }))
		expect(items).toHaveLength(0)
		expect(state.snapshot!.refusals.length).toBeGreaterThan(0)
	})

	test('progress is reported while the read runs, with the status still "loading"', async () => {
		const seen: string[] = []
		await collectAuctionListRead(readFrom({ 'wss://a': { events: [createEvent({ id: 'root', d: 'lot-1' })] } }), {
			onProgress: (state) => seen.push(state.status),
		})
		expect(seen.length).toBeGreaterThan(0)
		expect(seen.every((status) => status === 'loading')).toBe(true)
	})
})