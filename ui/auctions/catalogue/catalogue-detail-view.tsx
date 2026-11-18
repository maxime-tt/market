import './catalogue-theme.css'
import type { ReactNode } from 'react'
import { catalogueCssVars } from './catalogue-preset'
import { bidCountLabel, priceLine, readStateMessage } from '@ui/auction/arena/model'
import {
	antisnipeBehaviourLabel,
	phaseLabel,
	phaseTone,
	shortKey,
	ARENA_UNKNOWN_END_LABEL,
	ARENA_NO_RECEIPT_LABEL,
	ARENA_RECEIPT_PARAMS_MISMATCH_LABEL,
	refundReceiptLabel,
	settleReceiptLabel,
	type ArenaAuctionDetailModel,
	type ArenaRelayHealth,
	type ArenaSurfaceStatus,
} from '@ui/auction/arena/model'
import { StatusBadge } from '@ui/shared/status-badge'

/**
 * The Catalogue detail, Layout A — the split gallery + buy column from
 * `reference/EXTRACTION-STRUCTURE.md` §Layout A.
 *
 * Props-only by the house rule: the host owns the read and the clock; this
 * component owns the arrangement. It receives the **arena read-model**
 * (`ArenaAuctionDetailModel`, projected by
 * `platform/web/auctions/relay/auctionSurfacesRead.ts`) — not the retired demo
 * state document — and renders whatever the read actually delivered.
 *
 * ## The flat demo fields that have no arena source, and are not defaulted
 *
 * The Layout A extraction carried `fundingMode`, `reserve`, `requiredLocktime`,
 * `extensionCount` and `originalEndTime`, all read from the demo's committed
 * state document. The arena read-model carries **none** of them (`model.ts`,
 * `review §3.4`), so each is dropped rather than defaulted to `0`/`''`:
 *
 *   - `fundingMode` — the escrow is mint-backed, not `custodial_reservation_v1`;
 *   - `reserve` — no reserve is committed in the read;
 *   - `requiredLocktime` — the lock floor belongs to the escrow params, which
 *     the chain does not publish to the relay yet (validator workstream D);
 *   - `extensionCount` / `originalEndTime` — the committed, possibly-extended
 *     end is increment 3's; today `endsAt` is create-derived and there is no
 *     extension count.
 *
 * ## Three honesty rules, each enforced where it shows
 *
 *   1. **The money notice is not optional.** The demo asserted `FAKE_MONEY_ONLY`
 *      from its config; the arena read has no funding mode, so the banner states
 *      the escrow the read-model documents instead.
 *   2. **The countdown reads the read's `now`**, never the browser clock — the
 *      clock is wall time for the display and the create-derived end for the
 *      rule (the rules clock will arrive with the committed end, increment 3).
 *   3. **Nothing is shown that the read does not carry.** The reference has
 *      watchers, a condition line, postage and a Q&A feed; the read has none of
 *      those, so this surface renders none of them.
 *
 * ## Bidding is a slot, not a form
 *
 * The bid half is blocked on the chain publishing its escrow params (validator
 * workstream D, plan §2 / increment 9). This view therefore renders the host's
 * existing arena bid panel through {@link CatalogueDetailViewProps.bidPanel} and
 * owns not one bid rule — the entry surface and its validation are
 * `ui/auction/arena/bid-panel.tsx` + `bid-rules.ts`, mounted by
 * `platform/web/auctions/relay/AuctionBidHost.tsx`. Absent the slot, nothing
 * renders in its place: a placeholder would promise bidding the build cannot do.
 */
export interface CatalogueDetailViewProps {
	/** The lot, or `null` when the read delivered none. */
	model: ArenaAuctionDetailModel | null
	status: ArenaSurfaceStatus
	relayHealth: ArenaRelayHealth
	/** Unix seconds; the route's one ticking clock, shared with the bid panel. */
	now: number
	/** Host-resolved link back to the list, or `null` to omit the affordance. */
	backHref?: string | null
	/**
	 * The read's chain clock, already rendered into words by the host
	 * (`chainClockLabel`). `null`/absent renders nothing: the label is the only
	 * thing a surface may say about chain time, so the view never formats a
	 * number itself and never substitutes the wall clock for it.
	 */
	chainClockLabel?: string | null
	/** Host-owned seller identity node (avatar + display name). */
	sellerIdentity?: ReactNode
	/** The host's arena bid panel; `null`/absent omits the slot entirely. */
	bidPanel?: ReactNode
	/**
	 * The live-video surface is DEFERRED (owner ruling): the component renders
	 * nothing without a real feed URL, and there is no feed yet.
	 */
	liveFeedUrl?: string | null
}

