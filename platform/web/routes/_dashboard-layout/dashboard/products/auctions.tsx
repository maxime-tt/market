/**
 * `/dashboard/products/auctions` — the seller's own lots, read from the arena
 * 1440 series.
 *
 * The route is an assembler: it owns the signed-in seller and the child-route
 * branch, and renders the list page host
 * (`platform/web/dashboard/SellerAuctionsListPageHost.tsx`), which owns the read,
 * the filter state, the create drawer and the one host that shows the lots. The
 * retired 30408 pipeline this page used to drive — `auctionsByPubkeyQueryOptions`,
 * the bid / settlement / path-release fan-out, `AuctionListItemHost`, the manual
 * settlement-publish action and the `30408:` coordinates — is gone. The modules
 * still exist for a later stage to remove, but nothing here reads them and the
 * page renders no second, dual-sourced list.
 *
 * The create button is unchanged: it opens the `createAuction` drawer, which
 * already mounts the kind-1440 create form.
 *
 * **The whole-arena read is mounted by the list page, not by this route.** The
 * child route (`auctions.$auctionId`) owns its own lot-scoped read, so mounting
 * the list read here as well opened two arena subscriptions per detail page for
 * nothing (the detail's lot does not come from the list read). The read lives in
 * `SellerAuctionsListPageHost`, which the child route never renders.
 */

import { SellerAuctionsListPageHost } from '@platform/web/dashboard/SellerAuctionsListPageHost'
import { authStore } from '@platform/web/auth/authStore'
import { useDashboardTitle } from '@platform/web/app/dashboardTitle'
import { EmptyState } from '@ui/shared/empty-state'
import { createFileRoute, Outlet, useMatchRoute } from '@tanstack/react-router'
import { useSelector } from '@tanstack/react-store'

export const Route = createFileRoute('/_dashboard-layout/dashboard/products/auctions')({
	component: AuctionsOverviewComponent,
})

function AuctionsOverviewComponent() {
	const { user, isAuthenticated } = useSelector(authStore)
	const matchRoute = useMatchRoute()

	const isOnChildRoute = matchRoute({
		to: '/dashboard/products/auctions/$auctionId',
		fuzzy: true,
	})

	useDashboardTitle(isOnChildRoute ? 'Auction Details' : 'Auctions')

	if (!isAuthenticated || !user) {
		return <EmptyState className="p-6" title="Please log in to manage your auctions." />
	}

	// The child route owns its own read; rendering it here as well would open a
	// second arena subscription the detail never uses.
	if (isOnChildRoute) {
		return <Outlet />
	}

	return <SellerAuctionsListPageHost seller={user.pubkey} />
}
