import type { HTMLAttributes, Ref } from 'react'
import { Skeleton } from '../primitives/skeleton'
import { Spinner } from '../primitives/spinner'
import { cn } from '../utils/cn'

export type LoadingStateVariant = 'spinner' | 'skeleton'

export interface LoadingStateProps extends HTMLAttributes<HTMLDivElement> {
	/** Accessible status label; also the visible text for the spinner variant. */
	label?: string
	/** Spinner for short waits, skeleton rows for content-shaped placeholders. */
	variant?: LoadingStateVariant
	/** Number of skeleton rows. Ignored by the spinner variant. */
	rows?: number
	/** Tightens the vertical rhythm for inline or card-embedded usage. */
	compact?: boolean
	ref?: Ref<HTMLDivElement>
}

/** Shared loading indicator. Composes `primitives/spinner` and `primitives/skeleton`. */
export function LoadingState({
	label = 'Loading…',
	variant = 'spinner',
	rows = 3,
	compact = false,
	className,
	ref,
	...props
}: LoadingStateProps) {
	if (variant === 'skeleton') {
		return (
			<div
				ref={ref}
				role="status"
				aria-label={label}
				data-slot="loading-state"
				className={cn('space-y-2', compact ? 'py-2' : 'py-4', className)}
				{...props}
			>
				{Array.from({ length: rows }, (_, index) => (
					<Skeleton key={index} className="h-4 w-full" />
				))}
			</div>
		)
	}

	return (
		<div
			ref={ref}
			role="status"
			aria-label={label}
			data-slot="loading-state"
			className={cn('flex items-center justify-center gap-2 text-muted-foreground', compact ? 'py-4' : 'py-8', className)}
			{...props}
		>
			<Spinner />
			<span className={compact ? 'text-sm' : 'text-base'}>{label}</span>
		</div>
	)
}
