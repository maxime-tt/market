import { cn } from '@ui/utils/cn'
import { Fragment, type ReactNode } from 'react'
import { useStorefrontContext } from '../StorefrontContext'
import type { AuctionListItem, AuctionListStatus } from './AuctionListBlock'
import { AccentTitle, MagazineImage, formatCountdown, formatSats, type MagazineProduct } from './MagazineBlocks'
import { StorefrontEditorHint } from './shared'

/**
 * The zine home blocks (ADR-0029), drawn from the "On the block" layout.
 *
 * Same rules as the magazine blocks (ADR-0028): props-only, every figure read
 * live by the platform slot, an editor hint when there is nothing to draw.
 */

function bidOf(item: AuctionListItem): number | null {
	return item.topBidTotal ?? item.startingBid
}

function bidsLabel(count: number): string {
	return count === 1 ? '1 bid' : `${count} bids`
}

// ---------------------------------------------------------------------------
// Auction bento
// ---------------------------------------------------------------------------

export interface AuctionBentoBlockProps {
	title: string
	intro: string
	showLiveCount: boolean
	source: 'auto' | 'picked'
	auctionCoordinates: string[]
	sticker: string
}

export interface AuctionBentoBlockViewProps extends AuctionBentoBlockProps {
	items: AuctionListItem[]
	liveCount: number
	status: AuctionListStatus
	now: number
	auctionHref: (coordinate: string) => string
	renderSeller?: (pubkey: string) => ReactNode
}

function BentoLot({
	item,
	slot,
	now,
	href,
	sticker,
	renderSeller,
}: {
	item: AuctionListItem
	slot: 'a' | 'b' | 'c'
	now: number
	href: string
	sticker?: string
	renderSeller?: (pubkey: string) => ReactNode
}) {
	const live = item.phase === 'open'
	const title = item.title?.trim() || item.d
	const big = slot === 'a'
	return (
		<a className={cn('zn-bx', `zn-bx-${slot}`)} href={href} data-testid={`storefront-bento-lot-${item.d}`} data-phase={item.phase}>
			<MagazineImage src={item.imageUrl} alt={title} eager={big} />
			<div className="zn-tl">
				<span className="mz-pill" data-phase={live ? 'open' : 'ended'}>
					{live ? 'Live' : 'Ended'}
				</span>
				{live ? <span className="zn-cdb">{formatCountdown(item.endsAt, now)}</span> : null}
			</div>
			{big && sticker?.trim() ? (
				<span className="zn-stk">
					<span>
						{item.topBidTotal !== null ? sticker : 'Starts at'}
						<b>{formatSats(bidOf(item))}</b>
						sats
					</span>
				</span>
			) : null}
			<div className="zn-ov">
				<h3>{title}</h3>
				<div className="zn-r">
					<span className="zn-by">
						<span>{bidsLabel(item.bidCount)}</span>
						{renderSeller ? (
							<>
								<span aria-hidden>·</span>
								{renderSeller(item.seller)}
							</>
						) : null}
					</span>
					{big ? null : <b>{formatSats(bidOf(item))}</b>}
				</div>
			</div>
		</a>
	)
}

export function AuctionBentoBlock({
	title,
	intro,
	showLiveCount,
	sticker,
	source,
	auctionCoordinates,
	items,
	liveCount,
	status,
	now,
	auctionHref,
	renderSeller,
}: AuctionBentoBlockViewProps) {
	const { isEditing } = useStorefrontContext()
	const lots = items.slice(0, 4)
	const head = (
		<div className="zn-hl">
			<h1>
				<AccentTitle text={title} />
				{showLiveCount && liveCount > 0 ? <span className="zn-tag">{liveCount} live</span> : null}
			</h1>
			{intro.trim() ? <p>{intro}</p> : null}
		</div>
	)

	if (lots.length === 0) {
		if (status === 'loading') {
			return (
				<div className="mz-wrap zn-hero" aria-busy="true">
					{head}
					<div className="zn-bento">
						<div className="mz-skel zn-bx-a" />
						<div className="mz-skel zn-bx-b" />
						<div className="mz-skel zn-bx-c" />
						<div className="mz-skel zn-bx-c" />
					</div>
				</div>
			)
		}
		return (
			<div className="mz-wrap zn-hero">
				{head}
				{isEditing ? (
					<StorefrontEditorHint>
						{source === 'picked' && auctionCoordinates.length === 0
							? 'Pick up to four lots, or switch to Automatic.'
							: 'No auctions to show yet.'}
					</StorefrontEditorHint>
				) : null}
			</div>
		)
	}

	const slots: ('a' | 'b' | 'c')[] = ['a', 'b', 'c', 'c']
	return (
		<div className={cn('mz-wrap zn-hero', isEditing && 'pointer-events-none')} data-testid="storefront-auction-bento">
			{head}
			<div className="zn-bento" data-count={lots.length}>
				{lots.map((item, index) => (
					<BentoLot
						key={item.coordinate}
						item={item}
						slot={slots[index]}
						now={now}
						href={auctionHref(item.coordinate)}
						sticker={index === 0 ? sticker : undefined}
						renderSeller={renderSeller}
					/>
				))}
			</div>
		</div>
	)
}

// ---------------------------------------------------------------------------
// Band (the Ticker's `band` style)
// ---------------------------------------------------------------------------

