import { isSafeMediaSrc } from '@sdk/commerce/storefront/storefrontPage'
import { cn } from '@ui/utils/cn'
import { Fragment, type ReactNode } from 'react'
import { useStorefrontContext } from '../StorefrontContext'
import type { AuctionListItem, AuctionListStatus } from './AuctionListBlock'
import { StorefrontEditorHint } from './shared'
import './magazine.css'

/**
 * The magazine home blocks (ADR-0028), drawn from the "cover story" mockup.
 *
 * Props-only, like every block in `ui/storefront`: the platform slots read the
 * auctions, products and collections and hand them down as plain data. Each
 * view has an honest empty state — an editor hint while editing, and nothing
 * (or a quiet skeleton while reading) on a published page.
 */

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Sats with thousands separators, e.g. `540,000`. */
export function formatSats(value: number | null | undefined): string {
	if (value === null || value === undefined || !Number.isFinite(value)) return '—'
	return Math.round(value).toLocaleString('en-GB')
}

/** A countdown: `2d 04h` over a day, `07:31` under an hour, `01:07:31` otherwise. */
export function formatCountdown(endsAt: number | null, now: number): string {
	if (endsAt === null) return '—'
	const left = Math.max(0, Math.floor(endsAt - now))
	if (left === 0) return 'Ended'
	const days = Math.floor(left / 86_400)
	const hours = Math.floor((left % 86_400) / 3600)
	const minutes = Math.floor((left % 3600) / 60)
	const seconds = left % 60
	const pad = (n: number) => String(n).padStart(2, '0')
	if (days > 0) return `${days}d ${pad(hours)}h`
	if (hours > 0) return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
	return `${pad(minutes)}:${pad(seconds)}`
}

/** Share of the auction's time already gone, 0–100. */
export function elapsedPercent(item: Pick<AuctionListItem, 'endsAt' | 'startsAt'>, now: number): number {
	if (item.endsAt === null || item.startsAt === null || item.startsAt === undefined) return 0
	const span = item.endsAt - item.startsAt
	if (span <= 0) return 100
	return Math.min(100, Math.max(0, ((now - item.startsAt) / span) * 100))
}

/**
 * A section title where `*word*` becomes the italic accent. Plain text in, plain
 * elements out: there is no markup path, only the one emphasis the design uses.
 */
export function AccentTitle({ text }: { text: string }) {
	const parts = text.split(/(\*[^*]+\*)/g).filter((part) => part.length > 0)
	return (
		<>
			{parts.map((part, index) =>
				part.startsWith('*') && part.endsWith('*') && part.length > 2 ? (
					<em key={index}>{part.slice(1, -1)}</em>
				) : (
					<Fragment key={index}>{part}</Fragment>
				),
			)}
		</>
	)
}

export function MagazineHead({
	title,
	label,
	subtitle,
	linkLabel,
	linkHref,
}: {
	title: string
	label?: string
	subtitle?: string
	linkLabel?: string
	linkHref?: string
}) {
	const hasLink = Boolean(linkLabel?.trim() && linkHref?.trim())
	if (!title.trim() && !label?.trim() && !hasLink) return null
	return (
		<div className="mz-head">
			<div className="min-w-0">
				{label?.trim() ? <div className="mz-label">{label}</div> : null}
				{title.trim() ? (
					<h2>
						<AccentTitle text={title} />
					</h2>
				) : null}
				{subtitle?.trim() ? <div className="mz-sub">{subtitle}</div> : null}
			</div>
			{hasLink ? (
				<a className="mz-link" href={linkHref}>
					{linkLabel} →
				</a>
			) : null}
		</div>
	)
}

/** An image gated through the same scheme check as every page image. */
export function MagazineImage({ src, alt = '', eager = false }: { src: string | null | undefined; alt?: string; eager?: boolean }) {
	if (!src || !isSafeMediaSrc(src)) return <span className="mz-noimg">No image</span>
	return (
		<img
			className="mz-img"
			src={src}
			alt={alt}
			loading={eager ? 'eager' : 'lazy'}
			decoding="async"
			referrerPolicy="no-referrer"
			{...(eager ? { fetchPriority: 'high' as const } : {})}
		/>
	)
}

