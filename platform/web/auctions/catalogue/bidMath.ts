/**
 * The bid arithmetic for the Catalogue detail, kept pure so the trap that has
 * bitten every auction UI on this programme is testable in isolation.
 *
 * Source of truth: `notes/HANDOVER-AUCTIONS-FRONTEND-WIRING.md` §6. A committed
 * bid's `amount` is a **delta added to the bidder's existing position**, not the
 * bidder's new total. Two consequences the UI must not get wrong:
 *
 *   - A second bid of 65 by the same bidder who already holds 60 leaves them at
 *     125, not 65. If the amount field means "my new total", the delta sent on
 *     the wire is `total - myPosition`.
 *   - A displaced bidder's position is 0, because the backend returns their money
 *     when the whole position is outbid. Summing their historical deltas would
 *     silently over-state what they already hold and under-bid the leader.
 *
 * The backend commits its own `high_bid` and `leader_bid_id`; when they are
 * present this module trusts them over a re-sum, because that is the same number
 * the chain validates against.
 */

export interface BidInput {
	/** The bidder's pubkey, as committed. */
	bidder: string
	/** The committed DELTA, exactly as stored. */
	amount: number
	id?: string
}

export interface AuctionBidRules {
	/** Floor for the first bid: with no bids the auction opens here. */
	startingBid: number
	/** Every raise must clear the leader by at least this much. */
	minIncrement: number
	/** The backend's committed leader position, when the state carries it. */
	highBid?: number
	/** The id of the bid that set `highBid`; names the leader. */
	leaderBidId?: string
}

export interface BidPosition {
	/** Who currently leads; null before the first bid. */
	leaderPubkey: string | null
	/** The leader's total position (the number the auction is "at"). */
	leaderPosition: number
	/**
	 * The viewer's effective position: their total while leading, otherwise 0.
	 * Zero is not "no bids" here — a displaced bidder who bid 60 still reads 0,
	 * because the chain returned those sats.
	 */
	myPosition: number
	/** The smallest resulting position the next bid may reach. */
	minNextPosition: number
	/** The smallest DELTA the next `KindBid.amount` may carry. */
	minDelta: number
}

/** Sum every committed delta by bidder — the fallback when the state has no leader. */
function positionsByBidder(bids: readonly BidInput[]): Map<string, number> {
	const totals = new Map<string, number>()
	for (const bid of bids) {
		if (!bid.bidder) continue
		totals.set(bid.bidder, (totals.get(bid.bidder) ?? 0) + (Number(bid.amount) || 0))
	}
	return totals
}

/**
 * Resolve the leader from the backend's own markers, falling back to the largest
 * summed position when those markers are absent (an older state document).
 */
function resolveLeader(
	rules: AuctionBidRules,
	bids: readonly BidInput[],
): { leaderPubkey: string | null; leaderPosition: number } {
	if (rules.leaderBidId) {
		const leaderBid = bids.find((bid) => bid.id === rules.leaderBidId)
		if (leaderBid) {
			return {
				leaderPubkey: leaderBid.bidder,
				leaderPosition: typeof rules.highBid === 'number' && rules.highBid > 0 ? rules.highBid : leaderBid.amount,
			}
		}
	}
	let leaderPubkey: string | null = null
	let leaderPosition = 0
	for (const [bidder, total] of positionsByBidder(bids)) {
		if (total > leaderPosition) {
			leaderPosition = total
			leaderPubkey = bidder
		}
	}
	return { leaderPubkey, leaderPosition }
}

/**
 * What the viewer may bid, in both the terms the wire uses (a delta) and the
 * terms a person reads (the total they will hold).
 */
export function computeBidPosition(
	rules: AuctionBidRules,
	bids: readonly BidInput[],
	bidder: string,
): BidPosition {
	const { leaderPubkey, leaderPosition } = resolveLeader(rules, bids)
	// A displaced bidder's position is 0: the chain returned what they held.
	const myPosition = leaderPubkey !== null && bidder !== '' && bidder === leaderPubkey ? leaderPosition : 0
	const hasBids = leaderPubkey !== null && leaderPosition > 0
	const minNextPosition = hasBids ? leaderPosition + Math.max(1, rules.minIncrement) : rules.startingBid
	const minDelta = Math.max(0, minNextPosition - myPosition)
	return { leaderPubkey, leaderPosition, myPosition, minNextPosition, minDelta }
}

/**
 * Convert a bidder's chosen *resulting position* into the delta the wire wants.
 *
 * The field in the UI is a position ("I want to hold 130 sats"), because that is
 * what a person can reason about; the delta is derived here. Throws on a bid the
 * chain would refuse, naming the same minimum the UI shows, so a client-side
 * refusal reads the same as the validator's.
 */
export function deltaForPosition(
	requestedPosition: number,
	rules: AuctionBidRules,
	bids: readonly BidInput[],
	bidder: string,
): number {
	const position = computeBidPosition(rules, bids, bidder)
	const requested = Math.round(requestedPosition)
	if (!Number.isFinite(requested)) throw new Error('Enter a bid amount')
	if (requested < position.minNextPosition) {
		throw new Error(`Minimum bid is ${position.minNextPosition} sats`)
	}
	return requested - position.myPosition
}

/** The total a viewer will hold after adding `delta` — the number to show beside the field. */
export function positionForDelta(delta: number, rules: AuctionBidRules, bids: readonly BidInput[], bidder: string): number {
	return computeBidPosition(rules, bids, bidder).myPosition + Math.max(0, Math.round(delta))
}
