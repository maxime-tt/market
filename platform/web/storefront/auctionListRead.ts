/**
 * `platform/web/storefront/auctionListRead.ts` — the platform-side adapter that
 * turns the verified arena read (`platform/web/auctions/relay/arenaAuctionRead.ts`)
 * into the plain data the props-only `AuctionListBlock` renders.
 *
 * ## Why this lives here
 *
 * `ui/AGENTS.md:18-28` forbids `ui/` importing `@platform/…`, `nostr-tools` or
 * `applesauce-*`; `ui/AGENTS.md:38-41` says a data adapter "is invoked by the
 * platform/assembler and passed down as props". This is that adapter. The
 * block gets plain auction items and a read *state*; it never sees a relay, an
 * event or a promise.
 *
 * ## Why the live read, not `snapshot()`
 *
 * `snapshot()` is the bounded read, and the read module's own header records a
 * measured trap: the web transport's `fetchEvents` turns a connection failure
 * into an empty array, so on a bounded read a dead relay is indistinguishable
 * from an empty one (`arenaAuctionRead.ts:66-72`). That is exactly the
 * distinction a page must not lose — "no auctions" and "no relay answered" are
 * different sentences. So this adapter consumes `events()` and reports the
 * live health, which does keep the distinction.
 *
 * ## What "honest" means at this seam
 *
 * {@link auctionListStatus} maps the read's health to one of five states and
 * never invents a sixth. `incomplete` is returned whenever any relay did not
 * answer — including a relay that closed without EOSE — because a read that
 * has not heard from every relay has no verdict about what exists.
 *
 * The end time is derived from the **root** create's `created_at`
 * (`rootCreatedAt`, added to the view for this reason): the canonical version's
 * `created_at` moves forward when the seller edits a display field, and an end
 * time that moves when a title changes is not an end time.
 */

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { EventStorePort } from '@sdk/core'
import type { Event } from '@sdk/core/nostr-io'
import { getReadContext } from '@platform/web/readContext'
import { webRelayPolicy } from '@platform/web/sdkNostrIo'
import {
	createWebArenaAuctionRead,
	projectArenaEvents,
	type ArenaAuctionEvent,
	type ArenaAuctionSnapshot,
	type ArenaAuctionView,
	type ArenaReadHealth,
	type ArenaRefusedEvent,
} from '@platform/web/auctions/relay/arenaAuctionRead'
import type { AuctionListItem, AuctionListStatus } from '@ui/storefront/blocks/AuctionListBlock'

export interface AuctionListSelection {
	/** `mine` = the page author's auctions; `picked` = the explicit coordinates. */
	source: 'mine' | 'picked' | 'all'
	/** The page author, from the page event — never from the document. */
	seller: string
	/** Ordered `1440:<seller>:<d>` references, used when `source` is `picked`. */
	coordinates: readonly string[]
	limit: number
	/** Unix seconds. Supplied by the caller so the projection stays pure. */
	now: number
	/** Order for `all` (ADR-0028). Defaults to `ending`, the original rule. */
	sort?: 'ending' | 'popular' | 'newest'
}

export interface AuctionListData {
	items: AuctionListItem[]
	/** Requested coordinates the read did not deliver. */
	missing: string[]
	status: AuctionListStatus
	relayHealth: { answered: number; total: number }
}

/**
 * The read's health as the one word the block renders.
 *
 * Order matters: `aborted` outranks everything (the result is partial by
 * construction), then "nobody answered", then any relay still pending.
 */
export function auctionListStatus(health: ArenaReadHealth): AuctionListStatus {
	if (health.aborted) return 'incomplete'
	if (health.noRelaysReachable) return 'no-relays'
	if (health.pending.length > 0) return 'incomplete'
	return 'settled'
}

/** Health → the two numbers the block may state. */
export function relayCounts(health: ArenaReadHealth): { answered: number; total: number } {
	return { answered: health.answered.length, total: health.relays.length }
}

