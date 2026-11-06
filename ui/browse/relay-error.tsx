/**
 * browse/relay-error.tsx — Relay error and dead-search surfaces.
 *
 * Frame `X_kMCMIsAp__state-relay-error-1440.html`:
 * - Minimal indicator: "9 relays responded with 40 products"
 * - Expandable chip: "2 timeout · 1 refused" + arrow
 * - Popover (on expand): per-relay breakdown with status dots
 * - Dead-search panel: left-accented error bar with retry
 *
 * Frame `Vn3rn2dUpp__state-tag-filtered-1440.html`:
 * - Tag-filtered badges above results
 */

import type { FC, ReactNode } from 'react'
import { useState } from 'react'
import { cn } from '../utils/cn'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface RelayDetail {
	/** Relay URL (last 8 chars for display). */
	relay: string
	/** Whether this relay reached EOSE. */
	status: 'responded' | 'pending'
}

export interface RelayIndicatorProps {
	/** Total relays that responded. */
	responded: number
	/** Total products received. */
	totalProducts: number
	/** Per-relay breakdown for the expanding detail. */
	relays?: readonly RelayDetail[]
	/**
	 * The read is still in flight. The indicator then states the search as
	 * *fetching* — "Searching relays…", or the partial count — instead of
	 * announcing "0 relays responded with 0 products" about a query that has
	 * not finished answering. It is always the caller's read state: the
	 * component never guesses one.
	 */
	loading?: boolean
	/**
	 * What the count counts. The results grid leaves it at `products`; the
	 * seller profile reads `products from this seller`, so the sentence stays
	 * true about the read it summarises.
	 */
	productsLabel?: string
	/** Extra classes for the root. */
	className?: string
}

export interface DeadSearchErrorProps {
	/** Total relays contacted. */
	totalRelays: number
	/** Relays that did not reach EOSE. */
	pendingCount: number
	/** Suggestion text. */
	message?: string
	/** Retry callback. */
	onRetry?: () => void
	/** Extra classes. */
	className?: string
}

export interface TagFilterBadgeProps {
	/** Tag label. */
	label: string
	/** Product count under this tag. */
	count: number
	/** Whether this tag is active/selected. */
	active?: boolean
	/** Optional callback when badge is clicked (toggle filter). */
	onToggle?: () => void
}

// ---------------------------------------------------------------------------
// Relay indicator — minimal line + expanding popover
// ---------------------------------------------------------------------------

/**
 * Relay indicator: the read's relay state, always present.
 *
 * Its one job is to never lie about a query. "N relays responded with M
 * products" is a **verdict**, and a verdict is only true once the read has
 * finished — so while `loading` the line states the search as in flight
 * ("Searching relays…", or "2 of 5 relays responded · 12 products so far"), and
 * a zero-verdict is never printed about a query still running. Once the counts
 * are known they stay on screen; the per-relay breakdown (which relay answered,
 * which is pending) is behind the expand chip.
 *
 * A failing relay is NORMAL — results are kept and the indicator shows the
 * per-relay breakdown on demand.
 */
