/**
 * `ArenaAuctionLotHost.tsx` — the platform binding for the `/auctions/<d>`
 * detail experience.
 *
 * It does three things the pure `ui/auction/arena/*` surfaces may not:
 *
 * 1. **Reads the relays.** {@link useArenaLotRead} consumes the verified arena
 *    read (`auctionSurfacesRead.ts` → `arenaAuctionRead.ts`) to its caught-up
 *    marker. It is a one-shot subscription that can be **reopened** by a key,
 *    which is the whole mechanism by which a bid the app presumed published
 *    becomes one the read has actually **seen** — a relay must serve it, never
 *    the app's own optimism (`AuctionBidHost.tsx:51-57`).
 * 2. **Projects** one canonical `ArenaAuctionView` into the plain read-models
 *    the surfaces render (`toAuctionDetailModel`, `toVerdictPanelModel`) and
 *    resolves the route's `d` to a lot (`arenaLotRead.ts`).
 * 3. **Injects the hosts** the `ui/` views require as props: the real bid panel
 *    (`AuctionBidHost`) into the detail's `bidPanel` slot, and the seller /
 *    validator identity nodes.
 *
 * The view layer never sees a relay, an event or a promise
 * (`ui/AGENTS.md:18-28`, `ui/AGENTS.md:120`). This file is the assembler.
 *
 * ## What it refuses to say
 *
 * - **Not found is said only from a settled read.** {@link CatalogueDetailView}
 *   renders the correct sentence for whatever `status` it is handed, so this host
 *   passes the read's real status through and never upgrades a partial read to
 *   "no such auction".
 * - **A bare `d` with several sellers is ambiguous, not guessed**
 *   (`arenaLotRead.ts`): the host lists the candidates and renders no lot.
 * - **The verdict panel infers no winner.** The host builds its model from
 *   `toVerdictPanelModel` and never reads a quorum — that rule is the panel's
 *   (`verdict-panel.tsx:23-41`), and there is no quorum to apply.
 */

import { useEffect, useMemo, useState } from 'react'
import type { EventStorePort } from '@sdk/core'
import type { Event } from '@sdk/core/nostr-io'
import { getReadContext } from '@platform/web/readContext'
import { webRelayPolicy } from '@platform/web/sdkNostrIo'
import {
	arenaLotFilters,
	arenaLotFollowUpFilters,
	createWebArenaAuctionRead,
	type ArenaAuctionView,
} from '@platform/web/auctions/relay/arenaAuctionRead'
import {
	collectArenaSurfacesRead,
	toAuctionDetailModel,
	toVerdictPanelModel,
	type ArenaSurfacesReadState,
} from '@platform/web/auctions/relay/auctionSurfacesRead'
import { ArenaVerdictPanel } from '@ui/auction/arena/verdict-panel'
import { ArenaLotView } from '@ui/auctions/arena-lot/arena-lot-view'
import { getNormalizedProfileDisplayName, useProfile } from '@platform/web/profiles/profileQuery'
import { chainClockLabel, shortKey, type ArenaRelayHealth, type ArenaSurfaceStatus } from '@ui/auction/arena/model'
import { useAuctionBidController } from '@platform/web/auctions/relay/AuctionBidHost'
import { arenaChainAdvancing } from '@platform/web/auctions/relay/arenaBidPublish'
import { UserCardHost } from '@platform/web/profiles/userCardHosts'
import { AuctionFulfilmentHost } from '@platform/web/dashboard/AuctionFulfilmentHost'
import { lotHref, resolveArenaLot, type ArenaLotLookup } from '@platform/web/auctions/relay/arenaLotRead'

/** Before the first relay result arrives: not "no auction", just "not read yet". */
const EMPTY_READ: ArenaSurfacesReadState = {
	snapshot: null,
	status: 'loading',
	relayHealth: { answered: 0, total: 0 },
	chainClock: null,
}

/**
 * The lot read, reopenable by `refreshKey`.
 *
 * A near-twin of `useArenaSurfacesRead` (`auctionSurfacesRead.ts:306-342`) with
 * two differences: the key, and **lot-scoped filters**. The read logic is **not**
 * duplicated — both shells call the same {@link collectArenaSurfacesRead} over
 * the same `createWebArenaAuctionRead`; the lot detail asks for one lot
 * (`arenaLotFilters`) instead of subscribing to the whole-arena firehose, which
 * is the subscription the app relay is slow to answer. A route that could not
 * bump a key could watch a just-published bid never appear, because the read it
 * closed after settling would never look again.
 */
