/**
 * platform/web/auctions/AuctionCardHost.tsx — host for the auction list card.
 *
 * Moved verbatim out of `src/components/AuctionCard.tsx` (the component retires in this
 * fused commit): this half owns the bid subscription (`@platform/web/auctions/auctionsQuery`),
 * the read-model derivations, the countdown (`AuctionCountdownHost`), the test-label
 * coordinate (`@sdk/config/testLabelFilters`), the compact bidder panel
 * (`AuctionBidderHost`) and the router link, and hands the resolved values plus the
 * host-owned nodes to the props-only `@ui/auction/auction-card-view`. The host holds no
 * `platform -> @/` edge.
 *
 * The bidder-status derivation (`getBidderStatus`) and the spec-validity gate's blocked
 * panel (`renderBidBlocked`) are injected by the caller: both live in `src/` modules that
 * are still owned by other slices (L-auction's `src/lib/auctionBidderStatus.ts` and the
 * H-e7 auction notices), and this host may not add a `platform -> src` edge while the
 * inbound boundary is frozen.
 *
 * Declared inert drops (dead in the retiring component — set, never read; verified by
 * importer grep before landing): the `usePublishAuctionBidMutation` call, the
 * `bidAmountInput` state and its min-bid effect, the `minBid` memo (its only consumer was
 * that effect), the `isOwnAuction` state and its `applesauceIo.getUser()` effect, and the
 * `acceptedMints` / `keyScheme` / `p2pkXpub` / `pathIssuerPubkey` derivations. None is
 * rendered, returned, or passed down — the bidder panel derives its own values.
 *
 * The retiring card also passed `className="w-full justify-between"` and `compact` to
 * `<AuctionCountdown>`, which accepts neither (the platform countdown's surface is
 * `{ auction, bids? }`), so those inert props are dropped with it — no DOM change, one fewer
 * pre-existing error site (the AuctionDisplayHost precedent).
 */
import type { HTMLAttributes, ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import { useMemo } from 'react'
import type { NostrEventLike } from '@sdk/core/nostr/eventLike'
import type { AuctionAdmission } from '@sdk/commerce/auctions/schemas/auctionAdmission'
import { getItemTestLabelCoordinate } from '@sdk/config/testLabelFilters'
import { authStore } from '@platform/web/auth/authStore'
import { TestListingNoticeHost } from '@platform/web/config/testListingNoticeHost'
import { AuctionCountdown, useAuctionCountdown } from '@platform/web/auctions/AuctionCountdownHost'
import {
	getAuctionBidCountFromBids,
	getAuctionBiddingCutoffAt,
	getAuctionCurrentPriceFromBids,
	getAuctionId,
	getAuctionImages,
	getAuctionRootEventId,
	getAuctionStartAt,
	getAuctionStartingBid,
	getAuctionTitle,
	useAuctionBids,
} from '@platform/web/auctions/auctionsQuery'
import { AuctionBidderHost } from '@platform/web/auctions/AuctionBidderHost'
import { AuctionCardView, type AuctionCardBidderStatus } from '@ui/auction/auction-card-view'

/** The pure bidder-status derivation, injected by the caller (L-auction module today). */
export type AuctionBidderStatusDeriver = (input: {
	currentUserPubkey?: string | null
	auction: NostrEventLike
	bids: NostrEventLike[]
	isEnded: boolean
}) => AuctionCardBidderStatus | null

export interface AuctionCardHostProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
	auction: NostrEventLike
	/**
	 * Pre-fetched bids from a parent (the auctions list). Skip the internal bid
	 * subscription when provided.
	 */
	bids?: NostrEventLike[]
	getBidderStatus: AuctionBidderStatusDeriver
	/** The spec-validity gate's blocked panel (injected; see the module header). */
	renderBidBlocked: (admission: AuctionAdmission) => ReactNode
}

export function AuctionCardHost({ auction, bids: bidsProp, getBidderStatus, renderBidBlocked, className, ...props }: AuctionCardHostProps) {
	const { user: currentUser } = useStore(authStore)
	const title = getAuctionTitle(auction)
	const images = getAuctionImages(auction)
	const startingBid = getAuctionStartingBid(auction)
	// ADR-0009: resolve the item coordinate once; the notice renders nothing
	// unless that coordinate carries an active test label.
	const testLabelCoordinate = getItemTestLabelCoordinate(auction)
	// When a parent (the auctions list) supplies bids in bulk, skip the per-
	// card subscription. Empty-string args disable the underlying query.
	const shouldFetchBids = bidsProp === undefined
	const auctionDTag = getAuctionId(auction)
	const auctionRootEventId = getAuctionRootEventId(auction)
	const auctionCoordinates = auctionDTag ? `30408:${auction.pubkey}:${auctionDTag}` : ''
	const bidsQuery = useAuctionBids(
		shouldFetchBids ? auctionRootEventId || auction.id : '',
		500,
		shouldFetchBids ? auctionCoordinates : undefined,
	)
	const bids = bidsProp ?? bidsQuery.data ?? []
	const startAt = getAuctionStartAt(auction)
	const biddingCutoffAt = getAuctionBiddingCutoffAt(auction)
	const countdown = useAuctionCountdown(biddingCutoffAt, { showSeconds: true })

	const currentPrice = getAuctionCurrentPriceFromBids(auction, bids, startingBid)
	const bidsCount = getAuctionBidCountFromBids(auction, bids)
	const ended = countdown.isEnded
	// Lower-bound gate: bids cannot be placed before start_at. Mirrors the
	// hard refusal in `publishAuctionBid` so users don't see a bid form for
	// auctions that haven't opened yet.
	const notStarted = startAt > 0 && countdown.now < startAt
	const bidderStatus = useMemo(
		() =>
			getBidderStatus({
				currentUserPubkey: currentUser?.pubkey,
				auction,
				bids,
				isEnded: ended,
			}),
		// The injected deriver is a stable module-level function at every call site.
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[currentUser?.pubkey, auction, bids, ended, getBidderStatus],
	)

	const href = `/auctions/${auction.id}`
	const renderLink = (children: ReactNode, linkClassName?: string) => (
		<Link to={href} className={linkClassName}>
			{children}
		</Link>
	)

	return (
		<AuctionCardView
			{...props}
			title={title}
			imageUrl={images.length > 0 ? images[0][1] : null}
			currentPrice={currentPrice}
			bidsCount={bidsCount}
			bidderStatus={bidderStatus}
			ended={ended}
			notStarted={notStarted}
			renderLink={renderLink}
			countdown={<AuctionCountdown auction={auction} bids={bids} />}
			testLabelNotice={
				testLabelCoordinate ? (
					<TestListingNoticeHost
						coordinate={testLabelCoordinate}
						itemLabel="Auction"
						variant="icon"
						className="absolute top-2 left-2 z-10"
					/>
				) : undefined
			}
			bidder={
				<AuctionBidderHost
					auction={auction}
					currentUserPubkey={currentUser?.pubkey}
					bids={bids}
					compact
					renderBidBlocked={renderBidBlocked}
				/>
			}
			className={className}
		/>
	)
}
