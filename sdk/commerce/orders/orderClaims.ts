/**
 * sdk/commerce/orders/orderClaims.ts — the typed public-claim contract for order events.
 *
 * An order event may carry a typed public claim marker: the `subject` tag convention the order
 * templates already build (`orderEvents.ts` writes the `subject`/`type`/`order`/`amount` tags into
 * a buyer order). This module owns only the generic contract: a claim TYPE advertises the
 * `subject` it owns plus the parser that extracts its typed public marker fields from an order
 * event. It is deliberately minimal — a descriptor plus first-match resolution — not a registry:
 * one claim type exists today, and a second type is a new descriptor, one union member at the
 * composition host, and one case where that host switches on `subject`.
 *
 * Placement: `sdk/commerce/orders/` because the tag conventions are order-side. The module names
 * no marketplace feature — the auction claim is one plug-in descriptor
 * (`@sdk/commerce/auctions/claimOrderType.ts`); orders never name auctions. The dependency is
 * one-way: auctions -> orders (type-only).
 */
export interface OrderClaimEventLike {
	pubkey?: string
	tags: string[][]
}

export interface OrderClaimTypeDescriptor<Marker = unknown> {
	/** The order event's `subject` tag value this claim type owns. */
	readonly subject: string
	/** Extract the typed public marker fields from the order event, or null if it carries no such claim. */
	readonly parsePublicMarker: (event: OrderClaimEventLike) => Marker | null
}

export interface OrderClaimMatch<Marker = unknown> {
	readonly type: OrderClaimTypeDescriptor<Marker>
	readonly marker: Marker
}

/**
 * Resolve the first descriptor whose parser accepts the order event — `types` order is the
 * resolution order — or null when no descriptor does. Parsers are untrusted-marker gates: they
 * answer null for an event that merely has a `subject` tag but fails their field validation.
 */
export function findOrderClaimType<Marker>(
	event: OrderClaimEventLike,
	types: readonly OrderClaimTypeDescriptor<Marker>[],
): OrderClaimMatch<Marker> | null {
	for (const type of types) {
		const marker = type.parsePublicMarker(event)
		if (marker !== null) return { type, marker }
	}
	return null
}
