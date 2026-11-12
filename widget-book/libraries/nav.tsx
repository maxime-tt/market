import { useState, type ReactNode } from 'react'
import { BackButton } from '@ui/nav/back-button'
import { DASHBOARD_NAV, resolveBackTarget, resolveNavView, type NavBadgeCounts } from '@ui/nav/model'
import { SidebarNav, type NavLinkRenderArgs } from '@ui/nav/sidebar-nav'

import type { WidgetLibrary } from '../libraries'

/**
 * Navigation renderers. Nav is **data, not router introspection**: `ui/nav/model`
 * is the single source of truth (sections, labels, emoji, admin gating, badge
 * keys, back targets) and these renderers project it. The library therefore
 * builds its entries from the real `DASHBOARD_NAV` through the real
 * `resolveNavView`, so the catalogue shows what the app shows.
 *
 * `ui/` never imports the router, so the host supplies the link renderer. Here
 * it is a plain anchor, exactly as `ui/nav/nav-renderers.test.tsx` does it.
 */

/** The projection the host runs: model + pathname + badge counts + admin flag. */
function sidebarSections(pathname: string, counts: NavBadgeCounts = {}, isAdmin = false) {
	return resolveNavView(DASHBOARD_NAV, pathname, counts, { isAdmin })
}

/** The host's router link, replaced by an anchor. */
function renderLink(args: NavLinkRenderArgs): ReactNode {
	return (
		<a
			key={args.item.path}
			href={args.item.path}
			className={args.className}
			data-status={args.active ? 'active' : 'inactive'}
			onClick={args.onNavigate}
		>
			{args.children}
		</a>
	)
}

/** `BackButton` is a click handler, so the demo holds a click count. */
function BackButtonDemo({ variant }: { variant: 'inline' | 'icon' }) {
	const [clicks, setClicks] = useState(0)

	return (
		<div className={variant === 'icon' ? 'relative h-16 rounded-md border border-dashed' : 'rounded-md border border-dashed p-3'}>
			<BackButton label="Sales" onClick={() => setClicks((n) => n + 1)} variant={variant} />
			<p className="mt-2 text-xs text-text-mid">
				onClick fired {clicks} time{clicks === 1 ? '' : 's'}
			</p>
		</div>
	)
}

export const nav: WidgetLibrary = {
	name: 'nav',
	entries: [
		{
			name: 'SidebarNav',
			render: () => (
				<div className="max-w-xs">
					<SidebarNav
						sections={sidebarSections('/dashboard/sales/sales', { unseenOrders: 3, unseenMessages: 12 })}
						renderLink={renderLink}
					/>
				</div>
			),
		},
		{
			name: 'SidebarNavBadgesOverflow',
			render: () => (
				<div className="max-w-xs">
					{/* `99+` is the cap, so 250 must render as `99+`. */}
					<SidebarNav
						sections={sidebarSections('/dashboard/products/products', { unseenProductThreadComments: 250 })}
						renderLink={renderLink}
					/>
				</div>
			),
		},
		{
			name: 'SidebarNavAdmin',
			render: () => (
				<div className="max-w-xs">
					<SidebarNav sections={sidebarSections('/dashboard/sales/sales', {}, true)} renderLink={renderLink} />
				</div>
			),
		},
		{
			name: 'BackButtonInline',
			render: () => <BackButtonDemo variant="inline" />,
		},
		{
			name: 'BackButtonIcon',
			render: () => <BackButtonDemo variant="icon" />,
		},
		{
			name: 'BackButtonResolvedTarget',
			render: () => {
				// The host resolves the label from the model, never from the path.
				const target = resolveBackTarget('/dashboard/sales/messages')
				return (
					<div className="rounded-md border border-dashed p-3">
						<BackButton label={target?.label ?? 'Back'} onClick={() => {}} />
						<p className="mt-2 text-xs text-text-mid">
							resolveBackTarget('/dashboard/sales/messages') → {target ? `${target.kind}: ${target.label}` : 'null'}
						</p>
					</div>
				)
			},
		},
	],
}
