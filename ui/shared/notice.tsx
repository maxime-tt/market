import type { HTMLAttributes, ReactNode, Ref } from 'react'
import { X } from 'lucide-react'
import { cn } from '../utils/cn'

export type NoticeTone = 'info' | 'warning' | 'error' | 'success'

export interface NoticeProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
	/** Semantic tone; selects the token palette. Defaults to "info". */
	tone?: NoticeTone
	/** Optional heading rendered above the body. */
	title?: ReactNode
	/** Optional trailing control, e.g. a retry or link. */
	action?: ReactNode
	/** Renders a dismiss button when provided. */
	onDismiss?: () => void
	/** Tightens padding for inline usage. */
	compact?: boolean
	ref?: Ref<HTMLDivElement>
}

const TONE_CLASS: Record<NoticeTone, string> = {
	info: 'bg-info-muted border-info-border text-info-muted-foreground',
	warning: 'bg-warning-muted border-warning-border text-warning-muted-foreground',
	error: 'bg-error-muted border-error-border text-error-muted-foreground',
	success: 'bg-success-muted border-success-border text-success-muted-foreground',
}

/** Inline banner for info, warning, error, and success messaging. */
export function Notice({ tone = 'info', title, action, onDismiss, compact = false, className, ref, children, ...props }: NoticeProps) {
	return (
		<div
			ref={ref}
			role={tone === 'warning' || tone === 'error' ? 'alert' : 'status'}
			data-slot="notice"
			data-tone={tone}
			className={cn('flex items-start gap-2 rounded-md border', compact ? 'px-3 py-2 text-sm' : 'p-4', TONE_CLASS[tone], className)}
			{...props}
		>
			<div className="min-w-0 flex-1 space-y-1">
				{title && <p className="font-medium">{title}</p>}
				{children && <div className="text-sm">{children}</div>}
			</div>
			{action && <div className="shrink-0">{action}</div>}
			{onDismiss && (
				<button
					type="button"
					onClick={onDismiss}
					aria-label="Dismiss"
					className="shrink-0 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
				>
					<X className="size-4" />
				</button>
			)}
		</div>
	)
}
