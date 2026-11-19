import type { LucideIcon } from 'lucide-react'
import { cn } from '../utils/cn'

export interface DashboardIconTileProps {
	icon: LucideIcon
	className?: string
}

/**
 * A line icon on a soft tile in the theme's accent (`fill-accent`). Inside the admin console that token is the
 * admin's own colour (ADR-0022), so the tiles follow the Appearance picker; elsewhere they follow the page theme.
 * Replaces the emoji the dashboard used to show, which ignored the theme and rendered differently on every OS.
 */
export function DashboardIconTile({ icon: Icon, className }: DashboardIconTileProps) {
	return (
		<span
			aria-hidden="true"
			data-slot="dashboard-icon-tile"
			className={cn('inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-fill-accent/12 text-fill-accent', className)}
		>
			<Icon className="size-5" strokeWidth={1.75} />
		</span>
	)
}