export function useArenaLotRead(init: ArenaLotReadInit): ArenaSurfacesReadState {
	const { d, seller, refreshKey } = init
	const [state, setState] = useState<ArenaSurfacesReadState>(EMPTY_READ)

	const relays = useMemo(() => [...webRelayPolicy('query')], [])
	const relaysKey = relays.join('|')

	useEffect(() => {
		const controller = new AbortController()
		let cancelled = false

		const read = createWebArenaAuctionRead({
			relays,
			store: getReadContext().store as unknown as EventStorePort<Event>,
			// `d === null` is the whole-arena read the auctions index needs (its list
			// and its featured lot); a lot page names its lot and asks for that one.
			filters: d === null ? undefined : arenaLotFilters(seller, d),
			// A bid's `a` value is 106 chars (…:uuid), which the relay's index
			// refuses, so its bids are only findable by the bid's `e` = the create's
			// event id — knowable only after the create arrives. The base REQ keeps
			// `#a` for relays that index it; this second REQ adds `#e`. The
			// whole-arena read already asks for every bid kind, so it has no
			// follow-up to add. The create-admissions its gate reads are not a
			// follow-up either: the read asks for the missing ones when it has
			// reported (`ArenaAuctionRead.missingCreateAdmissions`).
			followUpFilters: d === null ? undefined : arenaLotFollowUpFilters(seller, d),
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
		// `relays` is memoized (stable); `relaysKey` re-subscribes if the set
		// itself changes; `refreshKey` is the deliberate reopen; the lot identity
		// decides which filters are asked for.
	}, [relays, relaysKey, refreshKey, d, seller])

	return state
}

export interface ArenaLotReadInit {
	/** The route param: the auction's `d` tag, or `null` for the whole-arena read (the index). */
	d: string | null
	/** The `?seller=` disambiguator, or `null` for the bare `d` address. */
	seller: string | null
	/** Bumped to reopen the read: a published bid, or the page's retry. */
	refreshKey: number
}

export interface ArenaAuctionLotHostProps {
	/** The route param: the auction's `d` tag. */
	d: string
	/** The `?seller=` disambiguator, or `null` for the bare `d` address. */
	seller: string | null
	/** Unix seconds; the route's one ticking clock, shared with the bid panel. */
	now: number
	/** The read state, from {@link useArenaLotRead}. */
	read: ArenaSurfacesReadState
	/** Called after a bid reached a relay, so the route can reopen the read. */
	onPublished: (eventId: string) => void
/** The "All lots" link; `null` hides it (the index features a lot on its own page). */
	backHref?: string | null
	/**
	 * Reopen the read on demand. The bid panel polls this while the chain has not
	 * settled a published bid, so a chain that advances later resolves the panel
	 * instead of leaving a stale freshness window as a claim about the chain.
	 */
	onRefresh: () => void
}

/**
 * The lot page: resolve, project, render.
 *
 * When the lot is ambiguous it renders the candidates and nothing else — no
 * detail model is built, because building one would mean choosing a seller.
 */
export function ArenaAuctionLotHost({ d, seller, now, read, onPublished, backHref = '/auctions', onRefresh }: ArenaAuctionLotHostProps) {
	const lookup: ArenaLotLookup = read.snapshot === null ? { kind: 'missing' } : resolveArenaLot(read.snapshot, d, seller)

	const view = lookup.kind === 'found' ? lookup.view : null
	// `now` is projection input, so it is read once here and handed to every
	// projection and to the panel below — one instant, one page.
	//
	// The projections are memoized on the facts they derive from, and the detail
	// model's **identity** is part of the bid panel's contract: the panel's state
	// machine runs in an effect keyed on the model (`AuctionBidHost.tsx`), so an
	// object rebuilt on every render re-runs that effect on every render. That is
	// only harmless while the state machine hands back the same object for a
	// state that did not change — which it now does — but a stable model keeps
	// the effect from running at all for a render that moved nothing. `view` is
	// the snapshot's own object and the divergences belong to the snapshot, so
	// these keys change only when the read or the clock really moved.
	const divergences = read.snapshot?.verdictDivergence
	const context = useMemo(() => ({ now, status: read.status, divergences }), [now, read.status, divergences])
	const detail = useMemo(() => (view === null ? null : toAuctionDetailModel(view, context)), [view, context])
	const verdicts = useMemo(() => (view === null ? null : toVerdictPanelModel(view, context)), [view, context])
	// Whether the chain is advancing — fresh kind-1447 commitments across several
	// blocks — is the signal the bid panel needs to tell "the chain did not accept
	// the bid" from "the chain has not settled it". It is derived here, from the
	// commitments the read already holds, and passed down; the panel never reads a
	// relay itself. `onRefresh` is the same reopen the publish path uses: the panel
	// polls it while the chain has not settled a bid, because a one-shot read's
	// freshness decays by itself (`AuctionBidHost.tsx`, the poll timer).
	const chainAdvancing =
		read.snapshot === null
			? null
			: arenaChainAdvancing({
					heights: read.snapshot.stateCommitments.map((commitment) => commitment.height),
					newestTime: read.snapshot.highestCommitment?.time ?? null,
					now,
				})

	// Called before any early return: hooks run in the same order on every render.
	const bid = useAuctionBidController({ model: detail, readStatus: read.status, now, chainAdvancing, onPublished, onRefresh })

	if (lookup.kind === 'ambiguous') {
		return <ArenaLotAmbiguous candidates={lookup.candidates} status={read.status} relayHealth={read.relayHealth} />
	}

	return (
		<>
			<ArenaLotView
				model={detail}
				status={read.status}
				relayHealth={read.relayHealth}
				now={now}
				backHref={backHref}
				chainClockLabel={read.chainClock === null ? null : chainClockLabel(read.chainClock)}
				sellerIdentity={view === null ? undefined : <UserCardHost pubkey={view.seller} subtitle="npub" />}
				renderName={(pubkey) => <BidderName pubkey={pubkey} />}
				bid={detail === null ? null : bid}
				verdicts={
					verdicts === null ? null : (
						<ArenaVerdictPanel
							model={verdicts}
							status={read.status}
							relayHealth={read.relayHealth}
							renderValidator={(pubkey) => (pubkey === null ? null : <UserCardHost pubkey={pubkey} />)}
						/>
					)
				}
			/>
			<AuctionFulfilmentHost view={view} />
		</>
	)
}

/** A bidder's display name from their profile, or the short key while none is read. */
function BidderName({ pubkey }: { pubkey: string }) {
	const { data } = useProfile(pubkey)
	const name = getNormalizedProfileDisplayName(data?.profile)
	return <>{name && name.trim() !== '' ? name : shortKey(pubkey)}</>
}

function ArenaLotAmbiguous({
	candidates,
	status,
	relayHealth,
}: {
	candidates: ArenaAuctionView[]
	status: ArenaSurfaceStatus
	relayHealth: ArenaRelayHealth
}) {
	return (
		<div data-slot="arena-lot-ambiguous" data-state={status} className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6">
			<h1 className="font-header text-2xl font-semibold text-text-high">More than one auction has this id</h1>
			<p className="text-sm text-text-mid">
				An auction id is unique only within its seller, and {candidates.length} sellers published this one. Pick the lot you meant — the
				page will not guess which.
			</p>
			<ul className="space-y-2">
				{candidates.map((candidate) => (
					<li
						key={candidate.coordinate}
						className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border-default bg-surface-raised px-3 py-2"
					>
						<span className="flex flex-wrap items-center gap-2">
							<UserCardHost pubkey={candidate.seller} />
							<span className="font-mono text-xs text-text-mid">{shortKey(candidate.seller)}</span>
						</span>
						<a href={lotHref(candidate.d, candidate.seller)} className="text-xs font-medium text-text-high hover:underline">
							Open this lot →
						</a>
					</li>
				))}
			</ul>
			{relayHealth.total > 0 && (
				<p className="text-[11px] text-text-mid opacity-80">
					{relayHealth.answered} of {relayHealth.total} relays answered
					{status === 'settled' ? '.' : ' so far — a slow relay could still add another seller.'}
				</p>
			)}
		</div>
	)
}
