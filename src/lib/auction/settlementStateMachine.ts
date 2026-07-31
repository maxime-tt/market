import type { ParsedBidEvent, ParsedSettlementEvent, ParsedPathReleaseEvent } from './events'

/**
 * State machine for the AuctionSettlement component.
 *
 * This pure function encapsulates the if/else condition chain that determines
 * what settlement state card to show to the user. Extracting it from the React
 * component allows targeted unit testing of each branch without rendering.
 *
 * The component is responsible for:
 * 1. Computing the inputs (from validated data, timing, user identity, etc.)
 * 2. Calling this function to get the state descriptor
 * 3. Mapping the state descriptor to JSX (icons, buttons, actions)
 */

export type SettlementStateId =
	| 'bidder-release-path'
	| 'bidder-path-released'
	| 'winner-with-order'
	| 'winner-claim-dialog'
	| 'seller-order-received'
	| 'seller-awaiting-shipping'
	| 'reserve-not-met-refund-ready'
	| 'reserve-not-met-refund-pending'
	| 'settlement-expired'
	| 'seller-settlement-ready'
	| 'seller-close-auction'
	| 'seller-awaiting-path-release'
	| 'bidder-local-record-missing'
	| 'auction-not-ended'
	| 'no-state'

export interface SettlementStateInput {
	isSeller: boolean
	isMyBidTop: boolean
	isWinner: boolean
	ended: boolean
	reserveMet: boolean
	hasReserve: boolean
	settlementWindowExpired: boolean
	myAlreadyReleased: boolean
	hasBidderRecord: boolean
	hasLatestSettlement: boolean
	settlementStatus: string
	hasPathReleaseForTopBid: boolean
	hasMatchedClaimOrder: boolean
	settlementLocktimeAt: number
	now: number
}

export interface SettlementStateOutput {
	stateId: SettlementStateId
	title: string
	message: string
	buttonTitle: string
	theme: 'action' | 'waiting' | 'completed' | 'default'
	showButton: boolean
	bidAmount: number
}

const NO_STATE: SettlementStateOutput = {
	stateId: 'no-state',
	title: '',
	message: '',
	buttonTitle: '',
	theme: 'default',
	showButton: false,
	bidAmount: 0,
}

