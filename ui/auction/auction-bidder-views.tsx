/**
 * Auction **bidder** presentations — the presentational half of the bidder's
 * money-path panel, lifted verbatim out of `src/components/AuctionBidder.tsx`
 * (the component retires in the same fused commit).
 *
 * The bid state machine, the publish/re-fund orchestration, the funding
 * lifecycle and every validation stay in the host
 * (`platform/web/auctions/AuctionBidderHost.tsx`); the views receive resolved
 * values, handler callbacks and host-owned identity nodes as props, so they
 * hold no query, store or mutation plumbing.
 *
 * Declared visible changes: the raw-palette classes of the retiring component
 * were migrated to the Tier-1 role vocabulary (amber -> warning). Markup,
 * copy, `data-testid`s and DOM structure are otherwise identical.
 */
import type { ChangeEvent, ClipboardEvent, ReactNode } from 'react'
import { Button } from '../primitives/button'
import { ToggleGroup } from '../primitives/toggle-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../primitives/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../primitives/dialog'
import { Separator } from '../primitives/separator'
import { Label } from '../primitives/label'
import { DetailField } from '../shared/detail-field'
import { Alert, AlertDescription } from '../primitives/alert'
import { InputGroup, InputGroupAddon, InputGroupInput } from '../primitives/input-group'
import { cn } from '../utils/cn'
import { TooltipToggleGroupItem } from '../wrappers/tooltip-toggle-group-item'

/** One selectable mint in the bidder's mint selector (funded mints only). */
export interface AuctionBidderMintOption {
	mintUrl: string
	hostname: string
	balance: number
	hasSufficientBalance: boolean
}

/** The anti-snipe curve state, resolved by the host from the auction event. */
export interface AuctionBidderCurveState {
	/** True inside `(end_at, max_end_at]`. */
	inCurveWindow: boolean
	/** The curve's shape; `'none'` disables every curve surface. */
	curveShape: string
	curvePeakMultiplier: number
}

export interface AuctionBidderViewProps extends AuctionBidderCurveState {
	/** Compact card mode: hides the amount input, the mint selector and the minimum-bid info. */
	compact?: boolean
	ended: boolean
	/** Lower-bound gate: bidding has not opened yet (`now < start_at`). */
	notStarted: boolean
	isOwnAuction: boolean
	hasSignedInBidder: boolean
	minBid: number
	bidStep: number
	/** Mint selector (non-compact, more than one funded mint). */
	showMintSelector: boolean
	availableMints: AuctionBidderMintOption[]
	selectedMint: string | null
	onSelectMint: (mintUrl: string) => void
	/** Main action area. */
	isDisabledInput: boolean
	isDisabledBid: boolean
	bidAmountInput: string
	onBidAmountChange: (event: ChangeEvent<HTMLInputElement>) => void
	onBidAmountPaste: (event: ClipboardEvent<HTMLInputElement>) => void
	buttonText: string
	onSubmitBid: () => void
	/** The "Review auction rules" link (non-compact, signed in, not own auction). */
	onOpenRules: () => void
}

