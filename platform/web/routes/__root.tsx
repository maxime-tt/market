import { AuctionWonModal } from '@platform/web/auctions/AuctionWonModal'
import { FooterHost } from '@platform/web/layout/FooterHost'
import { usesArenaChrome } from '@platform/web/layout/appChrome'
import { AppBar } from '@platform/web/layout/AppBar'
import { Pattern } from '@ui/shared/pattern'
import { usePageViews } from '@platform/web/analytics/usePageViews'
import { useDocumentIdentity } from '@platform/web/app/useDocumentIdentity'
import { useRootRedirects } from '@platform/web/app/useRootRedirects'
import { ServedPage, servedPageForPath } from '@platform/web/servedPage'
import { appChromePageForPath } from '@platform/web/storefront/appChromePage'
import { BoundPathPage } from '@platform/web/storefront/BoundPathPage'
import { createRootRoute, Outlet, useLocation } from '@tanstack/react-router'
import { useEffect } from 'react'

/**
 * The router's root route. It is a lean assembler: the app-wide monitors,
 * providers and overlays live in `platform/web/app/` (mounted above
 * `RouterProvider` in `frontend.tsx`), and the two redirect guards run through
 * `useRootRedirects`. All this file owns is the page frame — the app bar, routed
 * content, the footer — plus `AuctionWonModal`, which needs router context
 * (`useLocation`) and so cannot move above the router.
 */
export const Route = createRootRoute({
	component: RootComponent,
})

function RootComponent() {
	return <RootLayout />
}

function RootLayout() {
	const location = useLocation()
	const isSetupPage = location.pathname === '/setup'
	const isDashboardPage = location.pathname.startsWith('/dashboard')
	const isCheckoutPage = location.pathname.startsWith('/checkout')

	/**
	 * The page the server bound to this path, in place of `<Outlet/>` — the
	 * app-chrome sibling of `served` below, read from `#__AR_ROUTE__`.
	 *
	 * The same reason it lives here rather than in a route file: the routing file
	 * decides the path, not the router, and a binding may supersede a
	 * *compiled-in* name (`resolve()` checks bindings first; `surface.test.ts`
	 * S4b pins it). `/dashboard` bound to a page must render the page, and
	 * `$vanityName` never sees a path the router already has a route for. One
	 * guard above the outlet covers every bound path, including `/`.
	 *
	 * The payload is a fact about this document load. A client-side navigation to
	 * a *different* bound path has no payload and falls through to the outlet;
	 * only the cold-loaded path renders as a page.
	 */
	const appPage = appChromePageForPath(location.pathname)

	useDocumentIdentity()
	useRootRedirects()
	// One page view per navigation, query string dropped (see the module).
	usePageViews()

	/**
	 * The served page, in place of `<Outlet/>`.
	 *
	 * The routing file decided this path, not the router: when the server
	 * answered `/dashboard` with a bound page, the compiled-in dashboard is not
	 * what that URL means while the binding is live, and this guard is what stops
	 * it from mounting over the page the server sent (`ARCHITECTURE.md` §5.2,
	 * S4b). It is also what makes a client-side return to the served path render
	 * the served page rather than the route that happens to share the URL — the
	 * router knows nothing about the routing file, so the payload is the only
	 * thing that does.
	 *
	 * On the first paint this never runs: a served document hydrates outside the
	 * router (`servedPage.tsx`). It applies from the moment the app takes the URL
	 * back, which is the first navigation.
	 */
	const served = servedPageForPath(location.pathname)
	// Auction routes and the home / Browse surface render in the Arena chrome
	// (dark header, footer and search); see `usesArenaChrome`.
	const arena = usesArenaChrome(location.pathname)
	// Portalled pop-ups (cart sheet, menus, dialogs) mount on <body>, outside
	// the wrapper, so the scope goes on <body> too while a public page is shown.
	useEffect(() => {
		document.body.classList.toggle('arena-chrome', arena)
		return () => document.body.classList.remove('arena-chrome')
	}, [arena])

	// Setup renders without the app chrome.
	if (isSetupPage) {
		return (
			<div className="relative flex flex-col min-h-screen arena-chrome">
				{appPage ? <BoundPathPage payload={appPage} /> : served ? <ServedPage payload={served} /> : <Outlet />}
			</div>
		)
	}

	return (
		<div className={arena ? 'relative flex flex-col min-h-screen arena-chrome' : 'relative flex flex-col min-h-screen'}>
			<AppBar />

			<main className="flex flex-col flex-grow">
				{appPage ? <BoundPathPage payload={appPage} /> : served ? <ServedPage payload={served} /> : <Outlet />}
			</main>
			{!arena && <Pattern pattern="page" />}
			{!isDashboardPage && !isCheckoutPage && <FooterHost />}

			<AuctionWonModal />
		</div>
	)
}