export const RelayIndicator: FC<RelayIndicatorProps> = ({
	responded,
	totalProducts,
	relays = [],
	loading = false,
	productsLabel = 'products',
	className,
}) => {
	const [expanded, setExpanded] = useState(false)

	const respondedCount = relays.filter((r) => r.status === 'responded').length
	const pendingCount = relays.filter((r) => r.status === 'pending').length
	// The caller may state a responded count without a per-relay list; the
	// larger of the two is the only total that cannot undercount.
	const totalRelays = Math.max(respondedCount + pendingCount, responded)

	const products = totalProducts.toLocaleString()

	return (
		<div
			data-slot="relay-indicator"
			data-testid="widget-relay-indicator"
			data-state={loading ? 'fetching' : 'settled'}
			className={cn(
				'flex',
				'items-center',
				'gap-2.5',
				'text-xs',
				'leading-none',
				'text-text-mid',
				'font-variant-numeric-tabular-nums',
				'relative',
				className,
			)}
		>
			{/* Status dot — pulses while the read is in flight */}
			<div
				data-slot="status-dot"
				className={cn('size-[7px] rounded-full flex-none', loading ? 'bg-text-mid animate-pulse' : 'bg-fill-ink')}
				aria-hidden="true"
			/>

			{/* Summary line — a verdict only once the read has settled */}
			<span>
				{loading && totalRelays === 0 ? (
					<span data-slot="relay-fetching">Searching relays…</span>
				) : loading ? (
					<span data-slot="relay-fetching">
						{responded} of {totalRelays} relay{totalRelays === 1 ? '' : 's'} responded ·{' '}
						<b className="font-normal text-text-high">{products}</b> {productsLabel} so far
					</span>
				) : totalRelays === 0 ? (
					<span data-slot="relay-unreported">Relay detail unavailable for this search</span>
				) : (
					<>
						{responded} relay{responded !== 1 ? 's' : ''} responded with <b className="font-normal text-text-high">{products}</b>{' '}
						{productsLabel}
					</>
				)}
			</span>

			{/* Expand chip — shows offline count */}
			{totalRelays > responded ? (
				<button
					type="button"
					data-slot="relay-expand-chip"
					data-testid="widget-relay-indicator-chip"
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
					onClick={() => setExpanded(!expanded)}
				>
					<span>{pendingCount} pending</span>
					<svg
						className={cn('size-3', 'text-text-mid', 'transition-transform', expanded && 'rotate-180')}
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
			) : null}

			{/* Popover — per-relay breakdown */}
			{expanded && relays.length > 0 && (
				<div
					data-slot="relay-popover"
					data-testid="widget-relay-indicator-popover"
					className={cn(
						'absolute',
						'right-0',
						'top-full',
						'mt-1.5',
						'w-[392px]',
						'z-10',
						'bg-surface-raised',
						'border',
						'border-border-strong',
						'rounded',
						'box-shadow-[0_2px_8px_rgba(0,0,0,0.08)]',
						'p-3.5',
					)}
				>
					{/* Popover head */}
					<div
						data-slot="pop-head"
						className={cn(
							'flex',
							'items-baseline',
							'justify-between',
							'gap-2.5',
							'pb-2',
							'border-b',
							'border-border-strong',
							'text-[10.5px]',
							'tracking-[0.14em]',
							'uppercase',
							'text-text-mid',
						)}
					>
						<span>Relay detail</span>
						<span className="font-normal text-text-high text-[11.5px] tracking-normal">
							{totalRelays} relays · {totalProducts.toLocaleString()} products
						</span>
					</div>

					{/* Per-relay rows grouped by status */}
					{(['responded', 'pending'] as const).map((group) => {
						const groupRelays = relays.filter((r) => r.status === group)
						if (groupRelays.length === 0) return null

						const groupLabels: Record<string, string> = {
							responded: 'Responded',
							pending: 'Pending',
						}
						const groupDotClass: Record<string, string> = {
							responded: '',
							pending: 'p',
						}

						return (
							<div key={group} className="mt-2">
								<div
									data-slot="pop-group-label"
									className={cn('text-[10.5px]', 'tracking-[0.14em]', 'uppercase', 'text-text-mid', 'mb-[2px]')}
								>
									{groupLabels[group]}
								</div>
								<div data-slot="pop-rows" className={cn('flex', 'flex-col', 'gap-2', 'items-center')}>
									{groupRelays.map((r, i) => (
										<div
											key={i}
											data-slot="pop-row"
											className={cn(
												'grid',
												'grid-cols-[1fr_auto]',
												'items-center',
												'gap-2',
												'py-[5px]',
												i < groupRelays.length - 1 && 'border-b',
												'border-border-default',
											)}
										>
											<span className="text-text-high text-sm truncate" title={r.relay}>
												{r.relay}
											</span>
											<div data-slot="pop-status" className={cn('flex', 'items-center', 'gap-1.5', 'text-[11.5px]', 'text-text-mid')}>
												<div className={cn('size-[6px]', 'rounded-full', 'flex-none', 'bg-fill-ink', groupDotClass[group])} />
												{r.status}
											</div>
										</div>
									))}
								</div>
							</div>
						)
					})}
				</div>
			)}
		</div>
	)
}

// ---------------------------------------------------------------------------
// Dead search error panel — shown only when the search is dead
// ---------------------------------------------------------------------------

/**
 * Compact error panel for the dead-search case.
 * The ONLY state that earns an error treatment: the search itself is dead.
 * Shown below the relay indicator when no products were received.
 */
export const DeadSearchError: FC<DeadSearchErrorProps> = ({
	totalRelays,
	pendingCount,
	message = 'All relays failed. Check your connection and try again.',
	onRetry,
	className,
}) => {
	return (
		<div
			data-slot="dead-search-error"
			data-testid="widget-dead-search-error"
			className={cn(
				'flex',
				'items-center',
				'gap-3.5',
				'mt-4',
				'p-3.5',
				'bg-surface-sunken',
				'border',
				'border-border-strong',
				'border-l-[3px]',
				'border-l-fill-accent',
				'rounded',
				className,
			)}
		>
			<svg
				className="size-4 flex-none text-text-mid"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				aria-hidden="true"
			>
				<path d="M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
			</svg>
			<div className="min-w-0 flex-1">
				<div className="text-[10.5px] tracking-[0.14em] uppercase text-text-mid">
					{totalRelays} relays contacted · {pendingCount} pending
				</div>
				<p className="mt-1 text-sm leading-relaxed text-text-high">{message}</p>
			</div>
			{onRetry && (
				<button
					type="button"
					data-slot="error-retry"
					data-testid="widget-dead-search-error-retry"
					className="shrink-0 h-9 px-4.5 rounded-full bg-fill-ink text-on-fill-ink text-sm font-medium cursor-pointer transition-colors hover:bg-fill-ink-hover"
					onClick={onRetry}
				>
					Retry
				</button>
			)}
		</div>
	)
}

// ---------------------------------------------------------------------------
// Tag filter badge
// ---------------------------------------------------------------------------

/**
 * A single facet/tag badge — pill-shaped, shows count.
 * Active badge uses fill-ink bg / on-fill-ink text.
 */
export const TagFilterBadge: FC<TagFilterBadgeProps> = ({ label, count, active = false, onToggle }) => (
	<button
		type="button"
		data-slot="tag-badge"
		data-testid={`widget-tag-badge-${label}`}
		className={cn(
			'h-7',
			'px-3',
			'rounded-full',
			'flex',
			'items-center',
			'gap-1.75',
			'text-xs',
			active ? 'bg-fill-ink border-fill-ink text-on-fill-ink' : 'border-border-default text-text-mid',
			'cursor-pointer',
			'transition-colors',
			active && 'hover:bg-fill-ink-hover',
		)}
		onClick={onToggle}
	>
		{label}
		<b className={cn('font-normal', 'opacity-60', 'font-variant-numeric-tabular-nums')}>{count.toLocaleString()}</b>
	</button>
)
