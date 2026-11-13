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

import { useEffect, useMemo, useState } from 'react'
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
	source: 'mine' | 'picked'
	/** The page author, from the page event — never from the document. */
	seller: string
	/** Ordered `1440:<seller>:<d>` references, used when `source` is `picked`. */
	coordinates: readonly string[]
	limit: number
	/** Unix seconds. Supplied by the caller so the projection stays pure. */
	now: number
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
	const duration = view.content.durationSeconds
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
		startingBid: view.content.startingBid,
		topBidTotal: view.topBid?.total ?? null,
		bidCount: view.bids.length,
		endsAt,
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