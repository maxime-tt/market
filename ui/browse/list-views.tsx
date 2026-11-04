/**
 * browse/list-views.tsx — Lists surfaces: list-row (index), list-detail (detail).
 *
 * Eyebrow, head, rows with text + meta/chip, toolbar with sort, and product
 * cards embedded in the detail view.
 */

import type { FC, ReactNode, Ref } from 'react'
import { cn } from '../utils/cn'

// ---------------------------------------------------------------------------
// Relay indicator — the minimal line + expanding per-relay detail
// ---------------------------------------------------------------------------

export interface RelayDetail {
	/** Relay URL (last 8 chars for display). */
	relay: string
	/** Number of products from this relay. */
	count: number
	/** Status: responded, timeout, or refused. */
	status: 'responded' | 'timeout' | 'refused'
}

export interface RelayIndicatorProps {
	/** Total relays that responded. */
	responded: number
	/** Total products received. */
	totalProducts: number
	/** Per-relay breakdown for the expanding detail. */
	relays?: readonly RelayDetail[]
	/** Whether the expanding detail is open. */
	expanded?: boolean
	/** Callback to toggle expand. */
	onToggle?: () => void
	/** Extra classes for the root. */
	className?: string
}

/**
 * Minimal relay indicator: "N relays responded with M products" (12px, text-mid,
 * tabular-nums) + compact expanding per-relay detail (responded/timeout/refused
 * counts + a local-index row).
 */
export const RelayIndicator: FC<RelayIndicatorProps> = ({
	responded,
	totalProducts,
	relays = [],
	expanded = false,
	onToggle,
	className,
}) => {
	const respondedCount = relays.filter((r) => r.status === 'responded').length
	const timeoutCount = relays.filter((r) => r.status === 'timeout').length
	const refusedCount = relays.filter((r) => r.status === 'refused').length
	const cachedCount = relays
		.filter((r) => r.status === 'responded')
		.reduce((sum, r) => sum + r.count, 0)

	return (
		<div
			data-slot="relay-indicator"
			data-testid="widget-relay-indicator"
			className={cn(
				'flex',
				'items-center',
				'gap-2.5',
				'text-xs',
				'leading-none',
				'text-text-mid',
				'font-variant-numeric:tabular-nums',
				className,
			)}
		>
			{/* Status dot */}
			<div
				data-slot="status-dot"
				className="size-[7px] rounded-full bg-fill-ink flex-none"
				aria-hidden="true"
			/>
			{/* Summary line */}
			<span>
				{responded} relay{responded !== 1 ? 's' : ''} responded with{' '}
				<b className="font-normal text-text-high">{totalProducts.toLocaleString()}</b>{' '}
				products
			</span>
			{/* Expand button */}
			{relays.length > 0 && onToggle && (
				<button
					type="button"
					data-slot="relay-expand"
					data-testid="widget-relay-indicator-expand"
					className={cn(
						'shrink-0',
						'flex',
						'items-center',
						'gap-1.5',
						'py-[3px]',
						'px-2.5',
						'border',
						'border-border-default',
						'rounded-full',
						'text-xs',
						'text-text-mid',
						'cursor-pointer',
						'transition-colors',
						'hover:text-text-high',
					)}
					aria-expanded={expanded}
					onClick={onToggle}
				>
					local index
					<svg
						className={cn(
							'size-3',
							'text-text-mid',
							'transition-transform',
							expanded && 'rotate-180',
						)}
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						aria-hidden="true"
					>
						<path d="M6 9l6 6-6 6" />
					</svg>
				</button>
			)}
		</div>
	)
}

// ---------------------------------------------------------------------------
// Dead search error panel — shown only when the search is dead
// ---------------------------------------------------------------------------

export interface DeadSearchErrorProps {
	/** Total relays contacted. */
	totalRelays: number
	/** Relays that timed out. */
	timeoutCount: number
	/** Relays that refused. */
	refusedCount: number
	/** Suggestion text. */
	message?: string
	/** Retry callback. */
	onRetry?: () => void
	/** Extra classes. */
	className?: string
}

/**
 * Compact error panel for the dead-search case.
 * Shown only when the search is completely dead (all relays failed).
 */
