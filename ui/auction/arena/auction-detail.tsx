import type { ReactNode, Ref } from 'react'
import { Media } from '../../shared/media'
import { StatusBadge } from '../../shared/status-badge'
import { cn } from '../../utils/cn'
import { AuctionDetailCard, AuctionTechnicalRow } from '../auction-detail-views'
import { readStateMessage } from './auction-card'
import {
	phaseLabel,
	phaseTone,
	shortKey,
	type ArenaAuctionDetailModel,
	type ArenaRelayHealth,
	type ArenaSurfaceStatus,
} from './model'

/**
 * The 1440-series auction **detail** view — one auction in full, read from
 * relays through `arenaAuctionRead`.
 *
 * Ported from the operator detail presentations in
 * `ui/auction/auction-detail-views.tsx` (`AuctionDetailCard`,
 * `AuctionTechnicalRow`) and the list card's frame. The data source is
 * different, so three things are stated rather than assumed:
 *
 * - **Terms are `not stated` when the create did not state them.** A missing
 *   `reserve` is not "no reserve" and a missing `duration_seconds` is not a
 *   zero-length auction; the create simply said nothing, and the card says
 *   exactly that.
 * - **Positions are derived, not decided.** The per-bidder totals come from
 *   summing bid *deltas*. They are labelled as a derived view: the 1445 verdict
 *   names a winner, and the mint decides whether money moved.
 * - **Bidding is a slot, not a form.** The detail view renders the host's bid
 *   panel through `bidPanel` and does not own a single bid rule: the entry
 *   surface, its validation and its publish state are
 *   `ui/auction/arena/bid-panel.tsx` + `bid-rules.ts`, mounted by
 *   `platform/web/auctions/relay/AuctionBidHost.tsx`. Passing the node in keeps
 *   this file a pure read-side presentation — and keeps a route that has no
 *   publish seam additive-only over the read half (no bid panel, no behaviour
 *   change). A detail view that passed `null` would be telling the bidder the
 *   auction has no way to be bid on, so the *slot* contract is: the route
 *   supplies the host, or it supplies nothing because bidding is out of scope
 *   for that route.
 */

export interface ArenaAuctionDetailProps {
	model: ArenaAuctionDetailModel | null
	status: ArenaSurfaceStatus
	relayHealth: ArenaRelayHealth
	/** Host-resolved link back to the list, or `null` to omit the affordance. */
	backHref?: string | null
	/** Host-owned seller identity node (avatar + display name). */
	sellerIdentity?: ReactNode
	/**
	 * The host's bid panel (`AuctionBidHost`), rendered between the terms and the
	 * bids. `null`/absent omits the slot entirely; nothing renders in its place
	 * — a placeholder here would imply bidding exists and is unavailable.
	 */
	bidPanel?: ReactNode
	className?: string
	ref?: Ref<HTMLDivElement>
}

/** A term the create may or may not have stated. `null` is never rendered as `0`. */
function term(value: number | null, unit: string): string {
	return value === null ? 'not stated' : `${value.toLocaleString()} ${unit}`
}

function TermCard({ label, value, helper }: { label: string; value: string; helper?: string }) {
	return <AuctionDetailCard label={label} value={value} helper={helper} />
}

function unavailableCopy(status: ArenaSurfaceStatus): string | null {
	if (status === 'settled') return null
	return readStateMessage(status)?.title ?? null
}

