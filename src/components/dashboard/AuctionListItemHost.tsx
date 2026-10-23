import { ExternalLink, Hourglass } from 'lucide-react'
import { useSelector } from '@tanstack/react-store'
import { Link } from '@tanstack/react-router'
import { AUCTION_KIND } from '@sdk/commerce/auctions/constants'
import { getOrderReference } from '@sdk/commerce/orders'
import { AvatarUser } from '@/components/AvatarUser'
import { AuctionCountdown } from '@/components/AuctionCountdown'
import { TestLabelButton } from '@/components/dashboard/TestLabelButton'
import type { NDKEvent } from '@/lib/nostr/ndk-events'
import { notificationActions, notificationStore } from '@/lib/stores/notifications'
import {
	getAuctionBiddingCutoffAt,
	getAuctionBidCountFromBids,
	getAuctionId,
	getAuctionImages,
	getAuctionRootEventId,
	getAuctionSettlementGrace,
	getAuctionStartAt,
	getAuctionSummary,
	getAuctionTitle,
	getAuctionTopBidFromBids,
	getBidAmount,
	useAuctionClaimOrders,
} from '@/queries/auctions'
import { useComments } from '@/queries/comments'
import { useLiveActivity, useLiveChatMessages } from '@/queries/liveChat'
import { useProfileName } from '@/queries/profiles'
import { AuctionListItemView, AuctionTopBidBox } from '@ui/auction/auction-list-views'
import { Button } from '@ui/wrappers/button'

/**
 * Host for one row of the dashboard auctions list.
 *
 * The presentations live in `ui/auction/auction-list-views.tsx`; this module is
 * the half that acquires data — the notification store, the comments /
 * live-chat / claim-order queries, the protocol derivations and the top-bid
 * selection — and injects the host-owned pieces (the bidder identity link, the
 * open-auction action, the countdown, the test-label control, the settlement and
 * order actions) into them.
 *
 * Lifted out of `platform/web/routes/_dashboard-layout/dashboard/products/auctions.tsx`,
 * which is an assembler and must not define components. Behaviour is unchanged:
 * the derived values, the notification keying and the rendered markup are the
 * same as the route's inline `AuctionListItem` + `TopBidBox`.
 */

type AuctionStatus = 'Scheduled' | 'Live' | 'Settlement' | 'Ended'

function formatAuctionStatus(startAt: number, biddingCutoffAt: number, settlementLocked: boolean, now: number): AuctionStatus {
	if (startAt > 0 && now < startAt) return 'Scheduled'
	if (settlementLocked) return 'Ended'
	if (biddingCutoffAt > 0 && now >= biddingCutoffAt) return 'Settlement'
	return 'Live'
}

export interface AuctionListItemHostProps {
	auction: NDKEvent
	bids: NDKEvent[]
	latestSettlement: NDKEvent | null
	pathReleases: NDKEvent[]
	/** Resolved by the list assembler (`getAuctionCoordinates`). */
	auctionCoordinates: string
	onPublishSettlement: () => void
	isSettling: boolean
}

