/**
 * `BidderPositionsHost.tsx` — the bidder dashboard's own bids, read from the
 * arena 1440 series.
 *
 * ## What survived, and what was removed on purpose
 *
 * This page used to carry the 30408 bid pipeline's reclaim / collateral
 * machinery: the cashu `PendingToken` book, the local orphaned-lock ledger, the
 * `getAuctionReclaimReadyAt` gate, the reclaim button and the wallet-refresh
 * control. Under the consolidated protocol a refund is automatic off the
 * bidder's committed template — there is no pull/release path and no collateral
 * to reclaim from a button — so all of it is gone from the page. What is left is
 * what the arena read can actually support:
 *
 * - **which lots you bid on** — a lot with at least one 1441 from you;
 * - **your derived position**, when the read carries one (`positions[you]`,
 *   summed from bid deltas). When a bid of yours carried no readable amount the
 *   read has no position for you, and the page says *not stated* rather than
 *   printing a zero;
 * - **each lot's state** — its phase (open / ended / no stated end) and the
 *   relay-reported verdict, if any.
 *
 * Nothing here asserts an outcome: the 1445 verdict names the winner, the mint
 * decides whether money moved, and neither is inferred from a bid sum.
 */

import type { ArenaAuctionSnapshot, ArenaAuctionView } from '@platform/web/auctions/relay/arenaAuctionRead'
import { auctionEndsAt, auctionPhase } from '@platform/web/auctions/relay/auctionSurfacesRead'
import { sellerAuctionHref } from '@platform/web/dashboard/sellerAuctionHref'
import { StatusBadge } from '@ui/shared/status-badge'
import {
	phaseLabel,
	phaseTone,
	satsLabel,
	shortKey,
	type ArenaAuctionPhase,
	type ArenaRelayHealth,
	type ArenaSurfaceStatus,
} from '@ui/auction/arena/model'

/** One lot the bidder bid on, as this page renders it. */
export interface BidderLotModel {
	/** `1440:<seller>:<d>`. */
	coordinate: string
	d: string
	seller: string
	title: string | null
	phase: ArenaAuctionPhase
	/** `root.created_at + durationSec`, or `null` when the create stated no end. */
	endsAt: number | null
	/** Your derived position (summed deltas), or `null` when the read carries none. */
	yourPosition: number | null
	/** How many 1441s from you this lot carries. */
	yourBidCount: number
	/** Bids on this lot whose amount was unreadable — the positions are then partial. */
	bidsWithoutAmount: number
	/** The highest-anchored relay-reported verdict outcome, or `null`. */
	verdict: string | null
	/** The best derived position overall, or `null`. */
	topBidTotal: number | null
}

/**
 * The lots in the snapshot that carry at least one bid from `bidder`, in the
 * read's own order (newest `created_at` first). Pure: no React, no relay.
 */
export function selectBidderLots(snapshot: ArenaAuctionSnapshot | null, bidder: string, now: number): BidderLotModel[] {
	const views = snapshot?.auctions ?? []
	return views
		.filter((view: ArenaAuctionView) => view.bids.some((bid) => bid.bidder === bidder))
		.map((view) => ({
			coordinate: view.coordinate,
			d: view.d,
			seller: view.seller,
			title: view.content.title,
			phase: auctionPhase(view, now),
			endsAt: auctionEndsAt(view),
			yourPosition: view.positions[bidder] ?? null,
			yourBidCount: view.bids.filter((bid) => bid.bidder === bidder).length,
			bidsWithoutAmount: view.bidsWithoutAmount,
			verdict: view.verdicts[0]?.outcome ?? null,
			topBidTotal: view.topBid?.total ?? null,
		}))
}

export interface BidderListMessage {
	title: string
	detail: string
}

/** What the bids page says when it has no lot to show — one sentence per state. */
export function bidderLotsEmptyMessage(status: ArenaSurfaceStatus): BidderListMessage {
	switch (status) {
		case 'loading':
			return {
				title: 'Reading your bids from relays…',
				detail: 'Nothing has arrived yet. An empty list here means the read has not finished, not that you have no bids.',
			}
		case 'incomplete':
			return {
				title: 'The read stopped before every relay answered.',
				detail: 'Anything listed here is what arrived, not the whole picture.',
			}
		case 'no-relays':
			return {
				title: 'No relay answered, so your bids could not be read.',
				detail: 'This is not the same as you having no bids.',
			}
		case 'error':
			return {
				title: 'Your bids could not be read right now.',
				detail: 'The read failed rather than answering. Retrying is the only honest next step.',
			}
		case 'settled':
			return {
				title: 'You have no bids.',
				detail: 'Every relay answered and none of the lots it carried have a bid from you.',
			}
	}
}