export function ArenaAuctionDetail({
	model,
	status,
	relayHealth,
	backHref = null,
	sellerIdentity,
	bidPanel = null,
	className,
	ref,
}: ArenaAuctionDetailProps) {
	if (model === null) {
		const message = readStateMessage(status)
		return (
			<div ref={ref} data-slot="arena-auction-detail" data-state={status} className={cn('space-y-4', className)}>
				{message && (
					<div role="status" className="rounded-xl border border-dashed border-border-default bg-surface-sunken p-6">
						<p className="text-sm font-medium text-text-high">{message.title}</p>
						<p className="mt-1 text-xs text-text-mid">{message.detail}</p>
						{relayHealth.total > 0 && (
							<p className="mt-2 text-[11px] text-text-mid opacity-80">
								{relayHealth.answered} of {relayHealth.total} relays answered
							</p>
						)}
					</div>
				)}
			</div>
		)
	}

	const label = model.title?.trim() || model.d
	const partial = unavailableCopy(status)
	const positions = [...model.positions].sort((a, b) => b.total - a.total || a.bidder.localeCompare(b.bidder))

	return (
		<div ref={ref} data-slot="arena-auction-detail" data-state={status} className={cn('space-y-6', className)}>
			<header className="space-y-2">
				{backHref !== null && (
					<a href={backHref} className="text-xs text-text-mid hover:underline">
						← All auctions
					</a>
				)}
				<div className="flex flex-wrap items-start justify-between gap-3">
					<h1 className="font-header text-2xl font-semibold text-text-high">{label}</h1>
					<div className="flex flex-wrap items-center gap-2">
						<StatusBadge status={phaseLabel(model.phase)} tone={phaseTone(model.phase)} />
						{model.divergent && <StatusBadge status="relays disagree" tone="warning" />}
					</div>
				</div>
				<p className="text-xs text-text-mid">
					{model.d}
					{model.endsAt !== null ? ` · ends ${new Date(model.endsAt * 1000).toLocaleString()}` : ' · end time not stated'}
				</p>
				{partial !== null && (
					// A detail view rendered from a read that has not finished says so
					// once, at the top, instead of qualifying every field.
					<p data-slot="arena-auction-detail-partial" className="rounded-lg bg-warning-muted px-3 py-2 text-xs text-warning-muted-foreground">
						{partial}
					</p>
				)}
			</header>

			<div className="grid gap-4 sm:grid-cols-2">
				<div className="overflow-hidden rounded-xl border border-border-default bg-surface-raised">
					<div className="aspect-video w-full bg-surface-sunken">
						{model.imageUrl ? (
							<Media src={model.imageUrl} alt={label} className="h-full w-full object-cover" />
						) : (
							<div className="flex h-full w-full items-center justify-center text-xs text-text-mid">No image</div>
						)}
					</div>
				</div>

				<div className="space-y-3">
					<AuctionDetailCard
						label="Seller"
						value={sellerIdentity ?? <span className="font-mono text-xs">{shortKey(model.seller)}</span>}
						helper={`coordinate ${model.coordinate}`}
					/>
					<AuctionDetailCard
						label="Current position"
						value={
							model.topBidTotal === null
								? model.bidsWithoutAmount > 0
									? 'total unknown'
									: 'no bids read'
								: `${model.topBidTotal.toLocaleString()} sats`
						}
						helper={
							model.bidsWithoutAmount > 0
								? `${model.bidsWithoutAmount} ${model.bidsWithoutAmount === 1 ? 'bid carries' : 'bids carry'} no readable amount, so this is a partial sum`
								: 'derived from bid deltas — not an outcome'
						}
					/>
					<AuctionDetailCard
						label="Outcome"
						value={model.verdict ?? 'unknown'}
						helper={
							model.verdict === null
								? 'No verdict has been read on the relays that answered. Unknown is not "no outcome".'
								: 'Relay-reported claim. The relay notifies, the chain decides.'
						}
					/>
				</div>
			</div>

			<section className="space-y-2">
				<h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-text-mid">Description</h2>
				<p className="whitespace-pre-wrap text-sm text-text-high">
					{model.description ?? <span className="text-text-mid">The create published no description.</span>}
				</p>
			</section>

			<section className="space-y-3">
				<h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-text-mid">Terms, as published</h2>
				<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
					<TermCard label="Starting bid" value={term(model.startingBid, 'sats')} />
					<TermCard label="Minimum increment" value={term(model.minIncrement, 'sats')} />
					<TermCard
						label="Reserve"
						value={model.reserve === null ? 'not stated' : term(model.reserve, 'sats')}
						helper={model.reserve === null ? 'An unstated reserve is not "no reserve".' : undefined}
					/>
					<TermCard
						label="Duration"
						value={term(model.durationSeconds, 'seconds')}
						helper={model.durationSeconds === null ? 'No duration, so there is no end to state.' : undefined}
					/>
					<TermCard label="Late-bid window" value={term(model.lateBidWindowSeconds, 'seconds')} />
					<TermCard label="Late-bid extension" value={term(model.lateBidExtensionSeconds, 'seconds')} />
					<TermCard label="Max total extension" value={term(model.maxTotalExtensionSeconds, 'seconds')} />
					<TermCard label="Locktime" value={term(model.locktimeSeconds, 'seconds')} />
					<TermCard label="Funding mode" value={model.fundingMode ?? 'not stated'} />
				</div>
			</section>

			{bidPanel !== null && <div data-slot="arena-auction-detail-bid">{bidPanel}</div>}

			<section className="space-y-3">
				<div className="flex items-baseline justify-between">
					<h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-text-mid">Bids</h2>
					<p className="text-[11px] text-text-mid">
						{model.bidCount} {model.bidCount === 1 ? 'bid' : 'bids'}
						{status !== 'settled' ? ' so far' : ''} · {model.versions} create {model.versions === 1 ? 'version' : 'versions'}
					</p>
				</div>

				{model.bids.length === 0 ? (
					<p className="rounded-lg border border-dashed border-border-default bg-surface-sunken p-3 text-xs text-text-mid">
						{status === 'settled'
							? 'No bids were read for this auction.'
							: 'No bids have been read yet — the read has not finished, so this is not "no bids".'}
					</p>
				) : (
					<>
						{model.bidsWithoutAmount > 0 && (
							<p className="rounded-lg bg-warning-muted px-3 py-2 text-xs text-warning-muted-foreground">
								{model.bidsWithoutAmount} of {model.bids.length} bids carried no readable amount. The rows below show
								the bid, not a price, and the positions are a partial sum.
							</p>
						)}
						<ol className="space-y-1.5">
							{model.bids.map((bid) => (
								<li
									key={bid.eventId}
									className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border-default bg-surface-raised px-3 py-2 text-xs"
								>
									<span className="font-mono text-text-mid">{shortKey(bid.bidder)}</span>
									<span className="font-medium text-text-high">
										{bid.amount === null ? 'amount not stated' : `+${bid.amount.toLocaleString()} sats`}
									</span>
									<span className="text-text-mid">{new Date(bid.createdAt * 1000).toLocaleString()}</span>
								</li>
							))}
						</ol>
					</>
				)}

				{positions.length > 0 && (
					<div className="rounded-lg border border-border-default bg-surface-sunken/40 p-3">
						<p className="text-xs font-semibold uppercase tracking-[0.16em] text-text-mid">Positions (derived)</p>
						<p className="mt-1 text-[11px] text-text-mid">
							Summed from bid deltas. This is not the outcome: the verdict names the winner.
						</p>
						<ul className="mt-2 space-y-1">
							{positions.map((position) => (
								<li key={position.bidder} className="flex justify-between text-xs">
									<span className="font-mono text-text-mid">{shortKey(position.bidder)}</span>
									<span className="font-medium text-text-high">{position.total.toLocaleString()} sats</span>
								</li>
							))}
						</ul>
					</div>
				)}
			</section>

			<section className="space-y-2">
				<h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-text-mid">Provenance</h2>
				<AuctionTechnicalRow label="Relays that delivered" value={`${model.relayCount}`} />
				<AuctionTechnicalRow label="Root event (bids bind here)" value={model.rootEventId} copyValue={model.rootEventId} stacked />
				<AuctionTechnicalRow label="Canonical version" value={model.canonicalEventId} copyValue={model.canonicalEventId} stacked />
				<AuctionTechnicalRow
					label="Versions read"
					value={`${model.versions}`}
					stacked
				/>
				{status !== 'settled' && (
					<p className="text-[11px] text-text-mid">
						{relayHealth.answered} of {relayHealth.total} relays answered. A later version may exist on a relay that has
						not answered.
					</p>
				)}
			</section>
		</div>
	)
}