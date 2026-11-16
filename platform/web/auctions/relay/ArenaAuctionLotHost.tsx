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
 * - **Not found is said only from a settled read.** {@link ArenaAuctionDetail}
 *   renders the correct sentence for whatever `status` it is handed
 *   (`auction-card.tsx:58-86`), so this host passes the read's real status
 *   through and never upgrades a partial read to "no such auction".
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
import { createWebArenaAuctionRead, type ArenaAuctionView } from '@platform/web/auctions/relay/arenaAuctionRead'
import {
	collectArenaSurfacesRead,
	toAuctionDetailModel,
	toVerdictPanelModel,
	type ArenaSurfacesReadState,
} from '@platform/web/auctions/relay/auctionSurfacesRead'
import { ArenaAuctionDetail } from '@ui/auction/arena/auction-detail'
import { ArenaVerdictPanel } from '@ui/auction/arena/verdict-panel'
import { shortKey, type ArenaRelayHealth, type ArenaSurfaceStatus } from '@ui/auction/arena/model'
import { AuctionBidHost } from '@platform/web/auctions/relay/AuctionBidHost'
import { UserCardHost } from '@platform/web/profiles/userCardHosts'
import { lotHref, resolveArenaLot, type ArenaLotLookup } from '@platform/web/auctions/relay/arenaLotRead'

/** Before the first relay result arrives: not "no auction", just "not read yet". */
const EMPTY_READ: ArenaSurfacesReadState = {
	snapshot: null,
	status: 'loading',
	relayHealth: { answered: 0, total: 0 },
}

/**
 * The surfaces read, reopenable by `refreshKey`.
 *
 * A near-twin of `useArenaSurfacesRead` (`auctionSurfacesRead.ts:306-342`) with
 * one extra dependency: the key. The read logic is **not** duplicated — both
 * shells call the same {@link collectArenaSurfacesRead} over the same
 * `createWebArenaAuctionRead`; only the reopen trigger is added. A route that
 * could not bump a key could watch a just-published bid never appear, because
 * the read it closed after settling would never look again.
 */
export function useArenaLotRead(refreshKey: number): ArenaSurfacesReadState {
	const [state, setState] = useState<ArenaSurfacesReadState>(EMPTY_READ)

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
		// `relays` is memoized (stable); `relaysKey` re-subscribes if the set
		// itself changes; `refreshKey` is the deliberate reopen.
	}, [relays, relaysKey, refreshKey])

	return state
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
}

/**
 * The lot page: resolve, project, render.
 *
 * When the lot is ambiguous it renders the candidates and nothing else — no
 * detail model is built, because building one would mean choosing a seller.
 */
export function ArenaAuctionLotHost({ d, seller, now, read, onPublished }: ArenaAuctionLotHostProps) {
	const lookup: ArenaLotLookup = read.snapshot === null ? { kind: 'missing' } : resolveArenaLot(read.snapshot, d, seller)

	if (lookup.kind === 'ambiguous') {
		return <ArenaLotAmbiguous candidates={lookup.candidates} status={read.status} relayHealth={read.relayHealth} />
	}

	const view = lookup.kind === 'found' ? lookup.view : null
	// `now` is projection input, so it is read once here and handed to every
	// projection and to the panel below — one instant, one page.
	const context = { now, status: read.status, divergences: read.snapshot?.verdictDivergence }
	const detail = view === null ? null : toAuctionDetailModel(view, context)
	const verdicts = view === null ? null : toVerdictPanelModel(view, context)

	return (
		<div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6">
			<ArenaAuctionDetail
				model={detail}
				status={read.status}
				relayHealth={read.relayHealth}
				backHref="/auctions"
				sellerIdentity={view === null ? undefined : <UserCardHost pubkey={view.seller} />}
				bidPanel={
					detail === null ? null : (
						<AuctionBidHost model={detail} readStatus={read.status} now={now} onPublished={onPublished} />
					)
				}
			/>
			{verdicts !== null && (
				<ArenaVerdictPanel
					model={verdicts}
					status={read.status}
					relayHealth={read.relayHealth}
					renderValidator={(pubkey) => (pubkey === null ? null : <UserCardHost pubkey={pubkey} />)}
				/>
			)}
		</div>
	)
}

/**
 * The ambiguity surface: the honest answer to a `d` that more than one seller
 * published. It names every candidate and links each to its own seller-scoped
 * address, so the reader disambiguates; the page does not.
 */
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
		<div
			data-slot="arena-lot-ambiguous"
			data-state={status}
			className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6"
		>
			<h1 className="font-header text-2xl font-semibold text-text-high">More than one auction has this id</h1>
			<p className="text-sm text-text-mid">
				An auction id is unique only within its seller, and {candidates.length} sellers published this one. Pick the
				lot you meant — the page will not guess which.
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
