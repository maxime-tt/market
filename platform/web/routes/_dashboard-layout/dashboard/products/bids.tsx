/**
 * `/dashboard/products/bids` — the lots the signed-in bidder bid on, read from
 * the arena 1440 series.
 *
 * The route is an assembler: it owns the read, the signed-in bidder and the
 * notification mark, and renders the one host that shows the lots
 * (`platform/web/dashboard/BidderPositionsHost.tsx`). The 30408 bid pipeline
 * this page used to drive — `useAuctionBidsByBidder`, the settlement / claim
 * order fan-out, `resolveBidGroupStatus` and the whole reclaim / collateral
 * surface (`PendingToken`, `getAuctionReclaimReadyAt`, the orphaned-lock ledger,
 * `walletOps.reclaimToken`, the wallet-refresh control) — is gone. Under the
 * consolidated protocol a refund is automatic off the committed template, so a
 * reclaim button would be a lie.
 */

import { createFileRoute } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useSelector } from '@tanstack/react-store'
import { authStore } from '@platform/web/auth/authStore'
import { useDashboardTitle } from '@platform/web/app/dashboardTitle'
import { useArenaSurfacesRead } from '@platform/web/auctions/relay/auctionSurfacesRead'
import { BidderPositionsHost } from '@platform/web/dashboard/BidderPositionsHost'
import { readMarks } from '@platform/web/notifications'
import { EmptyState } from '@ui/shared/empty-state'
import { PageHeader } from '@ui/layout/page-header'

export const Route = createFileRoute('/_dashboard-layout/dashboard/products/bids')({
	component: BidsOverviewComponent,
})

function BidsOverviewComponent() {
	useDashboardTitle('Bids')

	const { user, isAuthenticated } = useSelector(authStore)
	// The arena read: one live 1440 read, projected to the lots the bidder bid
	// on by the host. `now` is projection input, fixed for this render.
	const read = useArenaSurfacesRead()
	const now = Math.floor(Date.now() / 1000)

	useEffect(() => {
		if (isAuthenticated && user?.pubkey) {
			readMarks.markBidUpdatesSeen()
		}
	}, [isAuthenticated, user?.pubkey])

	if (!isAuthenticated || !user) {
		return <EmptyState className="p-6" title="Please log in to manage your bids." />
	}

	return (
		<div>
			<PageHeader className="gap-4">
				<div>
					<h1 className="text-2xl font-bold">Bids</h1>
					<p className="text-sm text-muted-foreground">
						The lots you bid on, read from your relays. Your position is derived from your bid deltas — the verdict names the winner.
					</p>
				</div>
			</PageHeader>

			<div className="space-y-6 p-4 lg:p-6">
				<BidderPositionsHost
					snapshot={read.snapshot}
					status={read.status}
					relayHealth={read.relayHealth}
					now={now}
					bidder={user.pubkey}
				/>
			</div>
		</div>
	)
}