function bidOf(item: AuctionListItem): number | null {
	return item.topBidTotal ?? item.startingBid
}

// ---------------------------------------------------------------------------
// Ticker
// ---------------------------------------------------------------------------

export interface TickerEntry {
	label: string
	/** Highlighted figure, drawn in the secondary colour. */
	value?: string
}

export interface TickerBlockViewProps {
	entries: TickerEntry[]
}

export function TickerBlock({ entries }: TickerBlockViewProps) {
	const { isEditing } = useStorefrontContext()
	if (entries.length === 0) {
		return isEditing ? (
			<div className="mz-wrap py-3">
				<StorefrontEditorHint>Add a line or turn on live figures to fill the ticker.</StorefrontEditorHint>
			</div>
		) : null
	}
	// Two copies so the marquee loops without a gap; the second is decorative.
	const line = (hidden: boolean) =>
		entries.map((entry, index) => (
			<span key={`${hidden ? 'b' : 'a'}${index}`} aria-hidden={hidden || undefined}>
				{entry.value ? (
					<>
						{entry.label ? `${entry.label} ` : ''}
						<b>{entry.value}</b>
					</>
				) : (
					entry.label
				)}
			</span>
		))
	return (
		<div className="mz-tick" data-testid="storefront-ticker">
			<div className="mz-tick-track">
				{line(false)}
				{line(true)}
			</div>
		</div>
	)
}

// ---------------------------------------------------------------------------
// Cover auction
// ---------------------------------------------------------------------------

export interface CoverAuctionBlockProps {
	source: 'auto' | 'picked'
	auctionCoordinates: string[]
	kicker: string
	deck: string
	sticker: string
	ctaLabel: string
	footnote: string
}

export interface CoverAuctionBlockViewProps extends CoverAuctionBlockProps {
	item: AuctionListItem | null
	/** The lot's own summary, used when `deck` is blank. */
	summary?: string | null
	status: AuctionListStatus
	now: number
	auctionHref: (coordinate: string) => string
	allAuctionsHref?: string
	renderSeller?: (pubkey: string) => ReactNode
}

export function CoverAuctionBlock({
	source,
	auctionCoordinates,
	kicker,
	deck,
	sticker,
	ctaLabel,
	footnote,
	item,
	summary,
	status,
	now,
	auctionHref,
	allAuctionsHref = '/auctions',
	renderSeller,
}: CoverAuctionBlockViewProps) {
	const { isEditing } = useStorefrontContext()

	if (!item) {
		if (isEditing && source === 'picked' && auctionCoordinates.length === 0) {
			return (
				<div className="mz-wrap py-8">
					<StorefrontEditorHint>Pick the auction for the cover, or switch to Automatic.</StorefrontEditorHint>
				</div>
			)
		}
		if (status === 'loading') {
			// Hold the cover's shape while the read runs, so nothing jumps.
			return (
				<div className="mz-wrap" aria-busy="true">
					<div className="mz-cover">
						<div className="mz-skel" style={{ aspectRatio: '4 / 3.3' }} />
						<div className="flex flex-col gap-4">
							<div className="mz-skel h-4 w-40" />
							<div className="mz-skel h-24 w-full" />
							<div className="mz-skel h-16 w-4/5" />
						</div>
					</div>
				</div>
			)
		}
		return isEditing ? (
			<div className="mz-wrap py-8">
				<StorefrontEditorHint>No live auction to put on the cover yet.</StorefrontEditorHint>
			</div>
		) : null
	}

	const href = auctionHref(item.coordinate)
	const title = item.title?.trim() || item.d
	const deckText = deck.trim() || summary?.trim() || ''
	const live = item.phase === 'open'

	return (
		<div className="mz-wrap">
			<section className={cn('mz-cover', isEditing && 'pointer-events-none')} data-testid="storefront-cover-auction">
				<a className="mz-cover-ph" href={href} aria-label={title}>
					<span className="mz-clip">
						<MagazineImage src={item.imageUrl} eager />
					</span>
					<span className="mz-pill" data-phase={live ? 'open' : 'ended'}>
						{live ? 'Live' : 'Ended'}
					</span>
					{sticker.trim() ? <span className="mz-sticker">{sticker}</span> : null}
				</a>
				<div>
					{kicker.trim() ? <div className="mz-kicker">{kicker}</div> : null}
					<h1>{title}</h1>
					{deckText ? <p className="mz-deck">{deckText}</p> : null}
					<div className="mz-stats">
						<div>
							<small>{item.topBidTotal !== null ? 'Current bid' : 'Starting bid'}</small>
							<div className="mz-v">
								{formatSats(bidOf(item))}
								<i>sats</i>
							</div>
						</div>
						<div>
							<small>{live ? 'Ends in' : 'Status'}</small>
							<div className="mz-v mz-hot" data-testid="storefront-cover-countdown">
								{live ? formatCountdown(item.endsAt, now) : 'Ended'}
							</div>
						</div>
						<div>
							<small>Bids</small>
							<div className="mz-v">{item.bidCount}</div>
						</div>
					</div>
					<div className="mz-actions">
						<a className="mz-btn" href={href}>
							{ctaLabel.trim() || 'Open the lot'} →
						</a>
						<a className="mz-btn mz-btn-ghost" href={allAuctionsHref}>
							All auctions
						</a>
					</div>
					<div className="mz-by">
						{renderSeller ? renderSeller(item.seller) : null}
						{footnote.trim() ? <span>{footnote}</span> : null}
					</div>
				</div>
			</section>
		</div>
	)
}

