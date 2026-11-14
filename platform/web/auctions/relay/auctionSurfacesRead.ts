/**
 * `auctionSurfacesRead.ts` — the platform-side adapter that turns the verified
 * arena read into the plain read-models the 1440-series auction surfaces render
 * (`ui/auction/arena/`).
 *
 * ## Why this lives on the platform side
 *
 * `ui/AGENTS.md:18-28` forbids `ui/` importing `@platform/…`, `nostr-tools` or
 * `applesauce-*`, and `ui/AGENTS.md:120` forbids data fetching in `ui/`
 * outright. `ui/AGENTS.md:38-41` says a data adapter "is invoked by the
 * platform/assembler and passed down as props". This is that adapter, exactly as
 * `platform/web/storefront/auctionListRead.ts` is the block's.
 *
 * ## It adds no read logic
 *
 * Everything here is a **projection** of `ArenaAuctionView` — the shape
 * `arenaAuctionRead.ts` already produces, with relays, provenance, divergence
 * and health. This module does not open a subscription of its own, does not
 * re-parse an event, and does not re-derive a canonical version. It only decides
 * what a view may say.
 *
 * Two rules it enforces, both ported from the storefront adapter because they
 * are the same read:
 *
 * 1. **The live read, not `snapshot()`.** The read module records a measured
 *    trap (`arenaAuctionRead.ts:66-72`): on a bounded read the web transport
 *    turns a connection failure into an empty array, so a dead relay is
 *    indistinguishable from an empty one. "No auctions" and "no relay answered"
 *    are different sentences, so the collector consumes `events()` and keeps the
 *    live health.
 * 2. **`null` over `0`.** A create with no duration has no end; a bid with no
 *    readable amount contributes no position; a verdict nobody published is
 *    unknown. {@link toAuctionCardModel} carries those as `null` and the views
 *    say so.
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
	type ArenaVerdictDivergence,
} from '@platform/web/auctions/relay/arenaAuctionRead'
import { auctionListStatus, relayCounts } from '@platform/web/storefront/auctionListRead'
import type {
	ArenaAuctionBidModel,
	ArenaAuctionCardModel,
	ArenaAuctionDetailModel,
	ArenaAuctionPhase,
	ArenaRelayHealth,
	ArenaSurfaceStatus,
	ArenaVerdictPanelModel,
	ArenaVerdictRelayDivergence,
	ArenaVerdictRow,
} from '@ui/auction/arena/model'

// =========================================================================
// Read state
// =========================================================================

/**
 * The read's health as the one word the surfaces render.
 *
 * This is deliberately **the same function** the storefront block uses
 * (`auctionListStatus`), not a second copy of the rule: one read has one
 * honesty rule, and two implementations of it would eventually disagree.
 */
export function arenaSurfaceStatus(health: ArenaReadHealth): ArenaSurfaceStatus {
	return auctionListStatus(health)
}

/** Health → the two numbers a surface may state. */
export function arenaSurfaceRelayCounts(health: ArenaReadHealth): ArenaRelayHealth {
	return relayCounts(health)
}

// =========================================================================
// Projections
// =========================================================================

/** Where an auction's end time comes from, and why it can be `null`. */
export function auctionEndsAt(view: ArenaAuctionView): number | null {
	const duration = view.content.durationSeconds
	// A create with no duration has no end to state. `0` is treated the same: an
	// auction that lasts zero seconds is not a fact this adapter will assert.
	if (duration === null || duration <= 0) return null
	// The **root** create's `created_at`, not the canonical version's: a seller
	// editing the title moves the canonical timestamp, and an end time that
	// moves when a title changes is not an end time.
	return view.rootCreatedAt + duration
}

export function auctionPhase(view: ArenaAuctionView, now: number): ArenaAuctionPhase {
	const endsAt = auctionEndsAt(view)
	if (endsAt === null) return 'unknown'
	return now < endsAt ? 'open' : 'ended'
}

