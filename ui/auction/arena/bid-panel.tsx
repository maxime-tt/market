import type { Ref } from 'react'
import { Button } from '../../primitives/button'
import { Input } from '../../primitives/input'
import { Label } from '../../primitives/label'
import { StatusBadge } from '../../shared/status-badge'
import { cn } from '../../utils/cn'
import { ARENA_BID_ADVISORY, bidBlockedCopy, type ArenaBidCheck, type ArenaBidBlockedReason } from './bid-rules'
import type { ArenaAuctionDetailModel } from './model'

/**
 * The 1440-series **bid panel** — the entry surface inside the auction detail
 * view, and the honest record of a submission that may not have landed.
 *
 * ## Split from its host
 *
 * Props-only (`ui/AGENTS.md:118-120`): the host
 * (`platform/web/auctions/relay/AuctionBidHost.tsx`) owns the input state, the
 * clock, the viewer identity and the publish; this file owns markup and words.
 * Nothing here fetches, signs or publishes; `onSubmit` is the only way out.
 *
 * ## Ported presentation, new data source
 *
 * The layout is the retired bidder panel's (`ui/auction/auction-bidder-views.tsx`
 * `AuctionBidderView`): one amount field with the sats unit inline, one button
 * under it, the minimum stated in words, and the input pre-filled with the
 * minimum (`platform/web/auctions/AuctionBidderHost.tsx:425-428`) — a bidder
 * who types is editing the floor, not starting from nothing. What changed is
 * where the minimum comes from: the auction's **own** published terms read from
 * relays (`bid-rules.ts`), not a validator's opinion.
 *
 * ## The states, and why each is a sentence rather than a disabled button
 *
 * A greyed-out button with no reason is the failure this panel exists to avoid.
 * Every blocking reason has words (`bidBlockedCopy`), and the panel states
 * which one applies *before* the bidder types anything. "No wallet" is split
 * from "wallet unavailable", because the fix differs (`AGENTS.md:41-46`).
 *
 * ## After publishing: optimistic, but never a claim of acceptance
 *
 * See {@link ArenaBidSubmissionState}. Between the click and the relay
 * round-trip the bid is **presumed** — the row says "presumed", not "placed" —
 * and a publish that gets no relay ACK at all is a **failure**, matching the
 * app's existing fail-closed rule for a zero-ACK publish
 * (`platform/web/auctions/auctionPublishIo.ts:47-52`).
 */

// =========================================================================
// Submission state
// =========================================================================

/**
 * What the surface may say about a bid the bidder just submitted.
 *
 * Six states, not two (`AGENTS.md:41-46`): "signed locally", "some relays
 * acknowledged", "no relay acknowledged" and "a relay acknowledged but nothing
 * has come back on the read" are different facts, and collapsing them into
 * "success/failure" would hide the one case a bidder most needs to know about —
 * a bid that was accepted by one relay out of three.
 */
export type ArenaBidSubmissionState =
	/** Nothing submitted since this page loaded. */
	| { phase: 'idle' }
	/** The event is signed and being offered to relays; nothing is ACKed yet. */
	| { phase: 'publishing'; amount: number }
	/** ≥1 relay ACKed the event, but the read has not yet delivered it back. **Presumed, not seen.** */
	| { phase: 'presumed'; amount: number; eventId: string; acceptedBy: string[]; totalRelays: number }
	/** The read delivered the bid back: the relays hold it. Still not an outcome (`bid-rules.ts`). */
	| { phase: 'seen'; amount: number; eventId: string; acceptedBy: string[]; totalRelays: number }
	/** Signed and offered, but **no** relay ACKed. Published nowhere — fail closed. */
	| { phase: 'unpublished'; amount: number; eventId: string | null; reason: string }
	/** Signing failed, or the wallet refused; nothing was published and nothing was signed. */
	| { phase: 'failed'; amount: number; reason: string }

/** The submission is over and did not land: the bidder may retry the same amount. */
export function isArenaBidSubmissionUnsuccessful(state: ArenaBidSubmissionState): boolean {
	return state.phase === 'unpublished' || state.phase === 'failed'
}

// =========================================================================
// Props
// =========================================================================

