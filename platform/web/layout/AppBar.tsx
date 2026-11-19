/**
 * platform/web/layout/AppBar.tsx — the frame's one top bar.
 *
 * Mounted once, by the root layout (`platform/web/routes/__root.tsx`), on every
 * route except `/setup`. It replaces the legacy `Header` mount and the two
 * Browse-local `BrowseNav` mounts: there is no opt-out and no per-route variant,
 * because a route either draws the app's chrome or it does not, and the app's
 * chrome is now one bar.
 *
 * This is the host half of the `ui/`-first split (`ui/AGENTS.md`): the
 * presentation lives in `ui/appbar/app-bar-view.tsx` and takes slots; everything
 * data-bound is read here and passed down.
 *
 * - **Identity** is the instance's, not a literal: `useInstanceName()` for the
 *   title (`platform/web/config/instanceName.ts`), `config.picture` for the logo.
 *   Both are read here rather than threaded from the frame, which has no config
 *   and would become a second place for the brand to drift.
 * - **Nav** is the one list in `platform/web/layout/navItems.ts`, called with the
 *   live routing table so the bar and the small-screen menu cannot disagree:
 *   the built-in destinations plus the operator's pinned pages (`Binding.nav`,
 *   ordered by `nav.order`). The list module owns the composition and the shape
 *   gate; this host only renders the entries. A pinned entry is a
 *   document-load anchor, not a router link — the router has no route object
 *   for a path the operator invented.
 * - **Search** is the same `SearchField` the idle hero uses, at `size="nav"`. It
 *   navigates to `/?q=`, the route that validates the term and hands it to the
 *   Browse host, so the bar has one search and every route has it.
 * - **Account** is the one auth-aware menu (`platform/web/layout/AccountMenu.tsx`):
 *   a sign-in action when signed out; profile, wallet, dashboard, cart, the
 *   currency submenu and sign-out when signed in.
 * - **Small screens** reach the same destinations through `MobileMenu`, opened by
 *   the bar's own trigger (`sm:hidden`, the width at which the view hides the nav
 *   list). The trigger rides in the account cluster because that is the bar's
 *   right-hand group; the overlay itself is a second surface, not a second list.
 *
 * Nothing here branches on the path for styling: the bar is written against the
 * widget role tokens, and `.arena-chrome` rebinds those to the arena's dark
 * values, so both chromes are one code path.
 */

import { Link, useLocation, useNavigate } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import { Menu, X } from 'lucide-react'
import { useEffect, useMemo, useState, type FC } from 'react'
import { uiActions, uiStore } from '@platform/web/app/uiStore'
import { useInstanceName } from '@platform/web/config/instanceName'
import { useConfigQuery } from '@platform/web/config/publicConfigQuery'
import { AccountMenu } from '@platform/web/layout/AccountMenu'
import { MOBILE_MENU_ID, MobileMenu } from '@platform/web/layout/MobileMenu'
import { navItems } from '@platform/web/layout/navItems'
import { useRouteTable } from '@platform/web/routes-authoring/routeTableQuery'
import { AppBarView } from '@ui/appbar/app-bar-view'
import { SearchField } from '@ui/browse/search-field'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface AppBarProps {
	/** Extra classes for the bar root. The frame mounts it with none. */
	className?: string
}

// ---------------------------------------------------------------------------
// Presentation vocabulary
// ---------------------------------------------------------------------------

/** The nav link skin, shared by the built-in destinations and the operator's pins. */
const NAV_LINK_CLASS = 'text-sm font-medium text-text-mid transition-colors hover:text-text-high cursor-pointer'

/** The bar's per-destination handle. One convention, whichever kind of entry it is. */
const navTestId = (label: string) => `widget-app-bar-nav-${label.toLowerCase()}`

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const AppBar: FC<AppBarProps> = ({ className }) => {
	const instanceName = useInstanceName()
	const { data: config } = useConfigQuery()
	const { data: routeTable } = useRouteTable()
	const { mobileMenuOpen } = useStore(uiStore)
	const navigate = useNavigate()
	const location = useLocation()

	/**
	 * The term the URL already holds. The bar's field and the page's `?q=` are
	 * one search: arriving from a category card, a facet pill or a back/forward
	 * step, the field must show the term the results below it were read with,
	 * or the two disagree about what is being browsed.
	 */
	const urlQuery = useMemo(
		() => (location.pathname === '/' ? (new URLSearchParams(location.searchStr).get('q') ?? '') : ''),
		[location.pathname, location.searchStr],
	)

	const [query, setQuery] = useState(urlQuery)

	// A search written by anything else — the host's own navigation, the
	// history — resyncs the field. Typing does not touch the URL until Enter, so
	// this effect never fights the caret.
	useEffect(() => {
		setQuery(urlQuery)
	}, [urlQuery])

	const submitSearch = () => navigate({ to: '/', search: { q: query } })

	const brand = (
		<Link
			to="/"
			data-testid="home-link"
			data-slot="wordmark-link"
			aria-label={`${instanceName} — Browse`}
			className="inline-flex items-center gap-2 font-display text-[20px] leading-tight tracking-[-0.01em] font-bold text-fill-ink hover:text-fill-ink-hover transition-colors cursor-pointer"
		>
			{/* The instance's own logo, sized to sit inside the `h-16` bar. The
			    text stays and remains the visible title. */}
			{config?.picture && <img src={config.picture} alt={config.displayName || config.name} className="h-8 w-8 shrink-0 object-contain" />}
			{instanceName}
		</Link>
	)

	const nav = navItems(config?.appSettings?.showNostrLink, routeTable?.bindings).map((entry) =>
		entry.kind === 'route' ? (
			<Link
				key={entry.to}
				to={entry.to}
				data-testid={navTestId(entry.label)}
				className={NAV_LINK_CLASS}
				activeProps={{ className: 'text-text-high', 'aria-current': 'page' }}
			>
				{entry.label}
			</Link>
		) : (
			/*
			 * A document load, not a router navigation: the operator's path has no
			 * route object, and the page bound to it is rendered from the
			 * server's `#__AR_ROUTE__` payload, which only exists on the document
			 * the server answered for that path.
			 */
			<a key={entry.href} href={entry.href} data-testid={navTestId(entry.label)} className={NAV_LINK_CLASS}>
				{entry.label}
			</a>
		),
	)

	return (
		<>
			<AppBarView
				className={className}
				brand={brand}
				navItems={nav}
				searchSlot={<SearchField size="nav" value={query} onChange={setQuery} onGo={submitSearch} />}
				accountSlot={
					<div className="flex items-center gap-2">
						{/*
						 * Below `sm` the view hides the nav list (`hidden sm:flex`), so this
						 * is the only way to the destinations on a phone. It opens the
						 * overlay that carries the same list.
						 */}
						<button
							type="button"
							data-testid="mobile-menu-button"
							aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
							aria-expanded={mobileMenuOpen}
							aria-controls={MOBILE_MENU_ID}
							onClick={() => uiActions.toggleMobileMenu()}
							className="inline-flex sm:hidden h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full border border-border-default bg-surface-raised text-text-high transition-colors hover:bg-fill-ink hover:text-on-fill-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
						>
							{mobileMenuOpen ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
						</button>
						<AccountMenu />
					</div>
				}
			/>
			<MobileMenu />
		</>
	)
}