export function getAuctionSettlementState(input: SettlementStateInput): SettlementStateOutput {
	const {
		isSeller,
		isMyBidTop,
		isWinner,
		ended,
		reserveMet,
		hasReserve,
		settlementWindowExpired,
		myAlreadyReleased,
		hasBidderRecord,
		hasLatestSettlement,
		settlementStatus,
		hasPathReleaseForTopBid,
		hasMatchedClaimOrder,
		settlementLocktimeAt,
		now,
	} = input

	// Auction not ended yet
	if (!ended) {
		return { ...NO_STATE, stateId: 'auction-not-ended' }
	}

	// Bidder settle action - shown to the top bidder once the auction ends
	// so they can publish their kind-1025 path release.
	// Guards: auction ended (canonical cutoff), reserve met, settlement window not expired,
	// canonical valid top bid exists, no existing settlement.
	if (isMyBidTop && ended && reserveMet && !settlementWindowExpired && !myAlreadyReleased && hasBidderRecord && !hasLatestSettlement) {
		return {
			stateId: 'bidder-release-path',
			title: 'You won — release your path to settle',
			message: 'Publishing your kind-1025 reveals the derivation path so the seller can redeem your locked proofs.',
			buttonTitle: 'Release path & settle',
			theme: 'action',
			showButton: true,
			bidAmount: 0, // Set by component from myTopBidEvent.amount
		}
	}

	// Path release published - waiting for seller to redeem and publish settlement
	if (isMyBidTop && ended && myAlreadyReleased && settlementStatus !== 'settled') {
		return {
			stateId: 'bidder-path-released',
			title: 'Path release published',
			message: 'Waiting for seller to redeem and publish settlement.',
			buttonTitle: '',
			theme: 'waiting',
			showButton: false,
			bidAmount: 0,
		}
	}

	// Winner banner - shown to the auction winner after settlement
	if (isWinner && settlementStatus === 'settled') {
		if (hasMatchedClaimOrder) {
			return {
				stateId: 'winner-with-order',
				title: 'You won this auction!',
				message: 'Shipping details submitted — awaiting seller.',
				buttonTitle: 'View Order',
				theme: 'completed',
				showButton: true,
				bidAmount: 0, // Set by component from settlementFinalAmount
			}
		}
		return {
			stateId: 'winner-claim-dialog',
			title: 'You won this auction!',
			message: 'Submit your shipping address to complete the order.',
			buttonTitle: 'Submit Shipping Address',
			theme: 'action',
			showButton: true,
			bidAmount: 0, // Set by component from settlementFinalAmount
		}
	}

	// Seller side - check if winner has submitted shipping details
	if (isSeller && settlementStatus === 'settled' && hasLatestSettlement) {
		if (hasMatchedClaimOrder) {
			return {
				stateId: 'seller-order-received',
				title: 'Order Received',
				message: 'Winner has submitted shipping details. Process and ship the item.',
				buttonTitle: 'View Order',
				theme: 'completed',
				showButton: true,
				bidAmount: 0,
			}
		}
		return {
			stateId: 'seller-awaiting-shipping',
			title: 'Awaiting Shipping Details',
			message: 'Waiting for winner to submit shipping details.',
			buttonTitle: '',
			theme: 'waiting',
			showButton: false,
			bidAmount: 0,
		}
	}

	// Reserve not met states
	if (hasLatestSettlement && settlementStatus === 'reserve_not_met') {
		if (now >= settlementLocktimeAt && settlementLocktimeAt > 0) {
			return {
				stateId: 'reserve-not-met-refund-ready',
				title: 'Refund Ready',
				message: 'Refund window opened - verify the unlocked funds have returned to your wallet.',
				buttonTitle: '',
				theme: 'completed',
				showButton: false,
				bidAmount: 0,
			}
		}
		return {
			stateId: 'reserve-not-met-refund-pending',
			title: 'Refund Pending',
			message: 'Refund window opens soon.',
			buttonTitle: '',
			theme: 'waiting',
			showButton: false,
			bidAmount: 0,
		}
	}

	// Settlement window expired
	if (settlementWindowExpired && !hasLatestSettlement) {
		return {
			stateId: 'settlement-expired',
			title: 'Settlement Expired',
			message: 'Settlement window has passed.',
			buttonTitle: '',
			theme: 'completed',
			showButton: false,
			bidAmount: 0,
		}
	}

	// Seller settlement action
	if (isSeller && ended && !hasLatestSettlement && hasPathReleaseForTopBid) {
		return {
			stateId: 'seller-settlement-ready',
			title: 'Settlement Ready',
			message: 'Complete settlement by publishing the settlement event.',
			buttonTitle: 'Publish Settlement',
			theme: 'action',
			showButton: true,
			bidAmount: 0,
		}
	}

	// Seller close action for no-bid / below-reserve auctions.
	if (isSeller && ended && !hasLatestSettlement && !reserveMet) {
		if (hasReserve) {
			return {
				stateId: 'seller-close-auction',
				title: 'Reserve Not Met',
				message: 'No bid met the reserve price. Close the auction to publish a reserve_not_met settlement.',
				buttonTitle: 'Close Auction',
				theme: 'action',
				showButton: true,
				bidAmount: 0,
			}
		}
		return {
			stateId: 'seller-close-auction',
			title: 'No Bids Received',
			message: 'This auction received no bids. Close the auction to finalize it.',
			buttonTitle: 'Close Auction',
			theme: 'action',
			showButton: true,
			bidAmount: 0,
		}
	}

	// Seller waiting for path release (only when reserve is met — a valid winner exists)
	if (isSeller && ended && !hasLatestSettlement && !hasPathReleaseForTopBid && reserveMet) {
		return {
			stateId: 'seller-awaiting-path-release',
			title: 'Awaiting Path Release',
			message: 'Waiting for the winning bidder to release their path.',
			buttonTitle: '',
			theme: 'waiting',
			showButton: false,
			bidAmount: 0,
		}
	}

	// (The 'bidder-awaiting-settlement' branch was merged into 'bidder-path-released'
	// above — both had the same condition isMyBidTop && ended && myAlreadyReleased
	// && settlementStatus !== 'settled', differing only in the !isSeller guard
	// which was redundant since the first match wins.)

	// Bidder local record missing - prompt for refresh page
	if (!isSeller && isMyBidTop && !hasBidderRecord && ended) {
		return {
			stateId: 'bidder-local-record-missing',
			title: 'Local Record Missing',
			message:
				'Cannot find the release path for the bid. Refreshing the page to reload wallet data may help - otherwise the bid may have been placed from another browser or device.',
			buttonTitle: 'Refresh Page',
			theme: 'completed',
			showButton: true,
			bidAmount: 0,
		}
	}

	return NO_STATE
}

/**
 * Derive the validated top bid and the current user's top bid from
 * #1170-validated data. This replaces the raw `getAuctionTopBidValid` +
 * manual filtering that previously operated on unvalidated streamed bids.
 *
 * Returns `null` for both when validated data is not yet available.
 */
export function getValidatedBidContext(
	validatedBids: ParsedBidEvent[] | undefined,
	validatedTopBid: ParsedBidEvent | undefined,
	currentUserPubkey: string | undefined,
): {
	topBid: ParsedBidEvent | null
	myTopBidEvent: ParsedBidEvent | null
	isMyBidTop: boolean
} {
	const topBid = validatedTopBid ?? null

	if (!currentUserPubkey || !validatedBids || validatedBids.length === 0) {
		return { topBid, myTopBidEvent: null, isMyBidTop: false }
	}

	// Find the current user's highest bid from validated bids
	const myBids = validatedBids.filter((b) => b.bidderPubkey === currentUserPubkey)
	if (myBids.length === 0) {
		return { topBid, myTopBidEvent: null, isMyBidTop: false }
	}

	const myTopBidEvent = myBids.reduce<ParsedBidEvent | null>((best, bid) => {
		if (!best) return bid
		const delta = bid.amount - best.amount
		if (delta > 0) return bid
		if (delta < 0) return best
		return (bid.createdAt || 0) < (best.createdAt || 0) ? bid : best
	}, myBids[0])

	const isMyBidTop = !!(myTopBidEvent && topBid && myTopBidEvent.id === topBid.id)

	return { topBid, myTopBidEvent, isMyBidTop }
}

/**
 * Check if a path release exists for the given top bid, using validated
 * path release data from #1170 validators.
 */
export function checkPathReleaseForTopBid(pathReleases: ParsedPathReleaseEvent[] | undefined, topBid: ParsedBidEvent | null): boolean {
	if (!topBid || !pathReleases) return false
	return pathReleases.some((pr) => pr.bidEventId === topBid.id)
}

/**
 * Check if the reserve price was met by the top bid.
 */
export function checkReserveMet(topBid: ParsedBidEvent | null, reserve: number): boolean {
	return !!topBid && topBid.amount >= reserve
}