export function AuctionBidderView({
	compact = false,
	ended,
	notStarted,
	isOwnAuction,
	hasSignedInBidder,
	inCurveWindow,
	curveShape: shape,
	curvePeakMultiplier,
	minBid,
	bidStep,
	showMintSelector,
	availableMints,
	selectedMint,
	onSelectMint,
	isDisabledInput,
	isDisabledBid,
	bidAmountInput,
	onBidAmountChange,
	onBidAmountPaste,
	buttonText,
	onSubmitBid,
	onOpenRules,
}: AuctionBidderViewProps) {
	return (
		<div className="flex flex-col gap-2 w-full" data-testid="auction-bidder">
			{/* Anti-snipe curve banner — visible only when we're inside
			    `(end_at, max_end_at]` AND the auction has a non-`none` curve.
			    Tells the bidder why the floor is higher than they'd expect
			    from the flat minimum bid / raise. AUCTIONS.md §6.1. */}
			{!ended && inCurveWindow && shape !== 'none' && (
				<div className="rounded-md border border-warning-border bg-warning-muted px-3 py-2 text-xs text-warning-muted-foreground">
					<p className="font-semibold">Anti-snipe window — minimum bid rising</p>
					<p className="mt-0.5 text-warning-muted-foreground/90">
						Flat bidding has ended. Bids are still accepted until auction end, but the floor ramps up{' '}
						<span className="font-semibold">{shape}</span>ly to {curvePeakMultiplier}× by then. Floor right now:{' '}
						<span className="font-semibold">{minBid.toLocaleString()} sats</span>.
					</p>
				</div>
			)}

			{!compact && showMintSelector && (
				<div className="flex items-center gap-2">
					<span className="text-xs text-text-high/60 whitespace-nowrap">Mint:</span>
					<ToggleGroup
						type="single"
						value={selectedMint ?? ''}
						onValueChange={(val) => {
							if (val) onSelectMint(val)
						}}
						className="flex flex-wrap gap-1"
					>
						{availableMints
							.filter((m) => m.balance > 0)
							.map((m) => (
								<TooltipToggleGroupItem
									key={m.mintUrl}
									value={m.mintUrl}
									variant="outline"
									size="sm"
									tooltip={`${m.mintUrl} — ${m.balance.toLocaleString()} sats`}
									disabled={isDisabledInput || !m.hasSufficientBalance}
									className={cn('cursor-pointer flex text-xs', !m.hasSufficientBalance && 'opacity-60')}
								>
									{m.hostname} <span className="text-text-high/50">({m.balance.toLocaleString()})</span>
								</TooltipToggleGroupItem>
							))}
					</ToggleGroup>
				</div>
			)}
			{/* Main Action Area */}
			<div className={cn('flex flex-col sm:flex-row gap-2 items-stretch sm:items-center')}>
				{!compact && (
					<InputGroup className="grow w-auto">
						<InputGroupInput
							type="number"
							min={minBid}
							step={bidStep}
							value={bidAmountInput}
							onChange={onBidAmountChange}
							onPaste={onBidAmountPaste}
							placeholder={`Min: ${minBid.toLocaleString()}`}
							disabled={isDisabledInput}
						/>
					</InputGroup>
				)}

				{/* Place Bid Button */}
				<Button
					onClick={onSubmitBid}
					disabled={isDisabledBid}
					variant={ended ? 'ghost' : isOwnAuction ? 'secondary' : 'default'}
					className={cn('whitespace-nowrap flex grow')}
				>
					{buttonText}
				</Button>
			</div>

			{/* Minimum Bid Info */}
			{!compact && !ended && <div className="text-xs text-text-high/80 pl-1">Minimum allowed bid: {minBid.toLocaleString()} sats</div>}
			{!compact && hasSignedInBidder && !isOwnAuction && (
				<Button type="button" variant="link" size="sm" onClick={onOpenRules} className="h-auto justify-start p-0 text-xs text-text-mid">
					Review auction rules
				</Button>
			)}
		</div>
	)
}

export interface AuctionRulesDialogViewProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	/** The publish mutation is pending: both actions are disabled while a leg is in flight. */
	publishPending: boolean
	onConfirmRules: () => void
}

