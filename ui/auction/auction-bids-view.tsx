import { getBidAmount, getBidMint } from '@sdk/commerce/auctions/auctionRead'
import type { ValidatedBidSet } from '@sdk/commerce/auctions/bidValidation'
import { getBidClassification, getValidatedTopAmount, getValidatedTopBidderPubkey } from '@sdk/commerce/auctions/validatedBidView'
import type { NostrEventLike } from '@sdk/core/nostr/eventLike'
import { formatSats, getMintHostname } from '@sdk/commerce/payments/display'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@ui/primitives/accordion'
import { Badge } from '@ui/primitives/badge'
import { Check, Landmark } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../utils/cn'
/** Props-only auction bid list (D4 S5a). Reproduces the retiring
 * `src/components/AuctionBidsContainer.tsx` structure, copy and accordion
 * behaviour; the stream read stays in the platform host and the bidder identity
 * arrives via `renderUserCard`. Raw palette migrated to Tier-1 roles (R18).
 * `isLoading` marks the region busy; the legacy had no loading chrome.
 */
export interface AuctionBidsViewProps {
	bids: NostrEventLike[]
	validatedBidSet?: ValidatedBidSet | null
	currentUserPubkey?: string
	isEnded?: boolean
	isLoading?: boolean
	renderUserCard: (pubkey: string, size: 'md' | 'sm') => ReactNode
	className?: string
}

function TechnicalDataRow({ label, value }: { label: string; value: ReactNode }) {
	return (
		<div className="rounded-lg border border-border-default bg-surface-sunken px-3 py-3">
			<p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-text-mid">{label}</p>
			<div className="mt-1 break-all text-sm font-medium text-text-high">{value}</div>
		</div>
	)
}

type BidTone = 'blue' | 'orange' | 'green' | 'pink' | 'white'

const toneContainerClassName: Record<BidTone, string> = {
	blue: 'border-info-border bg-info-muted',
	orange: 'border-warning-border bg-warning-muted',
	green: 'border-success-border bg-success-muted',
	pink: 'border-fill-accent bg-fill-accent/10',
	white: 'border-border-default bg-surface-sunken',
}

const toneLabelClassName: Record<BidTone, string> = {
	blue: 'text-info-foreground',
	orange: 'text-warning-foreground',
	green: 'text-success-foreground',
	pink: 'text-fill-accent',
	white: 'text-text-mid',
}

function formatBidRecordedAt(bidEvent: NostrEventLike): string {
	return bidEvent.created_at ? new Date(bidEvent.created_at * 1000).toLocaleString() : 'Unknown time'
}

function BidMintRow({ mint }: { mint: string }) {
	return (
		<div className="flex flex-wrap items-center gap-2 text-sm text-text-high">
			<div className="relative flex h-6 cursor-default items-center px-2">
				<Landmark className="size-4 text-primary" />
				<span className="absolute -bottom-1.5 -right-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-fill-accent text-[9px] font-bold leading-none text-on-fill-accent">
					<Check className="h-2 w-2 text-on-fill-accent stroke-[3]" />
				</span>
			</div>
			<p>Mint: {mint ? getMintHostname(mint) : 'N/A'}</p>
		</div>
	)
}

function BidEventDetails({ bidEvent }: { bidEvent: NostrEventLike }) {
	const locktime = bidEvent.tags.find((tag) => tag[0] === 'locktime')?.[1]
	const bidKeyScheme = bidEvent.tags.find((tag) => tag[0] === 'key_scheme')?.[1] || 'hd_p2pk'

	return (
		<Accordion type="single" collapsible className="rounded-xl border border-border-default bg-card px-4">
			<AccordionItem value={`bid-${bidEvent.id}`} className="border-none">
				<AccordionTrigger className="py-4 text-sm font-semibold text-text-high hover:no-underline">Bid event details</AccordionTrigger>
				<AccordionContent className="space-y-3 pb-4">
					<TechnicalDataRow label="Bidder pubkey" value={bidEvent.pubkey} />
					<TechnicalDataRow label="Mint" value={getBidMint(bidEvent) || 'N/A'} />
					<TechnicalDataRow label="Key scheme" value={bidKeyScheme} />
					<TechnicalDataRow label="Locktime" value={locktime ? new Date(parseInt(locktime, 10) * 1000).toLocaleString() : 'N/A'} />
					<TechnicalDataRow label="Bid event ID" value={bidEvent.id} />
				</AccordionContent>
			</AccordionItem>
		</Accordion>
	)
}

