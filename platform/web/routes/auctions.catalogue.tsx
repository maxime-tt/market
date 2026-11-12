import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { auctionsStateQueryOptions } from '@platform/web/auctions/catalogue/catalogueQuery'
import { CatalogueView, type CatalogueAuctionView } from '@ui/auctions/catalogue/catalogue-view'

/**
 * `/auctions/catalogue` — the Catalogue list, Layout A.
 *
 * This is the pplx baseline's list surface, built against the extraction rather
 * than the mockup: light editorial tokens (see `catalogue-theme.css`), one card
 * per lot, and every number taken from the backend's committed state. The
 * countdown uses `last_consensus_time` from that same document, because the
 * backend evaluates deadlines against block time — a browser-clock countdown
 * would drift from the auction it describes.
 */
export const Route = createFileRoute('/auctions/catalogue')({
	component: CatalogueIndex,
})

function CatalogueIndex() {
	const navigate = useNavigate()
	const { data, isLoading, isError } = useQuery(auctionsStateQueryOptions())

	const auctions: CatalogueAuctionView[] | null = data
		? Object.values(data.auctions)
				.slice()
				.sort((a, b) => a.end_time - b.end_time)
				.map((auction) => ({
					id: auction.id,
					title: auction.title,
					seller: auction.seller,
					imageUrl: auction.image_url,
					startingBid: auction.starting_bid,
					highBid: auction.high_bid,
					endTime: auction.end_time,
					status: auction.status,
					fundingMode: auction.funding_mode,
				}))
		: null

	return (
		<CatalogueView
			auctions={auctions}
			isLoading={isLoading}
			isError={isError}
			now={data?.last_consensus_time ?? 0}
			onSelect={(auctionId) => navigate({ to: '/auctions/catalogue/$auctionId', params: { auctionId } })}
		/>
	)
}
