import { useMemo, useState, type ReactElement } from 'react'
import { useStore } from '@tanstack/react-store'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { authStore } from '@/lib/stores/auth'
import { cn } from '@/lib/utils'
import { findBidderRecord } from '@/lib/auction/bidderRecords'
import { nip60Actions } from '@/lib/stores/nip60'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { auctionKeys } from '@/queries/queryKeyFactory'
import { usePublishAuctionSettlementMutation } from '@/publish/auctions'
import {
	getAuctionSettlementGrace,
	getAuctionBiddingCutoffAt,
	getAuctionRootEventId,
	useAuctionWithRelatedEvents,
	useAuctionClaimOrders,
} from '@/queries/auctions'
import {
	getAuctionSettlementState,
	getValidatedBidContext,
	checkPathReleaseForTopBid,
	checkReserveMet,
} from '@/lib/auction/settlementStateMachine'
import { Clock, CheckCircle, Ban, Truck, Gavel, Trophy, BadgeCheck, AlertTriangle } from 'lucide-react'
import { AuctionClaimDialog } from './AuctionClaimDialog'
import { useNavigate } from '@tanstack/react-router'
import type { NDKEvent } from '@/lib/nostr/ndk-events'

interface AuctionSettlementProps {
	auction: NDKEvent
	bids: NDKEvent[]
	className?: string
}