export function AuctionBidsView({
	bids,
	validatedBidSet,
	currentUserPubkey,
	isEnded,
	isLoading = false,
	renderUserCard,
	className,
}: AuctionBidsViewProps) {
	// Determine top bid — use the validated canonicalWinner when available,
	// otherwise fall back to raw bid sort (legacy behaviour).
	let topBid: NostrEventLike | null
	let topBidPubkey: string | null
	let topAmount: number
	if (validatedBidSet) {
		topBid = validatedBidSet.canonicalWinner?.rawEvent ?? null
		topBidPubkey = getValidatedTopBidderPubkey(validatedBidSet)
		topAmount = getValidatedTopAmount(validatedBidSet)
	} else {
		topBid = bids.reduce<NostrEventLike | null>((best, bid) => {
			if (!best) return bid

			const amountDiff = getBidAmount(bid) - getBidAmount(best)
			if (amountDiff > 0) return bid
			if (amountDiff < 0) return best

			const createdAtDiff = (bid.created_at ?? 0) - (best.created_at ?? 0)
			if (createdAtDiff < 0) return bid
			if (createdAtDiff > 0) return best

			return bid.id.localeCompare(best.id) < 0 ? bid : best
		}, null)
		topBidPubkey = topBid?.pubkey ?? null
		topAmount = topBid ? getBidAmount(topBid) : 0
	}

	const latestBids = [...bids]
		.filter((bid) => bid.id !== topBid?.id)
		.sort((a, b) => {
			const createdAtDiff = (b.created_at || 0) - (a.created_at || 0)
			if (createdAtDiff !== 0) return createdAtDiff
			return b.id.localeCompare(a.id)
		})

	const hasOwnBids = !!currentUserPubkey && bids.some((bid) => bid.pubkey === currentUserPubkey)
	const topBidIsOwn = !!topBid && topBidPubkey === currentUserPubkey
	const topBidTone: BidTone = topBidIsOwn ? 'green' : hasOwnBids ? 'orange' : 'blue'
	const myHighestBidAmount = hasOwnBids
		? bids.filter((bid) => bid.pubkey === currentUserPubkey).reduce((max, bid) => Math.max(max, getBidAmount(bid)), 0)
		: 0
	const showOutbidNotice = !topBidIsOwn && hasOwnBids && !isEnded

	return bids.length === 0 ? (
		<div
			data-slot="auction-bids-view"
			aria-busy={isLoading || undefined}
			className={cn('rounded-xl border border-dashed border-border-default bg-surface-sunken px-5 py-6 text-sm text-text-mid', className)}
		>
			No bids yet. The latest bids will appear here once bidders lock funds.
		</div>
	) : (
		<div data-slot="auction-bids-view" aria-busy={isLoading || undefined} className="space-y-4">
			{topBid && (
				<div className={cn('flex flex-col gap-4 rounded-xl border-2 px-4 py-4 shadow-sm', toneContainerClassName[topBidTone])}>
					<div className="flex flex-wrap items-start justify-between gap-3">
						<div>
							<p className={cn('text-[11px] font-semibold uppercase tracking-[0.18em]', toneLabelClassName[topBidTone])}>
								Highest visible bid
							</p>
							<p className="mt-1 text-3xl font-semibold tracking-tight text-text-high">{formatSats(topAmount)} sats</p>
							<p className="mt-1 text-sm text-text-mid">Recorded {formatBidRecordedAt(topBid)}</p>
						</div>
						<div className="flex flex-col items-end gap-2">
							<div className="flex items-center gap-2">
								{topBidIsOwn && (
									<Badge className="border-success-border bg-success-muted text-success-muted-foreground hover:bg-success-muted">
										Your Bid
									</Badge>
								)}
								{!topBidIsOwn && hasOwnBids && (
									<Badge className="border-warning-border bg-warning-muted text-warning-muted-foreground hover:bg-warning-muted">
										Outbid
									</Badge>
								)}
							</div>
						</div>
					</div>

					{renderUserCard(topBidPubkey ?? '', 'md')}
					<BidMintRow mint={getBidMint(topBid)} />
					<BidEventDetails bidEvent={topBid} />
				</div>
			)}

			{showOutbidNotice && (
				<div className="rounded-lg border border-warning-border bg-warning-muted px-3 py-2 text-sm font-medium text-warning-muted-foreground">
					Your previous bid of {formatSats(myHighestBidAmount)} sats was outbid. Bid again to try win the auction.
				</div>
			)}

			<div className="space-y-3">
				<div className="flex items-center justify-between gap-3">
					<h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-text-mid">Latest bids</h3>
					<p className="text-xs text-text-mid">
						{latestBids.length} more bid{latestBids.length === 1 ? '' : 's'}
					</p>
				</div>

				<div className={cn('max-h-[500px] space-y-3 overflow-y-auto pr-1', className)}>
					{latestBids.length === 0 ? (
						<div className="rounded-xl border border-dashed border-border-default bg-surface-sunken px-4 py-4 text-sm text-text-mid">
							No other bids yet.
						</div>
					) : (
						latestBids.map((bidEvent) => {
							const isOwnBid = bidEvent.pubkey === currentUserPubkey
							const classification = validatedBidSet ? getBidClassification(validatedBidSet, bidEvent.id) : null
							const tone: BidTone = isOwnBid ? 'pink' : 'white'
							return (
								<div
									key={bidEvent.id}
									className={cn(
										'flex flex-col gap-3 rounded-xl border px-4 py-4 animate-in fade-in-0 slide-in-from-bottom-1 duration-200',
										toneContainerClassName[tone],
									)}
								>
									<div className="flex flex-wrap items-start justify-between gap-3">
										<div>
											<p className="text-xl font-semibold tracking-tight text-text-high">{formatSats(getBidAmount(bidEvent))} sats</p>
											<p className="mt-1 text-sm text-text-mid">Recorded {formatBidRecordedAt(bidEvent)}</p>
										</div>
										<div className="flex items-center gap-2">
											{classification && classification !== 'valid' && (
												<Badge
													className={cn(
														'border-border-default',
														classification === 'invalid'
															? 'bg-error-muted text-error-muted-foreground hover:bg-error-muted'
															: 'bg-warning-muted text-warning-muted-foreground hover:bg-warning-muted',
													)}
												>
													{classification === 'invalid' ? 'Rejected' : 'Pending'}
												</Badge>
											)}
											{isOwnBid && (
												<Badge className="border-fill-accent bg-fill-accent/10 text-fill-accent hover:bg-fill-accent/10">Your Bid</Badge>
											)}
										</div>
									</div>

									{renderUserCard(bidEvent.pubkey, 'sm')}
									<BidMintRow mint={getBidMint(bidEvent)} />
									<BidEventDetails bidEvent={bidEvent} />
								</div>
							)
						})
					)}
				</div>
			</div>
		</div>
	)
}
