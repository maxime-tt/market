import { cn } from '@ui/utils/cn'
import type { ReactNode } from 'react'
import { useStorefrontContext } from '../StorefrontContext'
import { isSafeMediaSrc } from '@sdk/commerce/storefront/storefrontPage'
import { StorefrontEditorHint, StorefrontSection, StorefrontSectionTitle } from './shared'
import { ClosingAuctionCard, MagazineHead, TallAuctionCard } from './MagazineBlocks'

/**
 * A listing of auctions an author can place in a page.
 *
 * This is the "interconnected" step for auctions: they stop being a route with
 * no inbound links and become something an author composes with.
 *
 * Props-only, per `ui/AGENTS.md`: no `fetch`, no `useQuery`, no relay client,
 * no `@platform/…` import. The platform host reads the auctions through
 * `arenaAuctionRead` and passes them down as plain data — including the state
 * of the read itself, because this block's whole job is to be *honest* about
 * what it does and does not know.
 *
 * ## The honesty rules this view enforces
 *
 * - A count is a **verdict**, and a verdict is only true once the read has
 *   finished. While `status === 'loading'` the block never claims how many
 *   auctions exist; it says what it has delivered *so far*.
 * - `incomplete` (a relay timed out, or the read stopped early) keeps the
 *   auctions that arrived and says the picture is partial. It never falls
 *   through to "no auctions here", which would be a claim it cannot make.
 * - `no-relays` is not an empty result: nothing was read, so nothing is said
 *   about whether auctions exist.
 * - An auction whose on-chain verification is unknown says so. The verdict is
 *   relay-reported and the block labels it that way — the relay notifies, the
 *   chain decides.
 * - `emptyMessage` ("no auctions yet") is reachable **only** from `settled`.
 *
 * The read-model types below are deliberately structural: `ui/` may import
 * `@sdk/…` types, and these are the plain shapes the platform adapter produces.
 */

/** The document-facing configuration of the block (what the page event stores). */
export interface AuctionListBlockProps {
	title: string
	/** `mine` = the page author's auctions; `picked` = the explicit coordinates below. */
	source: 'mine' | 'picked' | 'all'
	/** Ordered `1440:<seller>:<d>` references, used when `source` is `picked`. */
	auctionCoordinates: string[]
	limit: number
	emptyMessage: string
	/** Card style (ADR-0028): `grid` (original), `closing` (countdown + time bar) or `tall` (4:5 magazine card). */
	layout?: 'grid' | 'closing' | 'tall'
	/** Order for `all`; applied by the host. */
	sort?: 'ending' | 'popular' | 'newest'
	linkLabel?: string
	linkHref?: string
}

/** One auction, as the host read it. No field here is stored in the document. */
export interface AuctionListItem {
	/** `1440:<seller>:<d>`, the identity this block links with. */
	coordinate: string
	seller: string
	/** The auction's `d` tag. */
	d: string
	title: string | null
	/** The lot's cover image (`image` on the wire), or `null`. Re-gated before rendering. */
	imageUrl?: string | null
	startingBid: number | null
	/** Summed from the bid **deltas** — a derived view, not the outcome. */
	topBidTotal: number | null
	bidCount: number
	/** `created_at + duration_seconds`, or `null` when the create carried no duration. */
	endsAt: number | null
	/** The root create's `created_at`, so a card can draw how much time has gone. */
	startsAt?: number | null
	/** `unknown` is a real answer: a create with no duration has no end to state. */
	phase: 'open' | 'ended' | 'unknown'
	/** The relay-reported verdict outcome, or `null` when no verdict has been read. */
	verdict: string | null
}

/**
 * The state of the read that produced the list.
 *
 * `loading`  — still running; the items are what arrived so far.
 * `settled`  — every relay has been accounted for (it answered, refused the
 *              subscription, or could not be reached); an empty list is a verdict.
 * `incomplete` — a relay has not been heard from at all, so the read is partial.
 * `no-relays` — nothing answered; this is not "no auctions".
 * `error`    — the read threw, or no host supplied the data.
 */
export type AuctionListStatus = 'loading' | 'settled' | 'incomplete' | 'no-relays' | 'error'

/** The props-only view contract: the block plus its data and read state. */
export interface AuctionListBlockViewProps extends AuctionListBlockProps {
	/** The auctions read so far; `null` means no data reached the view. */
	auctions: AuctionListItem[] | null
	/** Requested coordinates the read did not deliver. Meaning depends on `status`. */
	missing: string[]
	status: AuctionListStatus
	/** Relays that answered, out of the relays the read opened. */
	relayHealth: { answered: number; total: number }
	/** Host-supplied link target for one auction (the block never invents a route). */
	auctionHref: (coordinate: string) => string
	/** Unix seconds for the countdowns; the host ticks it. Defaults to the render time. */
	now?: number
}