// ---------------------------------------------------------------------------
// Auction cards used by AuctionList's magazine layouts
// ---------------------------------------------------------------------------

export function ClosingAuctionCard({ item, now, href }: { item: AuctionListItem; now: number; href: string }) {
	const label = item.title?.trim() || item.d
	return (
		<a className="mz-cc" href={href} data-testid={`storefront-auction-${item.d}`} data-phase={item.phase}>
			<div className="mz-ph">
				<MagazineImage src={item.imageUrl} />
				<span className="mz-cd">{item.phase === 'open' ? formatCountdown(item.endsAt, now) : 'Ended'}</span>
			</div>
			<div className="mz-b">
				<div className="mz-t">{label}</div>
				<div className="mz-m">
					<span>{item.bidCount === 1 ? '1 bid' : `${item.bidCount} bids`}</span>
					<b>{formatSats(bidOf(item))}</b>
				</div>
				<div className="mz-bar" aria-hidden>
					<i style={{ width: `${item.phase === 'open' ? elapsedPercent(item, now) : 100}%` }} />
				</div>
			</div>
		</a>
	)
}

export function TallAuctionCard({ item, now, href }: { item: AuctionListItem; now: number; href: string }) {
	const label = item.title?.trim() || item.d
	const live = item.phase === 'open'
	return (
		<a className="mz-lc" href={href} data-testid={`storefront-auction-${item.d}`} data-phase={item.phase}>
			<div className="mz-ph">
				<MagazineImage src={item.imageUrl} />
				<span className="mz-pill" data-phase={live ? 'open' : 'ended'}>
					{live ? 'Live' : 'Ended'}
				</span>
				{live ? <span className="mz-cd2">{formatCountdown(item.endsAt, now)}</span> : null}
			</div>
			<h3>{label}</h3>
			<div className="mz-m">
				<span>{item.bidCount === 1 ? '1 bid' : `${item.bidCount} bids`}</span>
				<b>{formatSats(bidOf(item))} sats</b>
			</div>
		</a>
	)
}

// ---------------------------------------------------------------------------
// Product spread
// ---------------------------------------------------------------------------

export interface ProductSpreadBlockProps {
	title: string
	source: 'featured' | 'picked'
	productDTags: string[]
	kickers: { text: string }[]
	quote: string
	linkLabel: string
	linkHref: string
}

