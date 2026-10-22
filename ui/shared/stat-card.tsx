import type { HTMLAttributes, ReactNode, Ref } from 'react'
import { cn } from '../utils/cn'

export type StatCardTrend = 'up' | 'down' | 'flat'

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
	ref?: Ref<HTMLDivElement>
}

const TREND_CLASS: Record<StatCardTrend, string> = {
	up: 'text-success',
	down: 'text-destructive',
	flat: 'text-muted-foreground',
}

/** Compact card showing one metric. */
export function StatCard({ eyebrow, label, value, helper, trend, className, ref, ...props }: StatCardProps) {
	return (
		<div
			ref={ref}
			data-slot="stat-card"
			className={cn('flex flex-col gap-1 rounded-xl border bg-card p-4 text-card-foreground shadow-sm', className)}
			{...props}
		>
			{eyebrow && <p className="text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">{eyebrow}</p>}
			<p className="text-sm text-muted-foreground">{label}</p>
			<p className={cn('text-2xl font-medium', trend && TREND_CLASS[trend])}>{value}</p>
			{helper && <p className="text-xs text-muted-foreground">{helper}</p>}
		</div>
	)
}
