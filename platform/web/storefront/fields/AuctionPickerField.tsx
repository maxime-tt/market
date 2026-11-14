import { toAuctionListItem, useAuctionListRead } from '../auctionListRead'
import { useStorefrontContext } from '@ui/storefront/StorefrontContext'

/**
 * Sidebar field for choosing auctions to place in a page.
 *
 * The persisted value is the auction **coordinate** (`1440:<seller>:<d>`), never
 * a title or a price: a cached price on a page would be a price the seller did
 * not agree to honour (the same rule `ProductGrid` follows), and a coordinate
 * still resolves after the seller edits display fields.
 *
 * The list is the author's own auctions, read over the same adapter the block
 * renders — so the editor offers exactly the auctions the published page can
 * resolve, and an existing value that no longer reads stays visible and
 * removable rather than being silently rewritten.
 *
 * A coordinate the read has not delivered is marked, not dropped: while the
 * read is still running "not delivered yet" is not "does not exist".
 */

const rowClassName =
	'flex w-full items-start gap-2 rounded border border-border px-2 py-1.5 text-left text-sm text-foreground hover:bg-muted/40'

export function AuctionPickerField({
	label,
	value,
	onChange,
	readOnly,
}: {
	label: string
	value: string[]
	onChange: (value: string[]) => void
	readOnly?: boolean
}) {
	const { pubkey } = useStorefrontContext()
	const read = useAuctionListRead()
	const now = Math.floor(Date.now() / 1000)
	const mine = (read.snapshot?.auctions ?? [])
		.filter((auction) => auction.seller === pubkey)
		.map((auction) => {
			const item = toAuctionListItem(auction, now)
			return { coordinate: item.coordinate, label: item.title ?? item.d }
		})

	const known = new Set(mine.map((auction) => auction.coordinate))
	const unresolved = value.filter((coordinate) => !known.has(coordinate))

	const toggle = (coordinate: string) => {
		if (readOnly) return
		onChange(value.includes(coordinate) ? value.filter((entry) => entry !== coordinate) : [...value, coordinate])
	}

	return (
		<div className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
			<span>{label}</span>

			{read.status === 'loading' && mine.length === 0 && (
				<span className="font-normal">Reading your auctions from relays…</span>
			)}
			{read.status === 'no-relays' && <span className="font-normal">No relay answered, so your auctions could not be read.</span>}
			{read.status === 'incomplete' && mine.length === 0 && (
				<span className="font-normal">The read stopped before every relay answered; no auctions were delivered.</span>
			)}
			{read.status === 'settled' && mine.length === 0 && <span className="font-normal">You have no auctions on the relays yet.</span>}
			{read.status === 'error' && <span className="font-normal">Your auctions could not be loaded right now.</span>}

			{value.length > 0 && (
				<ol className="flex flex-col gap-1 font-normal" data-testid="auction-picker-selected">
					{value.map((coordinate, index) => (
						<li key={coordinate} className="flex items-center justify-between gap-2 rounded bg-muted/40 px-2 py-1">
							<span className="truncate">
								{index + 1}. {mine.find((auction) => auction.coordinate === coordinate)?.label ?? coordinate}
							</span>
							{!readOnly && (
								<button type="button" className="text-[11px] underline" onClick={() => toggle(coordinate)}>
									Remove
								</button>
							)}
						</li>
					))}
				</ol>
			)}

			{mine.length > 0 && (
				<ul className="flex flex-col gap-1 font-normal">
					{mine.map((auction) => {
						const selected = value.includes(auction.coordinate)
						return (
							<li key={auction.coordinate}>
								<button type="button" className={rowClassName} aria-pressed={selected} disabled={readOnly} onClick={() => toggle(auction.coordinate)}>
									<span aria-hidden>{selected ? '✓' : '+'}</span>
									<span className="truncate">{auction.label}</span>
								</button>
							</li>
						)
					})}
				</ul>
			)}

			{unresolved.length > 0 && (
				<ul className="flex flex-col gap-1 font-normal" data-testid="auction-picker-unresolved">
					{unresolved.map((coordinate) => (
						<li key={coordinate} className="flex items-center justify-between gap-2 rounded border border-dashed border-border px-2 py-1">
							<span className="truncate" title={coordinate}>
								{coordinate} ({read.status === 'settled' ? 'not found' : 'not delivered yet'})
							</span>
							{!readOnly && (
								<button type="button" className="text-[11px] underline" onClick={() => toggle(coordinate)}>
									Remove
								</button>
							)}
						</li>
					))}
				</ul>
			)}
		</div>
	)
}