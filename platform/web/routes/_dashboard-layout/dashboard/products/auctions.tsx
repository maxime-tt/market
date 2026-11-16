/**
 * `/dashboard/products/auctions` — the seller's own lots, read from the arena
 * 1440 series.
 *
 * The route is an assembler: it owns the read, the signed-in seller, the filter
 * state and the create drawer, and renders the one host that shows the lots
 * (`platform/web/dashboard/SellerAuctionsListHost.tsx`). The retired 30408
 * pipeline this page used to drive — `auctionsByPubkeyQueryOptions`, the bid /
 * settlement / path-release fan-out, `AuctionListItemHost`, the manual
 * settlement-publish action and the `30408:` coordinates — is gone. The modules
 * still exist for a later stage to remove, but nothing here reads them and the
 * page renders no second, dual-sourced list.
 *
 * The create button is unchanged: it opens the `createAuction` drawer, which
 * already mounts the kind-1440 create form.
 */

import type { ArenaListSort } from '@platform/web/auctions/relay/ArenaAuctionsListHost'
import { useArenaSurfacesRead } from '@platform/web/auctions/relay/auctionSurfacesRead'
import { SellerAuctionsListHost } from '@platform/web/dashboard/SellerAuctionsListHost'
import { authStore } from '@platform/web/auth/authStore'
import { uiActions } from '@platform/web/app/uiStore'
import { useDashboardTitle } from '@platform/web/app/dashboardTitle'
import { Button } from '@ui/wrappers/button'
import { EmptyState } from '@ui/shared/empty-state'
import { PageHeader } from '@ui/layout/page-header'
import { createFileRoute, Link, Outlet, useMatchRoute } from '@tanstack/react-router'
import { useSelector } from '@tanstack/react-store'
import { ExternalLink, Gavel } from 'lucide-react'
import { useState } from 'react'

export const Route = createFileRoute('/_dashboard-layout/dashboard/products/auctions')({
	component: AuctionsOverviewComponent,
})

function AuctionsOverviewComponent() {
	const { user, isAuthenticated } = useSelector(authStore)
	const matchRoute = useMatchRoute()
	const [sort, setSort] = useState<ArenaListSort>('newest')
	const [hideEnded, setHideEnded] = useState(false)

	// The arena read: one live 1440 read, projected to the seller's own lots by
	// the host. `now` is projection input, fixed for this render, so the read is
	// not reopened when the clock ticks.
	const read = useArenaSurfacesRead()
	const now = Math.floor(Date.now() / 1000)

	const isOnChildRoute = matchRoute({
		to: '/dashboard/products/auctions/$auctionId',
		fuzzy: true,
	})

	useDashboardTitle(isOnChildRoute ? 'Auction Details' : 'Auctions')

	const handleCreateAuction = () => {
		uiActions.openDrawer('createAuction')
	}

	if (!isAuthenticated || !user) {
		return <EmptyState className="p-6" title="Please log in to manage your auctions." />
	}

	if (isOnChildRoute) {
		return <Outlet />
	}

	return (
		<div>
			<PageHeader>
				<h1 className="text-2xl font-bold">Auctions</h1>
				<div className="flex items-center gap-4">
					<Link to="/auctions">
						<Button variant="outline" className="gap-2">
							<ExternalLink className="w-4 h-4" />
							View Public Auctions
						</Button>
					</Link>
					<Button
						onClick={handleCreateAuction}
						className="bg-neutral-800 hover:bg-neutral-700 text-white flex items-center gap-2 px-4 py-2 text-sm font-semibold"
					>
						<Gavel className="w-4 h-4" />
						Add An Auction
					</Button>
				</div>
			</PageHeader>

			<div className="space-y-6 p-4 lg:p-6">
				<div className="lg:hidden">
					<Button
						onClick={handleCreateAuction}
						data-testid="add-auction-button-mobile"
						className="w-full bg-neutral-800 hover:bg-neutral-700 text-white flex items-center justify-center gap-2 py-3 text-base font-semibold rounded-md"
					>
						<Gavel className="w-4 h-4" /> Add An Auction
					</Button>
				</div>

				<SellerAuctionsListHost
					snapshot={read.snapshot}
					status={read.status}
					relayHealth={read.relayHealth}
					now={now}
					seller={user.pubkey}
					sort={sort}
					hideEnded={hideEnded}
					onSortChange={(value) => setSort(value as ArenaListSort)}
					onToggleHideEnded={() => setHideEnded((prev) => !prev)}
					onReset={() => {
						setSort('newest')
						setHideEnded(false)
					}}
				/>
			</div>
		</div>
	)
}
