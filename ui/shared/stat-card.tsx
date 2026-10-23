import type { HTMLAttributes, ReactNode, Ref } from 'react'
import { cn } from '../utils/cn'

export type StatCardTrend = 'up' | 'down' | 'flat'
export type StatCardSurface = 'solid' | 'glass'
export type StatCardCorners = 'default' | 'handmade'

export interface StatCardProps extends HTMLAttributes<HTMLDivElement> {
	/** Small uppercase kicker shown above the label, e.g. "Live pulse". */
	eyebrow?: ReactNode
	/** Metric name, e.g. "Revenue". */
	label: string
	/** Preformatted metric value. */
	value: ReactNode
	/** Supporting context shown under the value. */
	helper?: ReactNode
	/** Semantic direction; colors the value with success/destructive/muted tokens. */
	trend?: StatCardTrend
	/** `glass` blends the card with the surface behind it when the theme enables glass. */
	surface?: StatCardSurface
	/** `handmade` renders the gently irregular corner treatment. */
	corners?: StatCardCorners
	ref?: Ref<HTMLDivElement>
}

const TREND_CLASS: Record<StatCardTrend, string> = {
	up: 'text-success',
	down: 'text-error',
	flat: 'text-text-mid',
}

/** Compact card showing one metric. */
export function StatCard({
	eyebrow,
	label,
	value,
	helper,
	trend,
	surface = 'solid',
	corners = 'default',
	className,
	ref,
	...props
}: StatCardProps) {
	return (
		<div
			ref={ref}
			data-slot="stat-card"
			className={cn(
				'flex flex-col gap-1 rounded-xl border bg-surface-raised p-4 text-text-high shadow-sm',
				surface === 'glass' && 'glass',
				corners === 'handmade' && 'rounded-hand',
				className,
			)}
			{...props}
		>
			{eyebrow && <p className="text-[11px] font-semibold tracking-[0.18em] text-text-mid uppercase">{eyebrow}</p>}
			<p className="text-sm text-text-mid">{label}</p>
			<p className={cn('text-2xl font-medium', trend && TREND_CLASS[trend])}>{value}</p>
			{helper && <p className="text-xs text-text-mid">{helper}</p>}
		</div>
	)
}
