import { AuctionWonModal } from '@platform/web/auctions/AuctionWonModal'
import { FooterHost } from '@platform/web/layout/FooterHost'
import { hidesAppHeader, usesArenaChrome } from '@platform/web/layout/appChrome'
import { Header } from '@platform/web/layout/Header'
import { Pattern } from '@ui/shared/pattern'
import { usePageViews } from '@platform/web/analytics/usePageViews'
import { useDocumentIdentity } from '@platform/web/app/useDocumentIdentity'
import { useRootRedirects } from '@platform/web/app/useRootRedirects'
import { ServedPage, servedPageForPath } from '@platform/web/servedPage'
import { appChromePageForPath } from '@platform/web/storefront/appChromePage'
import { BoundPathPage } from '@platform/web/storefront/BoundPathPage'
import { createRootRoute, Outlet, useLocation, useMatches } from '@tanstack/react-router'

/**
 * The router's root route. It is a lean assembler: the app-wide monitors,
 * providers and overlays live in `platform/web/app/` (mounted above
 * `RouterProvider` in `frontend.tsx`), and the two redirect guards run through
 * `useRootRedirects`. All this file owns is the page frame — the legacy header
 * (skipped on routes that draw their own nav, see `layout/appChrome.ts`), routed
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

	/**
	 * A route that draws its own page nav — Browse renders `BrowseNav` — opts out
	 * of the legacy header here, so exactly one nav renders. The decision is
	 * route metadata (`staticData.hidesAppHeader`), not a pathname check in this
	 * frame, so every state of that route inherits it; see `appChrome.ts`.
	 *
	 * A bound page overrides it: the header the route opted out of is the app's
	 * frame, and a page rendered *inside* that frame must have it. (Without this,
	 * a page bound at `/` — whose route hides the header — would render with no
	 * nav at all.)
	 */
	const headerHidden = useMatches({ select: (matches) => hidesAppHeader(matches) }) && !appPage

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

	// Setup renders without the app chrome.
	if (isSetupPage) {
		return appPage ? <BoundPathPage payload={appPage} /> : served ? <ServedPage payload={served} /> : <Outlet />
	}

	return (
		<div className={arena ? 'relative flex flex-col min-h-screen arena-chrome' : 'relative flex flex-col min-h-screen'}>
			{!headerHidden && <Header />}

			<main className="flex flex-col flex-grow">
				{appPage ? <BoundPathPage payload={appPage} /> : served ? <ServedPage payload={served} /> : <Outlet />}
			</main>
			{!arena && <Pattern pattern="page" />}
			{!isDashboardPage && !isCheckoutPage && <FooterHost />}

			<AuctionWonModal />
		</div>
	)
}
