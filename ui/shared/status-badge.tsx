import type { ReactNode, Ref } from 'react'
import { Badge } from '../primitives/badge'
import { cn } from '../utils/cn'

export type StatusTone = 'neutral' | 'info' | 'warning' | 'error' | 'success'

export interface StatusBadgeProps {
	/** Status text; also the default label. */
	status: string
	/** Semantic tone; selects the token palette. Defaults to "neutral". */
	tone?: StatusTone
	/** Overrides the visible label without changing `status`. */
	label?: ReactNode
	className?: string
	ref?: Ref<HTMLSpanElement>
}

const TONE_CLASS: Record<StatusTone, string> = {
	neutral: 'bg-muted text-muted-foreground border-border',
	info: 'bg-info-muted text-info-muted-foreground border-info-border',
	warning: 'bg-warning-muted text-warning-muted-foreground border-warning-border',
	error: 'bg-error-muted text-error-muted-foreground border-error-border',
	success: 'bg-success-muted text-success-muted-foreground border-success-border',
}

/** Generic status chip; domain code maps status → tone and passes the label. */
export function StatusBadge({ status, tone = 'neutral', label, className, ref }: StatusBadgeProps) {
	return (
		<Badge ref={ref} variant="outline" data-slot="status-badge" data-tone={tone} className={cn(TONE_CLASS[tone], className)}>
			{label ?? status}
		</Badge>
	)
}
