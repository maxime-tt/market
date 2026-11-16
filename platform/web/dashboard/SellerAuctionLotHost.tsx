/**
 * `SellerAuctionLotHost.tsx` — the dashboard's per-lot page: one 1440 lot,
 * resolved and rendered **read-only**.
 *
 * ## Why the money side is read-only, and what that means here
 *
 * Under the consolidated protocol the seller no longer publishes a settlement
 * from a button on this page: the settler pushes settlement and refunds are
 * automatic off the bidder's committed template (`MERGED-PROTOCOL-SPEC.md`).
 * The retired 30408 pipeline this route used to drive — manual settlement
 * publishing, the kind-1025 path-release gate, the cashu reclaim flow — has no
 * analogue, so the page renders the lot's state and the validators' verdicts and
 * offers **no money action**. A button for an action that no longer exists would
 * be a lie, so there is none.
 *
 * Fulfilment is not money: the winner's shipping claim (keyed on the winning
 * 1445 verdict, not a settlement) is offered by `AuctionFulfilmentHost`, and the
 * seller reads the delivered address there.
 *
 * It resolves the `d` **the same way the public detail route does**
 * (`resolveArenaLot`, `arenaLotRead.ts`): a bare `d` is ambiguous across sellers
 * and is answered by naming the candidates, never by guessing; "not found" is
 * said only from a `settled` read. The projection is the same
 * (`toAuctionDetailModel`, `toVerdictPanelModel`) and the surfaces are the same
 * `ui/auction/arena/*` views — only the `bidPanel` slot is left empty, because
 * bidding is not a dashboard action.
 */

import type { ArenaAuctionView } from '@platform/web/auctions/relay/arenaAuctionRead'
import {
	toAuctionDetailModel,
	toVerdictPanelModel,
	type ArenaSurfacesReadState,
} from '@platform/web/auctions/relay/auctionSurfacesRead'
import { resolveArenaLot, type ArenaLotLookup } from '@platform/web/auctions/relay/arenaLotRead'
import { ArenaAuctionDetail } from '@ui/auction/arena/auction-detail'
import { ArenaVerdictPanel } from '@ui/auction/arena/verdict-panel'
import { shortKey, type ArenaRelayHealth, type ArenaSurfaceStatus } from '@ui/auction/arena/model'
import { UserCardHost } from '@platform/web/profiles/userCardHosts'
import { AuctionFulfilmentHost } from '@platform/web/dashboard/AuctionFulfilmentHost'
import { sellerAuctionHref } from '@platform/web/dashboard/sellerAuctionHref'

export interface SellerAuctionLotHostProps {
	/** The route param: the auction's `d` tag. */
	d: string
	/** The `?seller=` disambiguator, or `null` for the bare `d` address. */
	seller: string | null
	/** Unix seconds; the route's one ticking clock, shared with the projection. */
	now: number
	/** The read state, from `useArenaSurfacesRead` / `useArenaLotRead`. */
	read: ArenaSurfacesReadState
}

/**
 * The lot page: resolve, project, render — no bid panel, no management action.
 *
 * When the lot is ambiguous it renders the candidates and nothing else — no
 * detail model is built, because building one would mean choosing a seller.
 */
export function SellerAuctionLotHost({ d, seller, now, read }: SellerAuctionLotHostProps) {
	const lookup: ArenaLotLookup = read.snapshot === null ? { kind: 'missing' } : resolveArenaLot(read.snapshot, d, seller)

	if (lookup.kind === 'ambiguous') {
		return <SellerLotAmbiguous candidates={lookup.candidates} status={read.status} relayHealth={read.relayHealth} />
	}

	const view = lookup.kind === 'found' ? lookup.view : null
	// `now` is projection input, read once here and handed to every projection —
	// one instant, one page.
	const context = { now, status: read.status, divergences: read.snapshot?.verdictDivergence }
	const detail = view === null ? null : toAuctionDetailModel(view, context)
	const verdicts = view === null ? null : toVerdictPanelModel(view, context)

	return (
		<div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6">
			{/* No `bidPanel`: this page is read-only by design. */}
			<ArenaAuctionDetail
				model={detail}
				status={read.status}
				relayHealth={read.relayHealth}
				backHref="/dashboard/products/auctions"
				sellerIdentity={view === null ? undefined : <UserCardHost pubkey={view.seller} />}
			/>
			{verdicts !== null && (
				<ArenaVerdictPanel
					model={verdicts}
					status={read.status}
					relayHealth={read.relayHealth}
					renderValidator={(pubkey) => (pubkey === null ? null : <UserCardHost pubkey={pubkey} />)}
				/>
			)}
			{/* Fulfilment, not money: the winner's shipping claim and the seller's
			    view of it. Everything money-related stays read-only above. */}
			<AuctionFulfilmentHost view={view} />
		</div>
	)
}

/**
 * The ambiguity surface: the honest answer to a `d` that more than one seller
 * published. It names every candidate and links each to its own seller-scoped
 * dashboard address, so the reader disambiguates; the page does not.
 */
function SellerLotAmbiguous({
	candidates,
	status,
	relayHealth,
}: {
	candidates: ArenaAuctionView[]
	status: ArenaSurfaceStatus
	relayHealth: ArenaRelayHealth
}) {
	return (
		<div data-slot="seller-lot-ambiguous" data-state={status} className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6">
			<h1 className="font-header text-2xl font-semibold text-text-high">More than one auction has this id</h1>
			<p className="text-sm text-text-mid">
				An auction id is unique only within its seller, and {candidates.length} sellers published this one. Pick the lot you
				meant — the page will not guess which.
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
						<a href={sellerAuctionHref(candidate.d, candidate.seller)} className="text-xs font-medium text-text-high hover:underline">
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
