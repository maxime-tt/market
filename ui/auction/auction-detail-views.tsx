import type { ReactNode, Ref } from 'react'
import { CopyButton } from '../shared/copy-button'
import { DetailField } from '../shared/detail-field'
import { StatusBadge } from '../shared/status-badge'
import type { StatusTone } from '../shared/status-badge'
import { cn } from '../utils/cn'

/**
 * Auction detail presentations, lifted out of the operator auction route
 * (`platform/web/routes/_dashboard-layout/dashboard/products/auctions.$auctionId.tsx`).
 *
 * The route is an assembler and must not define components. Four inline
 * components and two raw status-style maps moved here:
 *
 * - `AUCTION_STATUS_STYLES` + `SETTLEMENT_STATUS_STYLES` -> the tone maps below,
 *   rendered through `shared/status-badge`.
 * - `StatCard`  -> `shared/stat-card` at the call site (the operator's `eyebrow`
 *   slot is now a first-class prop on the shared atom).
 * - `OverviewItem` -> `AuctionDetailCard`, a card wrapping `shared/detail-field`
 *   (`align="start"`), so there is no second label/value implementation.
 * - `PartyRow` -> `AuctionPartyCard`; the avatar and display name arrive as an
 *   injected node, because resolving a pubkey to a profile is host work.
 * - `TechnicalRow` -> `AuctionTechnicalRow`; the copy affordance is the shared
 *   `CopyButton`, and a failed write is reported through `onCopyError`.
 *
 * Declared visible changes: raw `zinc`/`white`/`emerald`/`amber`/`rose` colour
 * classes become semantic tokens; the copy control now swaps Copy -> Check in
 * place instead of raising a toast; the detail cards use the kit's typography.
 */

const AUCTION_STATUS_TONE: Record<string, StatusTone> = {
	Live: 'success',
	Scheduled: 'info',
	Ended: 'neutral',
}

/** Auction lifecycle status (`Live` / `Scheduled` / `Ended`) -> semantic tone. */
export function getAuctionStatusTone(status: string): StatusTone {
	return AUCTION_STATUS_TONE[status] ?? 'neutral'
}

export interface AuctionStatusBadgeProps {
	/** Auction lifecycle status; also the default label. */
	status: string
	className?: string
	ref?: Ref<HTMLSpanElement>
}

/** Status chip for the auction lifecycle. */
export function AuctionStatusBadge({ status, className, ref }: AuctionStatusBadgeProps) {
	return <StatusBadge ref={ref} status={status} tone={getAuctionStatusTone(status)} className={className} />
}

/**
 * The settlement chip's display state: either a published settlement's status,
 * or the derived pre-settlement state (`ready` once bidding closed, `awaiting`
 * while it is still open).
 */
export type AuctionSettlementState = 'settled' | 'reserve_not_met' | 'cancelled' | 'unknown' | 'ready' | 'awaiting'

export interface AuctionSettlementCopy {
	label: string
	tone: StatusTone
}

const SETTLEMENT_STATE_COPY: Record<AuctionSettlementState, AuctionSettlementCopy> = {
	settled: { label: 'settled', tone: 'success' },
	reserve_not_met: { label: 'reserve not met', tone: 'warning' },
	cancelled: { label: 'cancelled', tone: 'error' },
	unknown: { label: 'unknown', tone: 'neutral' },
	ready: { label: 'Ready to settle', tone: 'warning' },
	awaiting: { label: 'Awaiting close', tone: 'info' },
}

/** Settlement display state -> label + tone. Exported so the mapping is unit-testable. */
export function getSettlementStatusCopy(state: string): AuctionSettlementCopy {
	return SETTLEMENT_STATE_COPY[state as AuctionSettlementState] ?? SETTLEMENT_STATE_COPY.unknown
}

export interface AuctionSettlementBadgeProps {
	/** A published settlement status or a derived pre-settlement state (`ready` / `awaiting`). */
	state: string
	className?: string
	ref?: Ref<HTMLSpanElement>
}

/** Status chip for the settlement panel. */
export function AuctionSettlementBadge({ state, className, ref }: AuctionSettlementBadgeProps) {
	const copy = getSettlementStatusCopy(state)
	return <StatusBadge ref={ref} status={copy.label} tone={copy.tone} className={className} />
}

export interface AuctionDetailCardProps {
	label: ReactNode
	value: ReactNode
	helper?: ReactNode
	className?: string
	ref?: Ref<HTMLDivElement>
}

/** Bordered card holding one stacked label/value/helper field. */
export function AuctionDetailCard({ label, value, helper, className, ref }: AuctionDetailCardProps) {
	return (
		<div ref={ref} data-slot="auction-detail-card" className={cn('rounded-xl border border-border bg-card p-4', className)}>
			<DetailField
				label={label}
				value={value}
				helper={helper}
				align="start"
				labelClassName="text-xs font-semibold uppercase tracking-[0.16em]"
			/>
		</div>
	)
}

export interface AuctionPartyCardProps {
	label: ReactNode
	/** Avatar + display-name cluster for the party; the host resolves the pubkey. */
	identity: ReactNode
	helper?: ReactNode
	className?: string
	ref?: Ref<HTMLDivElement>
}

/** Bordered card showing one auction party (seller, winner) by identity. */
export function AuctionPartyCard({ label, identity, helper, className, ref }: AuctionPartyCardProps) {
	return (
		<div ref={ref} data-slot="auction-party-card" className={cn('rounded-xl border border-border bg-card p-4', className)}>
			<p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
			<div className="mt-2 flex items-center gap-2">{identity}</div>
			{helper && <p className="mt-1 text-xs text-muted-foreground">{helper}</p>}
		</div>
	)
}

export interface AuctionTechnicalRowProps {
	label: string
	value: ReactNode
	/** When set, renders a copy control for this value. */
	copyValue?: string
	/** Stacks the value under the label instead of placing it beside it. */
	stacked?: boolean
	/** Reports a failed clipboard write, so the host can surface it (the label is passed for the message). */
	onCopyError?: (label: string, error: unknown) => void
	className?: string
	ref?: Ref<HTMLDivElement>
}

/** Bordered row for one technical field, with an optional copy affordance. */
export function AuctionTechnicalRow({ label, value, copyValue, stacked = false, onCopyError, className, ref }: AuctionTechnicalRowProps) {
	return (
		<div
			ref={ref}
			data-slot="auction-technical-row"
			className={cn(
				'rounded-xl border border-border bg-muted/40 p-3',
				stacked ? 'space-y-2' : 'flex items-start justify-between gap-3',
				className,
			)}
		>
			<div className="min-w-0">
				<p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
				<p className={cn('mt-1 text-sm font-medium text-foreground', stacked ? 'break-words whitespace-pre-wrap' : 'break-all')}>
					{value || 'N/A'}
				</p>
			</div>
			{copyValue && (
				<CopyButton
					value={copyValue}
					ariaLabel={`Copy ${label}`}
					variant="ghost"
					size="sm"
					className="h-8 shrink-0 px-2 text-muted-foreground hover:text-foreground"
					onError={onCopyError ? (error) => onCopyError(label, error) : undefined}
				/>
			)}
		</div>
	)
}