function formatRemaining(endsAt: number, now: number): string {
	const seconds = Math.max(0, endsAt - now)
	if (seconds === 0) return 'ended'
	const h = Math.floor(seconds / 3600)
	const m = Math.floor((seconds % 3600) / 60)
	const s = seconds % 60
	if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
	return m > 0 ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`
}

/** A term the create may or may not have stated. `null` is the words, never `0`. */
function term(value: number | null, unit: string): string {
	return value === null ? 'not stated' : `${value.toLocaleString()} ${unit}`
}

/**
 * Deferred, per the owner's ruling: an optional live-video surface that renders
 * NOTHING when no real feed is present. Kept as its own component so the
 * deferral is a fact of the code, not a comment someone has to trust.
 */
export function CatalogueLivePip({ feedUrl }: { feedUrl: string | null | undefined }) {
	if (!feedUrl) return null
	return (
		<div className="cat-pip" data-testid="catalogue-live-pip" title="Watch the live stream">
			<video className="cat-pip__video" src={feedUrl} muted loop playsInline autoPlay />
			<span className="cat-pip__badge">
				<i />
				LIVE
			</span>
		</div>
	)
}

export function CatalogueDetailView({
	model,
	status,
	relayHealth,
	now,
	chainClockLabel,
	backHref = null,
	sellerIdentity,
	bidPanel = null,
	liveFeedUrl = null,
}: CatalogueDetailViewProps) {
	if (model === null) {
		const message = readStateMessage(status)
		return (
			<div className="cat" data-slot="arena-auction-detail" data-state={status} style={catalogueCssVars('light')}>
				<div className="cat__wrap">
					<p className="cat__empty" data-testid="catalogue-detail-state" data-state={status}>
						{message?.title ?? 'Reading the auction from relays…'}
					</p>
				</div>
			</div>
		)
	}

	const ended = model.phase === 'ended'
	const label = model.title?.trim() || model.d
	const positions = [...model.positions].sort((a, b) => b.total - a.total || a.bidder.localeCompare(b.bidder))
	const leader = positions[0] ?? null
	const antisnipe = antisnipeBehaviourLabel(model.mode, model.windowSec)
	// Newest first, by the bid's own committed time — the read orders by height,
	// but a bid feed reads as a timeline.
	const feed = [...model.bids].sort((a, b) => b.createdAt - a.createdAt)

	return (
		<div className="cat cat-detail" data-slot="arena-auction-detail" data-state={status} style={catalogueCssVars('light')}>
			<div className="cat__wrap">
				<p className="cat__banner" data-testid="catalogue-escrow-notice">
					Sats are locked in escrow until the lot closes: they go to the seller if you win, and come back to you otherwise.
				</p>

				<nav className="cat-crumbs" aria-label="Breadcrumb">
					{backHref !== null ? (
						<a href={backHref} className="cat-crumbs__back" data-testid="catalogue-back">
							Auctions
						</a>
					) : (
						<span>Auctions</span>
					)}
					<span className="cat-crumbs__sep">›</span>
					<b>Lot {model.d}</b>
				</nav>

				<div className="cat-dgrid">
					<section className="cat-gallery">
						<div className="cat-stage" data-testid="catalogue-stage">
							{model.imageUrl ? <img className="cat-stage__img" src={model.imageUrl} alt="" /> : null}
							<CatalogueLivePip feedUrl={liveFeedUrl} />
						</div>
					</section>

					<aside className="cat-buy">
						<div className="cat-eyebrow">
							<span className={`cat-live-dot${ended ? ' is-ended' : ''}`} />
							<span data-testid="catalogue-state">{ended ? 'ended' : 'live'}</span>
							<span>·</span>
							<span>Lot {model.d}</span>
						</div>

						<h1 className="cat-lot-title" data-testid="catalogue-title">
							{label}
						</h1>

						<div className="cat-price-card">
							<div className="cat-price-row">
								<div>
									<div className="cat-label">{ended ? 'Final price' : 'Current price'}</div>
									<div className="cat-price" data-testid="catalogue-price">
										{model.topBidTotal === null && model.bidsWithoutAmount > 0 ? (
											<span>total unknown</span>
										) : (
											<>
												<span>{model.topBidTotal ?? model.startingBid ?? 'not stated'}</span> <small>sats</small>
											</>
										)}
									</div>
									<div className="cat-muted">{priceLine(model)}</div>
								</div>
								<div className={`cat-timer${!ended && model.endsAt !== null && model.endsAt - now <= 10 ? ' is-urgent' : ''}`}>
									<div className="cat-label">{ended ? 'Closed' : 'Ends in'}</div>
									<div className="cat-timer__value" data-testid="catalogue-timer">
										{model.endsAt !== null ? formatRemaining(model.endsAt, now) : ARENA_UNKNOWN_END_LABEL}
									</div>
									<div className="cat-muted">{model.endsAt !== null ? 'create-derived end' : 'the create stated no duration'}</div>
								</div>
							</div>

							<div className="cat-muted" data-testid="catalogue-leader">
								{phaseLabel(model.phase)}
								{model.verdict !== null ? ` · outcome: ${model.verdict} (relay-reported)` : ' · outcome not verified yet'}
								{model.divergent ? ' · relays disagree' : ''}
								{leader !== null ? ` · leader ${shortKey(leader.bidder)}` : ' · no bids yet'}
							</div>
							{/*
							  The money receipt, kept apart from the verdict on purpose: a
							  verdict is a claim ("the verdict names the winner"), a receipt is
							  money that moved. When no 1444 was read the line says "no receipt
							  read" — never "not paid", which the read cannot know.
							*/}
							<p className="cat-muted" data-testid="catalogue-receipt" data-outcome={model.settleReceipt !== null ? 'settle' : 'none'}>
								{model.settleReceipt !== null ? settleReceiptLabel(model.settleReceipt) : ARENA_NO_RECEIPT_LABEL}
								{model.settleReceipt?.paramsVersionMismatch === true ? ` — ⚠ ${ARENA_RECEIPT_PARAMS_MISMATCH_LABEL}` : ''}
							</p>
						</div>

						{bidPanel !== null && (
							<div data-slot="arena-auction-detail-bid" data-testid="catalogue-bid-slot">
								{bidPanel}
							</div>
						)}

						<dl className="cat-meta">
							<div>
								<dt>Starting bid</dt>
								<dd>{term(model.startingBid, 'sats')}</dd>
							</div>
							<div>
								<dt>Mode</dt>
								<dd>{model.mode ?? 'not stated'}</dd>
							</div>
							<div>
								<dt>Minimum increment</dt>
								<dd>{term(model.minIncrement, 'sats')}</dd>
							</div>
							<div>
								<dt>Anti-snipe</dt>
								<dd>{antisnipe ?? (model.windowSec === null ? 'not stated' : term(model.windowSec, 'seconds'))}</dd>
							</div>
							<div>
								<dt>Seller</dt>
								<dd>{sellerIdentity ?? shortKey(model.seller)}</dd>
							</div>
						</dl>

						{backHref !== null && (
							<div className="cat-actions">
								<a className="cat-btn-ghost" href={backHref} data-testid="catalogue-back-link">
									← Back to auctions
								</a>
							</div>
						)}
					</aside>
				</div>

				<section className="cat-lower">
					<div className="cat-col">
						<h2>Live bidding</h2>
						{feed.length === 0 ? (
							<p className="cat-muted" data-testid="catalogue-feed-empty">
								{status === 'settled'
									? 'No bids were read for this lot.'
									: 'No bids have been read yet — the read has not finished, so this is not “no bids”.'}
							</p>
						) : (
							<ol className="cat-feed" data-testid="catalogue-feed">
								{feed.map((bid) => (
									<li key={bid.eventId} className="cat-feed__item">
										<span className="cat-bid-name">
											{shortKey(bid.bidder)}
											{bid.relays.length > 1 ? ` · ${bid.relays.length} relays` : ''}
										</span>
										<b>{bid.amount === null ? 'amount not stated' : `+${bid.amount.toLocaleString()} sats`}</b>
									</li>
								))}
							</ol>
						)}
						{model.bidsWithoutAmount > 0 && (
							<p className="cat-muted" data-testid="catalogue-bids-partial">
								{model.bidsWithoutAmount} of {model.bids.length} bids carried no readable amount, so the positions are a partial sum.
							</p>
						)}
					</div>

					<div className="cat-col">
						<h2>Positions (derived)</h2>
						{positions.length === 0 ? (
							<p className="cat-muted" data-testid="catalogue-positions-empty">
								No positions yet.
							</p>
						) : (
							<ul className="cat-feed" data-testid="catalogue-positions">
								{positions.map((position) => (
									<li key={position.bidder} className="cat-feed__item">
										<span className="cat-bid-name">{shortKey(position.bidder)}</span>
										<b>{position.total.toLocaleString()} sats</b>
										{model.refundsByBidder[position.bidder] !== undefined && (
											<em data-testid="catalogue-refund-receipt" data-height={model.refundsByBidder[position.bidder]}>
												{refundReceiptLabel(model.refundsByBidder[position.bidder])}
											</em>
										)}
									</li>
								))}
							</ul>
						)}
						<p className="cat-muted">
							Summed from bid deltas. This is not the outcome: the verdict names the winner, and the mint decides whether money moved.
						</p>
					</div>

					<div className="cat-col">
						<h2>About this lot</h2>
						<p data-testid="catalogue-description">{model.description ?? 'The create published no description.'}</p>
						{antisnipe !== null && <p className="cat-muted">Anti-snipe {antisnipe}.</p>}
						<p className="cat-muted" data-testid="catalogue-qa-notice">
							Lot Q&amp;A is not wired to this network yet — there is no committed chat for this auction, so none is shown.
						</p>
						<div className="cat-muted">
							<StatusBadge status={phaseLabel(model.phase)} tone={phaseTone(model.phase)} />
							{model.divergent && <StatusBadge status="relays disagree" tone="warning" />}
							{relayHealth.total > 0 && status !== 'settled' && (
								<span>
									{' '}
									{relayHealth.answered} of {relayHealth.total} relays answered
								</span>
							)}
							{chainClockLabel != null && <span data-testid="catalogue-chain-clock"> {chainClockLabel}</span>}
						</div>
						<span className="cat-muted">{bidCountLabel(model.bidCount, status)}</span>
					</div>
				</section>
			</div>
		</div>
	)
}
