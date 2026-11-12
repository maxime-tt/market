import type { ComponentProps, ReactNode } from 'react'
import { Media } from '../shared/media'
import { cn } from '../utils/cn'

/**
 * The auction **list card** — the presentational half, lifted verbatim out of
 * `src/components/AuctionCard.tsx` (the component retires in the same fused
 * commit).
 *
 * The bid subscription, the price/count derivations and the bidder-status
 * resolution stay in the host (`platform/web/auctions/AuctionCardHost.tsx`);
 * the resolved values arrive as props, and the host-owned pieces — the router
 * link, the countdown, the test-label notice and the compact bidder panel —
 * arrive as injected nodes/callbacks, so this view holds no query plumbing.
 *
 * Declared visible changes: the raw-palette classes of the retiring component
 * were migrated to the Tier-1 role vocabulary (grey/zinc → surface/text roles,
 * green → success, sky → info; the status pill → the success/warning roles).
 * Markup, copy and DOM structure are otherwise identical.
 */

/** The bidder-status chip data, resolved by the host (L-auction module). */
export interface AuctionCardBidderStatus {
	status: 'winning' | 'outbid' | 'won' | 'was_outbid'
	label: string
}

export interface AuctionCardViewProps extends Omit<ComponentProps<'div'>, 'children'> {
	/** Auction title. */
	title: string
	/** First image URL, or `null` for the "No image" placeholder. */
	imageUrl: string | null
	/** Current price in sats. */
	currentPrice: number
	/** Valid bid count. */
	bidsCount: number
	/** The signed-in bidder's status chip, or `null` to render the bid count. */
	bidderStatus: AuctionCardBidderStatus | null
	/** Bidding cutoff elapsed. */
	ended: boolean
	/** Lower-bound gate: `now < start_at`. */
	notStarted: boolean
	/** Router link factory (host-owned; the route is `to={`/auctions/${auction.id}`}`). */
	renderLink: (children: ReactNode, className?: string) => ReactNode
	/** Host-owned countdown node. */
	countdown?: ReactNode
	/** Host-owned test-label notice node (ADR-0009 compact marker). */
	testLabelNotice?: ReactNode
	/** Host-owned compact bidder node. */
	bidder?: ReactNode
}

const bidderStatusClassName = (status: AuctionCardBidderStatus['status']): string => {
	switch (status) {
		case 'winning':
		case 'won':
			return 'bg-success-muted text-success-muted-foreground border-success-border'
		case 'outbid':
		case 'was_outbid':
			return 'bg-warning-muted text-warning-muted-foreground border-warning-border'
	}
}

export function AuctionCardView({
	title,
	imageUrl,
	currentPrice,
	bidsCount,
	bidderStatus,
	ended,
	notStarted,
	renderLink,
	countdown,
	testLabelNotice,
	bidder,
	className,
	...props
}: AuctionCardViewProps) {
	const badgeClassName = ended
		? 'bg-surface-sunken text-text-high'
		: notStarted
			? 'bg-info text-info-foreground'
			: 'bg-success text-success-foreground'

	return (
		<div
			{...props}
			className={cn(
				'border border-fill-ink rounded-lg bg-bg shadow-sm flex flex-col w-full max-w-full overflow-hidden hover:shadow-md transition-shadow duration-200',
				className,
			)}
		>
			{renderLink(
				<>
					{imageUrl ? (
						<Media
							src={imageUrl}
							alt={title}
							className="w-full h-full object-cover rounded-t-[calc(var(--radius)-1px)] hover:scale-105 transition-transform duration-200"
						/>
					) : (
						<div className="w-full h-full bg-surface-sunken flex items-center justify-center text-text-mid rounded-lg hover:bg-surface-hover transition-colors duration-200">
							No image
						</div>
					)}
					{/* ADR-0009: a card reached by direct link, on a profile, or revealed
					    by the "Show test listings" toggle carries the compact marker.
					    Top-left — the top-right corner holds the LIVE/ENDED badge. */}
					{testLabelNotice}
					<div className={`absolute top-2 right-2 text-[10px] font-bold px-2 py-1 rounded ${badgeClassName}`}>
						{ended ? 'ENDED' : notStarted ? 'SCHEDULED' : 'LIVE'}
					</div>
				</>,
				'relative aspect-square overflow-hidden border-b border-border-strong block',
			)}

			<div className="p-2 flex flex-col gap-2 flex-grow">
				<h2 className="text-sm font-medium border-b border-[var(--light-gray)] pb-2 overflow-hidden text-ellipsis whitespace-nowrap">
					{renderLink(title, 'hover:underline')}
				</h2>

				<div className="flex justify-between items-center">
					<div className="text-sm font-semibold">{currentPrice.toLocaleString()} sats</div>
					{bidderStatus ? (
						<div className={`border font-semibold px-2 py-1 rounded-full text-xs ${bidderStatusClassName(bidderStatus.status)}`}>
							{bidderStatus.label}
						</div>
					) : (
						<div className="bg-[var(--light-gray)] font-medium px-4 py-1 rounded-full text-xs">
							{bidsCount} {bidsCount === 1 ? 'Bid' : 'Bids'}
						</div>
					)}
				</div>

				<div className="text-xs text-text-mid">{countdown}</div>

				{bidder}
			</div>
		</div>
	)
}
