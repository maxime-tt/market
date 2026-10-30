/**
 * platform/web/orders/orderClaimsBinding.ts — the order-claim composition host (Wave I, I-a A2 S3).
 *
 * Composes the order-claim type descriptors and exposes the single hook an order surface needs:
 * `useOrderClaimForSeller` answers the typed public claim an order event carries, for the SELLER
 * of that order, or null. The orders data layer stays auction-free — the auction member delegates
 * to the existing private-claim query machinery in the auctions binding (platform -> platform),
 * and this file is the only place that knows both. Re-exported through
 * `platform/web/orders/ordersQuery.ts`, so the sanctioned `src/queries/orders.tsx` shim carries
 * it to `src/` consumers — no new `SRC_TO_PLATFORM_ALLOWLIST` row.
 *
 * Behavioural-change declaration: NONE. The `enabled` arithmetic is byte-identical to the
 * pre-S3 call site (`isOrderSeller && !!auctionClaimFields`, asserted in the binding test); the
 * marker parse delegates to the same `getAuctionClaimPublicMarkerFields` through the descriptor;
 * and the component's render gate `orderClaim?.subject === 'auction-claim'` implies
 * `isSeller && marker present`, because this hook answers null for anyone but the seller.
 *
 * Residual-view debt row (red-team C5, recorded 2026-10-29, owed to DR-4 — OrderDetailComponent's
 * own host+view retirement): the auction flavour still surfaces in the orders VIEW layer, by
 * design of this slice — the `PrivateAuctionClaimCard` view (`ui/orders/order-detail-sections.tsx:129`),
 * the component's `orderClaim?.subject === 'auction-claim'` switch literal, and the
 * `privateAuctionClaimUnavailableMessage` copy helper. S3 removed the data-layer edge only; the
 * view and copy residue move with the component's own slice, not before.
 */
import { findOrderClaimType } from '@sdk/commerce/orders/orderClaims'
import { auctionClaimOrderType } from '@sdk/commerce/auctions/claimOrderType'
import { AUCTION_CLAIM_SUBJECT, type AuctionClaimPublicMarkerFields } from '@sdk/commerce/auctions/privateAuctionClaimMessage'
import type { NostrEventLike } from '@sdk/core/nostr/eventLike'
import { usePrivateAuctionClaimForOrder } from '@platform/web/auctions/auctionsQuery'

/** The composed order-claim types. One member today; a future type = new descriptor + one union member + one switch case below. */
const ORDER_CLAIM_TYPES = [auctionClaimOrderType] as const

export type AuctionClaimOrderQuery = ReturnType<typeof usePrivateAuctionClaimForOrder>

/** The typed public claim an order event carries, for the seller. One member today. */
export type OrderClaimForSellerView = {
	readonly subject: typeof AUCTION_CLAIM_SUBJECT
	readonly marker: AuctionClaimPublicMarkerFields
	readonly claimQuery: AuctionClaimOrderQuery
}

/**
 * The order event's typed public claim, for the seller of that order, or null when the event
 * carries no composed claim type or the viewer is not the seller.
 *
 * The claim query is ALWAYS mounted (React rules of hooks); `enabled` gates it — the arithmetic
 * is byte-identical to the pre-S3 call site: `isSeller && !!marker`.
 */
export function useOrderClaimForSeller(orderEvent: NostrEventLike | null | undefined, isSeller: boolean): OrderClaimForSellerView | null {
	const found = orderEvent ? findOrderClaimType(orderEvent, ORDER_CLAIM_TYPES) : null
	// Byte-identical to the pre-S3 `usePrivateAuctionClaimForOrder(orderEvent,
	// isOrderSeller && !!auctionClaimFields)` — asserted in the binding test.
	const claimQuery = usePrivateAuctionClaimForOrder(orderEvent, isSeller && found !== null)
	if (!isSeller || !found) return null
	switch (found.type.subject) {
		case AUCTION_CLAIM_SUBJECT:
			return { subject: AUCTION_CLAIM_SUBJECT, marker: found.marker, claimQuery }
		default:
			// No other claim type is composed today. A new descriptor must add its union
			// member + its case above in the same change; an unrecognised subject resolves
			// null (renders no claim card) rather than half-wiring a new claim type.
			return null
	}
}