export function TickerBand({ lines }: { lines: string[] }) {
	const { isEditing } = useStorefrontContext()
	if (lines.length === 0) {
		return isEditing ? (
			<div className="mz-wrap py-3">
				<StorefrontEditorHint>Add a line or turn on live figures to fill the band.</StorefrontEditorHint>
			</div>
		) : null
	}
	// Repeat so a short list still fills a wide screen, then twice for the loop.
	const fill = lines.length >= 6 ? lines : Array.from({ length: Math.ceil(6 / lines.length) }, () => lines).flat()
	const run = (hidden: boolean) =>
		fill.map((line, index) => (
			<Fragment key={`${hidden ? 'b' : 'a'}${index}`}>
				<span aria-hidden={hidden || undefined}>{line}</span>
				<span className="zn-star" aria-hidden>
					✶
				</span>
			</Fragment>
		))
	return (
		<div className="zn-band-wrap" data-testid="storefront-ticker-band">
			<div className="zn-band">
				<div className="zn-band-track">
					{run(false)}
					{run(true)}
				</div>
			</div>
		</div>
	)
}

// ---------------------------------------------------------------------------
// Closing soon + polaroid picks
// ---------------------------------------------------------------------------

export interface ClosingPicksBlockProps {
	closingTitle: string
	closingChip: string
	closingLimit: number
	picksTitle: string
	picksChip: string
	source: 'featured' | 'picked'
	productDTags: string[]
	picksLimit: number
	buttonLabel: string
}

export interface ClosingPicksBlockViewProps extends ClosingPicksBlockProps {
	closing: AuctionListItem[]
	closingStatus: AuctionListStatus
	picks: MagazineProduct[] | null
	picksLoading: boolean
	now: number
	auctionHref: (coordinate: string) => string
}

function ZineHead({ title, chip }: { title: string; chip: string }) {
	if (!title.trim() && !chip.trim()) return null
	return (
		<div className="zn-h2">
			<h2>
				<AccentTitle text={title} />
			</h2>
			{chip.trim() ? <span className="zn-chip">{chip}</span> : null}
		</div>
	)
}

export function ClosingPicksBlock({
	closingTitle,
	closingChip,
	closingLimit,
	picksTitle,
	picksChip,
	picksLimit,
	buttonLabel,
	source,
	productDTags,
	closing,
	closingStatus,
	picks,
	picksLoading,
	now,
	auctionHref,
}: ClosingPicksBlockViewProps) {
	const { isEditing } = useStorefrontContext()
	const rows = closing.slice(0, Math.max(0, closingLimit))
	const cards = (picks ?? []).slice(0, Math.max(0, picksLimit))

	let race: ReactNode
	if (rows.length > 0) {
		race = (
			<ol className="zn-race">
				{rows.map((item, index) => {
					const live = item.phase === 'open'
					return (
						<li key={item.coordinate}>
							<a className="zn-rr" href={auctionHref(item.coordinate)} data-testid={`storefront-closing-${item.d}`} data-phase={item.phase}>
								<span className="zn-n">{index + 1}</span>
								<span className="zn-th">
									<MagazineImage src={item.imageUrl} />
								</span>
								<span className="zn-t">
									{item.title?.trim() || item.d}
									<small>
										{bidsLabel(item.bidCount)} · {formatSats(bidOf(item))} sats
									</small>
								</span>
								<span className="zn-cd" data-phase={item.phase}>
									{live ? formatCountdown(item.endsAt, now) : 'Ended'}
									<small>{live ? 'left' : 'closed'}</small>
								</span>
							</a>
						</li>
					)
				})}
			</ol>
		)
	} else if (closingStatus === 'loading') {
		race = <div className="mz-skel" style={{ height: 420 }} aria-busy="true" />
	} else {
		race = isEditing ? (
			<StorefrontEditorHint>No auctions closing yet.</StorefrontEditorHint>
		) : (
			<p className="zn-empty">Nothing on the block right now.</p>
		)
	}

	let pinboard: ReactNode
	if (cards.length > 0) {
		pinboard = (
			<div className="zn-pol">
				{cards.map((product) => (
					<a key={product.key} className="zn-po" href={product.href} data-testid="storefront-polaroid">
						<span className="zn-ph">
							<MagazineImage src={product.imageUrl} alt={product.title} />
						</span>
						<span className="zn-pt">{product.title}</span>
						<span className="zn-pr">
							<span>{product.price}</span>
							{buttonLabel.trim() ? <i>{buttonLabel}</i> : null}
						</span>
					</a>
				))}
			</div>
		)
	} else if (picksLoading) {
		pinboard = (
			<div className="zn-pol" aria-busy="true">
				{Array.from({ length: Math.min(6, picksLimit) }, (_, index) => (
					<div key={index} className="mz-skel" style={{ aspectRatio: '1 / 1.3' }} />
				))}
			</div>
		)
	} else {
		pinboard = isEditing ? (
			<StorefrontEditorHint>
				{source === 'picked' && productDTags.length === 0 ? 'Pick up to six products for the pinboard.' : 'No products with pictures yet.'}
			</StorefrontEditorHint>
		) : null
	}

	return (
		<div className={cn('mz-wrap mz-sec', isEditing && 'pointer-events-none')} data-testid="storefront-closing-picks">
			<div className="zn-two">
				<section>
					<ZineHead title={closingTitle} chip={closingChip} />
					{race}
				</section>
				<section>
					<ZineHead title={picksTitle} chip={picksChip} />
					{pinboard}
				</section>
			</div>
		</div>
	)
}
