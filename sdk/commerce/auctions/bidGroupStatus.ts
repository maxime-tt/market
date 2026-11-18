/**
 * Bidder-side status of one auction's bid chain. Each status is distinct on purpose:
 * a refund received, a manual reclaim, and an outbid-but-still-locked chain are
 * different custody states and must not be collapsed.
 */
export type BidGroupStatus =
	| 'winning'
	| 'refund_received'
	| 'reclaimed'
	| 'reclaim_available'
	| 'outbid'
	| 'reserve_not_met'
	| 'cancelled'
	| 'locked'
	| 'recorded'

export interface BidGroupTokenInput<Token> {
	token: Token
	status: string
	/** Earliest unix time the wallet will accept a reclaim (locktime plus the wallet's skew buffer). */
	reclaimReadyAt: number
	locktime: number
}

export interface BidGroupSettlementInput {
	status: string | null
	winningBidId: string | null
	winnerPubkey: string | null
}

/**
 * A **money receipt** the chain published for this bid: a kind-1443 refund the
 * escrow executed. When present for the latest bid, the sats are already back —
 * this is `refund_received`, and there is nothing to reclaim.
 */
export interface BidGroupRefundReceiptInput {
	/** The bid id the receipt names. */
	bidId: string
	/** The anchored height the refund executed at. */
	height: number
}

export interface BidGroupStatusInput<Token> {
	latestBidId: string
	latestBidLocktime: number
	tokens: readonly BidGroupTokenInput<Token>[]
	settlement: BidGroupSettlementInput | null
	userPubkey: string
	now: number
	/**
	 * A refund **receipt** the chain published for the latest bid (kind 1443),
	 * or `null`/absent when none was read. A read that delivered no receipt is
	 * *no receipt read* — not "not paid" — and this stays `null`.
	 */
	refundReceipt?: BidGroupRefundReceiptInput | null
}

export interface BidGroupStatusResult<Token> {
	status: BidGroupStatus
	/** Tokens past their reclaim-ready time; empty unless status is `reclaim_available`. */
	reclaimable: Token[]
	reclaimReadyAt: number
	/** True when pending tokens exist but reclaim has not opened yet. */
	waitingForReclaim: boolean
	hasTrackedTokens: boolean
	latestLocktime: number
	/**
	 * The anchored height a refund receipt executed at, or `null` when none was
	 * read. `null` is "no receipt read", never a height of zero.
	 */
	refundedAtHeight: number | null
}

export function resolveBidGroupStatus<Token>(input: BidGroupStatusInput<Token>): BidGroupStatusResult<Token> {
	const { tokens, settlement, now } = input
	const pending = tokens.filter((token) => token.status === 'pending')
	const ready = pending.filter((token) => token.reclaimReadyAt <= now)
	const reclaimReadyAt = pending.reduce((max, token) => (token.reclaimReadyAt > max ? token.reclaimReadyAt : max), 0)
	const hasTrackedTokens = tokens.length > 0
	const waitingForReclaim = pending.length > 0 && reclaimReadyAt > now
	const latestLocktime = tokens.reduce((max, token) => Math.max(max, token.locktime), input.latestBidLocktime)
	const refundReceipt = input.refundReceipt ?? null
	// A refund receipt covers *this* bid only. A receipt naming another bid is
	// not this group's money and must not turn this status green.
	const receiptForThisBid = refundReceipt !== null && refundReceipt.bidId === input.latestBidId ? refundReceipt : null
	const refundedAtHeight = receiptForThisBid?.height ?? null

	const result = (status: BidGroupStatus, reclaimable: Token[] = []): BidGroupStatusResult<Token> => ({
		status,
		reclaimable,
		reclaimReadyAt,
		waitingForReclaim,
		hasTrackedTokens,
		latestLocktime,
		refundedAtHeight,
	})

	if (settlement && settlement.winningBidId === input.latestBidId && settlement.winnerPubkey === input.userPubkey) return result('winning')
	// A verified refund receipt *is* money back: it is a fact of the mint, not a
	// relay-reported outcome, so it wins over locked / outbid / a reclaim window —
	// and it offers NO reclaim, because the sats are already returned.
	if (receiptForThisBid !== null) return result('refund_received')
	if (hasTrackedTokens && tokens.every((token) => token.status === 'claimed')) return result('refund_received')
	if (hasTrackedTokens && tokens.every((token) => token.status === 'reclaimed')) return result('reclaimed')
	if (ready.length > 0)
		return result(
			'reclaim_available',
			ready.map((token) => token.token),
		)
	if (settlement?.status === 'settled') return result('outbid')
	if (settlement?.status === 'reserve_not_met') return result('reserve_not_met')
	if (settlement?.status === 'cancelled') return result('cancelled')
	if (latestLocktime > now) return result('locked')
	return result('recorded')
}
