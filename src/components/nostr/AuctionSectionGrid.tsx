import { AuctionCardHost as AuctionCard } from '@platform/web/auctions/AuctionCardHost'
import { getAuctionBidderStatus } from '@/lib/auctionBidderStatus'
import { InvalidAuctionBidBlock } from '@/components/InvalidAuctionNotice'
import { ItemGrid } from '@ui/shared/item-grid'
import { cn } from '@/lib/utils'
import { getAuctionRootEventId } from '@/queries/auctions'
import type { NostrEventLike } from '@/lib/nostr/eventLike'

interface AuctionSectionGridProps {
	title: string
	auctions: NostrEventLike[]
	bidsByAuctionId?: Map<string, NostrEventLike[]>
	emptyMessage?: string
	className?: string
}

export function AuctionSectionGrid({ title, auctions, bidsByAuctionId, emptyMessage, className }: AuctionSectionGridProps) {
	if (auctions.length === 0 && !emptyMessage) return null

	return (
		<div className={cn('w-full max-w-full overflow-hidden', className)}>
			<div className="mb-4">
				<h1 className="text-xl sm:text-2xl font-heading text-center sm:text-left">{title}</h1>
			</div>

			{auctions.length > 0 ? (
				<ItemGrid className="gap-4 sm:gap-8">
					{auctions.map((auction) => (
						<AuctionCard
							key={auction.id}
							auction={auction}
							bids={bidsByAuctionId?.get(getAuctionRootEventId(auction) || auction.id)}
							getBidderStatus={(input) => getAuctionBidderStatus(input as unknown as Parameters<typeof getAuctionBidderStatus>[0])}
							renderBidBlocked={(admission) => <InvalidAuctionBidBlock admission={admission} itemLabel="auction" compact />}
						/>
					))}
				</ItemGrid>
			) : (
				<p className="text-sm text-muted-foreground text-center py-4">{emptyMessage}</p>
			)}
		</div>
	)
}
