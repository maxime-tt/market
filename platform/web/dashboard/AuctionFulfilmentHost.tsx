/**
 * `AuctionFulfilmentHost.tsx` — the dashboard per-lot **fulfilment** panel.
 *
 * ## Why this is allowed on a read-only page
 *
 * The dashboard lot page is read-only for **money**: no settlement publish, no
 * path release, no reclaim. Fulfilment is not money — it is the winner handing
 * the seller a shipping address — so it stays, reusing the existing order-claim
 * path (`publishAuctionClaimOrder` → the generic `auction-claim` order marker →
 * the order surfaces). The one change the consolidated protocol forces is the
 * **claim key**: there is no manual 30408 settlement any more, so the claim is
 * keyed on the winning **1445 verdict** event id instead (`verdictEventId`).
 *
 * ## Who won, and from where
 *
 * The winner is the bidder of the bid whose id the highest-anchored `winner`
 * verdict names (`verdict.bidId` → `view.bids[].eventId`). That is a read of the
 * verdict, not a tally: this host applies no quorum rule and picks no winner of
 * its own — it reads the one a validator published.
 *
 * ## Two sides
 *
 * - the **winner** sees "submit shipping address" until they have a claim order
 *   on this lot, then a "sent" acknowledgement;
 * - the **seller** sees the decrypted shipping details for that claim order
 *   (through the same private gift-wrap lookup the order detail page uses).
 *
 * Nothing here displays a wallet key, a proof or a settlement: the amount shown
 * to the claim dialog is the winner's derived position, and the claim itself is
 * an order, not a payment.
 */

import { useMemo, useState } from 'react'
import { useStore } from '@tanstack/react-store'
import type { NostrEventLike } from '@sdk/core/nostr/eventLike'
import { authStore } from '@platform/web/auth/authStore'
import { useAuctionClaimOrders, usePrivateAuctionClaimForOrder } from '@platform/web/auctions/auctionsQuery'
import { AuctionClaimDialog } from '@platform/web/auctions/AuctionClaimDialog'
import type { ArenaAuctionView } from '@platform/web/auctions/relay/arenaAuctionRead'
import { Button } from '@ui/wrappers/button'
import { formatClaimAddress, winningVerdictOf, winningBidderOf } from '@platform/web/dashboard/auctionFulfilment'

export interface AuctionFulfilmentHostProps {
	/** The resolved lot, or `null` when the read delivered none. */
	view: ArenaAuctionView | null
}

export function AuctionFulfilmentHost({ view }: AuctionFulfilmentHostProps) {
	const { user } = useStore(authStore)
	const [isClaimOpen, setIsClaimOpen] = useState(false)

	const winnerVerdict = useMemo(() => winningVerdictOf(view), [view])
	const winnerPubkey = useMemo(() => winningBidderOf(view), [view])
	const isWinner = !!(user?.pubkey && winnerPubkey && user.pubkey === winnerPubkey)
	const isSeller = !!(user?.pubkey && view && user.pubkey === view.seller)

	// Hooks run unconditionally. Claim orders are kind-16 order events that
	// advertise this lot through the generic order-claim contract (`a` tag =
	// the lot coordinate); the private delivery is decrypted for the seller only.
	const claimOrdersQuery = useAuctionClaimOrders(view?.coordinate ?? '')
	const winnerClaim: NostrEventLike | null = useMemo(
		() => (claimOrdersQuery.data ?? []).find((order) => order.pubkey === winnerPubkey) ?? null,
		[claimOrdersQuery.data, winnerPubkey],
	)
	const privateClaimQuery = usePrivateAuctionClaimForOrder(winnerClaim, isSeller && !!winnerClaim)
	const privateClaim = privateClaimQuery.data?.status === 'found' ? privateClaimQuery.data.claim.payload : null

	if (view === null || winnerVerdict === null) return null

	const finalAmount = winnerPubkey !== null ? (view.positions[winnerPubkey] ?? null) : null
	const claimAmount = finalAmount !== null && finalAmount > 0 ? finalAmount : null

	if (isWinner) {
		return (
			<section data-slot="auction-fulfilment-winner" className="space-y-3 rounded-xl border border-border-default bg-surface-raised p-4">
				<h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-text-mid">Fulfilment</h2>
				{winnerClaim ? (
					<p className="text-sm text-text-high">
						Your shipping address was submitted to the seller. Fulfilment is tracked on your orders.
					</p>
				) : claimAmount !== null ? (
					<>
						<p className="text-sm text-text-high">
							You won this lot. Submit a shipping address so the seller can send it.
						</p>
						<Button onClick={() => setIsClaimOpen(true)}>Submit shipping address</Button>
						<AuctionClaimDialog
							open={isClaimOpen}
							onOpenChange={setIsClaimOpen}
							auctionEventId={view.rootEventId}
							auctionCoordinates={view.coordinate}
							verdictEventId={winnerVerdict.eventId}
							sellerPubkey={view.seller}
							finalAmount={claimAmount}
						/>
					</>
				) : (
					<p className="text-sm text-text-mid">
						The read holds no winning amount for your bid, so a shipping claim cannot be raised yet — this is not a statement
						that you did not win.
					</p>
				)}
			</section>
		)
	}

	if (isSeller) {
		return (
			<section data-slot="auction-fulfilment-seller" className="space-y-3 rounded-xl border border-border-default bg-surface-raised p-4">
				<h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-text-mid">Fulfilment</h2>
				{winnerClaim === null ? (
					<p className="text-sm text-text-mid">Waiting for the winner to submit a shipping address.</p>
				) : privateClaim !== null ? (
					<div className="space-y-3">
						<div className="rounded-lg border border-border-default bg-surface-sunken p-3">
							<p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-text-mid">Shipping address</p>
							<p className="mt-2 whitespace-pre-wrap text-sm text-text-high">{formatClaimAddress(privateClaim.shippingAddress)}</p>
						</div>
						{(privateClaim.email || privateClaim.phone) && (
							<div className="grid gap-2 text-sm text-text-high sm:grid-cols-2">
								{privateClaim.email && <p>Email: {privateClaim.email}</p>}
								{privateClaim.phone && <p>Phone: {privateClaim.phone}</p>}
							</div>
						)}
						{privateClaim.notes && <p className="text-sm text-text-high">Message: {privateClaim.notes}</p>}
					</div>
				) : privateClaimQuery.isLoading ? (
					<p className="text-sm text-text-mid">Decrypting the shipping address…</p>
				) : (
					<p className="text-sm text-text-mid">
						Shipping details could not be decrypted here — open the winner&apos;s order to read them.
					</p>
				)}
			</section>
		)
	}

	return null
}