export interface MagazineProduct {
	key: string
	title: string
	imageUrl: string | null
	href: string
	summary?: string
	price: ReactNode
	seller?: ReactNode
}

export interface ProductSpreadBlockViewProps extends ProductSpreadBlockProps {
	products: MagazineProduct[] | null
	isLoading: boolean
}

const DEFAULT_KICKERS = ["Editor's pick", 'Staff favourite', 'Just restocked']

export function ProductSpreadBlock({ title, kickers, quote, linkLabel, linkHref, products, isLoading, source, productDTags }: ProductSpreadBlockViewProps) {
	const { isEditing } = useStorefrontContext()
	const items = (products ?? []).slice(0, 3)
	const kicker = (index: number) => kickers[index]?.text?.trim() || DEFAULT_KICKERS[index] || ''

	if (items.length === 0) {
		if (isLoading) {
			return (
				<div className="mz-wrap mz-sec" aria-busy="true">
					<MagazineHead title={title} />
					<div className="mz-spread">
						<div className="mz-skel" style={{ minHeight: 460 }} />
						<div className="mz-stack">
							<div className="mz-skel" style={{ minHeight: 240 }} />
							<div className="mz-skel" style={{ minHeight: 240 }} />
						</div>
					</div>
				</div>
			)
		}
		return isEditing ? (
			<div className="mz-wrap mz-sec">
				<MagazineHead title={title} />
				<StorefrontEditorHint>
					{source === 'picked' && productDTags.length === 0
						? 'Pick up to three products for the spread.'
						: 'No featured products yet. Feature some in App settings, or pick them here.'}
				</StorefrontEditorHint>
			</div>
		) : null
	}

	const [lead, ...rest] = items
	return (
		<div className={cn('mz-wrap mz-sec', isEditing && 'pointer-events-none')} data-testid="storefront-product-spread">
			<MagazineHead title={title} linkLabel={linkLabel} linkHref={linkHref} />
			<div className="mz-spread">
				<a className="mz-big" href={lead.href}>
					<MagazineImage src={lead.imageUrl} alt={lead.title} />
					<div className="mz-cap">
						<div className="mz-kicker">{kicker(0)}</div>
						<blockquote>{quote.trim() || lead.title}</blockquote>
						<div className="mz-row">
							<div>
								{quote.trim() ? <div className="text-sm opacity-80">{lead.title}</div> : null}
								<div className="mz-price">{lead.price}</div>
							</div>
							<span className="mz-btn">View item →</span>
						</div>
					</div>
				</a>
				{rest.length > 0 ? (
					<div className="mz-stack">
						{rest.map((product, index) => (
							<a key={product.key} className="mz-sm" href={product.href}>
								<div className="mz-ph">
									<MagazineImage src={product.imageUrl} alt={product.title} />
								</div>
								<div className="mz-b">
									<div>
										<div className="mz-kicker">{kicker(index + 1)}</div>
										<h3>{product.title}</h3>
									</div>
									<div className="mz-row">
										<span className="mz-price">{product.price}</span>
										<span className="mz-chip">View</span>
									</div>
								</div>
							</a>
						))}
					</div>
				) : null}
			</div>
		</div>
	)
}

// ---------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------

export interface CollectionRowBlockProps {
	title: string
	source: 'featured' | 'newest'
	limit: number
	linkLabel: string
	linkHref: string
}

export interface MagazineCollection {
	key: string
	title: string
	href: string
	images: string[]
	itemCount: number
	curator?: ReactNode
}

export interface CollectionRowBlockViewProps extends CollectionRowBlockProps {
	collections: MagazineCollection[] | null
	isLoading: boolean
}

