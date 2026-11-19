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
 * - **Nav** is the one list in `platform/web/layout/navItems.ts`, so the bar and
 *   the small-screen menu cannot disagree. Pinned routes join it later, in the
 *   list module.
 * - **Search** is the same `SearchField` the idle hero uses, at `size="nav"`. It
 *   navigates to `/?q=`, the route that validates the term and hands it to the
 *   Browse host, so the bar has one search and every route has it.
 * - **Account** is the existing `HeaderAccountControls` for now (sign-in when
 *   signed out; dashboard, profile and sign-out when signed in).
 *
 * Nothing here branches on the path for styling: the bar is written against the
 * widget role tokens, and `.arena-chrome` rebinds those to the arena's dark
 * values, so both chromes are one code path.
 */

import { Link, useLocation, useNavigate } from '@tanstack/react-router'
import { useEffect, useMemo, useState, type FC } from 'react'
import { useInstanceName } from '@platform/web/config/instanceName'
import { useConfigQuery } from '@platform/web/config/publicConfigQuery'
import { HeaderAccountControls } from '@platform/web/layout/Header'
import { navItems } from '@platform/web/layout/navItems'
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
// Component
// ---------------------------------------------------------------------------

export const AppBar: FC<AppBarProps> = ({ className }) => {
	const instanceName = useInstanceName()
	const { data: config } = useConfigQuery()
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

	const nav = navItems(config?.appSettings?.showNostrLink).map((item) => (
		<Link
			key={item.to}
			to={item.to}
			data-testid={`widget-app-bar-nav-${item.label.toLowerCase()}`}
			className="text-sm font-medium text-text-mid transition-colors hover:text-text-high cursor-pointer"
			activeProps={{ className: 'text-text-high', 'aria-current': 'page' }}
		>
			{item.label}
		</Link>
	))

	return (
		<AppBarView
			className={className}
			brand={brand}
			navItems={nav}
			searchSlot={<SearchField size="nav" value={query} onChange={setQuery} onGo={submitSearch} />}
			accountSlot={<HeaderAccountControls />}
		/>
	)
}
