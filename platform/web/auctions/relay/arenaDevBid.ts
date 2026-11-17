/**
 * `arenaDevBid.ts` — which lot the dev-only "bid on a seeded auction" helper bids
 * on, and at what amount.
 *
 * ## Why this is its own module
 *
 * The helper used to pick its candidate itself: a `kinds: [30408]` subscription and
 * the retired tag set (`end_at`, `max_end_at`, `start_at`, `p2pk_xpub`, `d`) read
 * by hand (`walletOps.ts`, before this slice). Nothing publishes that family any
 * more — the seed writes arena 1440 creates — so the lookup could never find a
 * candidate. The replacement is the **same read the lot surfaces use** and the
 * **same rules the bid panel applies**, in one pure function, so "which lot, what
 * amount" can be tested with no relay and no wallet.
 *
 * ## What "biddable" means here
 *
 * Exactly what `checkArenaBid` means by it. A dev path with its own weaker rule for
 * money would be a second answer to a question that must have one
 * (`ui/auction/arena/bid-rules.ts:7-11`), so every refusal below is the panel's
 * refusal, not a local re-derivation: the read delivered the lot (`model`),
 * `arenaBidBlock` says the lot is open, the bidder is not the seller, the wallet
 * claims `ready`, and the amount reaches the published floor.
 *
 * ## The amount is a delta
 *
 * A kind-1441 `amount` is the delta a bidder **adds** to their own position
 * (`bid-rules.ts:156-164`; `arenaBidPublish.ts` `ArenaBidContent.amount`), while the
 * floor `arenaBidFloor` computes is a **position**. The conversion happens here,
 * once: `delta = max(1, floor − ownPosition)`. A dev's stated preference is a
 * preference, not a cap — it is raised to the floor rather than published as a bid
 * the terms refuse, which is what the retired helper did with its own `Math.max`
 * (and what a caller of this one would otherwise have to re-implement).
 */

import type { ArenaAuctionSnapshot, ArenaAuctionView } from '@platform/web/auctions/relay/arenaAuctionRead'
import { auctionPhase, toAuctionDetailModel } from '@platform/web/auctions/relay/auctionSurfacesRead'
import { checkArenaBid, type ArenaBidCheck, type ArenaBidderState } from '@ui/auction/arena/bid-rules'
import type { ArenaAuctionDetailModel, ArenaSurfaceStatus } from '@ui/auction/arena/model'

/** The lot the dev helper will bid on, with the check that allows its amount. */
export interface DevBidCandidate {
	/** The auction as the read projected it — the source of the coordinate and the root id. */
	view: ArenaAuctionView
	/** The same lot as the surfaces' detail model, which is what the bid path takes. */
	model: ArenaAuctionDetailModel
	/** The pre-check for the amount below — always `allowed`. */
	check: ArenaBidCheck
}

/**
 * The first lot in the snapshot a signed-in, wallet-ready bidder may bid on, or
 * `null` when none is. Order is the snapshot's own (`created_at` descending), so the
 * newest seeded lot wins.
 *
 * `preferredAmount` is in sats and is a **delta**; `undefined` means "the lot's own
 * floor". A non-integer, zero or negative preference is the caller's to refuse —
 * this function is not an input validator and would only turn it into
 * `not-integer-sats`/`zero` skips that look like "no lot found".
 */
export function selectDevBidCandidate(input: {
	snapshot: ArenaAuctionSnapshot
	/** The read state the snapshot came from; fed to `checkArenaBid` unchanged. */
	status: ArenaSurfaceStatus
	bidder: ArenaBidderState
	/** Unix seconds, injected so this stays pure. */
	now: number
	preferredAmount?: number | undefined
}): DevBidCandidate | null {
	for (const view of input.snapshot.auctions) {
		// A lot with no duration has no end, so it has no phase and cannot be bid on.
		if (auctionPhase(view, input.now) !== 'open') continue
		const model = toAuctionDetailModel(view, {
			now: input.now,
			status: input.status,
			divergences: input.snapshot.verdictDivergence,
		})

		// One 1-sat probe for the two figures the floor needs (`minimum` is a
		// position, `ownPosition` is where the bidder already stands). It is allowed
		// to be refused — a first bid of 1 sat on a lot opening at 1,000 is refused
		// `below-minimum` and still answers both.
		const probe = checkArenaBid({ model, status: input.status, now: input.now, bidder: input.bidder, raw: '1' })
		if (probe.minimum === null) continue // no `starting_bid`, or a partial read: nothing to bid against

		const minimumDelta = Math.max(1, probe.minimum - (probe.ownPosition ?? 0))
		const amount = input.preferredAmount === undefined ? minimumDelta : Math.max(minimumDelta, input.preferredAmount)
		// The real check, on the amount that would actually be published. This is
		// where `ended`, `concluded`, `own-auction`, `wallet-unavailable`,
		// `not-started` and an out-of-range amount all come out.
		const check = checkArenaBid({ model, status: input.status, now: input.now, bidder: input.bidder, raw: String(amount) })
		if (!check.allowed || check.amount === null) continue

		return { view, model, check }
	}
	return null
}
