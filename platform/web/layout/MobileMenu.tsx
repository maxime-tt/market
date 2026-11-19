/**
 * platform/web/layout/MobileMenu.tsx — the small-screen nav overlay.
 *
 * Below `sm` the bar's nav list is hidden (the view's `hidden sm:flex`) and this
 * overlay carries the same destinations instead, behind the bar's menu button.
 * It reads the *same* list as the bar — `platform/web/layout/navItems.ts`,
 * called with the same live routing table — so the two surfaces cannot disagree
 * about what the nav holds or in what order. It used to keep its own literal
 * array (a second source, with its own `Home` and `Dashboard` entries); those
 * are gone: `Home` is the bar's wordmark and `Dashboard` is the account menu's.
 *
 * Entries render the way `navItems` describes them: a compiled-in destination is
 * the router's `Link` (client-side, with the active match), and an
 * operator-pinned binding is a document-load anchor, because the router has no
 * route object for an operator's path.
 *
 * The currency control that used to sit at the bottom of this menu is gone with
 * the rest of the duplicated surfaces: the account menu's currency submenu has
 * it, at every width.
 */

import { authActions, authStore } from '@platform/web/auth/authStore'
import { uiActions, uiStore } from '@platform/web/app/uiStore'
import { useConfigQuery } from '@platform/web/config/publicConfigQuery'
import { navItems } from '@platform/web/layout/navItems'
import { useRouteTable } from '@platform/web/routes-authoring/routeTableQuery'
import { Pattern } from '@ui/shared/pattern'
import { cn } from '@ui/utils/cn'
import { useAutoAnimate } from '@formkit/auto-animate/react'
import { Link, useMatchRoute } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import { useEffect } from 'react'

/** The overlay's id, which the bar's menu button points at with `aria-controls`. */
export const MOBILE_MENU_ID = 'mobile-menu'

/** One destination row's skin; the active row is the menu's own highlight. */
const linkClass = (isActive: boolean) =>
	cn(
		'py-3 px-6 rounded-lg text-center text-lg font-normal uppercase tracking-wider transition-colors',
		isActive ? 'bg-black text-secondary' : 'text-white hover:text-secondary',
	)

export function MobileMenu() {
	const { mobileMenuOpen } = useStore(uiStore)
	const { isAuthenticated } = useStore(authStore)
	const { data: config } = useConfigQuery()
	const { data: routeTable } = useRouteTable()
	const matchRoute = useMatchRoute()
	const [animationParent] = useAutoAnimate<HTMLDivElement>()

	// Close menu on escape key
	useEffect(() => {
		const handleEscape = (e: KeyboardEvent) => {
			if (e.key === 'Escape' && mobileMenuOpen) {
				uiActions.closeMobileMenu()
			}
		}

		document.addEventListener('keydown', handleEscape)
		return () => document.removeEventListener('keydown', handleEscape)
	}, [mobileMenuOpen])

	// Prevent body scroll when menu is open
	useEffect(() => {
		if (mobileMenuOpen) {
			document.body.style.overflow = 'hidden'
		} else {
			document.body.style.overflow = 'unset'
		}

		return () => {
			document.body.style.overflow = 'unset'
		}
	}, [mobileMenuOpen])

	const handleLinkClick = () => {
		uiActions.closeMobileMenu()
	}

	const handleLogout = () => {
		authActions.logout()
		uiActions.closeMobileMenu()
	}

	// The bar's list, in the bar's order — built-ins first, then the operator's pins.
	const entries = navItems(config?.appSettings?.showNostrLink, routeTable?.bindings)

	return (
		<div ref={animationParent}>
			{mobileMenuOpen && (
				<div
					id={MOBILE_MENU_ID}
					className={cn('fixed top-16 left-0 right-0 bottom-0 z-40 bg-black/90')}
					onClick={() => uiActions.closeMobileMenu()}
				>
					{/* Dots Pattern Overlay */}
					<Pattern pattern="dots" className="opacity-30" />

					{/* Menu Content */}
					<div className="flex flex-col items-center justify-center h-full relative z-10" onClick={(e) => e.stopPropagation()}>
						<nav data-slot="mobile-menu-nav" className="flex flex-col items-stretch gap-4 w-full max-w-sm">
							{entries.map((entry) =>
								entry.kind === 'route' ? (
									<Link
										key={entry.to}
										to={entry.to}
										className={linkClass(matchRoute({ to: entry.to, fuzzy: true }) !== false)}
										onClick={handleLinkClick}
									>
										{entry.label}
									</Link>
								) : (
									/* A pinned path is a document load, not a router route. */
									<a key={entry.href} href={entry.href} className={linkClass(false)} onClick={handleLinkClick}>
										{entry.label}
									</a>
								),
							)}
							{isAuthenticated && (
								<div className="py-3 px-8">
									<button
										onClick={handleLogout}
										className="w-full text-center text-white text-lg font-normal uppercase tracking-wider hover:text-secondary transition-colors"
									>
										Log out
									</button>
								</div>
							)}
						</nav>
					</div>
				</div>
			)}
		</div>
	)
}