/** A pubkey is unreadable in full at card size; keep the ends, drop the middle. */
function shortKey(key: string): string {
	return key.length <= 14 ? key : `${key.slice(0, 6)}…${key.slice(-4)}`
}

function phaseLabel(item: AuctionListItem): string {
	if (item.phase === 'open') return 'Open'
	if (item.phase === 'ended') return 'Ended'
	return 'End time unknown'
}

function AuctionCard({ item, auctionHref }: { item: AuctionListItem; auctionHref: (coordinate: string) => string }) {
	const label = item.title?.trim() || item.d
	// Relay content is untrusted: only `https:` or in-app paths reach an <img>.
	const image = item.imageUrl && isSafeMediaSrc(item.imageUrl) ? item.imageUrl : null
	return (
		<article
			data-testid={`storefront-auction-${item.d}`}
			data-phase={item.phase}
			data-verdict={item.verdict ?? 'unknown'}
			className="flex flex-col gap-2 overflow-hidden rounded-lg border border-border bg-card p-4"
		>
			<a href={auctionHref(item.coordinate)} className="-mx-4 -mt-4 mb-2 block aspect-square overflow-hidden bg-muted" tabIndex={-1} aria-hidden="true">
				{image ? (
					<img
						src={image}
						alt=""
						loading="lazy"
						referrerPolicy="no-referrer"
						data-testid={`storefront-auction-${item.d}-image`}
						className="h-full w-full object-cover transition-transform duration-200 hover:scale-105"
					/>
				) : (
					<span className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">No image published</span>
				)}
			</a>
			<a href={auctionHref(item.coordinate)} className="font-header text-lg font-semibold text-foreground hover:underline">
				{label}
			</a>
			<p className="text-xs text-muted-foreground">by {shortKey(item.seller)}</p>

			<p data-testid={`storefront-auction-${item.d}-phase`} className="text-sm text-foreground">
				{phaseLabel(item)}
			</p>

			{item.startingBid !== null && (
				<p data-testid={`storefront-auction-${item.d}-starting-bid`} className="text-sm text-muted-foreground">
					Starting bid {item.startingBid} sats
				</p>
			)}

			{item.topBidTotal !== null && (
				<p data-testid={`storefront-auction-${item.d}-top-bid`} className="text-sm text-foreground">
					{item.bidCount === 1 ? '1 bid' : `${item.bidCount} bids`} · top {item.topBidTotal} sats
				</p>
			)}

			{item.verdict !== null ? (
				<p data-testid={`storefront-auction-${item.d}-verdict`} className="text-sm text-foreground">
					{/* The relay notifies, the chain decides: this is a published claim, not a receipt. */}
					Outcome: {item.verdict} (relay-reported)
				</p>
			) : item.phase === 'ended' ? (
				<p data-testid={`storefront-auction-${item.d}-unverified`} className="text-sm text-muted-foreground">
					Outcome not verified yet.
				</p>
			) : null}
		</article>
	)
}

