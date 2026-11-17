import { AuctionWonModal } from '@platform/web/auctions/AuctionWonModal'
import { FooterHost } from '@platform/web/layout/FooterHost'
import { hidesAppHeader } from '@platform/web/layout/appChrome'
import { Header } from '@platform/web/layout/Header'
import { Pattern } from '@ui/shared/pattern'
import { usePageViews } from '@platform/web/analytics/usePageViews'
import { useDocumentIdentity } from '@platform/web/app/useDocumentIdentity'
import { useRootRedirects } from '@platform/web/app/useRootRedirects'
import { ServedPage, servedPageForPath } from '@platform/web/servedPage'
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
	 * A route that draws its own page nav — Browse renders `BrowseNav` — opts out
	 * of the legacy header here, so exactly one nav renders. The decision is
	 * route metadata (`staticData.hidesAppHeader`), not a pathname check in this
	 * frame, so every state of that route inherits it; see `appChrome.ts`.
	 */
	const headerHidden = useMatches({ select: (matches) => hidesAppHeader(matches) })

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

	// Setup renders without the app chrome.
	if (isSetupPage) {
		return served ? <ServedPage payload={served} /> : <Outlet />
	}

	return (
		<div className="relative flex flex-col min-h-screen">
			{!headerHidden && <Header />}

			<main className="flex flex-col flex-grow">
				{served ? <ServedPage payload={served} /> : <Outlet />}
			</main>
			<Pattern pattern="page" />
			{!isDashboardPage && !isCheckoutPage && <FooterHost />}

			<AuctionWonModal />
		</div>
	)
}
