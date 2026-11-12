/**
 * The Catalogue detail, Layout A — the split gallery + buy column from
 * `reference/EXTRACTION-STRUCTURE.md` §Layout A.
 *
 * Props-only by the house rule: the host owns the read, the signer and the
 * clock; this component owns the arrangement. Three honesty rules are load-
 * bearing here and each is called out where it is enforced:
 *
 *   1. The money is fake — the banner is not optional (the config says so).
 *   2. The countdown reads committed block time (`now`), never the browser clock.
 *   3. Nothing is shown that the committed document does not carry. The reference
 *      has watchers, a condition line, postage and a Q&A feed; this surface has
 *      none of those, so it renders none of them.
 */
import './catalogue-theme.css'
import { catalogueCssVars } from './catalogue-preset'

export interface CatalogueDetailAuctionView {
	id: string
	title: string
	seller: string
	description?: string
	imageUrl?: string
	startingBid: number
	minIncrement: number
	/** Committed block time of the close, in seconds. */
	endTime: number
	originalEndTime?: number
	/** The locktime a mint lock must carry; read off the auction, never computed. */
	requiredLocktime?: number
	status?: string
	fundingMode: string
	reserve?: number
	extensionCount?: number
}

export interface CatalogueDetailBidView {
	id: string
	bidder: string
	/** The committed DELTA, exactly as stored. */
	amount: number
	committedAt?: number
}

export interface CatalogueBidPositionView {
	leaderPubkey: string | null
	leaderPosition: number
	myPosition: number
	minNextPosition: number
	minDelta: number
}

export interface CatalogueBidPreviewView {
	/** The delta the next KindBid would carry. */
	delta: number
	/** The total the bidder will hold after this bid. */
	resultingPosition: number
	/** True when the typed total is below the auction's minimum. */
	belowMinimum: boolean
}

export interface CatalogueDetailViewProps {
	auction: CatalogueDetailAuctionView | null
	bids: readonly CatalogueDetailBidView[]
	/** The signed-in viewer's pubkey, or null. */
	viewerPubkey: string | null
	bidPosition: CatalogueBidPositionView
	positionInput: string
	onPositionInput: (value: string) => void
	preview: CatalogueBidPreviewView | null
	isSubmitting: boolean
	onSubmitBid: () => void
	/** A refusal or failure to show in the status line, or null. */
	submitError: string | null
	submitSuccess: string | null
	/** Committed chain time, so the countdown never runs off the browser clock. */
	now: number
	onBack?: () => void
	/**
	 * The live-video surface is DEFERRED (owner ruling): the component renders
	 * nothing without a real feed URL, and there is no feed yet.
	 */
	liveFeedUrl?: string | null
}