export function AuctionListItemHost({
	auction,
	bids,
	latestSettlement,
	pathReleases,
	auctionCoordinates,
	onPublishSettlement,
	isSettling,
}: AuctionListItemHostProps) {
	const summary = getAuctionSummary(auction) || auction.content || 'No description'
	const images = getAuctionImages(auction)
	const thumbnailUrl = images.length > 0 ? images[0][1] : null
	const startAt = getAuctionStartAt(auction)
	const auctionNotificationKey =
		getAuctionRootEventId(auction) || (getAuctionId(auction) ? `30408:${auction.pubkey}:${getAuctionId(auction)}` : auction.id)
	const biddingCutoffAt = getAuctionBiddingCutoffAt(auction)
	const now = Math.floor(Date.now() / 1000)
	const {
		lastSeenTimestamps: {
			auctionBids: lastSeenAuctionBidsGlobal,
			auctionBidsByAuction,
			auctionComments: lastSeenAuctionCommentsGlobal,
			auctionCommentsByAuction,
			auctionEventComments: lastSeenAuctionEventCommentsGlobal,
			auctionEventCommentsByAuction,
			auctionLive: lastSeenAuctionLiveGlobal,
			auctionLiveByAuction,
			auctionSettlementBegins: lastSeenAuctionSettlementBeginsGlobal,
			auctionSettlementBeginsByAuction,
		},
	} = useSelector(notificationStore)
	const lastSeenAuctionBids = Math.max(lastSeenAuctionBidsGlobal, auctionBidsByAuction[auctionNotificationKey] || 0)
	const lastSeenAuctionComments = Math.max(lastSeenAuctionCommentsGlobal, auctionCommentsByAuction[auctionNotificationKey] || 0)
	const lastSeenAuctionEventComments = Math.max(
		lastSeenAuctionEventCommentsGlobal,
		auctionEventCommentsByAuction[auctionNotificationKey] || 0,
	)
	const lastSeenAuctionLive = Math.max(lastSeenAuctionLiveGlobal, auctionLiveByAuction[auctionNotificationKey] || 0)
	const lastSeenAuctionSettlementBegins = Math.max(
		lastSeenAuctionSettlementBeginsGlobal,
		auctionSettlementBeginsByAuction[auctionNotificationKey] || 0,
	)

	const bidsCount = getAuctionBidCountFromBids(auction, bids)
	const topBid = getAuctionTopBidFromBids(auction, bids)
	const newBidsCount = bids.filter((bid) => (bid.created_at ?? 0) > lastSeenAuctionBids).length
	const { data: bidderName } = useProfileName(topBid?.pubkey ?? '')

	const settlementLocked = !!latestSettlement

	const status = formatAuctionStatus(startAt, biddingCutoffAt, settlementLocked, now)
	const hasBids = bidsCount > 0
	const badgeStatus: AuctionStatus = status === 'Settlement' && !hasBids ? 'Ended' : status
	const isSettlementPhase = (status === 'Settlement' || status === 'Ended') && hasBids
	const settlementGraceSeconds = getAuctionSettlementGrace(auction)
	const settlementDeadlineAt = biddingCutoffAt > 0 ? biddingCutoffAt + settlementGraceSeconds : 0
	const settlementSecondsLeft = settlementDeadlineAt > 0 ? Math.max(0, settlementDeadlineAt - now) : 0
	const settlementGraceExpired = settlementDeadlineAt > 0 && now >= settlementDeadlineAt && !latestSettlement
	const winnerReleasedPath = !!(
		topBid && pathReleases.some((pathRelease) => pathRelease.tags.find((tag) => tag[0] === 'e')?.[1] === topBid.id)
	)
	const waitingForReleasePath = status === 'Settlement' && hasBids && !!topBid && !winnerReleasedPath && !settlementGraceExpired
	const releasePathReceived = status === 'Settlement' && hasBids && winnerReleasedPath && !settlementGraceExpired
	const settlementGrieved = status === 'Settlement' && hasBids && settlementGraceExpired && !latestSettlement && winnerReleasedPath
	const settlementGrievedNoRelease =
		status === 'Settlement' && hasBids && settlementGraceExpired && !latestSettlement && !winnerReleasedPath
	const canPublishSettlementNow = status === 'Settlement' && hasBids && !settlementGraceExpired && (!topBid || winnerReleasedPath)

	const commentsQuery = useComments(auction)
	const comments = commentsQuery.data ?? []
	const newCommentsCount = comments.filter((comment) => comment.createdAt > lastSeenAuctionEventComments).length
	const liveActivityQuery = useLiveActivity(auction)
	const liveActivityCoord = liveActivityQuery.data?.coord ?? ''
	const chatQuery = useLiveChatMessages(liveActivityCoord, status === 'Live')
	const chatMessages = chatQuery.data ?? []
	const newChatCount = chatMessages.filter((message) => message.createdAt > lastSeenAuctionComments).length
	const hasNewLiveStatus = startAt > 0 && startAt <= now && startAt > lastSeenAuctionLive
	const hasNewSettlementStatus = biddingCutoffAt > 0 && biddingCutoffAt <= now && biddingCutoffAt > lastSeenAuctionSettlementBegins
	const hasNewActivity = newBidsCount + newCommentsCount + newChatCount > 0 || hasNewLiveStatus || hasNewSettlementStatus

	const handleMarkActivitySeen = () => {
		notificationActions.markAuctionBidsSeen(auctionNotificationKey)
		notificationActions.markAuctionCommentsSeen(auctionNotificationKey)
		notificationActions.markAuctionEventCommentsSeen(auctionNotificationKey)
		notificationActions.markAuctionLiveSeen(auctionNotificationKey)
		notificationActions.markAuctionSettlementBeginsSeen(auctionNotificationKey)
	}

	const claimOrdersQuery = useAuctionClaimOrders(auctionCoordinates)
	const orderId = getOrderReference(claimOrdersQuery.data?.[0] ?? null) ?? undefined
	const waitingForShippingMethod = status === 'Ended' && !!latestSettlement && winnerReleasedPath && !orderId
	const showReleasePathDetails =
		waitingForReleasePath || releasePathReceived || settlementGrieved || settlementGrievedNoRelease || waitingForShippingMethod

	return (
		<AuctionListItemView
			title={getAuctionTitle(auction)}
			summary={summary}
			createdAt={auction.created_at ?? 0}
			thumbnailUrl={thumbnailUrl}
			status={badgeStatus}
			openAuctionAction={
				<Link to="/auctions/$auctionId" params={{ auctionId: auction.id }} className="w-24 lg:w-32">
					<Button
						size="sm"
						className="w-full gap-2 rounded-xl border border-zinc-300 bg-neutral-800 text-white shadow-sm hover:bg-neutral-700"
					>
						<ExternalLink className="h-3.5 w-3.5" />
						Open Auction
					</Button>
				</Link>
			}
			testLabelAction={
				/* ADR-0009: authorized labelers can mark / unmark this auction as a test listing */
				<TestLabelButton
					kind={AUCTION_KIND}
					pubkey={auction.pubkey}
					dTag={getAuctionId(auction)}
					itemLabel="Auction"
					className="w-full lg:w-32"
				/>
			}
			topBidBox={
				<AuctionTopBidBox
					className="flex-1"
					topBidSats={topBid ? getBidAmount(topBid) : null}
					topBidCreatedAt={topBid?.created_at ?? 0}
					bidderName={bidderName || topBid?.pubkey.slice(0, 8)}
					bidderIdentity={
						topBid ? (
							<Link to="/profile/$profileId" params={{ profileId: topBid.pubkey }}>
								<AvatarUser pubkey={topBid.pubkey} colored deterministicFallbackText className="w-6 h-6" />
							</Link>
						) : null
					}
					isSettlementPhase={isSettlementPhase}
					showReleasePathDetails={showReleasePathDetails}
					showWaitingForReleasePath={waitingForReleasePath}
					showReleasePathReceived={releasePathReceived}
					showSettlementGrieved={settlementGrieved}
					showSettlementGrievedNoRelease={settlementGrievedNoRelease}
					showWaitingForShippingMethod={waitingForShippingMethod}
					releasePathSecondsLeft={settlementSecondsLeft}
					releaseDetailsItemValue={topBid ? `release-details-${topBid.id}` : 'release-details'}
				/>
			}
			countdown={<AuctionCountdown auction={auction} bids={bids} />}
			settlementAction={
				status !== 'Ended' && hasBids ? (
					<Button
						className="mt-auto w-full bg-neutral-800 text-white hover:bg-neutral-700 disabled:border disabled:border-zinc-300 disabled:bg-zinc-200 disabled:text-zinc-500"
						onClick={onPublishSettlement}
						disabled={!canPublishSettlementNow}
						pending={isSettling}
					>
						{isSettling ? 'Publishing…' : 'Publish Settlement'}
					</Button>
				) : null
			}
			orderAction={
				status === 'Ended' && orderId ? (
					<Link to="/dashboard/orders/$orderId" params={{ orderId }} className="mt-auto w-full">
						<Button className="w-full bg-neutral-800 hover:bg-neutral-700 text-white">Go to Order Page</Button>
					</Link>
				) : null
			}
			shippingMethodNotice={
				waitingForShippingMethod ? (
					<Button
						type="button"
						variant="outline"
						disabled
						className="mt-2 w-full justify-start gap-2 border-sky-300 bg-sky-50 text-sky-900 hover:bg-sky-50"
					>
						<Hourglass className="h-4 w-4" aria-hidden="true" />
						Waiting for shipping method
					</Button>
				) : null
			}
			activity={{
				bids: bidsCount,
				newBids: newBidsCount,
				comments: comments.length,
				newComments: newCommentsCount,
				liveChat: chatMessages.length,
				newChat: newChatCount,
			}}
			hasNewActivity={hasNewActivity}
			onMarkActivitySeen={handleMarkActivitySeen}
		/>
	)
}
