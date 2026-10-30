/**
 * sdk/commerce/auctions/claimOrderType.ts — the auction claim's order-type plug-in (Wave I, I-a A2 S3).
 *
 * Auctions ADVERTISE into the orders claim contract (`@sdk/commerce/orders/orderClaims`); orders
 * never name auctions. The descriptor is the whole edge: the `auction-claim` subject plus the
 * public-marker parser from the private-claim module, so a composed order surface resolves the
 * auction claim through the generic contract instead of importing auction parsing.
 */
import type { OrderClaimTypeDescriptor } from '@sdk/commerce/orders/orderClaims'
import {
	AUCTION_CLAIM_SUBJECT,
	getAuctionClaimPublicMarkerFields,
	type AuctionClaimPublicMarkerFields,
} from '@sdk/commerce/auctions/privateAuctionClaimMessage'

export const auctionClaimOrderType: OrderClaimTypeDescriptor<AuctionClaimPublicMarkerFields> = {
	subject: AUCTION_CLAIM_SUBJECT,
	parsePublicMarker: getAuctionClaimPublicMarkerFields,
}