/** One canonical auction view → the block's plain card model. */
export function toAuctionListItem(view: ArenaAuctionView, now: number): AuctionListItem {
	const duration = view.content.durationSec
	// A create with no duration has no end to state. `0` is treated the same:
	// an auction that lasts zero seconds is not a fact this block will assert.
	const endsAt = duration !== null && duration > 0 ? view.rootCreatedAt + duration : null
	const phase: AuctionListItem['phase'] = endsAt === null ? 'unknown' : now < endsAt ? 'open' : 'ended'
	// `verdicts` arrives sorted by height descending (`arenaAuctionRead.ts:901`),
	// so the first entry is the highest-anchored verdict the read saw. Anything
	// else would pick an older state over a newer one.
	const verdict = view.verdicts[0]?.outcome ?? null
	return {
		coordinate: view.coordinate,
		seller: view.seller,
		d: view.d,
		title: view.content.title,
		imageUrl: view.content.image,
		startingBid: view.content.startPrice,
		topBidTotal: view.topBid?.total ?? null,
		bidCount: view.bids.length,
		endsAt,
		startsAt: view.rootCreatedAt,
		phase,
		verdict,
	}
}

/**
 * Pure selection over a projected snapshot.
 *
 * `mine` keeps the snapshot's own order (newest `created_at` first, the read's
 * rule). `picked` keeps the **document's** order — the author chose a sequence,
 * and a marketplace listing does not get to reorder it.
 */
export function selectAuctionList(
	snapshot: ArenaAuctionSnapshot,
	selection: AuctionListSelection,
): { items: AuctionListItem[]; missing: string[] } {
	const limit = Math.max(0, selection.limit)
	if (selection.source === 'mine') {
		return {
			items: snapshot.auctions
				.filter((auction) => auction.seller === selection.seller)
				.slice(0, limit)
				.map((auction) => toAuctionListItem(auction, selection.now)),
			missing: [],
		}
	}

	if (selection.source === 'all') {
		// Live first, soonest-ending at the top (what a visitor can still bid on),
		// then everything else in the read's own newest-first order.
		// `popular` puts the most-bid live lots first; `newest` keeps the read's
		// newest-first order. Live lots always lead: a front page shows what a
		// visitor can still bid on before what is over.
		const projected = snapshot.auctions.map((auction) => toAuctionListItem(auction, selection.now))
		const live = projected.filter((item) => item.phase === 'open')
		const sort = selection.sort ?? 'ending'
		if (sort === 'ending') live.sort((a, b) => (a.endsAt ?? Infinity) - (b.endsAt ?? Infinity))
		else if (sort === 'popular') live.sort(byPopularity)
		const rest = projected.filter((item) => item.phase !== 'open')
		return { items: [...live, ...rest].slice(0, limit), missing: [] }
	}

	const byCoordinate = new Map(snapshot.auctions.map((auction) => [auction.coordinate, auction]))
	const items: AuctionListItem[] = []
	const missing: string[] = []
	for (const coordinate of selection.coordinates) {
		const auction = byCoordinate.get(coordinate)
		if (auction === undefined) missing.push(coordinate)
		else if (items.length < limit) items.push(toAuctionListItem(auction, selection.now))
	}
	return { items, missing }
}

/** Most bids first, then the higher top bid, then the sooner end. */
export function byPopularity(a: AuctionListItem, b: AuctionListItem): number {
	return (
		b.bidCount - a.bidCount ||
		(b.topBidTotal ?? b.startingBid ?? 0) - (a.topBidTotal ?? a.startingBid ?? 0) ||
		(a.endsAt ?? Infinity) - (b.endsAt ?? Infinity)
	)
}

/**
 * The cover lot (ADR-0028). `picked` is the one coordinate the editor chose;
 * `auto` is the live lot with the most bids, else the newest lot read.
 */