export function AuctionRulesDialogView({ open, onOpenChange, publishPending, onConfirmRules }: AuctionRulesDialogViewProps) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Review auction rules before bidding</DialogTitle>
					<DialogDescription>
						Auction bids use Cashu e-cash with P2PK locks. Review what can happen to your funds before placing bids in this auction.
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-3 py-2 text-sm text-text-mid">
					<ul className="list-disc space-y-2 pl-5">
						<li>
							Your bid may lock Cashu e-cash to an auction-derived P2PK key, with a refund path that only opens after the auction and
							settlement window.
						</li>
						<li>
							The lock is designed so the seller cannot redeem the bid from public relay data alone before settlement; settlement requires
							the bid-specific path secret.
						</li>
						<li>If you win, settlement may require you to reveal or transfer the bid's path secret so the seller can redeem the funds.</li>
						<li>
							If the winning bid is not settled before the settlement window closes, it may be invalidated or move to the refund/fallback
							path.
						</li>
						<li>If you lose, or settlement does not complete, your funds may only become refundable after the refund window opens.</li>
						<li>
							This auction still relies on trusted parties: Cashu mints custody the bitcoin behind e-cash, validators/auditors and relay
							data affect what the app shows, and bidders/sellers must complete settlement and delivery honestly.
						</li>
					</ul>
				</div>
				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)} disabled={publishPending}>
						Cancel
					</Button>
					<Button onClick={onConfirmRules} disabled={publishPending}>
						I understand these rules
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}

export interface AuctionConfirmBidDialogViewProps extends AuctionBidderCurveState {
	open: boolean
	onOpenChange: (open: boolean) => void
	publishPending: boolean
	/** Auction summary column. */
	auctionThumbnailUrl: string
	auctionTitle: string
	/** Host-owned seller identity node (`UserCardHost`). */
	renderSellerCard: ReactNode
	/** Ends-in label, e.g. "2d 3h" or "Ended" — host-resolved from the ticking countdown. */
	endsInLabel: string
	minBid: number
	bidStep: number
	/** The confirm dialog's own amount input state (independent of the panel's). */
	confirmBidAmountInput: string
	onConfirmBidAmountChange: (value: string) => void
	/** Mint selection: funded mints first, then trusted-but-unfunded mints (balance 0). */
	mintOptions: { mintUrl: string; hostname: string; balance: number; hasSufficientBalance: boolean }[]
	confirmBidMint: string | null
	onConfirmBidMintChange: (mintUrl: string) => void
	/** Locked to the previous leg's mint on a rebid chain. */
	hasExistingBid: boolean
	/** Funding summary. */
	confirmMintBalance: number
	previousBidAmount: number
	confirmDeltaAmount: number
	confirmTopUpNeeded: number
	/** Refund locktime (unix seconds), rendered as a localised date. */
	refundLocktime: number
	/** Confirm actions. */
	onConfirm: () => void
	confirmButtonDisabled: boolean
}

