import { AuctionWonModal } from '@/components/AuctionWonModal'
import { Footer } from '@/components/layout/Footer'
import { Header } from '@/components/layout/Header'
import { Pattern } from '@ui/shared/pattern'
import { useDocumentIdentity } from '@platform/web/app/useDocumentIdentity'
import { useRootRedirects } from '@platform/web/app/useRootRedirects'
import { createRootRoute, Outlet, useLocation } from '@tanstack/react-router'

/**
 * The router's root route. It is a lean assembler: the app-wide monitors,
 * providers and overlays live in `platform/web/app/` (mounted above
 * `RouterProvider` in `frontend.tsx`), and the two redirect guards run through
 * `useRootRedirects`. All this file owns is the page frame — header, routed
 * content, footer — plus `AuctionWonModal`, which needs router context
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

	useDocumentIdentity()
	useRootRedirects()

	// Setup renders without the app chrome.
	if (isSetupPage) {
		return <Outlet />
	}

	return (
		<div className="relative flex flex-col min-h-screen">
			<Header />

			<main className="flex flex-col flex-grow">
				<Outlet />
			</main>
			<Pattern pattern="page" />
			{!isDashboardPage && !isCheckoutPage && <Footer />}

			<AuctionWonModal />
		</div>
	)
}
