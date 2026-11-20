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
		// Theme-token chips: the selected one takes the theme's single action colour (`fill-ink`), the rest are
		// hairline outlines, so a category row reads like the header's nav rather than a row of buttons.
		const selectionClasses = isSelected
			? 'bg-fill-ink border-fill-ink text-on-fill-ink hover:bg-fill-ink-hover'
			: 'bg-transparent border-border-strong text-text-high hover:border-fill-ink hover:text-fill-ink'

		return (
			<Badge
				ref={ref}
				data-selected={isSelected}
				className={cn(selectionClasses, 'rounded-full py-1.5 px-3.5 my-1 font-medium transition-colors', className)}
				{...props}
			/>
		)
	},
)

SelectableBadge.displayName = 'SelectableBadge'