function formatRemaining(endTime: number, now: number): string {
	const seconds = Math.max(0, endTime - now)
	if (seconds === 0) return 'ended'
	const h = Math.floor(seconds / 3600)
	const m = Math.floor((seconds % 3600) / 60)
	const s = seconds % 60
	if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
	return m > 0 ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`
}

function shortKey(pubkey: string): string {
	return pubkey.length > 12 ? `${pubkey.slice(0, 6)}…${pubkey.slice(-4)}` : pubkey
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
				<i />LIVE
			</span>
		</div>
	)
}

export function CatalogueDetailView({
	auction,
	bids,
	viewerPubkey,
	bidPosition,
	positionInput,
	onPositionInput,
	preview,
	isSubmitting,
	onSubmitBid,
	submitError,
	submitSuccess,
	now,
	onBack,
	liveFeedUrl = null,
}: CatalogueDetailViewProps) {
	if (!auction) {
		return (
			<div className="cat" style={catalogueCssVars('light')}>
				<div className="cat__wrap">
					<p className="cat__empty" data-testid="catalogue-detail-loading">
						Reading committed state…
					</p>
				</div>
			</div>
		)
	}

	const ended = auction.status === 'closed' || now >= auction.endTime
	const price = bidPosition.leaderPosition > 0 ? bidPosition.leaderPosition : auction.startingBid
	const iLead = !!viewerPubkey && bidPosition.leaderPubkey === viewerPubkey
	const iHaveBid = !!viewerPubkey && bids.some((bid) => bid.bidder === viewerPubkey)
	const reserveMet = auction.reserve !== undefined && auction.reserve > 0 ? price >= auction.reserve : null
	// Timeline: newest first, by committed block time where the document carries it.
	const feed = [...bids].sort((a, b) => (b.committedAt ?? 0) - (a.committedAt ?? 0))

	return (
		<div className="cat cat-detail" style={catalogueCssVars('light')}>
			<div className="cat__wrap">
				<p className="cat__banner" data-testid="catalogue-fake-money">
					<b>Demo network.</b> Bids and balances are fake money (FAKE_MONEY_ONLY) — nothing here settles to real
					value.
				</p>

				<nav className="cat-crumbs" aria-label="Breadcrumb">
					<span>Auctions</span>
					<span className="cat-crumbs__sep">›</span>
					<b>Lot {auction.id.slice(0, 18)}</b>
				</nav>

				<div className="cat-dgrid">
					<section className="cat-gallery">
						<div className="cat-stage" data-testid="catalogue-stage">
							{auction.imageUrl ? <img className="cat-stage__img" src={auction.imageUrl} alt="" /> : null}
							<CatalogueLivePip feedUrl={liveFeedUrl} />
						</div>
					</section>

					<aside className="cat-buy">
						<div className="cat-eyebrow">
							<span className={`cat-live-dot${ended ? ' is-ended' : ''}`} />
							<span data-testid="catalogue-state">{ended ? 'ended' : 'live'}</span>
							<span>·</span>
							<span>Lot {auction.id.slice(0, 18)}</span>
						</div>

						<h1 className="cat-lot-title" data-testid="catalogue-title">
							{auction.title}
						</h1>

						<div className="cat-price-card">
							<div className="cat-price-row">
								<div>
									<div className="cat-label">{ended ? 'Final price' : 'Current price'}</div>
									<div className="cat-price" data-testid="catalogue-price">
										<span>{price}</span> <small>sats</small>
									</div>
									<div className="cat-muted">
										{bids.length} {bids.length === 1 ? 'bid' : 'bids'} ·{' '}
										{bidPosition.leaderPubkey ? `leader ${shortKey(bidPosition.leaderPubkey)}` : 'no bids yet'}
									</div>
								</div>
								<div className={`cat-timer${!ended && auction.endTime - now <= 10 ? ' is-urgent' : ''}`}>
									<div className="cat-label">{ended ? 'Closed' : 'Ends in'}</div>
									<div className="cat-timer__value" data-testid="catalogue-timer">
										{formatRemaining(auction.endTime, now)}
									</div>
									<div className="cat-muted">committed block time</div>
								</div>
							</div>

							{reserveMet !== null && (
								<div className={`cat-reserve${reserveMet ? ' is-met' : ''}`} data-testid="catalogue-reserve">
									<div className="cat-reserve__bar">
										<i style={{ width: `${Math.min(100, Math.round((price / auction.reserve!) * 100))}%` }} />
									</div>
									<span>{reserveMet ? 'Reserve met — this lot will sell' : 'Reserve not yet met'}</span>
								</div>
							)}

							{viewerPubkey && iHaveBid && (
								<div className={`cat-mystatus ${iLead ? 'is-win' : 'is-lose'}`} data-testid="catalogue-mystatus">
									{iLead
										? 'You hold the top position'
										: 'You have been outbid — the coordinator has returned your sats'}
								</div>
							)}

							{!ended && (
								<div className="cat-bidform">
									<div className="cat-mode-toggle" role="radiogroup" aria-label="Bid type">
										<button type="button" className="is-on" data-testid="catalogue-mode-bid">
											Bid now
										</button>
										{/* Proxy bidding is approved in principle but needs an
										    auto-signer loop; shown disabled so the surface does not
										    promise a behaviour the build does not have. */}
										<button
											type="button"
											disabled
											title="Proxy bidding lands when the coordinator's auto-signer is wired"
											data-testid="catalogue-mode-max"
										>
											Set max bid
										</button>
									</div>

									<div className="cat-bid-row">
										<label className="cat-amount-field">
											<input
												inputMode="numeric"
												aria-label="Your bid total in sats"
												value={positionInput}
												onChange={(event) => onPositionInput(event.target.value.replace(/[^0-9]/g, ''))}
												onKeyDown={(event) => {
													if (event.key === 'Enter' && !isSubmitting) onSubmitBid()
												}}
												data-testid="catalogue-bid-input"
												placeholder={String(bidPosition.minNextPosition)}
											/>
											<span>sats</span>
										</label>
										<button
											type="button"
											className="cat-btn-primary"
											disabled={isSubmitting || !viewerPubkey || !preview || preview.belowMinimum}
											onClick={onSubmitBid}
											data-testid="catalogue-submit-bid"
										>
											{isSubmitting ? 'Bidding…' : 'Place bid'}
										</button>
									</div>

									<div className="cat-chips">
										<button
											type="button"
											data-testid="catalogue-quick-bid"
											onClick={() => onPositionInput(String(bidPosition.minNextPosition))}
										>
											Quick bid <b>{bidPosition.minNextPosition}</b>
										</button>
									</div>

									<p className="cat-hint" data-testid="catalogue-bid-hint">
										{viewerPubkey ? (
											<>
												Minimum <b>{bidPosition.minNextPosition}</b> sats total.
												{preview && !preview.belowMinimum ? (
													<>
														{' '}
														This adds <b>{preview.delta}</b> to your position, holding{' '}
														<b>{preview.resultingPosition}</b> sats in total.
													</>
												) : null}
											</>
										) : (
											'Sign in to place a bid.'
										)}
									</p>

									{submitError && (
										<p className="cat-error" role="status" data-testid="catalogue-bid-error">
											{submitError}
										</p>
									)}
									{submitSuccess && (
										<p className="cat-success" role="status" data-testid="catalogue-bid-success">
											{submitSuccess}
										</p>
									)}
								</div>
							)}

							<div className="cat-actions">
								<button type="button" className="cat-btn-ghost" onClick={() => onBack?.()} data-testid="catalogue-back">
									← Back to catalogue
								</button>
							</div>
						</div>

						<dl className="cat-meta">
							<div>
								<dt>Funding</dt>
								<dd>{auction.fundingMode}</dd>
							</div>
							<div>
								<dt>Increment</dt>
								<dd>{auction.minIncrement} sats</dd>
							</div>
							{auction.requiredLocktime !== undefined && (
								<div>
									<dt>Locktime</dt>
									<dd>{auction.requiredLocktime}</dd>
								</div>
							)}
							<div>
								<dt>Seller</dt>
								<dd>{shortKey(auction.seller)}</dd>
							</div>
						</dl>
					</aside>
				</div>

				<section className="cat-lower">
					<div className="cat-col">
						<h2>Live bidding</h2>
						{feed.length === 0 ? (
							<p className="cat-muted" data-testid="catalogue-feed-empty">
								No bids committed yet.
							</p>
						) : (
							<ol className="cat-feed" data-testid="catalogue-feed">
								{feed.map((bid) => (
									<li key={bid.id} className={`cat-feed__item${viewerPubkey === bid.bidder ? ' is-mine' : ''}`}>
										<span className="cat-bid-name">
											{shortKey(bid.bidder)}
											{viewerPubkey === bid.bidder ? ' (you)' : ''}
										</span>
										<b>+{bid.amount}</b>
									</li>
								))}
							</ol>
						)}
					</div>

					<div className="cat-col">
						<h2>Questions &amp; chat</h2>
						<p className="cat-muted" data-testid="catalogue-qa-notice">
							Lot Q&amp;A is not wired to this network yet — there is no committed chat for this auction, so
							none is shown.
						</p>
					</div>

					<div className="cat-col">
						<h2>About this lot</h2>
						<p data-testid="catalogue-description">{auction.description || 'No description provided.'}</p>
						{auction.extensionCount ? (
							<p className="cat-muted">Anti-snipe extended this lot {auction.extensionCount}×.</p>
						) : null}
					</div>
				</section>
			</div>
		</div>
	)
}