export interface BidderPositionsHostProps {
	/** The read's snapshot, or `null` while nothing has been projected yet. */
	snapshot: ArenaAuctionSnapshot | null
	status: ArenaSurfaceStatus
	relayHealth: ArenaRelayHealth
	/** Unix seconds, supplied by the route so the projection is deterministic. */
	now: number
	/** The signed-in bidder. */
	bidder: string
}

/** One row: the lot, your derived position, and the lot's state. */
function BidderLotRow({ lot, status, now }: { lot: BidderLotModel; status: ArenaSurfaceStatus; now: number }) {
	const label = lot.title?.trim() || lot.d
	const soFar = status === 'settled' ? '' : ' so far'
	// A position the read did not carry is stated as such, never as a zero.
	const positionValue = lot.yourPosition === null ? 'not stated' : satsLabel(lot.yourPosition)
	const positionHelper =
		lot.yourPosition === null
			? lot.bidsWithoutAmount > 0
				? 'Your bid carried no readable amount, so the read holds no position for you.'
				: 'The read did not deliver a readable amount for your bid.'
			: 'Derived from your bid deltas — not an outcome.'

	return (
		<li
			data-slot="bidder-lot-row"
			data-coordinate={lot.coordinate}
			data-phase={lot.phase}
			className="rounded-lg border border-border-default bg-surface-raised p-4"
		>
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0">
					<a href={sellerAuctionHref(lot.d, lot.seller)} className="text-sm font-semibold text-text-high hover:underline">
						{label}
					</a>
					<p className="mt-0.5 text-xs text-text-mid">
						by {shortKey(lot.seller)} · {lot.d}
					</p>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<StatusBadge status={phaseLabel(lot.phase)} tone={phaseTone(lot.phase)} />
					{lot.verdict !== null && <StatusBadge status={lot.verdict} tone="neutral" />}
				</div>
			</div>

			<dl className="mt-3 grid grid-cols-2 gap-3 text-xs">
				<div>
					<dt className="text-text-mid">Your position</dt>
					<dd className="font-medium text-text-high">{positionValue}</dd>
					<p className="mt-0.5 text-[11px] text-text-mid">{positionHelper}</p>
				</div>
				<div>
					<dt className="text-text-mid">Your bids</dt>
					<dd className="font-medium text-text-high">
						{lot.yourBidCount} {lot.yourBidCount === 1 ? 'bid' : 'bids'}
						{soFar}
					</dd>
					<p className="mt-0.5 text-[11px] text-text-mid">
						{lot.endsAt !== null ? `ends ${new Date(lot.endsAt * 1000).toLocaleString()}` : 'end time not stated'}
						{lot.endsAt !== null && now >= lot.endsAt ? ' · ended' : ''}
					</p>
				</div>
			</dl>
		</li>
	)
}

/**
 * The bidder's lots: one row per lot you bid on. Controlled on purpose — the
 * read state is a prop, so a test renders every state with literals.
 */
export function BidderPositionsHost({ snapshot, status, relayHealth, now, bidder }: BidderPositionsHostProps) {
	const lots = selectBidderLots(snapshot, bidder, now)
	const empty = bidderLotsEmptyMessage(status)
	const partialNotice = status === 'settled' ? null : empty.detail

	if (lots.length > 0) {
		return (
			<div className="flex flex-col gap-4">
				{partialNotice !== null && (
					<p
						data-slot="bidder-lots-notice"
						data-state={status}
						role="status"
						className="rounded-md border border-dashed border-border-default bg-surface-sunken px-4 py-3 text-sm text-text-mid"
					>
						{partialNotice}
					</p>
				)}
				<ul className="flex flex-col gap-4">
					{lots.map((lot) => (
						<BidderLotRow key={lot.coordinate} lot={lot} status={status} now={now} />
					))}
				</ul>
			</div>
		)
	}

	return (
		<div
			data-slot="bidder-lots-empty"
			data-state={status}
			role="status"
			className="flex min-h-[40vh] flex-col items-center justify-center gap-2 py-16 text-center"
		>
			<h2 className="text-xl font-semibold">{empty.title}</h2>
			<p className="text-text-mid">{empty.detail}</p>
			{relayHealth.total > 0 && (
				<p className="text-xs text-text-mid opacity-80">
					{relayHealth.answered} of {relayHealth.total} relays answered
				</p>
			)}
		</div>
	)
}
