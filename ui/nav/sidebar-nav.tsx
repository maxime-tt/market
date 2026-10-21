import type { ReactNode } from 'react'
import { cn } from '../utils/cn'
import type { NavItemWithBadge, NavSectionView } from './model'

/**
 * Link styling for a sidebar entry, including the `data-status` variants the
 * stylesheet keys off. Exported so the host's router link and this renderer
 * cannot drift apart.
 */
export const SIDEBAR_NAV_LINK_CLASS = cn(
	'block relative bg-white data-[status=active]:bg-secondary lg:bg-transparent',
	'p-4 lg:px-6 lg:py-2 border border-black data-[status=active]:border-secondary lg:border-0',
	'rounded lg:rounded-none font-bold data-[status=active]:text-white hover:text-pink-500 transition-colors',
)

/** Arguments handed to the host's link renderer. */
export interface NavLinkRenderArgs {
	item: NavItemWithBadge
	/** Resolved link classes; apply these to the host's router link. */
	className: string
	/**
	 * Whether the item is active. The host must mirror this into a
	 * `data-status` attribute of `'active'` or `'inactive'`, which
	 * {@link SIDEBAR_NAV_LINK_CLASS} styles.
	 */
	active: boolean
	/** Call when the link is activated, so a mobile sidebar can close itself. */
	onNavigate: () => void
	children: ReactNode
}

export interface SidebarNavProps {
	sections: readonly NavSectionView[]
	/**
	 * Renders one navigable entry. The host supplies its router link here;
	 * `ui/` never imports the router.
	 */
	renderLink: (args: NavLinkRenderArgs) => ReactNode
	onNavigate?: () => void
	className?: string
}

/** Highest badge value rendered verbatim before switching to `99+`. */
const BADGE_MAX = 99

function NavItemContent({ item }: { item: NavItemWithBadge }) {
	return (
		<span className="flex justify-between items-center">
			<span>{`${item.emoji} ${item.title}`}</span>
			{item.badgeCount > 0 && (
				<span className="inline-flex justify-center items-center bg-pink-500 ml-2 px-2 rounded-full min-w-[1.5rem] h-6 font-bold text-white text-xs">
					{item.badgeCount > BADGE_MAX ? `${BADGE_MAX}+` : item.badgeCount}
				</span>
			)}
		</span>
	)
}

/**
 * The dashboard sidebar: sections, their entries, badge counts and active
 * state. Router-free — the host injects link rendering so client-side routing
 * and prefetching stay in the host.
 */
export function SidebarNav({ sections, renderLink, onNavigate, className }: SidebarNavProps) {
	return (
		<div className={cn('lg:space-y-2', className)} data-slot="sidebar-nav">
			{sections.map((section) => (
				<div key={section.title}>
					<h3 className="bg-tertiary-black mb-0 px-4 py-2 font-heading text-white lg:mb-2">{section.title}</h3>
					<nav className="space-y-2 p-4 text-xl lg:p-0 lg:text-base">
						{section.items.map((item) =>
							renderLink({
								item,
								active: item.active,
								className: SIDEBAR_NAV_LINK_CLASS,
								onNavigate: () => onNavigate?.(),
								children: <NavItemContent item={item} />,
							}),
						)}
					</nav>
				</div>
			))}
		</div>
	)
}