export function AuctionConfirmBidDialogView({
	open,
	onOpenChange,
	publishPending,
	auctionThumbnailUrl,
	auctionTitle,
	renderSellerCard,
	endsInLabel,
	minBid,
	bidStep,
	inCurveWindow,
	curveShape: shape,
	curvePeakMultiplier,
	confirmBidAmountInput,
	onConfirmBidAmountChange,
	mintOptions,
	confirmBidMint,
	onConfirmBidMintChange,
	hasExistingBid,
	confirmMintBalance,
	previousBidAmount,
	confirmDeltaAmount,
	confirmTopUpNeeded,
	refundLocktime,
	onConfirm,
	confirmButtonDisabled,
}: AuctionConfirmBidDialogViewProps) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle className="text-xl">Confirm Bid</DialogTitle>
					<DialogDescription>Review the auction details and set your bid amount.</DialogDescription>
				</DialogHeader>

				{/* Top section: two-column layout with auction image and details */}
				<div className="flex gap-6 py-4">
					{/* Left column: Auction image */}
					{auctionThumbnailUrl && (
						<img
							src={auctionThumbnailUrl}
							alt={auctionTitle}
							className="w-40 h-40 rounded-lg object-cover shrink-0 border border-border-default"
						/>
					)}
					{/* Right column: Auction metadata */}
					<div className="flex flex-col gap-3 min-w-0 grow">
						<div className="min-w-0">
							<h3 className="font-semibold text-lg truncate">{auctionTitle}</h3>
						</div>
						<div className="min-w-0">{renderSellerCard}</div>
						<div className="flex flex-col gap-1">
							<DetailField label="Ends in" value={endsInLabel} />
							<DetailField label="Min. bid" value={`${minBid.toLocaleString()} sats`} valueClassName="font-semibold" />
						</div>
					</div>
				</div>

				<Separator />

				{/* Bottom section: Bid details */}
				<div className="flex flex-col gap-4 py-4">
					{/* Bid amount input */}
					<div className="flex flex-col gap-2">
						<Label htmlFor="confirm-bid-amount">Bid amount</Label>
						<InputGroup>
							<InputGroupInput
								id="confirm-bid-amount"
								type="number"
								min={minBid}
								step={bidStep}
								value={confirmBidAmountInput}
								onChange={(e) => onConfirmBidAmountChange(e.target.value)}
								placeholder={`Minimum: ${minBid.toLocaleString()} sats`}
								disabled={publishPending}
							/>
							<InputGroupAddon align="inline-end">sats</InputGroupAddon>
						</InputGroup>
						<p className="text-sm text-text-mid">Minimum allowed bid: {minBid.toLocaleString()} sats</p>
						{inCurveWindow && shape !== 'none' && (
							<Alert className="border-warning-border bg-warning-muted text-warning-muted-foreground">
								<AlertDescription className="text-sm text-warning-muted-foreground">
									Anti-snipe window active — minimum bid is rising ({shape}, {curvePeakMultiplier}x by cutoff).
								</AlertDescription>
							</Alert>
						)}
					</div>

					{/* Mint selection */}
					<div className="flex flex-col gap-2">
						<Label>Mint</Label>
						{mintOptions.length > 0 ? (
							<Select value={confirmBidMint ?? ''} onValueChange={onConfirmBidMintChange} disabled={hasExistingBid}>
								<SelectTrigger className="w-full">
									<SelectValue placeholder="Select a mint" />
								</SelectTrigger>
								<SelectContent>
									{mintOptions.map((m) => (
										<SelectItem key={m.mintUrl} value={m.mintUrl}>
											{m.hostname} ({m.balance.toLocaleString()} sats)
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						) : (
							<p className="text-sm text-destructive">No trusted mints available</p>
						)}
						{hasExistingBid && (
							<p className="text-sm text-text-mid">Multiple chained bids from the same mint only — your previous bid uses this mint.</p>
						)}
					</div>

					{/* Funding details */}
					<div className="flex flex-col gap-2">
						<DetailField label="Available in mint" value={`${confirmMintBalance.toLocaleString()} sats`} />
						{previousBidAmount > 0 && (
							<DetailField label="Already locked (previous bid)" value={`${previousBidAmount.toLocaleString()} sats`} />
						)}
						<DetailField label="To lock" value={`${confirmDeltaAmount.toLocaleString()} sats`} />
					</div>

					{/* Top-up amount (big, prominent) */}
					{confirmTopUpNeeded > 0 && (
						<div className="flex flex-col items-center gap-1 py-2">
							<p className="text-sm text-text-mid">Pay via Lightning</p>
							<p className="text-3xl font-bold text-warning">{confirmTopUpNeeded.toLocaleString()} sats</p>
						</div>
					)}

					{/* Lock time warning */}
					{refundLocktime > 0 && (
						<Alert className="border-warning-border bg-warning-muted">
							<AlertDescription className="text-sm font-medium text-warning-muted-foreground">
								Your funds will be locked in this auction until{' '}
								{new Date(refundLocktime * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
							</AlertDescription>
						</Alert>
					)}
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)} disabled={publishPending}>
						Cancel
					</Button>
					<Button onClick={onConfirm} disabled={publishPending || confirmButtonDisabled}>
						{publishPending ? 'Submitting...' : 'Confirm Bid'}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