export const DeadSearchError: FC<DeadSearchErrorProps> = ({
	totalRelays,
	timeoutCount,
	refusedCount,
	message = 'All relays failed. Check your connection and try again.',
	onRetry,
	className,
}) => {
	return (
		<div
			data-slot="dead-search-error"
			data-testid="widget-dead-search-error"
			className={cn(
				'rounded',
				'border',
				'border-border-default',
				'bg-surface-sunken',
				'p-4',
				className,
			)}
		>
			<div className="text-xs text-text-mid mb-2">
				{totalRelays} relays contacted · {timeoutCount} timed out · {refusedCount} refused
			</div>
			{message && <p className="text-sm text-text-high">{message}</p>}
			{onRetry && (
				<button
					type="button"
					data-slot="error-retry"
					data-testid="widget-dead-search-error-retry"
					className={cn(
						'mt-3',
						'px-4',
						'py-1.5',
						'rounded-full',
						'bg-fill-ink',
						'text-on-fill-ink',
						'text-xs',
						'font-medium',
						'cursor-pointer',
					)}
					onClick={onRetry}
				>
					Retry
				</button>
			)}
		</div>
	)
}

// ---------------------------------------------------------------------------
// List row — Lists index view
// ---------------------------------------------------------------------------

export interface ListRowItem {
	/** List id. */
	id: string
	/** List name. */
	name: string
	/** Number of items. */
	itemCount: number
	/** Whether the list is private. */
	privacy?: 'public' | 'private'
	/** List description/note. */
	note?: string
}

export interface ListRowProps {
	/** The list row item. */
	item: ListRowItem
	/** Extra classes for the row. */
	className?: string
}

/**
 * A single row in the Lists index.
 *
 * Row: [text + meta/chip]
 * - Name as heading (16.5px, 500 weight)
 * - Meta line: item count, privacy chip
 * - Optional note text
 */
export const ListRow: FC<ListRowProps> = ({ item, className }) => {
	return (
		<div
			data-slot="list-row"
			data-testid={`widget-list-row-${item.id}`}
			className={cn(
				'flex',
				'items-start',
				'gap-5.5',
				'px-5',
				'py-4.5',
				'bg-surface-raised',
				'rounded',
				'border',
				'border-border-default',
				'cursor-pointer',
				'hover:bg-surface-sunken',
				'transition-colors',
				className,
			)}
		>
			<div className="flex-1 min-w-0">
				<div className="text-[16.5px] font-medium leading-snug text-text-high">
					{item.name}
				</div>
				<div className="flex items-center gap-2 mt-2 text-xs text-text-mid">
					<span>{item.itemCount} items</span>
					{item.privacy === 'private' && (
						<span
							data-slot="list-privacy-chip"
							className={cn(
								'inline-flex',
								'items-center',
								'gap-1',
								'h-5.5',
								'px-2.5',
								'rounded-full',
								'border',
								'border-border-strong',
								'text-[10.5px]',
								'tracking-wide',
								'uppercase',
								'text-text-high',
							)}
						>
							Private
						</span>
					)}
				</div>
				{item.note && (
					<p className="text-xs text-text-mid mt-2 leading-relaxed">{item.note}</p>
				)}
			</div>
			<div data-slot="list-row-arrow" className="shrink-0">
				<svg
					className="size-4 text-text-mid"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					aria-hidden="true"
				>
					<path d="M9 6l6 6-6 6" />
				</svg>
			</div>
		</div>
	)
}

// ---------------------------------------------------------------------------
// List detail — the detail view for a single list
// ---------------------------------------------------------------------------

export interface ListDetailProps {
	/** List name. */
	name: string
	/** Privacy chip label. */
	privacyLabel?: string
	/** List owner name. */
	owner: string
	/** Owner npub (elided). */
	ownerNpub: string
	/** Item count. */
	itemCount: number
	/** Whether the list is private. */
	privacy?: 'public' | 'private'
	/** List description/note. */
	note?: string
	/** Items currently shown (for toolbar text). */
	shownItems: number
	/** Total items. */
	totalItems: number
	/** Sort label. */
	sortLabel?: string
	/** Extra classes for the root. */
	className?: string
}

/**
 * List detail view — eyebrow, head (title + chip), actions, meta, note,
 * toolbar, and product card grid.
 */
