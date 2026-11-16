/**
 * `sellerAuctionHref.ts` — the dashboard's address for one of the seller's lots.
 *
 * `/dashboard/products/auctions/<d>?seller=<seller>`.
 *
 * A `d` is scoped to its seller, so the seller key rides along and the address
 * is unambiguous without the detail page having to guess a seller. This is the
 * dashboard's copy of the public `lotHref` (`arenaLotRead.ts`), not a second
 * convention — kept in its own module so the list, lot and bids hosts share one
 * definition without importing each other.
 */
export function sellerAuctionHref(d: string, seller: string): string {
	return `/dashboard/products/auctions/${encodeURIComponent(d)}?seller=${encodeURIComponent(seller)}`
}