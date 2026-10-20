import type { HTMLAttributes, MouseEvent, ReactNode, Ref } from 'react'
import { DashboardListItem } from '../components/DashboardListItem'
import { TooltipButton } from '../components/TooltipButton'
import { Spinner } from '../primitives/spinner'

export interface EntityListItemAction {
	key: string
	/** Tooltip and aria-label for the action button. */
	label: string
	icon: ReactNode
	onClick: (event: MouseEvent<HTMLButtonElement>) => void
	/** Wraps the icon in `text-destructive`. */
	destructive?: boolean
	/** Renders a Spinner in place of the icon and disables the button. */
	pending?: boolean
	disabled?: boolean
}

export interface EntityListItemProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
	isOpen: boolean
	onOpenChange: (open: boolean) => void
	trigger: ReactNode
	actions?: EntityListItemAction[]
	isDeleting?: boolean
	icon?: ReactNode | false
	useCloseIcon?: boolean
	children: ReactNode
	ref?: Ref<HTMLDivElement>
}

/**
 * Molecule that pairs the collapsible dashboard list item with a standardized
 * row of action buttons. The trigger and the details body stay domain-owned;
 * this component only fixes the action row so every dashboard list presents
 * edit/share/delete controls the same way.
 */
export function EntityListItem({
	isOpen,
	onOpenChange,
	trigger,
	actions,
	isDeleting,
	icon,
	useCloseIcon,
	children,
	className,
	ref,
	...props
}: EntityListItemProps) {
	const renderedActions =
		actions && actions.length > 0 ? (
			<>
				{actions.map((action) => (
					<TooltipButton
						key={action.key}
						variant="ghost"
						size="sm"
						tooltip={action.label}
						aria-label={action.label}
						disabled={action.disabled || action.pending}
						onClick={(event) => {
							event.stopPropagation()
							action.onClick(event)
						}}
					>
						{action.pending ? (
							<Spinner className="size-4" />
						) : action.destructive ? (
							<span className="text-destructive">{action.icon}</span>
						) : (
							action.icon
						)}
					</TooltipButton>
				))}
			</>
		) : undefined

	return (
		<DashboardListItem
			ref={ref}
			isOpen={isOpen}
			onOpenChange={onOpenChange}
			triggerContent={trigger}
			actions={renderedActions}
			isDeleting={isDeleting}
			icon={icon}
			useCloseIcon={useCloseIcon}
			className={className}
			{...props}
		>
			{children}
		</DashboardListItem>
	)
}
