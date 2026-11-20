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
import { finalizeEvent, getPublicKey } from 'nostr-tools'
import type { EventFilter, EventStreamItem, NostrEventLike } from '@sdk/core'
import {
	ARENA_AUCTION_CREATE_KIND,
	ARENA_CREATE_ADMIT_SCHEMA,
	ARENA_LOT_STATE_KIND,
	ARENA_VERDICT_KIND,
} from '@sdk/commerce/auctions/constants'
import {
	createArenaAuctionRead,
	decodeArenaEvent,
	projectArenaEvents,
	type ArenaAuctionRead,
	type ArenaAuctionView,
	type ArenaRelayOpen,
	type ArenaRelayOpenOptions,
	type ArenaReadHealth,
} from '@platform/web/auctions/relay/arenaAuctionRead'
import {
	auctionListStatus,
	auctionTickerStats,
	byPopularity,
	collectAuctionListRead,
	selectCoverAuction,
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
			startPrice: 1000,
			durationSec: 3600,
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
	/** The relay answered the REQ with a refusal; the caught-up marker names it `refused`. */
	refused?: string
	/** The relay's connection never established; the caught-up marker names it `unreachable`. */
	unreachable?: boolean
	/** The relay settled without answering and without a connection verdict: it stays pending. */
	silent?: boolean
	/** Yield `events`, then hold the stream open until the read aborts it. */
	hang?: boolean
	/**
	 * The relay's socket truth when the read asks at its deadline
	 * (`init.relayConnected`). Default `true`, or `false` for a fake whose stream
	 * throws on open. `false` + `hang` is the measured never-connected relay.
	 */
	connected?: boolean
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
			yield {
				type: 'caught-up',
				info:
					options.refused !== undefined
						? { eose: [], pending: [url], complete: false, refused: [{ relay: url, reason: options.refused }] }
						: options.unreachable === true
							? { eose: [], pending: [url], complete: false, unreachable: [url] }
							: options.silent === true
								? { eose: [], pending: [url], complete: false }
								: { eose: [url], pending: [], complete: false },
			}
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

function selection(over: Partial<AuctionListSelection> = {}): AuctionListSelection {
	return { source: 'mine', seller: SELLER_A, coordinates: [], limit: 10, now: 0, ...over }
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

// =========================================================================
// The chain's create-admission — the fact the app follows a lot on
// =========================================================================

const ADMIT_SK = new Uint8Array(32).fill(23)
const ADMIT_PUB = getPublicKey(ADMIT_SK)

/**
 * A signed kind-1449 create-admission (`arena.createadmit.v1`) for a create the
 * fixtures published. The read verifies the signature, so a create without one
 * is not a lot the app follows (`arenaAuctionRead.ts` `isFollowedAuction`).
 */
function admitEvent(over: { d?: string; seller?: string; rootEventId?: string; acceptedHeight?: number } = {}): NostrEventLike {
	const d = over.d ?? 'lot-1'
	const seller = over.seller ?? SELLER_A
	const coordinate = `1440:${seller}:${d}`
	const acceptedHeight = over.acceptedHeight ?? 4241
	const hash = 'ab'.repeat(32)
	return finalizeEvent(
		{
			kind: ARENA_LOT_STATE_KIND,
			created_at: 1_795_021_527,
			tags: [
				['e', over.rootEventId ?? `create-${d}`],
				['auction', coordinate],
				['height', String(acceptedHeight)],
				['hash', hash],
				['p', ADMIT_PUB],
			],
			content: JSON.stringify({
				schema: ARENA_CREATE_ADMIT_SCHEMA,
				auction_id: coordinate,
				seller,
				root_event_id: over.rootEventId ?? `create-${d}`,
				accepted_height: acceptedHeight,
				block_hash: hash,
				end_time: 4600,
				original_end_time: 4600,
				mode: 'fixed',
			}),
		},
		ADMIT_SK,
	) as unknown as NostrEventLike
}

/** What a create fixture implies for its admission: its `d`, its seller, its own event id. */
function createAdmitOf(create: NostrEventLike): { d: string; seller: string; rootEventId: string } {
	const dTag = create.tags.find((tag) => tag[0] === 'd')?.[1]
	return { d: dTag ?? 'lot-1', seller: create.pubkey, rootEventId: create.id }
}

/**
 * The chain's create-admission for `lot-1`, as the `toAuctionListItem` fixture
 * carries it: a view must hold one to be a lot the app follows.
 */
const ADMIT: ArenaAuctionView['createAdmit'] = {
	eventId: 'admit-1',
	signerPubkey: ADMIT_PUB,
	auctionId: `1440:${SELLER_A}:lot-1`,
	seller: SELLER_A,
	rootEventId: 'create-lot-1',
	acceptedHeight: 4241,
	endTime: 4600,
	originalEndTime: 4600,
	mode: 'fixed',
	height: 4241,
	blockHash: 'ab'.repeat(32),
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
			image: null,
			media: [],
			startPrice: 1000,
			minIncrement: 10,
			mode: 'fixed',
			windowSec: null,
			durationSec: 100,
			sellerWallet: null,
			v4vSplit: null,
		},
		versions: 1,
		bids: [],
		positions: {},
		topBid: null,
		bidsWithoutAmount: 0,
		verdicts: [],
		receipts: [],
		refundForBid: {},
		settleForBid: {},
		settleReceipt: null,
		committedEnd: null,
		committedEnds: [],
		createRefusal: null,
		createAdmit: ADMIT,
		bidRefusals: [],
		admissions: [],
		admissionForBid: {},
		relays: ['wss://a'],
	}

	test('open before the derived end, ended after it', () => {
		expect(toAuctionListItem(view, 1050).phase).toBe('open')
		expect(toAuctionListItem(view, 1200).phase).toBe('ended')
	})

	test('a create with no duration has no end to state', () => {
		const noDuration = { ...view, content: { ...view.content, durationSec: null } }
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
			eventId: 'verdict-1',
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
		// rules a relay would be — **including the acceptance gate**: every 1440
		// here is a lot the chain accepted, so a signed create-admission is
		// appended for it. Without it the list would (correctly) drop the lot.
		const admits = events.filter((event) => event.kind === ARENA_AUCTION_CREATE_KIND).map((create) => admitEvent(createAdmitOf(create)))
		const ok = [...events, ...admits]
			.map((event) => decodeArenaEvent(event, 'wss://a'))
			.flatMap((result) => (result.ok ? [result.event] : []))
		return projectArenaEvents(ok)
	}

	test("mine keeps only the page author's auctions, newest first", () => {
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

	test('all lists every seller, live soonest-ending first, then the rest', () => {
		const snapshot = snapshotWith(
			createEvent({ id: 'a1', pubkey: SELLER_A, created_at: 1000, d: 'ended' }, { durationSec: 100 }),
			createEvent({ id: 'b1', pubkey: SELLER_B, created_at: 2000, d: 'late' }, { durationSec: 3600 }),
			createEvent({ id: 'b2', pubkey: SELLER_B, created_at: 2100, d: 'soon' }, { durationSec: 600 }),
		)
		const { items, missing } = selectAuctionList(snapshot, selection({ source: 'all', seller: SELLER_A, now: 2500 }))
		expect(items.map((item) => item.d)).toEqual(['soon', 'late', 'ended'])
		expect(missing).toEqual([])
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

	test('a create the chain has not accepted is not offered, and reads as not delivered', () => {
		// The read delivered the create; no create-admission fact names its
		// coordinate. Discovery follows only accepted lots, so it is not an item —
		// and a picked coordinate that is on the relays but unaccepted is reported
		// unshown, which the block says in its own words (never "accepted").
		const ok = [createEvent({ id: 'a1', created_at: 1000, d: 'pending' })]
			.map((event) => decodeArenaEvent(event, 'wss://a'))
			.flatMap((result) => (result.ok ? [result.event] : []))
		const snapshot = projectArenaEvents(ok)
		const coordinate = `1440:${SELLER_A}:pending`
		expect(snapshot.auctions.map((auction) => auction.coordinate)).toEqual([coordinate])

		expect(selectAuctionList(snapshot, selection({ source: 'all', now: 1000 })).items).toEqual([])
		const picked = selectAuctionList(snapshot, selection({ source: 'picked', coordinates: [coordinate], now: 1000 }))
		expect(picked.items).toEqual([])
		expect(picked.missing).toEqual([coordinate])
	})
})

// =========================================================================
// Magazine home selections (ADR-0028)
// =========================================================================

describe('magazine selections', () => {
	function snapshotWith(...events: NostrEventLike[]) {
		const ok = events.map((event) => decodeArenaEvent(event, 'wss://a')).flatMap((result) => (result.ok ? [result.event] : []))
		return projectArenaEvents(ok)
	}
	const item = (over: Partial<ReturnType<typeof toAuctionListItem>>) =>
		({ coordinate: 'c', seller: 's', d: 'd', title: null, startingBid: null, topBidTotal: null, bidCount: 0, endsAt: null, phase: 'open', verdict: null, ...over }) as ReturnType<
			typeof toAuctionListItem
		>

	test('popularity: most bids, then higher top bid, then sooner end', () => {
		const ranked = [
			item({ d: 'quiet', bidCount: 1, topBidTotal: 500 }),
			item({ d: 'busy', bidCount: 9, topBidTotal: 100 }),
			item({ d: 'rich', bidCount: 1, topBidTotal: 9000 }),
		].sort(byPopularity)
		expect(ranked.map((entry) => entry.d)).toEqual(['busy', 'rich', 'quiet'])
	})

	test('items carry the root start, so a card can draw elapsed time', () => {
		const snapshot = snapshotWith(createEvent({ id: 'a1', created_at: 1000, d: 'one' }))
		expect(toAuctionListItem(snapshot.auctions[0], 1500).startsAt).toBe(1000)
	})

	test('cover: picked is the named lot, auto prefers a live lot over an ended one', () => {
		const snapshot = snapshotWith(
			createEvent({ id: 'a1', pubkey: SELLER_A, created_at: 1000, d: 'ended' }, { durationSec: 100 }),
			createEvent({ id: 'b1', pubkey: SELLER_B, created_at: 2000, d: 'live' }, { durationSec: 3600 }),
		)
		expect(selectCoverAuction(snapshot, { source: 'auto', coordinates: [], now: 2500 })?.item.d).toBe('live')
		expect(selectCoverAuction(snapshot, { source: 'picked', coordinates: ['1440:seller-alice:ended'], now: 2500 })?.item.d).toBe('ended')
		expect(selectCoverAuction(snapshot, { source: 'picked', coordinates: [], now: 2500 })).toBeNull()
	})

	test('sort newest keeps the read order among live lots', () => {
		const snapshot = snapshotWith(
			createEvent({ id: 'b1', pubkey: SELLER_B, created_at: 2000, d: 'older' }, { durationSec: 600 }),
			createEvent({ id: 'b2', pubkey: SELLER_B, created_at: 2100, d: 'newer' }, { durationSec: 3600 }),
		)
		const { items } = selectAuctionList(snapshot, selection({ source: 'all', now: 2200, sort: 'newest' }))
		expect(items.map((entry) => entry.d)).toEqual(['newer', 'older'])
	})

	test('ticker stats count live lots and name the next to close', () => {
		const snapshot = snapshotWith(
			createEvent({ id: 'a1', created_at: 1000, d: 'ended' }, { durationSec: 100 }),
			createEvent({ id: 'b1', pubkey: SELLER_B, created_at: 2000, d: 'late' }, { durationSec: 3600 }),
			createEvent({ id: 'b2', pubkey: SELLER_B, created_at: 2100, d: 'soon' }, { durationSec: 600 }),
		)
		const stats = auctionTickerStats(snapshot, 2500)
		expect(stats.live).toBe(2)
		expect(stats.closingNext?.d).toBe('soon')
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
			// The chain's create-admission: without it the gate does not follow the
			// lot, and the delivered create is (correctly) not an item.
			admitEvent(),
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

	test('one dead relay beside a healthy one is accounted, and the read settles', async () => {
		// A relay whose connection failed has answered "no": it is a settled fact,
		// not silence, so nothing is left pending in the health
		// (`arenaAuctionRead.ts`, `summarizeHealth`). The data the other relay
		// delivered is kept.
		const state = await collectAuctionListRead(
			readFrom({
				'wss://a': { events: [createEvent({ id: 'root', d: 'lot-1' }), admitEvent()] },
				'wss://b': { fail: 'connection refused' },
			}),
		)
		expect(state.status).toBe('settled')
		expect(state.snapshot?.health.unreachable).toEqual(['wss://b'])
		expect(state.snapshot?.health.pending).toEqual([])
		const { items } = selectAuctionList(state.snapshot!, selection({ now: 1000 }))
		expect(items).toHaveLength(1)
	})

	test('a relay that delivers and then stays connected ends at the deadline', async () => {
		// A live relay keeps its socket open (a transport that never surfaces EOSE
		// keeps it open anyway). The read ends at its deadline — a relay's boundary
		// never ends it — and the auction it delivered is complete, not a
		// partial-read sentence.
		const started = Date.now()
		const state = await collectAuctionListRead(
			readFrom({ 'wss://answered': { events: [createEvent({ id: 'root', created_at: 1000, d: 'lot-1' })], hang: true } }, 150),
		)
		expect(Date.now() - started).toBeGreaterThanOrEqual(120)
		expect(state.status).toBe('settled')
		expect(state.relayHealth).toEqual({ answered: 1, total: 1 })
		expect(state.snapshot?.health.pending).toEqual([])
		const { items } = selectAuctionList(state.snapshot!, selection({ now: 1000 }))
		expect(items.map((item) => item.d)).toEqual(['lot-1'])
	})

	test('every relay answered, refused or unreachable reports settled', async () => {
		// The three ways a relay stops being pending: it answered, it refused the
		// filter, or it could not be reached. All three are answers, so nothing is
		// left pending in the health — which is what lets a surface state the lot's
		// phase instead of a partial-read sentence.
		const state = await collectAuctionListRead(
			readFrom({
				'wss://answered': { events: [createEvent({ id: 'root', d: 'lot-1' })] },
				'wss://refuser': { refused: 'bad req: error parsing #auction: unindexed tag filter' },
				'wss://gone': { unreachable: true },
			}),
		)
		expect(state.status).toBe('settled')
		expect(state.snapshot?.health.answered).toEqual(['wss://answered'])
		expect(state.snapshot?.health.refused).toEqual(['wss://refuser'])
		expect(state.snapshot?.health.unreachable).toEqual(['wss://gone'])
		expect(state.snapshot?.health.pending).toEqual([])
	})

	test('a relay whose socket never opened settles the read, with the count short of the total', async () => {
		// The measured cold-load shape (2026-11-20, lot d=612a25ed…, 7 configured
		// relays, 2-3 of them with no socket): `settled` beside `N of M relays
		// answered` is the honest pair. `incomplete` was the bug — the transport's
		// own verdict is armed later than the read's deadline, so the read asks the
		// transport's connect truth itself when it gives up.
		const state = await collectAuctionListRead(
			readFrom(
				{
					'wss://answered': { events: [createEvent({ id: 'root', d: 'lot-1' })] },
					'wss://never': { connected: false, hang: true },
				},
				60,
			),
		)
		expect(state.status).toBe('settled')
		expect(state.relayHealth).toEqual({ answered: 1, total: 2 })
		expect(state.snapshot?.health.unreachable).toEqual(['wss://never'])
		expect(state.snapshot?.health.pending).toEqual([])
		// The relay that never answered is still not counted as answering, and the
		// lot the other relay delivered is stated in full.
		const { items } = selectAuctionList(state.snapshot!, selection({ now: 1000 }))
		expect(items.map((item) => item.d)).toEqual(['lot-1'])
	})

	test('a relay that connected and stayed silent keeps the read incomplete', async () => {
		// The other half of the rule: an open socket that says nothing is not a
		// verdict, so the block may not state the lot's phase.
		const state = await collectAuctionListRead(
			readFrom(
				{
					'wss://answered': { events: [createEvent({ id: 'root', d: 'lot-1' })] },
					'wss://mute': { connected: true, hang: true },
				},
				60,
			),
		)
		expect(state.status).toBe('incomplete')
		expect(state.relayHealth).toEqual({ answered: 1, total: 2 })
		expect(state.snapshot?.health.pending).toEqual(['wss://mute'])
		expect(state.snapshot?.health.unreachable).toEqual([])
		expect(state.snapshot?.health.relays.find((r) => r.url === 'wss://mute')?.status).toBe('timeout')
	})

	test('a genuinely silent relay inside the deadline keeps the read incomplete', async () => {
		// The honesty rule: a relay the transport never heard from could still
		// answer, so the read may not render a no-data notice.
		const state = await collectAuctionListRead(
			readFrom({
				'wss://answered': { events: [createEvent({ id: 'root', d: 'lot-1' })] },
				'wss://mute': { silent: true },
			}),
		)
		expect(state.status).toBe('incomplete')
		expect(state.snapshot?.health.pending).toEqual(['wss://mute'])
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