export function AuctionSettlement({ auction, bids, className }: AuctionSettlementProps) {
	const { user } = useStore(authStore)
	const currentUserPubkey = user?.pubkey
	const [isClaimDialogOpen, setIsClaimDialogOpen] = useState(false)
	const navigate = useNavigate()

	// Get auction identifiers
	const auctionDTag = auction.tags.find((t) => t[0] === 'd')?.[1] || ''
	const auctionCoordinates = auctionDTag ? `30408:${auction.pubkey}:${auctionDTag}` : ''
	const auctionRootEventId = getAuctionRootEventId(auction) || auction.id

	const auctionWithRelatedEvents = useAuctionWithRelatedEvents(auctionRootEventId, auctionCoordinates)

	// Verification status from #1170 validators — the auctionWithRelatedEvents query
	// validates all events (bids, settlements, path releases) using validateBidLocalOnly,
	// validateSettlementEventLocalOnly, validatePathReleaseLocalOnly, and validateAuctionImmutableTags
	const validatedData = auctionWithRelatedEvents.data
	const isVerified = !!validatedData?.latestAuction

	// Fetch claim orders (not validated by #1170 — these are order events, not auction events)
	const claimOrdersQuery = useAuctionClaimOrders(auctionCoordinates)
	const claimOrders = claimOrdersQuery.data ?? []

	// Use validated settlement and path release data from #1170 validators.
	// Only display settlement UI for events that passed local-only validation.
	const settlements = validatedData?.settlements ?? []
	const pathReleases = validatedData?.pathReleases ?? []

	const latestSettlement = settlements[0] || null
	const settlementStatus = latestSettlement?.status ?? 'unknown'
	const settlementWinner = latestSettlement?.winnerPubkey ?? ''
	const settlementFinalAmount = latestSettlement?.finalAmount ?? 0

	const isSeller = currentUserPubkey === auction.pubkey
	const isWinner = !!(currentUserPubkey && settlementWinner === currentUserPubkey)

	// #7: Claim orders are matched by event author (pubkey), which is
	// cryptographically verified by the Nostr signature. For the seller view,
	// only claim orders authored by the settlement winner are matched.
	// For the buyer view, only claim orders authored by the current user
	// are matched. This prevents a malicious user from injecting a claim
	// order that would be navigated to by someone else.
	const matchedClaimOrder = useMemo(() => {
		if (isSeller && settlementWinner) {
			// Seller view - only match claim orders authored by the settlement winner
			return claimOrders.find((order) => order.pubkey === settlementWinner) ?? null
		} else if (!isSeller && currentUserPubkey && isWinner) {
			// Buyer view - only match claim orders authored by the current user
			// AND only when the current user is the settlement winner
			return claimOrders.find((order) => order.pubkey === currentUserPubkey) ?? null
		}
		return null
	}, [claimOrders, isSeller, settlementWinner, currentUserPubkey, isWinner])

	// Get auction timing info
	const biddingCutoffAt = getAuctionBiddingCutoffAt(auction)
	const settlementGrace = getAuctionSettlementGrace(auction)
	const settlementLocktimeAt = biddingCutoffAt > 0 && settlementGrace > 0 ? biddingCutoffAt + settlementGrace : 0
	const now = Math.floor(Date.now() / 1000)
	const settlementWindowExpired = settlementLocktimeAt > 0 && now >= settlementLocktimeAt
	const ended = biddingCutoffAt > 0 && now >= biddingCutoffAt

	// #1 fix: Derive top bid and my top bid from #1170-validated data, not raw streamed bids.
	// The raw `bids` prop is still passed for backwards compatibility but is no longer used
	// for winner determination or custody-action gating.
	const { topBid, myTopBidEvent, isMyBidTop } = useMemo(
		() => getValidatedBidContext(validatedData?.bids, validatedData?.topBid, currentUserPubkey),
		[validatedData?.bids, validatedData?.topBid, currentUserPubkey],
	)

	const reserve = auction.tags.find((t) => t[0] === 'reserve')?.[1]
		? parseInt(auction.tags.find((t) => t[0] === 'reserve')?.[1] || '0', 10)
		: 0
	const reserveMet = checkReserveMet(topBid, reserve)

	// Check if path release for top bid exists (using validated path releases + validated top bid)
	const hasPathReleaseForTopBid = useMemo(() => checkPathReleaseForTopBid(pathReleases, topBid), [pathReleases, topBid])

	const myAlreadyReleased = useMemo(() => {
		if (!myTopBidEvent) return false
		return pathReleases.some((pr) => pr.bidEventId === myTopBidEvent.id)
	}, [pathReleases, myTopBidEvent])
	const myBidderRecord = useMemo(() => (myTopBidEvent ? findBidderRecord(myTopBidEvent.id) : null), [myTopBidEvent])

	// Handle actions
	const queryClient = useQueryClient()
	const settlementMutation = usePublishAuctionSettlementMutation()
	const [isReleasing, setIsReleasing] = useState(false)

	// #3 fix: Optimistic update — immediately mark as released after successful publish,
	// before the query refetch completes. This prevents the button from re-appearing
	// during the gap between publish completion and query refetch.
	const [optimisticallyReleased, setOptimisticallyReleased] = useState(false)
	const myAlreadyReleasedEffective = useMemo(() => {
		if (optimisticallyReleased) return true
		if (!myTopBidEvent) return false
		return pathReleases.some((pr) => pr.bidEventId === myTopBidEvent.id)
	}, [pathReleases, myTopBidEvent, optimisticallyReleased])

	const handleReleasePath = async () => {
		if (!myTopBidEvent) return
		setIsReleasing(true)
		try {
			const result = await nip60Actions.settleAuctionAsWinner({
				bidEventId: myTopBidEvent.id,
				releaseReason: 'settlement',
			})
			toast.success('Path release published — seller can now redeem')
			void result.pathReleaseEventId
			// Optimistically mark as released so the UI transitions immediately
			setOptimisticallyReleased(true)
			await queryClient.invalidateQueries({ queryKey: auctionKeys.pathReleases(auctionRootEventId) })
			await queryClient.invalidateQueries({ queryKey: auctionKeys.details(auctionRootEventId) })
		} catch (err) {
			toast.error(`Failed to release path: ${err instanceof Error ? err.message : String(err)}`)
		} finally {
			setIsReleasing(false)
		}
	}

	const handleSubmitSettlement = async () => {
		if (!auction) return

		try {
			const desiredStatus: 'reserve_not_met' | undefined = topBid && reserveMet ? undefined : 'reserve_not_met'
			await settlementMutation.mutateAsync({
				auctionEventId: auctionRootEventId,
				auctionCoordinates,
				status: desiredStatus,
				winningBidEventId: desiredStatus ? undefined : topBid?.id,
			})
		} catch {
			// Toast handled in mutation hook.
		}
	}

	// Compute state using the extracted state machine
	const stateResult = getAuctionSettlementState({
		isSeller,
		isMyBidTop,
		isWinner,
		ended,
		reserveMet,
		settlementWindowExpired,
		myAlreadyReleased: myAlreadyReleasedEffective,
		hasBidderRecord: !!myBidderRecord,
		hasLatestSettlement: !!latestSettlement,
		settlementStatus,
		hasPathReleaseForTopBid,
		hasMatchedClaimOrder: !!matchedClaimOrder,
		settlementLocktimeAt,
		now,
	})

	// Map state machine output to renderable state
	let state: {
		icon: ReactElement | null
		title: string
		message: string
		buttonTitle: string
		buttonAction: (event: React.MouseEvent) => void
		theme: string
		showButton: boolean
		bidAmount: number
	} = {
		icon: null,
		title: '',
		message: '',
		buttonTitle: '',
		buttonAction: () => {},
		theme: 'default',
		showButton: false,
		bidAmount: 0,
	}

	switch (stateResult.stateId) {
		case 'auction-not-ended':
		case 'no-state':
			return null

		case 'bidder-release-path':
			state = {
				icon: <Gavel className="w-5 h-5 text-sky-300" />,
				title: stateResult.title,
				message: `Bid: ${(myTopBidEvent?.amount ?? 0).toLocaleString()} sats. ${stateResult.message}`,
				buttonTitle: isReleasing ? 'Releasing…' : stateResult.buttonTitle,
				buttonAction: () => void handleReleasePath(),
				theme: 'action',
				showButton: true,
				bidAmount: myTopBidEvent?.amount ?? 0,
			}
			break

		case 'bidder-path-released':
			state = {
				icon: <CheckCircle className="w-5 h-5 text-emerald-300" />,
				title: stateResult.title,
				message: stateResult.message,
				buttonTitle: '',
				buttonAction: () => {},
				theme: 'waiting',
				showButton: false,
				bidAmount: 0,
			}
			break

		case 'winner-with-order':
			state = {
				icon: <CheckCircle className="w-5 h-5 text-emerald-300" />,
				title: stateResult.title,
				message: `Shipping details submitted — awaiting seller. Final price: ${settlementFinalAmount.toLocaleString()} sats`,
				buttonTitle: stateResult.buttonTitle,
				buttonAction: () => {
					if (matchedClaimOrder?.id) {
						navigate({ to: `/dashboard/orders/${matchedClaimOrder.id}` })
					} else {
						toast.error('Issue with order id. Go to Dashboard -> Your Purchases to find the order.')
					}
				},
				theme: 'completed',
				showButton: true,
				bidAmount: settlementFinalAmount,
			}
			break

		case 'winner-claim-dialog':
			state = {
				icon: <Trophy className="w-5 h-5 text-emerald-300" />,
				title: stateResult.title,
				message: `Final price: ${settlementFinalAmount.toLocaleString()} sats`,
				buttonTitle: stateResult.buttonTitle,
				buttonAction: () => setIsClaimDialogOpen(true),
				theme: 'action',
				showButton: true,
				bidAmount: settlementFinalAmount,
			}
			break

		case 'seller-order-received':
			state = {
				icon: <Truck className="w-5 h-5 text-emerald-300" />,
				title: stateResult.title,
				message: stateResult.message,
				buttonTitle: stateResult.buttonTitle,
				buttonAction: () => {
					if (matchedClaimOrder?.id) {
						navigate({ to: `/dashboard/orders/${matchedClaimOrder.id}` })
					} else {
						toast.error('Issue with order id. Go to Dashboard -> Sales to find the order.')
					}
				},
				theme: 'completed',
				showButton: true,
				bidAmount: 0,
			}
			break

		case 'seller-awaiting-shipping':
			state = {
				icon: <Clock className="w-5 h-5 text-blue-300" />,
				title: stateResult.title,
				message: stateResult.message,
				buttonTitle: '',
				buttonAction: () => {},
				theme: 'waiting',
				showButton: false,
				bidAmount: 0,
			}
			break

		case 'reserve-not-met-refund-ready':
			state = {
				icon: <CheckCircle className="w-5 h-5 text-green-300" />,
				title: stateResult.title,
				message: stateResult.message,
				buttonTitle: '',
				buttonAction: () => {},
				theme: 'completed',
				showButton: false,
				bidAmount: 0,
			}
			break

		case 'reserve-not-met-refund-pending':
			state = {
				icon: <Clock className="w-5 h-5 text-blue-300" />,
				title: stateResult.title,
				message: stateResult.message,
				buttonTitle: '',
				buttonAction: () => {},
				theme: 'waiting',
				showButton: false,
				bidAmount: 0,
			}
			break

		case 'settlement-expired':
			state = {
				icon: <Ban className="w-5 h-5 text-red-300" />,
				title: stateResult.title,
				message: stateResult.message,
				buttonTitle: '',
				buttonAction: () => {},
				theme: 'completed',
				showButton: false,
				bidAmount: 0,
			}
			break

		case 'seller-settlement-ready':
			state = {
				icon: <Gavel className="w-5 h-5 text-amber-300" />,
				title: stateResult.title,
				message: stateResult.message,
				buttonTitle: settlementMutation.isPending ? 'Publishing…' : stateResult.buttonTitle,
				buttonAction: () => void handleSubmitSettlement(),
				theme: 'action',
				showButton: true,
				bidAmount: 0,
			}
			break

		case 'seller-close-auction':
			state = {
				icon: <Ban className="w-5 h-5 text-amber-300" />,
				title: stateResult.title,
				message: stateResult.message,
				buttonTitle: settlementMutation.isPending ? 'Publishing…' : stateResult.buttonTitle,
				buttonAction: () => void handleSubmitSettlement(),
				theme: 'action',
				showButton: true,
				bidAmount: 0,
			}
			break

		case 'seller-awaiting-path-release':
			state = {
				icon: <Clock className="w-5 h-5 text-blue-300" />,
				title: stateResult.title,
				message: stateResult.message,
				buttonTitle: '',
				buttonAction: () => {},
				theme: 'waiting',
				showButton: false,
				bidAmount: 0,
			}
			break

		case 'bidder-awaiting-settlement':
			state = {
				icon: <Clock className="w-5 h-5 text-blue-300" />,
				title: stateResult.title,
				message: stateResult.message,
				buttonTitle: '',
				buttonAction: () => {},
				theme: 'waiting',
				showButton: false,
				bidAmount: 0,
			}
			break

		case 'bidder-local-record-missing':
			state = {
				icon: <Ban className="w-5 h-5 text-red-300" />,
				title: stateResult.title,
				message: stateResult.message,
				buttonTitle: stateResult.buttonTitle,
				buttonAction: () => window.location.reload(),
				theme: 'completed',
				showButton: true,
				bidAmount: 0,
			}
			break
	}

	// Theme classes
	const themeClasses = {
		action: 'border-amber-100 bg-amber-50/30',
		waiting: 'border-blue-100 bg-blue-50/30',
		completed: 'border-green-100 bg-green-50/30',
		default: '',
	}

	return (
		<>
			<Card className={cn('p-4', themeClasses[state.theme as keyof typeof themeClasses], className)}>
				<div className="flex items-start gap-3">
					<div className="mt-0.5">{state.icon}</div>
					<div className="flex-1">
						<h3 className="font-semibold text-foreground">{state.title}</h3>
						<p className="text-sm text-foreground/80 mt-1">{state.message}</p>

						{/* Verification badge from #1170 validators */}
						{isVerified && (
							<div className="flex items-center gap-1.5 mt-2 text-xs">
								<BadgeCheck className="w-3.5 h-3.5 text-green-400" />
								<span className="text-green-400 font-medium">
									Verified{settlements.length > 0 ? ' · Settlement confirmed' : pathReleases.length > 0 ? ' · Path release confirmed' : ''}
								</span>
							</div>
						)}
						{!isVerified && auctionWithRelatedEvents.isLoading && (
							<div className="flex items-center gap-1.5 mt-2 text-xs">
								<AlertTriangle className="w-3.5 h-3.5 text-yellow-400" />
								<span className="text-yellow-400">Verifying…</span>
							</div>
						)}

						{state.showButton && (
							<Button
								onClick={state.buttonAction}
								disabled={isReleasing || settlementMutation.isPending || optimisticallyReleased}
								className="mt-3"
								size="sm"
							>
								{state.buttonTitle}
							</Button>
						)}
					</div>
				</div>
			</Card>

			{/* Shipping Address Dialog */}
			{isWinner && latestSettlement && auction && (
				<AuctionClaimDialog
					open={isClaimDialogOpen}
					onOpenChange={setIsClaimDialogOpen}
					auctionEventId={auctionRootEventId}
					auctionCoordinates={auctionCoordinates}
					settlementEventId={latestSettlement.id}
					sellerPubkey={auction.pubkey}
					finalAmount={settlementFinalAmount}
				/>
			)}
		</>
	)
}