export const ListDetail: FC<ListDetailProps> = ({
	name,
	privacyLabel,
	owner,
	ownerNpub,
	itemCount,
	privacy,
	note,
	shownItems,
	totalItems,
	sortLabel = 'Newest first',
	className,
}) => {
	return (
		<div
			data-slot="list-detail"
			data-testid="widget-list-detail"
			className={cn('flex', 'flex-col', 'gap-4', className)}
		>
			{/* Eyebrow */}
			<div
				data-slot="list-eyebrow"
				className="flex items-center gap-2.5 text-xs tracking-[0.14em] uppercase text-text-mid"
			>
				<span>Browse</span>
				<span>/</span>
				<span className="font-medium text-text-high">Lists</span>
			</div>

			{/* Head: title + chip */}
			<div
				data-slot="list-head"
				className="flex items-end justify-between gap-6"
			>
				<div className="flex items-center gap-3">
					<h1 className="text-[34px] font-bold leading-tight tracking-[-0.015em] text-text-high">
						{name}
					</h1>
					{privacy && (
						<span
							data-slot="list-privacy-chip"
							className={cn(
								'inline-flex',
								'items-center',
								'gap-1',
								'h-[22px]',
								'px-2.5',
								'rounded-full',
								'border',
								'border-border-strong',
								'text-[10.5px]',
								'tracking-wide',
								'uppercase',
								'text-text-high',
							)}
						>
							<svg
								className="size-2.5"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2.2"
								strokeLinecap="round"
								aria-hidden="true"
							>
								<rect x="5" y="11" width="14" height="9" rx="2" />
								<path d="M8 11V8a4 4 0 0 1 8 0v3" />
							</svg>
							{privacyLabel || privacy}
						</span>
					)}
				</div>
			</div>

			{/* Actions row */}
			<div
				data-slot="list-actions"
				className="flex items-center gap-2.5"
			>
				<button
					type="button"
					data-slot="btn-add-items"
					data-testid="widget-list-detail-add-items"
					className={cn(
						'flex',
						'items-center',
						'gap-2',
						'h-10',
						'px-4.5',
						'rounded-full',
						'border',
						'border-border-strong',
						'text-sm',
						'font-medium',
						'text-text-high',
						'cursor-pointer',
					)}
				>
					<svg
						className="size-[15px]"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2.2"
						strokeLinecap="round"
						aria-hidden="true"
					>
						<path d="M12 5v14M5 12h14" />
					</svg>
					Add items
				</button>
				<button
					type="button"
					data-slot="btn-copy-link"
					data-testid="widget-list-detail-copy-link"
					className={cn(
						'flex',
						'items-center',
						'gap-2',
						'h-10',
						'px-4.5',
						'rounded-full',
						'bg-fill-ink',
						'text-on-fill-ink',
						'border',
						'border-fill-ink',
						'text-sm',
						'font-medium',
						'cursor-pointer',
					)}
				>
					<svg
						className="size-[15px]"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2.1"
						strokeLinecap="round"
						aria-hidden="true"
					>
						<path d="M10 14a4.5 4.5 0 0 0 6.4 0l2.6-2.6a4.5 4.5 0 0 0-6.4-6.4L11.4 6" />
						<path d="M14 10a4.5 4.5 0 0 0-6.4 0l-2.6 2.6a4.5 4.5 0 0 0 6.4 6.4L12.6 18" />
					</svg>
					Copy link
				</button>
			</div>

			{/* Meta line: Owned by + npub + count + privacy note */}
			<div
				data-slot="list-meta"
				className="flex items-center gap-2 mt-2 text-xs leading-relaxed text-text-mid"
			>
				<span>
					Owned by <span className="font-medium text-text-high">{owner}</span>
				</span>
				<span className="size-[7px] rounded-full bg-text-mid" aria-hidden="true" />
				<span>{ownerNpub}</span>
				<span className="size-[7px] rounded-full bg-text-mid" aria-hidden="true" />
				<span>{itemCount} items</span>
			</div>

			{/* Note */}
			{note && (
				<div
					data-slot="list-note"
					className="rounded bg-surface-sunken p-3 text-sm leading-relaxed text-text-mid"
				>
					<b className="font-medium text-text-high">Note</b>
					{' '}{note}
				</div>
			)}

			{/* Toolbar */}
			<div
				data-slot="list-toolbar"
				className="flex items-center justify-between text-xs text-text-mid"
			>
				<span>
					{shownItems} of {totalItems} items shown
				</span>
				<span className="flex items-center gap-1">
					{sortLabel}
					<svg
						className="size-3 text-text-mid"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						aria-hidden="true"
					>
						<path d="M6 9l6 6-6 6" />
					</svg>
				</span>
			</div>
		</div>
	)
}