/**
 * The divergence record for one auction, if the read found one.
 *
 * `verdictDivergence[].auctionId` is the **raw** `auction_id` a verdict event
 * carried (the read groups by it before resolution), so it may be a full
 * `1440:<seller>:<d>` coordinate or a bare `d`. Both are matched; nothing else
 * is, because a fuzzy match is how a divergence gets attached to the wrong
 * auction.
 */
export function divergenceFor(view: ArenaAuctionView, divergences: readonly ArenaVerdictDivergence[]): ArenaVerdictRelayDivergence | null {
	const match = divergences.find((entry) => entry.auctionId === view.coordinate || entry.auctionId === view.d)
	if (match === undefined) return null
	const byRelay: Record<string, string[]> = {}
	for (const [relay, outcomes] of Object.entries(match.byRelay)) byRelay[relay] = [...outcomes].sort()
	return { auctionId: view.coordinate, byRelay }
}

/** Distinct validator keys among a set of verdicts; a verdict with no `p` tag counts as one key. */
function validatorKeys(verdicts: ArenaAuctionView['verdicts']): string[] {
	const keys = new Set<string>()
	for (const verdict of verdicts) keys.add(verdict.validatorPubkey ?? '')
	return [...keys]
}

/** The verdict outcomes a view carries, de-duplicated and sorted. */
function outcomesOf(verdicts: ArenaAuctionView['verdicts']): string[] {
	return [...new Set(verdicts.map((verdict) => verdict.outcome))].sort()
}

export interface ArenaSurfaceContext {
	/** Unix seconds, supplied by the caller so the projection stays pure. */
	now: number
	/** The read state, as `arenaSurfaceStatus` computed it. */
	status: ArenaSurfaceStatus
	/** The snapshot's divergence list — `snapshot.verdictDivergence`. */
	divergences?: readonly ArenaVerdictDivergence[]
}

/** One canonical auction → the card model. */
export function toAuctionCardModel(view: ArenaAuctionView, context: ArenaSurfaceContext): ArenaAuctionCardModel {
	const endsAt = auctionEndsAt(view)
	// `verdicts` arrives sorted by height descending (`arenaAuctionRead.ts:901`),
	// so the first entry is the highest-anchored verdict the read saw. Picking
	// any other would state an older state over a newer one.
	const verdict = view.verdicts[0]?.outcome ?? null
	const divergence = context.divergences ? divergenceFor(view, context.divergences) : null

	return {
		coordinate: view.coordinate,
		seller: view.seller,
		d: view.d,
		title: view.content.title,
		imageUrl: view.content.imageUrl,
		startingBid: view.content.startingBid,
		topBidTotal: view.topBid?.total ?? null,
		bidCount: view.bids.length,
		bidsWithoutAmount: view.bidsWithoutAmount,
		endsAt,
		phase: endsAt === null ? 'unknown' : context.now < endsAt ? 'open' : 'ended',
		verdict,
		verdictCount: view.verdicts.length,
		validatorCount: validatorKeys(view.verdicts).length,
		divergent: divergence !== null,
		relayCount: view.relays.length,
	}
}

/** One canonical auction → the detail model. */
export function toAuctionDetailModel(view: ArenaAuctionView, context: ArenaSurfaceContext): ArenaAuctionDetailModel {
	const bids: ArenaAuctionBidModel[] = view.bids.map((bid) => ({
		eventId: bid.eventId,
		bidder: bid.bidder,
		createdAt: bid.createdAt,
		amount: bid.amount,
		relays: [...bid.relays],
	}))
	const positions = Object.entries(view.positions)
		.map(([bidder, total]) => ({ bidder, total }))
		.sort((a, b) => b.total - a.total || a.bidder.localeCompare(b.bidder))

	return {
		...toAuctionCardModel(view, context),
		description: view.content.description,
		minIncrement: view.content.minIncrement,
		reserve: view.content.reserve,
		durationSeconds: view.content.durationSeconds,
		lateBidWindowSeconds: view.content.lateBidWindowSeconds,
		lateBidExtensionSeconds: view.content.lateBidExtensionSeconds,
		maxTotalExtensionSeconds: view.content.maxTotalExtensionSeconds,
		locktimeSeconds: view.content.locktimeSeconds,
		fundingMode: view.content.fundingMode,
		versions: view.versions,
		rootEventId: view.rootEventId,
		canonicalEventId: view.canonicalEventId,
		rootCreatedAt: view.rootCreatedAt,
		bids,
		positions,
	}
}

