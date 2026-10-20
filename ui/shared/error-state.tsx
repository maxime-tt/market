import type { HTMLAttributes, ReactNode, Ref } from 'react'
import { Button } from '../primitives/button'
import { cn } from '../utils/cn'

export interface ErrorStateProps extends HTMLAttributes<HTMLDivElement> {
	/** Heading for the failure. Defaults to a generic message. */
	title?: string
	/** Detail about what failed. Should be safe to display. */
	message?: ReactNode
	/** Renders a retry button when provided. */
	onRetry?: () => void
	/** Label for the retry button. */
	retryLabel?: string
	/** Tightens the vertical rhythm for inline or card-embedded usage. */
	compact?: boolean
	ref?: Ref<HTMLDivElement>
}

/** Inline failure state with an optional retry action. */
export function ErrorState({
	title = 'Something went wrong',
	message,
	onRetry,
	retryLabel = 'Try again',
	compact = false,
	className,
	ref,
	...props
}: ErrorStateProps) {
	return (
		<div
			ref={ref}
			role="alert"
			data-slot="error-state"
			className={cn('flex flex-col items-center justify-center gap-3 text-center', compact ? 'py-6' : 'py-12', className)}
			{...props}
		>
			<div className="space-y-1">
				<p className="font-medium text-destructive">{title}</p>
				{message && <p className="text-sm text-muted-foreground">{message}</p>}
			</div>
			{onRetry && (
				<Button variant="secondary" onClick={onRetry}>
					{retryLabel}
				</Button>
			)}
		</div>
	)
}
