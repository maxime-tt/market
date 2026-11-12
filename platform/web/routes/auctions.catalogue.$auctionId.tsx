import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useStore } from '@tanstack/react-store'
import { useEffect, useMemo, useState } from 'react'
import { authStore } from '@platform/web/auth/authStore'
import { auctionsStateQueryOptions } from '@platform/web/auctions/catalogue/catalogueQuery'
import {
	computeBidPosition,
	deltaForPosition,
	type AuctionBidRules,
	type BidInput,
} from '@platform/web/auctions/catalogue/bidMath'
import { createCatalogueProtocolClient, placeCustodialBid } from '@platform/web/auctions/catalogue/catalogueProtocolClient'
import {
	CatalogueDetailView,
	type CatalogueBidPreviewView,
	type CatalogueDetailAuctionView,
	type CatalogueDetailBidView,
} from '@ui/auctions/catalogue/catalogue-detail-view'

/**
 * `/auctions/catalogue/$auctionId` — one Catalogue lot, Layout A.
 *
 * The host owns everything the pure view cannot: the committed-state read, the
 * signer, the clock, and the bid. Reads come from the same same-origin state
 * document the list uses (3s poll; the chain publishes on a 1s cadence), and the
 * countdown is driven by that document's `last_consensus_time` — never the
 * browser clock, because the backend evaluates deadlines against block time.
 *
 * A bid is a DELTA on the bidder's position (§6). The field is the bidder's
 * chosen *total*; `bidMath` turns it into the delta the wire wants, and the view
 * states both so "it bid more than I typed" cannot happen silently.
 */
export const Route = createFileRoute('/auctions/catalogue/$auctionId')({
	component: CatalogueDetailRoute,
})

const NO_BIDS_RULES: AuctionBidRules = { startingBid: 0, minIncrement: 1 }

function CatalogueDetailRoute() {
	const { auctionId } = Route.useParams()
	const navigate = useNavigate()
	const queryClient = useQueryClient()
	const { user } = useStore(authStore)
	const viewerPubkey = user?.pubkey ?? null

	const { data, isLoading, isError } = useQuery(auctionsStateQueryOptions())
	const [positionInput, setPositionInput] = useState('')
	const [isSubmitting, setIsSubmitting] = useState(false)
	const [submitError, setSubmitError] = useState<string | null>(null)
	const [submitSuccess, setSubmitSuccess] = useState<string | null>(null)

	const auction = data?.auctions[auctionId] ?? null

	const auctionBids: BidInput[] = useMemo(
		() =>
			Object.values(data?.bids ?? {})
				.filter((bid) => bid.auction_id === auctionId)
				.map((bid) => ({ id: bid.id, bidder: bid.bidder, amount: bid.amount })),
		[data, auctionId],
	)

	const bidFeed: CatalogueDetailBidView[] = useMemo(
		() =>
			Object.values(data?.bids ?? {})
				.filter((bid) => bid.auction_id === auctionId)
				.map((bid) => ({ id: bid.id, bidder: bid.bidder, amount: bid.amount, committedAt: bid.committed_at })),
		[data, auctionId],
	)

	const rules: AuctionBidRules = auction
		? {
				startingBid: auction.starting_bid,
				minIncrement: auction.min_increment,
				highBid: auction.high_bid,
				leaderBidId: auction.leader_bid_id,
			}
		: NO_BIDS_RULES

	const bidPosition = useMemo(
		() => computeBidPosition(rules, auctionBids, viewerPubkey ?? ''),
		[rules.startingBid, rules.minIncrement, rules.highBid, rules.leaderBidId, auctionBids, viewerPubkey],
	)

	// Prime the field with the minimum total once the auction (and its floor) is known.
	useEffect(() => {
		if (auction) setPositionInput(String(bidPosition.minNextPosition))
	}, [auction?.id, bidPosition.minNextPosition])

	const preview: CatalogueBidPreviewView | null = useMemo(() => {
		if (positionInput === '') return null
		const requested = parseInt(positionInput, 10)
		if (!Number.isFinite(requested)) return null
		try {
			const delta = deltaForPosition(requested, rules, auctionBids, viewerPubkey ?? '')
			return { delta, resultingPosition: requested, belowMinimum: false }
		} catch {
			return {
				delta: Math.max(0, requested - bidPosition.myPosition),
				resultingPosition: requested,
				belowMinimum: true,
			}
		}
	}, [positionInput, rules.startingBid, rules.minIncrement, rules.highBid, rules.leaderBidId, auctionBids, viewerPubkey, bidPosition.myPosition])

	const handleSubmitBid = async () => {
		if (!auction || !viewerPubkey || !preview || preview.belowMinimum || isSubmitting) return
		setIsSubmitting(true)
		setSubmitError(null)
		setSubmitSuccess(null)
		try {
			const event = await placeCustodialBid(createCatalogueProtocolClient(), {
				auctionId: auction.id,
				bidder: viewerPubkey,
				delta: preview.delta,
				fundingMode: auction.funding_mode,
			})
			setSubmitSuccess(`Bid published (${event.id.slice(0, 12)}…). The chain commits it in about a block.`)
			await queryClient.invalidateQueries({ queryKey: auctionsStateQueryOptions().queryKey })
		} catch (err) {
			setSubmitError(err instanceof Error ? err.message : String(err))
		} finally {
			setIsSubmitting(false)
		}
	}

	const auctionView: CatalogueDetailAuctionView | null = auction
		? {
				id: auction.id,
				title: auction.title,
				seller: auction.seller,
				description: auction.description,
				imageUrl: auction.image_url,
				startingBid: auction.starting_bid,
				minIncrement: auction.min_increment,
				endTime: auction.end_time,
				originalEndTime: auction.original_end_time,
				requiredLocktime: auction.required_locktime,
				status: auction.status,
				fundingMode: auction.funding_mode,
				reserve: auction.reserve,
				extensionCount: auction.extension_count,
			}
		: null

	if (isError) {
		return (
			<div className="cat" style={{ minHeight: '60vh' }}>
				<div className="cat__wrap">
					<p className="cat__empty">The auction network could not be read.</p>
				</div>
			</div>
		)
	}

	return (
		<CatalogueDetailView
			auction={auctionView}
			bids={bidFeed}
			viewerPubkey={viewerPubkey}
			bidPosition={bidPosition}
			positionInput={positionInput}
			onPositionInput={setPositionInput}
			preview={preview}
			isSubmitting={isSubmitting || isLoading}
			onSubmitBid={handleSubmitBid}
			submitError={submitError}
			submitSuccess={submitSuccess}
			now={data?.last_consensus_time ?? 0}
			onBack={() => navigate({ to: '/auctions/catalogue' })}
		/>
	)
}