export function selectCoverAuction(
	snapshot: ArenaAuctionSnapshot,
	selection: { source: 'auto' | 'picked'; coordinates: readonly string[]; now: number },
): { item: AuctionListItem; description: string | null } | null {
	let view: ArenaAuctionView | undefined
	if (selection.source === 'picked') {
		const coordinate = selection.coordinates[0]
		view = coordinate ? snapshot.auctions.find((auction) => auction.coordinate === coordinate) : undefined
	} else {
		const ranked = snapshot.auctions
			.map((auction) => ({ auction, item: toAuctionListItem(auction, selection.now) }))
			.filter(({ item }) => item.phase === 'open')
			.sort((a, b) => byPopularity(a.item, b.item))
		view = ranked[0]?.auction ?? snapshot.auctions[0]
	}
	return view ? { item: toAuctionListItem(view, selection.now), description: view.content.description } : null
}

/** The live figures the ticker can state, all derived from the read. */
export interface AuctionTickerStats {
	live: number
	closingNext: AuctionListItem | null
	topBid: number | null
	bidsToday: number
}

export function auctionTickerStats(snapshot: ArenaAuctionSnapshot, now: number): AuctionTickerStats {
	const projected = snapshot.auctions.map((auction) => toAuctionListItem(auction, now))
	const live = projected.filter((item) => item.phase === 'open')
	const closingNext = [...live].sort((a, b) => (a.endsAt ?? Infinity) - (b.endsAt ?? Infinity))[0] ?? null
	const topBid = live.reduce<number | null>((best, item) => (item.topBidTotal !== null && (best === null || item.topBidTotal > best) ? item.topBidTotal : best), null)
	const dayAgo = now - 86_400
	let bidsToday = 0
	for (const auction of snapshot.auctions) for (const bid of auction.bids) if (bid.createdAt >= dayAgo) bidsToday += 1
	return { live: live.length, closingNext, topBid, bidsToday }
}

/** The read state the hook publishes; projection happens at render, with a fresh `now`. */
export interface AuctionListReadState {
	snapshot: ArenaAuctionSnapshot | null
	status: AuctionListStatus
	relayHealth: { answered: number; total: number }
}

const EMPTY_STATE: AuctionListReadState = {
	snapshot: null,
	status: 'loading',
	relayHealth: { answered: 0, total: 0 },
}

/**
 * Consume one live read to its caught-up marker.
 *
 * Ends the subscription: this is a page section, not a live feed, and the read
 * module's live read keeps the dead-relay distinction that `snapshot()` loses.
 * Never throws for network reasons — a failed relay is health, not an error.
 */
export async function collectAuctionListRead(
	read: ReturnType<typeof createWebArenaAuctionRead>,
	options: { signal?: AbortSignal; onProgress?: (state: AuctionListReadState) => void } = {},
): Promise<AuctionListReadState> {
	const byId = new Map<string, ArenaAuctionEvent>()
	const refusals: ArenaRefusedEvent[] = []
	let snapshot = projectArenaEvents([])

	try {
		for await (const item of read.events({ signal: options.signal })) {
			if (item.type === 'events') {
				for (const event of item.events) {
					const prior = byId.get(event.id)
					if (prior === undefined) byId.set(event.id, event)
					else for (const relay of event.relays) if (!prior.relays.includes(relay)) prior.relays.push(relay)
				}
				snapshot = projectArenaEvents([...byId.values()], snapshot.health, refusals)
				options.onProgress?.({ snapshot, status: 'loading', relayHealth: relayCounts(snapshot.health) })
				continue
			}
			if (item.type === 'refused') {
				refusals.push(...item.refusals)
				continue
			}
			snapshot = projectArenaEvents([...byId.values()], item.health, refusals)
			break
		}
	} finally {
		read.close()
	}

	return {
		snapshot,
		status: auctionListStatus(snapshot.health),
		relayHealth: relayCounts(snapshot.health),
	}
}

/**
 * The React seam for the storefront slot.
 *
 * The relays are the app's own query relays (`webRelayPolicy('query')`, the
 * same choice `createWebArenaAuctionRead` documents) and the store is the
 * shared read context's — admission stays the store's job.
 *
 * `now` is deliberately **not** a dependency: it is projection input, not read
 * input, and a subscription that reopens when the clock ticks is a subscription
 * that never settles.
 */
