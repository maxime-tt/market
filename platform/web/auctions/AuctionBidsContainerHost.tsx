/**
 * platform/web/auctions/AuctionBidsContainerHost.tsx — host for the auction bids list.
 *
 * Legacy source: `src/components/AuctionBidsContainer.tsx` (deleted in this fused
 * slice, D4 S5a). It keeps the exact legacy prop surface, reads the streaming bid
 * set through `@platform/web/auctions/auctionsQuery`, resolves each bidder through
 * the wave-3 `UserCardHost`, and hands the props-only `@ui/auction/auction-bids-view`
 * the data plus the identity slot — so the host holds no platform-to-src edge and
 * the view holds no query plumbing.
 */
import type { ValidatedBidSet } from '@sdk/commerce/auctions/bidValidation'
import { useStreamingAuctionBids } from '@platform/web/auctions/auctionsQuery'
import { UserCardHost } from '@platform/web/profiles/userCardHosts'
import { AuctionBidsView } from '@ui/auction/auction-bids-view'

interface Props {
	auctionRootEventId: string
	auctionCoordinates: string
	currentUserPubkey?: string
	isEnded?: boolean
	className?: string
	/**
	 * Optional validated bid set. When present, the highest-bid badge,
	 * outbid notice, and bid-list classifications are derived from the
	 * validated set's canonicalWinner and classification instead of raw
	 * bid chain computation.
	 */
	validatedBidSet?: ValidatedBidSet | null
}

export function AuctionBidsContainerHost({
	auctionRootEventId,
	auctionCoordinates,
	currentUserPubkey,
	isEnded,
	className,
	validatedBidSet,
}: Props) {
	const { bids, isStreaming } = useStreamingAuctionBids(auctionRootEventId, 500, auctionCoordinates)

	return (
		<AuctionBidsView
			bids={bids}
			validatedBidSet={validatedBidSet}
			currentUserPubkey={currentUserPubkey}
			isEnded={isEnded}
			isLoading={isStreaming}
			className={className}
			renderUserCard={(pubkey, size) => <UserCardHost pubkey={pubkey} size={size} />}
		/>
	)
}