export interface ArenaBidPanelProps {
	/** The auction, as read. `null` when nothing was read — the panel then says so. */
	model: ArenaAuctionDetailModel | null
	/** The read state. A partial read disables bidding: the floor may be stale. */
	readStatus: 'loading' | 'settled' | 'incomplete' | 'no-relays' | 'error'
	/** The check the host ran on the current input, or `null` when no auction was read. */
	check: ArenaBidCheck | null
	/** The check that blocks bidding regardless of the amount, e.g. `own-auction`; `null` when none does. */
	blockedReason: ArenaBidBlockedReason | null
	/** The typed amount, verbatim. */
	amountInput: string
	onAmountChange: (value: string) => void
	/** True while a submission is in flight: the input and the button are both inert. */
	pending: boolean
	/** The most recent submission's state. */
	submission: ArenaBidSubmissionState
	onSubmit: () => void
	className?: string
	ref?: Ref<HTMLDivElement>
}

// =========================================================================
// Helpers
// =========================================================================

/** The button's label — the same progression the retired panel used ("Submitting..." → idle). */
export function bidButtonLabel(
	blockedReason: ArenaBidBlockedReason | null,
	check: ArenaBidCheck | null,
	pending: boolean,
): string {
	if (pending) return 'Submitting…'
	if (blockedReason !== null) {
		const labels: Partial<Record<ArenaBidBlockedReason, string>> = {
			'own-auction': 'Your auction',
			concluded: 'Auction concluded',
			ended: 'Bidding closed',
			'end-unknown': 'No end time stated',
			'no-wallet': 'Sign in to bid',
			'wallet-unavailable': 'Wallet not ready',
			'not-started': 'Not open yet',
			'auction-not-read': 'Auction not read',
		}
		return labels[blockedReason] ?? 'Place bid'
	}
	if (check === null) return 'Reading terms…'
	return 'Place bid'
}

/** The sentence under the input: the floor, in words. */
export function bidFloorLabel(model: ArenaAuctionDetailModel, check: ArenaBidCheck | null): string {
	if (check === null || check.minimum === null) {
		if (model.startingBid === null) return 'This auction published no starting bid.'
		return 'The minimum for your next bid cannot be computed from the bids read so far.'
	}
	if (check.ownPosition !== null) {
		return `Bids add to your position. Yours is ${check.ownPosition.toLocaleString()} sats; your position must reach at least ${check.minimum.toLocaleString()} sats.`
	}
	if (model.bidCount === 0) return `Opening bid: at least ${check.minimum.toLocaleString()} sats.`
	if (model.minIncrement === null) {
		return `Next bid: more than ${check.minimum.toLocaleString()} sats. This auction published no minimum increment, so the app requires one sat above the top.`
	}
	return `Next bid: at least ${check.minimum.toLocaleString()} sats.`
}

/** The label the submission state renders. Always a fact about relays, never about money. */
export function submissionLine(state: ArenaBidSubmissionState): { title: string; detail: string; tone: 'neutral' | 'success' | 'warning' | 'error' } | null {
	switch (state.phase) {
		case 'idle':
			return null
		case 'publishing':
			return {
				title: `Publishing ${state.amount.toLocaleString()} sats…`,
				detail: 'The bid is signed and being offered to every relay this app writes to. Nothing has been acknowledged yet.',
				tone: 'neutral',
			}
		case 'presumed':
			return {
				title: `Bid presumed placed — ${state.acceptedBy.length} of ${state.totalRelays} relays acknowledged it.`,
				detail: `Your signed bid was accepted by ${state.acceptedBy.length === 1 ? 'a relay' : 'relays'}, so it is presumed to be on the network. This view has not read it back yet; it will say so when it has. “Accepted by a relay” is not “won”, and no money has moved.`,
				tone: 'warning',
			}
		case 'seen':
			return {
				title: `Bid seen on the read — ${state.acceptedBy.length} of ${state.totalRelays} relays acknowledged it.`,
				detail: 'The relays that answered delivered your bid back, and it is counted in the bids below. That is storage, not an outcome: the verdict names a winner and the chain decides.',
				tone: 'success',
			}
		case 'unpublished':
			return {
				title: 'Your bid was not published — no relay accepted it.',
				detail: `${state.reason} The event was signed by your key but stored nowhere this app writes to, so it is not on the network and is not counted. You can submit again.`,
				tone: 'error',
			}
		case 'failed':
			return {
				title: 'Your bid was not submitted.',
				detail: `${state.reason} Nothing was published.`,
				tone: 'error',
			}
	}
}