export function AuctionListBlock({
	title,
	source,
	auctionCoordinates,
	limit,
	emptyMessage,
	auctions,
	missing,
	status,
	relayHealth,
	auctionHref,
	layout = 'grid',
	linkLabel = '',
	linkHref = '',
	now = Math.floor(Date.now() / 1000),
}: AuctionListBlockViewProps) {
	const { isEditing } = useStorefrontContext()
	const items = (auctions ?? []).slice(0, Math.max(0, limit))

	if (layout !== 'grid') {
		return (
			<MagazineAuctionList
				title={title}
				layout={layout}
				linkLabel={linkLabel}
				linkHref={linkHref}
				emptyMessage={emptyMessage}
				items={items}
				limit={limit}
				status={status}
				now={now}
				auctionHref={auctionHref}
				pickedNothing={source === 'picked' && auctionCoordinates.length === 0}
				isEditing={isEditing}
			/>
		)
	}

	// Picked mode with nothing picked is an authoring gap, not a visitor fact.
	if (source === 'picked' && auctionCoordinates.length === 0) {
		return isEditing ? (
			<StorefrontSection className="py-8">
				<StorefrontSectionTitle title={title} />
				<StorefrontEditorHint>Pick the auctions this section should show.</StorefrontEditorHint>
			</StorefrontSection>
		) : null
	}

	return (
		<StorefrontSection className={cn('py-10', isEditing && 'pointer-events-none')}>
			<StorefrontSectionTitle title={title} />

			<div data-testid="storefront-auction-list" data-state={status}>
				{/* Nothing delivered yet. No count, because there is no verdict yet. */}
				{status === 'loading' && items.length === 0 && (
					<p data-testid="storefront-auction-list-loading" className="py-8 text-center text-muted-foreground">
						Reading auctions from relays…
					</p>
				)}

				{status === 'loading' && items.length > 0 && (
					<p data-testid="storefront-auction-list-progress" className="mb-4 text-sm text-muted-foreground">
						Still reading relays · {items.length} {items.length === 1 ? 'auction' : 'auctions'} so far
						{relayHealth.total > 0 && ` · ${relayHealth.answered} of ${relayHealth.total} relays answered`}
					</p>
				)}

				{status === 'incomplete' && (
					<p data-testid="storefront-auction-list-incomplete" className="mb-4 text-sm text-muted-foreground">
						This read stopped before every relay answered. What is shown is what arrived, not the whole picture.
					</p>
				)}

				{status === 'no-relays' && (
					<p data-testid="storefront-auction-list-unreachable" className="py-8 text-center text-muted-foreground">
						No relay answered, so these auctions could not be read. This is not the same as there being none.
					</p>
				)}

				{status === 'error' && (
					<p data-testid="storefront-auction-list-error" className="py-8 text-center text-muted-foreground">
						Auctions could not be loaded right now.
					</p>
				)}

				{/* The one place an empty list is allowed to be an answer. */}
				{status === 'settled' && items.length === 0 && (
					<p data-testid="storefront-auction-list-empty" className="py-8 text-center text-muted-foreground">
						{emptyMessage.trim() || 'No auctions here yet.'}
					</p>
				)}

				{items.length > 0 && (
					<div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
						{items.map((item) => (
							<AuctionCard key={item.coordinate} item={item} auctionHref={auctionHref} />
						))}
					</div>
				)}

				{missing.length > 0 && (
					// A requested auction with no data means different things in
					// different read states, and the two are not interchangeable.
					<p
						data-testid="storefront-auction-list-missing"
						data-settled={status === 'settled'}
						className="mt-4 text-sm text-muted-foreground"
					>
						{status === 'settled'
							? `${missing.length} requested ${missing.length === 1 ? 'auction was' : 'auctions were'} not found on the relays.`
							: `${missing.length} requested ${missing.length === 1 ? 'auction has' : 'auctions have'} not arrived yet.`}
					</p>
				)}
			</div>
		</StorefrontSection>
	)
}

/**
 * The magazine layouts (ADR-0028). The same honesty rules hold, said more
 * briefly: a skeleton while nothing has arrived, the cards that did arrive on a
 * partial read, and the empty message only once the read has settled.
 */
function MagazineAuctionList({
	title,
	layout,
	linkLabel,
	linkHref,
	emptyMessage,
	items,
	limit,
	status,
	now,
	auctionHref,
	pickedNothing,
	isEditing,
}: {
	title: string
	layout: 'closing' | 'tall'
	linkLabel: string
	linkHref: string
	emptyMessage: string
	items: AuctionListItem[]
	limit: number
	status: AuctionListStatus
	now: number
	auctionHref: (coordinate: string) => string
	pickedNothing: boolean
	isEditing: boolean
}) {
	const gridClass = layout === 'closing' ? 'mz-close' : 'mz-lots'
	if (pickedNothing) {
		return isEditing ? (
			<div className="mz-wrap mz-sec">
				<MagazineHead title={title} />
				<StorefrontEditorHint>Pick the auctions this section should show.</StorefrontEditorHint>
			</div>
		) : null
	}
	let body: ReactNode
	if (items.length > 0) {
		body = (
			<div className={gridClass}>
				{items.map((item) =>
					layout === 'closing' ? (
						<ClosingAuctionCard key={item.coordinate} item={item} now={now} href={auctionHref(item.coordinate)} />
					) : (
						<TallAuctionCard key={item.coordinate} item={item} now={now} href={auctionHref(item.coordinate)} />
					),
				)}
			</div>
		)
	} else if (status === 'loading') {
		const count = Math.min(limit, layout === 'closing' ? 6 : 4)
		body = (
			<div className={gridClass} aria-busy="true" data-testid="storefront-auction-list-loading">
				{Array.from({ length: count }, (_, index) => (
					<div key={index} className="mz-skel" style={{ aspectRatio: layout === 'closing' ? '1 / 1.45' : '4 / 6' }} />
				))}
			</div>
		)
	} else if (status === 'settled') {
		body = <p className="py-8 text-center text-muted-foreground">{emptyMessage.trim() || 'No auctions here yet.'}</p>
	} else {
		body = <p className="py-8 text-center text-muted-foreground">Auctions could not be read right now.</p>
	}
	return (
		<div className={cn('mz-wrap mz-sec', isEditing && 'pointer-events-none')}>
			<MagazineHead title={title} linkLabel={linkLabel} linkHref={linkHref} />
			<div data-testid="storefront-auction-list" data-state={status} data-layout={layout}>
				{body}
			</div>
		</div>
	)
}