export function CollectionRowBlock({ title, limit, linkLabel, linkHref, collections, isLoading }: CollectionRowBlockViewProps) {
	const { isEditing } = useStorefrontContext()
	const items = (collections ?? []).slice(0, Math.max(0, limit))

	if (items.length === 0) {
		if (isLoading) {
			return (
				<div className="mz-wrap mz-sec" aria-busy="true">
					<MagazineHead title={title} />
					<div className="mz-cols">
						{Array.from({ length: Math.min(4, limit) }, (_, index) => (
							<div key={index} className="mz-skel" style={{ height: 300 }} />
						))}
					</div>
				</div>
			)
		}
		return isEditing ? (
			<div className="mz-wrap mz-sec">
				<MagazineHead title={title} />
				<StorefrontEditorHint>No collections with images to show yet.</StorefrontEditorHint>
			</div>
		) : null
	}

	return (
		<div className={cn('mz-wrap mz-sec', isEditing && 'pointer-events-none')} data-testid="storefront-collection-row">
			<MagazineHead title={title} linkLabel={linkLabel} linkHref={linkHref} />
			<div className="mz-cols">
				{items.map((collection) => {
					const images = collection.images.slice(0, 3)
					return (
						<a key={collection.key} className="mz-col" href={collection.href}>
							<div className="mz-g" data-count={Math.max(1, images.length)}>
								{(images.length > 0 ? images : ['']).map((src, index) => (
									<div key={index}>
										<MagazineImage src={src || null} />
									</div>
								))}
							</div>
							<h3>{collection.title}</h3>
							<p>
								<span>{collection.itemCount === 1 ? '1 item' : `${collection.itemCount} items`}</span>
								{collection.curator ? (
									<>
										<span aria-hidden>·</span>
										{collection.curator}
									</>
								) : null}
							</p>
						</a>
					)
				})}
			</div>
		</div>
	)
}

// ---------------------------------------------------------------------------
// Category section
// ---------------------------------------------------------------------------

export interface CategorySectionBlockProps {
	label: string
	title: string
	subtitle: string
	tags: string
	limit: number
	linkLabel: string
}

export interface CategorySectionBlockViewProps extends CategorySectionBlockProps {
	/** Rendered product cards, supplied by the host. */
	products: ReactNode[] | null
	isLoading: boolean
	/** Host-resolved browse address for the section's tags. */
	browseHref: string
}

/** Comma-separated tags → trimmed, de-duplicated list. */
export function parseCategoryTags(tags: string): string[] {
	return [...new Set(tags.split(',').map((tag) => tag.trim()).filter((tag) => tag.length > 0))].slice(0, 10)
}

export function CategorySectionBlock({ label, title, subtitle, tags, limit, linkLabel, products, isLoading, browseHref }: CategorySectionBlockViewProps) {
	const { isEditing } = useStorefrontContext()
	const items = (products ?? []).slice(0, Math.max(0, limit))
	const head = (
		<MagazineHead title={title} label={label} subtitle={subtitle} linkLabel={linkLabel || (title ? `Browse ${title.replace(/\*/g, '').toLowerCase()}` : '')} linkHref={browseHref} />
	)

	if (parseCategoryTags(tags).length === 0) {
		return isEditing ? (
			<div className="mz-wrap mz-sec">
				{head}
				<StorefrontEditorHint>Add one or more product tags, separated by commas.</StorefrontEditorHint>
			</div>
		) : null
	}

	if (items.length === 0) {
		if (isLoading) {
			return (
				<div className="mz-wrap mz-sec" aria-busy="true">
					{head}
					<div className="mz-pg">
						{Array.from({ length: Math.min(5, limit) }, (_, index) => (
							<div key={index} className="mz-skel" style={{ aspectRatio: '1 / 1.35' }} />
						))}
					</div>
				</div>
			)
		}
		return isEditing ? (
			<div className="mz-wrap mz-sec">
				{head}
				<StorefrontEditorHint>No products with these tags yet.</StorefrontEditorHint>
			</div>
		) : null
	}

	return (
		<div className={cn('mz-wrap mz-sec', isEditing && 'pointer-events-none')} data-testid="storefront-category-section">
			{head}
			<div className="mz-pg">
				{items.map((product, index) => (
					<Fragment key={index}>{product}</Fragment>
				))}
			</div>
		</div>
	)
}
