import type { HTMLAttributes, ReactNode, Ref } from 'react'
import { cn } from '../utils/cn'

export interface EmptyStateProps extends HTMLAttributes<HTMLDivElement> {
	/** Leading visual, typically an icon. */
	icon?: ReactNode
	/** Short heading describing the empty state. */
	title: string
	/** Supporting copy shown under the title. */
	description?: ReactNode
	/** Primary action rendered below the copy. */
	action?: ReactNode
	/** Tightens the vertical rhythm for inline or card-embedded usage. */
	compact?: boolean
	ref?: Ref<HTMLDivElement>
}

/** Centered, muted placeholder for empty lists, searches, and first-run screens. */
export function EmptyState({ icon, title, description, action, compact = false, className, ref, ...props }: EmptyStateProps) {
	return (
		<div
			ref={ref}
			data-slot="empty-state"
			className={cn('flex flex-col items-center justify-center text-center', compact ? 'gap-2 py-6' : 'gap-3 py-12', className)}
			{...props}
		>
			{icon && <div className={cn('text-muted-foreground', compact ? '[&_svg]:size-6' : '[&_svg]:size-10')}>{icon}</div>}
			<div className="space-y-1">
				<p className={cn('font-medium', compact ? 'text-sm' : 'text-base')}>{title}</p>
				{description && <p className="text-sm text-muted-foreground">{description}</p>}
			</div>
			{action && <div className="pt-1">{action}</div>}
		</div>
	)
}
