import type { ReactNode } from 'react'
import { Badge } from '../primitives/badge'

/**
 * Auction shipping-option presentation, lifted out of the public auction route.
 *
 * Both components were inline in `platform/web/routes/auctions.$auctionId.tsx`;
 * the route is an assembler and must not define components. The markup is
 * unchanged apart from colour classes, which were raw `zinc`/`white` values and
 * are now semantic tokens (`border-border`, `bg-muted/50`, `text-foreground`,
 * `text-muted-foreground`).
 */

/** One `<dt>`/`<dd>` pair inside the shipping `<dl>`; renders nothing when empty. */
export function AuctionShippingDetailRow({ label, value }: { label: string; value?: ReactNode }) {
	if (value === null || value === undefined || value === '') return null

	return (
		// A `div` wrapping `dt`/`dd` is valid HTML inside a `dl`.
		<div className="rounded-lg border border-border bg-muted/50 px-3 py-3">
			<dt className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</dt>
			<dd className="mt-1 break-words text-sm font-medium text-foreground">{value}</dd>
		</div>
	)
}

export interface AuctionShippingOptionCardProps {
	/** `invalid` means the shipping reference could not be resolved at all. */
	status: 'valid' | 'invalid'
	/** The referenced event exists but its details are still loading. */
	isLoading?: boolean
	/** Neither a parsed option nor a tagged event was available. */
	isUnavailable?: boolean
	title: string
	description?: string | null
	/** Headline price shown in the badge. */
	priceLabel: string
	/** `Base price` row; resolved by the host from the option or its tags. */
	basePriceLabel?: ReactNode
	extraCost?: ReactNode
	service?: ReactNode
	carrier?: ReactNode
	location?: ReactNode
	pickup?: ReactNode
	destination?: ReactNode
	duration?: ReactNode
	/** The event carried a reference the parser could not fully resolve. */
	hasPartialShippingInfo?: boolean
}

/** Shipping option rendered as a `<li>`; the caller supplies the surrounding list. */
export function AuctionShippingOptionCard({
	status,
	isLoading = false,
	isUnavailable = false,
	title,
	description,
	priceLabel,
	basePriceLabel,
	extraCost,
	service,
	carrier,
	location,
	pickup,
	destination,
	duration,
	hasPartialShippingInfo = false,
}: AuctionShippingOptionCardProps) {
	if (status === 'invalid') {
		return (
			<li className="rounded-xl border border-border bg-background px-5 py-5 shadow-sm">
				<h3 className="text-sm font-semibold text-foreground">Invalid shipping reference</h3>
				{description && <p className="mt-2 break-all text-xs text-muted-foreground">{description}</p>}
			</li>
		)
	}

	if (isLoading) {
		return (
			<li className="rounded-xl border border-border bg-background px-5 py-5 shadow-sm">
				<p className="text-sm text-muted-foreground">Loading shipping details...</p>
			</li>
		)
	}

	if (isUnavailable) {
		return (
			<li className="rounded-xl border border-border bg-background px-5 py-5 shadow-sm">
				<h3 className="text-sm font-semibold text-foreground">Shipping option unavailable</h3>
			</li>
		)
	}

	return (
		<li className="rounded-xl border border-border bg-background px-5 py-5 shadow-sm">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<h3 className="text-base font-semibold text-foreground">{title}</h3>
					{description && <p className="mt-2 break-all text-xs text-muted-foreground">{description}</p>}
				</div>
				<Badge variant="outline" className="border-border bg-muted/50 text-muted-foreground">
					{priceLabel}
				</Badge>
			</div>

			{hasPartialShippingInfo && (
				<div className="mt-4 rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm leading-6 text-muted-foreground">
					Some shipping details are missing or malformed.
				</div>
			)}

			<dl className="mt-4 grid gap-3 sm:grid-cols-2">
				<AuctionShippingDetailRow label="Base price" value={basePriceLabel} />
				<AuctionShippingDetailRow label="Service" value={service} />
				<AuctionShippingDetailRow label="Carrier" value={carrier} />
				<AuctionShippingDetailRow label="Destination" value={destination} />
				<AuctionShippingDetailRow label="Duration" value={duration} />
				<AuctionShippingDetailRow label="Location" value={location} />
				<AuctionShippingDetailRow label="Pickup" value={pickup} />
				<AuctionShippingDetailRow label="Auction extra cost" value={extraCost} />
			</dl>
		</li>
	)
}