export function useAuctionListRead(): AuctionListReadState {
	const [state, setState] = useState<AuctionListReadState>(EMPTY_STATE)

	const relays = useMemo(() => [...webRelayPolicy('query')], [])
	const relaysKey = relays.join('|')

	useEffect(() => {
		const controller = new AbortController()
		let cancelled = false

		const read = createWebArenaAuctionRead({
			relays,
			// `EventStorePort` is structural; the read context's store is the same
			// port typed over the normalized event shape.
			store: getReadContext().store as unknown as EventStorePort<Event>,
		})

		void collectAuctionListRead(read, {
			signal: controller.signal,
			onProgress: (progress) => {
				if (!cancelled) setState(progress)
			},
		})
			.then((result) => {
				if (!cancelled) setState(result)
			})
			.catch(() => {
				if (!cancelled) setState((previous) => ({ ...previous, status: 'error' }))
			})

		return () => {
			cancelled = true
			controller.abort()
			read.close()
		}
	}, [relays, relaysKey])

	return state
}
/**
 * One auction read shared by every block on the page (ADR-0028).
 *
 * The magazine home puts four auction-backed blocks on one page — ticker,
 * cover, closing soon, featured — and each opening its own subscription would
 * read the same relays four times. They subscribe to one shared read instead.
 * The read starts with the first subscriber and closes a few seconds after the
 * last one leaves; the last result is kept so a remount (or the editor
 * re-rendering a block) starts from what was already read.
 */
type SharedRead = {
	state: AuctionListReadState
	listeners: Set<() => void>
	stop: (() => void) | null
	idleTimer: ReturnType<typeof setTimeout> | null
	startedAt: number
}

const shared: SharedRead = { state: EMPTY_STATE, listeners: new Set(), stop: null, idleTimer: null, startedAt: 0 }

/** A settled read older than this is read again on the next mount. */
const SHARED_READ_TTL_MS = 60_000

function publish(next: AuctionListReadState) {
	shared.state = next
	for (const listener of shared.listeners) listener()
}

function startSharedRead() {
	const controller = new AbortController()
	let cancelled = false
	const read = createWebArenaAuctionRead({
		relays: [...webRelayPolicy('query')],
		store: getReadContext().store as unknown as EventStorePort<Event>,
	})
	shared.startedAt = Date.now()
	void collectAuctionListRead(read, {
		signal: controller.signal,
		onProgress: (progress) => {
			// Keep showing the previous result until the new read has something.
			if (!cancelled && (progress.snapshot?.auctions.length ?? 0) > 0) publish(progress)
		},
	})
		.then((result) => {
			if (!cancelled) publish(result)
		})
		.catch(() => {
			if (!cancelled) publish({ ...shared.state, status: 'error' })
		})
	shared.stop = () => {
		cancelled = true
		controller.abort()
		read.close()
	}
}

function subscribeShared(listener: () => void): () => void {
	shared.listeners.add(listener)
	if (shared.idleTimer) {
		clearTimeout(shared.idleTimer)
		shared.idleTimer = null
	}
	const stale = Date.now() - shared.startedAt > SHARED_READ_TTL_MS
	if (!shared.stop || (stale && shared.state.status !== 'loading')) {
		shared.stop?.()
		startSharedRead()
	}
	return () => {
		shared.listeners.delete(listener)
		if (shared.listeners.size === 0 && !shared.idleTimer) {
			shared.idleTimer = setTimeout(() => {
				shared.idleTimer = null
				if (shared.listeners.size > 0) return
				shared.stop?.()
				shared.stop = null
			}, 5_000)
		}
	}
}

export function useSharedAuctionListRead(): AuctionListReadState {
	return useSyncExternalStore(
		subscribeShared,
		() => shared.state,
		() => EMPTY_STATE,
	)
}

/** A clock that ticks once a second, for the countdowns. */
export function useNowSeconds(): number {
	const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
	useEffect(() => {
		const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000)
		return () => clearInterval(timer)
	}, [])
	return now
}
