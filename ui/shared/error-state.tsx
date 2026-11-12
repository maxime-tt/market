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
	/** Extra control rendered beside the retry button, e.g. a "Go back" action. */
	action?: ReactNode
	/** Label for the retry button. */
	retryLabel?: string
	/** `data-testid` for the retry button, for hosts whose tests target it. */
	retryTestId?: string
	/** Tightens the vertical rhythm for inline or card-embedded usage. */
	compact?: boolean
	ref?: Ref<HTMLDivElement>
}

/** Inline failure state with an optional retry action. */
export function ErrorState({
	title = 'Something went wrong',
	message,
	onRetry,
	action,
	retryLabel = 'Try again',
	retryTestId,
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
				<p className="font-medium text-error">{title}</p>
				{message && <p className="text-sm text-text-mid">{message}</p>}
			</div>
			{(onRetry || action) && (
				<div className="flex flex-wrap items-center justify-center gap-2">
					{onRetry && (
						<Button variant="secondary" onClick={onRetry} data-testid={retryTestId}>
							{retryLabel}
						</Button>
					)}
					{action}
				</div>
			)}
		</div>
	)
}