/**
 * One canonical auction → the verdict-panel model.
 *
 * Rows are kept **one per published verdict event**, in the read's own order
 * (height descending, then validator key). Nothing is merged per validator and
 * nothing is counted into a quorum, because there is no quorum rule to apply.
 */
export function toVerdictPanelModel(view: ArenaAuctionView, context: ArenaSurfaceContext): ArenaVerdictPanelModel {
	const rows: ArenaVerdictRow[] = view.verdicts.map((verdict) => ({
		validator: verdict.validatorPubkey,
		outcome: verdict.outcome,
		height: verdict.height,
		blockHash: verdict.blockHash,
		bidId: verdict.bidId,
		payoutTokenSha256: verdict.payoutTokenSha256,
		derivedFrom: verdict.derivedFrom,
	}))

	return {
		auctionId: view.coordinate,
		rows,
		validatorCount: validatorKeys(view.verdicts).length,
		outcomes: outcomesOf(view.verdicts),
		divergence: context.divergences ? divergenceFor(view, context.divergences) : null,
	}
}

/** The auction a coordinate names, or `null` when the read did not deliver it. */
export function findAuction(snapshot: ArenaAuctionSnapshot, coordinate: string): ArenaAuctionView | null {
	return snapshot.auctions.find((auction) => auction.coordinate === coordinate) ?? null
}

// =========================================================================
// The read
// =========================================================================

/** The read state a route composes its surfaces from; projection happens at render, with a fresh `now`. */
export interface ArenaSurfacesReadState {
	snapshot: ArenaAuctionSnapshot | null
	status: ArenaSurfaceStatus
	relayHealth: ArenaRelayHealth
}

const EMPTY_STATE: ArenaSurfacesReadState = {
	snapshot: null,
	status: 'loading',
	relayHealth: { answered: 0, total: 0 },
}

/**
 * Consume one live read to its caught-up marker.
 *
 * Ends the subscription: these are page surfaces, not a live feed, and the live
 * read is what keeps the dead-relay distinction that `snapshot()` loses. Never
 * throws for network reasons — a failed relay is health, not an error.
 */
export async function collectArenaSurfacesRead(
	read: ReturnType<typeof createWebArenaAuctionRead>,
	options: { signal?: AbortSignal; onProgress?: (state: ArenaSurfacesReadState) => void } = {},
): Promise<ArenaSurfacesReadState> {
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
				options.onProgress?.({ snapshot, status: 'loading', relayHealth: arenaSurfaceRelayCounts(snapshot.health) })
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
		status: arenaSurfaceStatus(snapshot.health),
		relayHealth: arenaSurfaceRelayCounts(snapshot.health),
	}
}

/**
 * The React seam for the routes.
 *
 * Relays are the app's own query relays (`webRelayPolicy('query')`), the store
 * is the shared read context's, and `now` is deliberately not a dependency: it
 * is projection input, not read input.
 */
export function useArenaSurfacesRead(): ArenaSurfacesReadState {
	const [state, setState] = useState<ArenaSurfacesReadState>(EMPTY_STATE)

	const relays = useMemo(() => [...webRelayPolicy('query')], [])
	const relaysKey = relays.join('|')

	useEffect(() => {
		const controller = new AbortController()
		let cancelled = false

		const read = createWebArenaAuctionRead({
			relays,
			store: getReadContext().store as unknown as EventStorePort<Event>,
		})

		void collectArenaSurfacesRead(read, {
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