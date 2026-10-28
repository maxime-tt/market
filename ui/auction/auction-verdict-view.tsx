import type { ParsedValidatorVerdictEvent } from '@sdk/commerce/auctions/events'
import type { ReactNode } from 'react'
import { cn } from '../utils/cn'

/**
 * Minimal display of kind-30440 validator verdicts for an auction.
 *
 * One row per `(validator, bid)` tuple (kind-30440 is parameterised
 * replaceable on `<bidder_pk>:<auction_root_event_id>:<bid_event_id>`,
 * per-bid addressability — ADR-0003 §4.4.1 amendment, so the relay
 * returns at most one verdict per bid per validator). The panel is
 * intentionally bare: the validator's claim, the bidder it targets,
 * the latest NUT-7 state if known, and a timestamp. This is what
 * compliant clients consume to filter "fraudulent_bid" / "griefed"
 * outcomes and to surface bid verifiability — Phase 7 builds the
 * reputation UX on top.
 *
 * Props-only: parsing and the identity read stay in the platform host
 * (`platform/web/auctions/AuctionVerdictPanelHost.tsx`); the avatar node
 * arrives through `renderAvatar`. Reproduces `src/components/AuctionVerdictPanel.tsx`
 * with its raw palette migrated to Tier-1 semantic roles (see the mapping
 * table the retiring commit carries).
 */
export interface AuctionVerdictViewProps {
	verdicts: ParsedValidatorVerdictEvent[]
	isLoading?: boolean
	renderAvatar: (pubkey: string) => ReactNode
	className?: string
}

const claimToneClass = (claim: string): string => {
	if (claim.startsWith('settled')) return 'border-success-border bg-success-muted text-success-muted-foreground'
	if (claim === 'valid_bid_placed' || claim === 'won_pending_settlement')
		return 'border-info-border bg-info-muted text-info-muted-foreground'
	if (claim === 'lost_pending_refund') return 'border-border-default bg-surface-sunken text-text-high'
	if (claim === 'griefed' || claim === 'griefed_pending_fallback' || claim === 'fraudulent_bid' || claim === 'bid_invalid')
		return 'border-error-border bg-error-muted text-error-muted-foreground'
	return 'border-border-default bg-card text-text-high'
}

const formatTs = (ts: number): string => {
	if (!ts) return ''
	try {
		return new Date(ts * 1000).toLocaleString()
	} catch {
		return ''
	}
}

export function AuctionVerdictView({ verdicts, isLoading = false, renderAvatar, className }: AuctionVerdictViewProps) {
	if (isLoading && !verdicts.length) {
		return (
			<div data-slot="auction-verdict-view" className={cn('text-xs text-text-mid', className)}>
				Loading validator verdicts…
			</div>
		)
	}
	if (!verdicts.length) {
		return (
			<div
				data-slot="auction-verdict-view"
				className={cn('rounded-lg border border-dashed border-border-default bg-surface-sunken p-3 text-xs text-text-mid', className)}
			>
				No validator verdicts yet on this auction. The listed validators publish kind-30440 once they observe bid + mint state.
			</div>
		)
	}

	return (
		<div data-slot="auction-verdict-view" className={cn('space-y-2', className)}>
			<div className="flex items-baseline justify-between">
				<p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-mid">Validator verdicts</p>
				<p className="text-[10px] text-text-mid opacity-70">{verdicts.length} total</p>
			</div>
			<ul className="space-y-1.5">
				{verdicts.map((v) => (
					<li key={v.id} className={cn('rounded-lg border px-3 py-2 text-xs', claimToneClass(v.claim))}>
						<div className="flex flex-wrap items-center gap-2">
							<span className="font-semibold uppercase tracking-wide">{v.claim}</span>
							{v.reason && <span className="rounded bg-surface-raised px-1.5 py-0.5 text-[10px] text-text-high">reason: {v.reason}</span>}
							{v.nut7State && (
								<span className="rounded bg-surface-raised px-1.5 py-0.5 text-[10px] text-text-high">nut7: {v.nut7State}</span>
							)}
						</div>
						<div className="mt-1 flex flex-wrap items-center gap-3 text-[10px] opacity-80">
							<span className="inline-flex items-center gap-1">
								<span>validator</span>
								{renderAvatar(v.validatorPubkey)}
							</span>
							<span className="inline-flex items-center gap-1">
								<span>bidder</span>
								{renderAvatar(v.bidderPubkey)}
							</span>
							<span>observed {formatTs(v.observedAt)}</span>
						</div>
					</li>
				))}
			</ul>
		</div>
	)
}