// =========================================================================
// The view
// =========================================================================

export function ArenaBidPanel({
	model,
	readStatus,
	check,
	blockedReason,
	amountInput,
	onAmountChange,
	pending,
	submission,
	onSubmit,
	className,
	ref,
}: ArenaBidPanelProps) {
	const hardBlocked = blockedReason !== null
	const invalid = check !== null && !check.allowed && !hardBlocked && amountInput.trim() !== ''
	const disabled = hardBlocked || pending || check === null || !check.allowed
	const floor = model !== null ? bidFloorLabel(model, check) : null
	const invalidCopy = check !== null && !check.allowed && !hardBlocked ? bidBlockedCopy(check.reason, check) : null
	const line = submissionLine(submission)

	return (
		<section
			ref={ref}
			data-slot="arena-bid-panel"
			data-state={submission.phase}
			aria-labelledby="arena-bid-panel-title"
			className={cn('space-y-3 rounded-xl border border-border-default bg-surface-raised p-4', className)}
		>
			<div className="flex flex-wrap items-baseline justify-between gap-2">
				<h2 id="arena-bid-panel-title" className="text-xs font-semibold uppercase tracking-[0.16em] text-text-mid">
					Place a bid
				</h2>
				{model !== null && model.phase === 'open' && !hardBlocked && (
					<StatusBadge status="Bidding open" tone="success" />
				)}
			</div>

			{hardBlocked && blockedReason !== null && (
				<p data-slot="arena-bid-blocked" className="rounded-lg bg-surface-sunken px-3 py-2 text-xs text-text-mid">
					{bidBlockedCopy(blockedReason, check ?? { minimum: null, ownPosition: null })}
				</p>
			)}

			<div className="flex flex-col gap-2 sm:flex-row sm:items-center">
				{/* Always rendered, even while blocked: the bidder can see the amount
				    they would bid and the floor they would have to meet. A hidden
				    form on an ended auction hides why nothing can be done. */}
				<Label htmlFor="arena-bid-amount" className="sr-only">
					Bid amount in sats
				</Label>
				<div className="relative flex grow items-center">
					<Input
						id="arena-bid-amount"
						data-slot="arena-bid-amount"
						type="text"
						inputMode="numeric"
						autoComplete="off"
						placeholder={check !== null && check.minimum !== null ? `${check.minimum.toLocaleString()}` : 'Amount'}
						value={amountInput}
						onChange={(event) => onAmountChange(event.target.value)}
						disabled={hardBlocked || pending}
						aria-invalid={invalid}
						aria-describedby="arena-bid-floor"
						className="pr-14"
					/>
					<span className="pointer-events-none absolute right-3 text-xs text-text-mid">sats</span>
				</div>
				<Button type="button" onClick={onSubmit} disabled={disabled} variant={hardBlocked ? 'secondary' : 'default'} className="whitespace-nowrap sm:min-w-36">
					{bidButtonLabel(blockedReason, check, pending)}
				</Button>
			</div>

			<p id="arena-bid-floor" data-slot="arena-bid-floor" className="text-xs text-text-mid">
				{floor ?? (readStatus === 'loading' ? 'Reading the auction’s terms from relays…' : 'No terms to state.')}
			</p>

			{invalidCopy !== null && (
				<p role="alert" data-slot="arena-bid-invalid" className="text-xs text-error">
					{invalidCopy}
				</p>
			)}

			{line !== null && (
				<div
					role="status"
					data-slot="arena-bid-submission"
					data-phase={submission.phase}
					className={cn(
						'rounded-lg px-3 py-2 text-xs',
						line.tone === 'error' && 'bg-error-muted text-error-muted-foreground',
						line.tone === 'success' && 'bg-success-muted text-success-muted-foreground',
						line.tone === 'warning' && 'bg-warning-muted text-warning-muted-foreground',
						line.tone === 'neutral' && 'bg-surface-sunken text-text-mid',
					)}
				>
					<p className="font-medium">{line.title}</p>
					<p className="mt-0.5 opacity-90">{line.detail}</p>
				</div>
			)}

			<p className="text-[11px] text-text-mid opacity-80">{ARENA_BID_ADVISORY}</p>
		</section>
	)
}