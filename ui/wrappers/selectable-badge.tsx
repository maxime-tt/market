import * as React from 'react'
import { Badge } from '../primitives/badge'
import { cn } from '../utils/cn'

type BadgeProps = React.ComponentProps<typeof Badge>

export interface SelectableBadgeProps extends BadgeProps {
	/** Whether the badge is currently selected. */
	isSelected?: boolean
}

export const SelectableBadge = React.forwardRef<HTMLSpanElement, SelectableBadgeProps>(
	({ isSelected = false, className, ...props }, ref) => {
		const selectionClasses = isSelected
			? 'bg-fill-accent border-primary-border-hover text-on-fill-accent active:bg-primary-border-hover'
			: 'bg-fill-accent border-fill-accent hover:border-primary-border-hover text-on-fill-accent active:bg-primary-border-hover'

		return <Badge ref={ref} data-selected={isSelected} className={cn(selectionClasses, 'py-1.5 px-3 my-1', className)} {...props} />
	},
)

SelectableBadge.displayName = 'SelectableBadge'
