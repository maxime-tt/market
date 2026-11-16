/**
 * `auctionFulfilment.ts` — the pure helpers behind the dashboard fulfilment
 * panel: who won (from the verdict) and how a delivery address is rendered.
 *
 * Split from `AuctionFulfilmentHost.tsx` so they carry no React, no query and no
 * wallet import: the winner rule is load-bearing for the shipping claim, and a
 * pure function is what a test can pin without the app runtime.
 */

import type { AuctionClaimDeliveryDetails } from '@sdk/commerce/auctions/privateAuctionClaimMessage'
import type { ArenaAuctionView } from '@platform/web/auctions/relay/arenaAuctionRead'

/**
 * The highest-anchored verdict, **only when it is a `winner`**. Consistent with
 * the card/detail, which state `verdicts[0]` (height-descending) as the outcome:
 * an older `winner` row beneath a newer `cancelled` one is a disagreement the
 * read refuses to resolve, not a win to act on.
 */
export function winningVerdictOf(view: ArenaAuctionView | null) {
	if (view === null) return null
	const latest = view.verdicts[0]
	return latest?.outcome === 'winner' ? latest : null
}

/**
 * The winning bid's bidder, read from the highest-anchored `winner` verdict and
 * the bid it names. `null` when no `winner` verdict is on top, when that verdict
 * names no bid, or when that bid is not in the read.
 */
export function winningBidderOf(view: ArenaAuctionView | null): string | null {
	if (view === null) return null
	const winnerVerdict = winningVerdictOf(view)
	if (!winnerVerdict || winnerVerdict.bidId === null) return null
	return view.bids.find((bid) => bid.eventId === winnerVerdict.bidId)?.bidder ?? null
}

/** The delivery address, as the seller reads it. No contact fields, no keys. */
export function formatClaimAddress(address: AuctionClaimDeliveryDetails): string {
	return [
		address.name,
		address.firstLineOfAddress,
		address.additionalInformation,
		[address.city, address.zipPostcode].filter(Boolean).join(' '),
		address.country,
	]
		.filter(Boolean)
		.join('\n')
}