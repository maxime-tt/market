import { useQuery } from '@tanstack/react-query'
import { getCoordsFromATag } from '@sdk/core/utils/coords'
import {
	auctionByATagQueryOptions,
	getAuctionBiddingCutoffAt,
	getAuctionImages,
	getAuctionSummary,
	getAuctionTitle,
} from '@platform/web/auctions/auctionsQuery'
import { AuctionCountdown } from '@platform/web/auctions/AuctionCountdownHost'
import { AuctionDisplayView } from '@ui/auction/auction-display-view'

export interface AuctionDisplayComponentProps {
	auctionCoords: string
	index: number
	onMoveUp?: () => void
	onMoveDown?: () => void
	onRemove: () => void
	canMoveUp?: boolean
	canMoveDown?: boolean
	isReordering?: boolean
	isRemoving: boolean
}

/**
 * App-settings featured-auction row host. Moved verbatim from the retired
 * `src/components/AuctionDisplayComponent.tsx`: it owns the by-a-tag auction
 * query and the read-model derivations, then hands the resolved values and the
 * `<AuctionCountdown>` node to the props-only `AuctionDisplayView`. The public
 * prop interface is unchanged, so the route's JSX is untouched. The leaf passed
 * `className="max-w-full"` to `<AuctionCountdown>`, which does not accept or
 * render it; the inert prop is dropped here (no DOM change, one fewer type error).
 */
export function AuctionDisplayComponent({
	auctionCoords,
	onMoveUp,
	onMoveDown,
	onRemove,
	canMoveUp,
	canMoveDown,
	isReordering,
	isRemoving,
}: AuctionDisplayComponentProps) {
	const coords = getCoordsFromATag(auctionCoords)

	const { data: auction } = useQuery({
		...auctionByATagQueryOptions(coords.pubkey, coords.identifier),
		enabled: coords.kind === 30408 && !!coords.pubkey && !!coords.identifier,
	})

	const title = auction ? getAuctionTitle(auction) : 'Loading...'
	const summary = auction ? getAuctionSummary(auction) : 'No summary available'
	const images = auction ? getAuctionImages(auction) : []
	const imageUrl = images.length > 0 ? images[0][1] : null
	const biddingCutoffAt = auction ? getAuctionBiddingCutoffAt(auction) : 0
	const endAtLabel = biddingCutoffAt ? new Date(biddingCutoffAt * 1000).toLocaleString() : 'No end date'

	return (
		<AuctionDisplayView
			title={title}
			summary={summary}
			imageUrl={imageUrl}
			endAtLabel={endAtLabel}
			coordsIdentifier={coords.identifier}
			countdownSlot={auction ? <AuctionCountdown auction={auction} /> : undefined}
			onMoveUp={onMoveUp}
			onMoveDown={onMoveDown}
			onRemove={onRemove}
			canMoveUp={canMoveUp}
			canMoveDown={canMoveDown}
			isReordering={isReordering}
			isRemoving={isRemoving}
		/>
	)
}
