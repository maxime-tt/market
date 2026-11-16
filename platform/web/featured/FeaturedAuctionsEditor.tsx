/**
 * `platform/web/featured/FeaturedAuctionsEditor.tsx` — the app-settings
 * "Featured Auctions" tab: the curated list, and the picker that extends it.
 *
 * Props-only (ADR-0007): the route holds the read, the picker state and the
 * mutations; this host renders what it is handed. That is also what makes the
 * two states a test has to cover reachable without a relay — the empty list and
 * the populated list are just props.
 *
 * ## The picker cannot name a lot that does not exist
 *
 * The admin picker is a `Select` over `options`: the lots the arena read
 * actually delivered (see `featuredAuctionLots.ts`). There is no free-text field
 * any more, because a text field could only promise "add this coordinate" — and
 * a coordinate is not a lot. When there is nothing to offer the tab says which
 * of the three reasons applies: the read has not settled, no lot is published,
 * or every published lot is already featured.
 *
 * ## An entry whose lot cannot be read says so
 *
 * A curated coordinate that the read did not deliver renders a row stating that
 * fact and keeping the Remove control — never a card with a blank title and a
 * `0` price. `unread` and `missing` stay distinct here for the same reason they
 * do in the derivation: "not read yet" must not be printed as "deleted".
 */

import { Button } from '@ui/wrappers/button'
import { EmptyState } from '@ui/shared/empty-state'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@ui/primitives/card'
import { Label } from '@ui/primitives/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@ui/primitives/select'
import { AuctionDisplayView } from '@ui/auction/auction-display-view'
import { Gavel, Plus } from 'lucide-react'
import type { FeaturedAuctionEntry, FeaturedAuctionOption, FeaturedAuctionRead } from './featuredAuctionLots'
import { featuredAuctionReadNotice } from './featuredAuctionLots'

export interface FeaturedAuctionsEditorProps {
	/** The curated entries, resolved against the read, in the curator's order. */
	entries: readonly FeaturedAuctionEntry[]
	/** Published lots that are not featured yet. */
	options: readonly FeaturedAuctionOption[]
	read: FeaturedAuctionRead
	/** The coordinate currently chosen in the picker, or `''`. */
	picked: string
	onPickChange: (coordinate: string) => void
	onAdd: () => void
	onRemove: (coordinate: string) => void
	onMoveUp: (index: number) => void
	onMoveDown: (index: number) => void
	isAdding: boolean
	isReordering: boolean
	isRemoving: boolean
}

/** `2026-11-16 14:05` — the row's end time, or the fact that the create stated none. */
function endAtLabel(endsAt: number | null): string {
	return endsAt === null ? 'No end stated' : new Date(endsAt * 1000).toLocaleString()
}

/** What the lot's own card may say in one line, without inventing a field it did not state. */
function summaryOf(entry: Extract<FeaturedAuctionEntry, { kind: 'lot' }>): string {
	const { card } = entry
	const price = card.startingBid === null ? 'No starting bid stated' : `Starting bid ${card.startingBid} sats`
	const bids = card.bidCount === 1 ? '1 bid' : `${card.bidCount} bids`
	return `${price} · ${bids}`
}

export function FeaturedAuctionsEditor({
	entries,
	options,
	read,
	picked,
	onPickChange,
	onAdd,
	onRemove,
	onMoveUp,
	onMoveDown,
	isAdding,
	isReordering,
	isRemoving,
}: FeaturedAuctionsEditorProps) {
	const notice = featuredAuctionReadNotice(read)
	const nothingToOffer = read.status === 'settled' && options.length === 0

	return (
		<>
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<Gavel className="w-5 h-5" />
						Featured Auctions
					</CardTitle>
					<CardDescription>
						Live arena auctions highlighted on the auctions page. Order matters - use up/down buttons to reorder.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					{entries.length === 0 ? (
						<EmptyState icon={<Gavel />} title="No featured auctions yet" description="Pick a published auction below to feature it." />
					) : (
						<div className="space-y-3">
							{entries.map((entry, index) => {
								const shared = {
									index,
									onMoveUp: () => onMoveUp(index),
									onMoveDown: () => onMoveDown(index),
									onRemove: () => onRemove(entry.coordinate),
									canMoveUp: index > 0,
									canMoveDown: index < entries.length - 1,
									isReordering,
									isRemoving,
								}
								if (entry.kind === 'lot') {
									return (
										<AuctionDisplayView
											key={entry.coordinate}
											title={entry.card.title ?? entry.card.d}
											summary={summaryOf(entry)}
											imageUrl={entry.card.imageUrl}
											endAtLabel={endAtLabel(entry.card.endsAt)}
											coordsIdentifier={entry.card.d}
											{...shared}
										/>
									)
								}
								const detail =
									entry.kind === 'missing'
										? 'No relay carries this auction any more, so it cannot be shown. Remove it from the list.'
										: 'The auction read has not finished, so this entry cannot be shown yet. Nothing has been removed.'
								return (
									<Card key={entry.coordinate} className="p-4">
										<div className="flex items-start gap-4">
											<div className="flex-1 min-w-0">
												<h3 className="font-semibold text-sm">
													{entry.kind === 'missing' ? 'Auction no longer published' : 'Auction not read yet'}
												</h3>
												<p className="text-xs text-text-mid mt-1 break-all">{entry.coordinate}</p>
												<p className="text-xs text-text-mid mt-1">{detail}</p>
											</div>
											<Button variant="destructive" size="sm" onClick={() => onRemove(entry.coordinate)} disabled={isRemoving}>
												Remove
											</Button>
										</div>
									</Card>
								)
							})}
						</div>
					)}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<Plus className="w-5 h-5" />
						Add Featured Auction
					</CardTitle>
					<CardDescription>Only auctions published to the relays can be featured.</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					{notice !== null && <p className="text-sm text-text-mid">{notice}</p>}
					{nothingToOffer && (
						<EmptyState
							compact
							icon={<Gavel />}
							title="No published auctions to feature"
							description="Every relay answered and none carried an auction, or every published auction is already featured above."
						/>
					)}
					{options.length > 0 && (
						<div className="space-y-2">
							<Label htmlFor="newAuction">Published Auction</Label>
							<div className="flex gap-2">
								<Select value={picked} onValueChange={onPickChange}>
									<SelectTrigger id="newAuction" className="flex-1">
										<SelectValue placeholder="Choose a published auction" />
									</SelectTrigger>
									<SelectContent>
										{options.map((option) => (
											<SelectItem key={option.coordinate} value={option.coordinate}>
												{option.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
								<Button onClick={onAdd} pending={isAdding} disabled={isAdding || picked === ''}>
									{!isAdding && <Plus className="w-4 h-4" />}Add
								</Button>
							</div>
						</div>
					)}
					<div className="text-xs text-gray-500">
						Note: Auctions will be displayed in the order they appear in the list. Use the up/down buttons to reorder.
					</div>
				</CardContent>
			</Card>
		</>
	)
}