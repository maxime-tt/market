import type { ReactNode, Ref } from 'react'
import { cn } from '../utils/cn'

/**
 * The sticky desktop page-header band.
 *
 * The identical class list was declared by hand in 21 dashboard routes, and a
 * twenty-second copy lived inside `SettingsPageHeader`. It is exported so any
 * remaining raw usage can adopt the same band without re-typing it, and so the
 * two renderers below cannot drift apart.
 */
export const PAGE_HEADER_CLASS = cn('sticky top-0 z-10 hidden items-center justify-between border-b bg-white px-4 py-4 lg:flex lg:px-6')

export interface PageHeaderProps {
	/** Header content; typically a title block, optionally with actions at the end. */
	children: ReactNode
	/** Extra utilities appended to the band, e.g. a gap between title and actions. */
	className?: string
	ref?: Ref<HTMLDivElement>
}

/**
 * The generic sticky band. It arranges slots and owns no data: routes that need
 * a bespoke title block pass one in, while fixed-shape headers such as
 * `SettingsPageHeader` compose this component instead of re-declaring the band.
 */
export function PageHeader({ children, className, ref }: PageHeaderProps) {
	return (
		<div ref={ref} data-slot="page-header" className={cn(PAGE_HEADER_CLASS, className)}>
			{children}
		</div>
	)
}

export interface MobilePageHeaderProps {
	/** Header content shown above the scrolling content on compact viewports. */
	children: ReactNode
	/** Top offset utilities for the sticky positioning, e.g. a fixed app header height. */
	className?: string
	ref?: Ref<HTMLDivElement>
}

/**
 * The compact-viewport title band. Hidden from `lg` up, where {@link PageHeader}
 * takes over. Kept separate so a page can supply different content per breakpoint
 * rather than duplicating both bands in the route.
 */
export function MobilePageHeader({ children, className, ref }: MobilePageHeaderProps) {
	return (
		<div ref={ref} data-slot="mobile-page-header" className={cn('lg:hidden', className)}>
			{children}
		</div>
	)
}
