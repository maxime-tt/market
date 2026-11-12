import './catalogue-theme.css'
import { catalogueCssVars } from './catalogue-preset'

/**
 * The Catalogue list, Layout A.
 *
 * Props-only by the house rule: the host owns the read and the clock, this
 * component owns the arrangement. The fake-money banner is not optional — the
 * backend's own config says `FAKE_MONEY_ONLY`, and a surface that shows bid
 * amounts without saying so is misleading by omission.
 */
export interface CatalogueAuctionView {
	id: string
	title: string
	seller: string
	imageUrl?: string
	startingBid: number
	/** The backend's committed leader position, when the lot has bids. */
	highBid?: number
	/** Committed block time of the close, in seconds. */
	endTime: number
	status?: string
	fundingMode: string
}

export interface CatalogueViewProps {
	auctions: readonly CatalogueAuctionView[] | null
	isLoading: boolean
	isError: boolean
	/** Committed chain time, so a countdown never runs off the browser clock. */
	now: number
	onSelect?: (auctionId: string) => void
}

function formatRemaining(endTime: number, now: number): string {
	const seconds = Math.max(0, endTime - now)
	if (seconds === 0) return 'closed'
	const minutes = Math.floor(seconds / 60)
	const rest = seconds % 60
	return minutes > 0 ? `${minutes}m ${String(rest).padStart(2, '0')}s` : `${rest}s`
}

export function CatalogueView({ auctions, isLoading, isError, now, onSelect }: CatalogueViewProps) {
	return (
		<div className="cat" style={catalogueCssVars('light')}>
			<div className="cat__wrap">
				<p className="cat__banner" data-testid="catalogue-fake-money">
					<b>Demo network.</b> Bids and balances are fake money (FAKE_MONEY_ONLY) — nothing here settles to real
					value.
				</p>

				<header className="cat__head">
					<h1 className="cat__title">Auctions</h1>
					<span className="cat__sub">
						{isLoading ? 'reading committed state…' : `${auctions?.length ?? 0} lots`}
					</span>
				</header>

				{isError ? (
					<p className="cat__empty" data-testid="catalogue-error">
						The auction network could not be read.
					</p>
				) : isLoading && auctions === null ? (
					<p className="cat__empty">Loading…</p>
				) : (auctions?.length ?? 0) === 0 ? (
					<p className="cat__empty" data-testid="catalogue-empty">
						No auctions are open on this network.
					</p>
				) : (
					<div className="cat__grid" data-testid="catalogue-grid">
						{(auctions ?? []).map((auction) => (
							<a
								key={auction.id}
								className="cat__card"
								href={`/auctions/catalogue/${encodeURIComponent(auction.id)}`}
								onClick={(event) => {
									if (!onSelect) return
									event.preventDefault()
									onSelect(auction.id)
								}}
							>
								<div className="cat__shot">{auction.imageUrl ? <img src={auction.imageUrl} alt="" /> : null}</div>
								<span className="cat__lot">Lot · {auction.id.slice(0, 18)}</span>
								<h2 className="cat__card-title">{auction.title}</h2>
								<div className="cat__meta">
									<span className="cat__price">
										{auction.highBid && auction.highBid > 0 ? auction.highBid : auction.startingBid} sats
									</span>
									<span className="cat__timer">{formatRemaining(auction.endTime, now)}</span>
								</div>
								<span className="cat__state">
									{auction.status ?? 'open'} · {auction.fundingMode}
								</span>
							</a>
						))}
					</div>
				)}
			</div>
		</div>
	)
}
