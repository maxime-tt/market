/**
 * `SellerAuctionsListPageHost.tsx` — the seller's `/dashboard/products/auctions`
 * list page: the one whole-arena 1440 read, projected to the signed-in seller's
 * own lots, behind the page chrome (the header and the create affordances).
 *
 * ## Why a host and not the route
 *
 * `platform/web/routes/*` assembles; it does not define presentational
 * components (`ADR-0007` §1b, enforced by `scripts/check-ui-assembler.sh`). The
 * list page cannot live on the route component either: the route component runs
 * on the child detail route too (it renders the `<Outlet/>`), and a read mounted
 * there would open a second arena subscription per detail page for nothing. So
 * the page — chrome, filter state, the read and its one host — is a component
 * that the route renders **only** when it is not on the child route, exactly the
 * way `auctions.$auctionId.tsx` renders `SellerAuctionLotHost`.
 *
 * ## The chrome is unchanged
 *
 * The header, the link to the public list and both create buttons (desktop and
 * mobile) are the same markup the route used to hold; the create action opens
 * the `createAuction` drawer, which already mounts the kind-1440 create form.
 *
 * The read itself is projected by the controlled `SellerAuctionsListHost`: the
 * filter state lives here and the host is a pure function of props, so it stays
 * testable without a relay.
 */

import type { ArenaListSort } from '@platform/web/auctions/relay/ArenaAuctionsListHost'
import { useArenaSurfacesRead } from '@platform/web/auctions/relay/auctionSurfacesRead'
import { SellerAuctionsListHost } from '@platform/web/dashboard/SellerAuctionsListHost'
import { uiActions } from '@platform/web/app/uiStore'
import { Button } from '@ui/wrappers/button'
import { PageHeader } from '@ui/layout/page-header'
import { Link } from '@tanstack/react-router'
import { ExternalLink, Gavel } from 'lucide-react'
import { useState } from 'react'

export interface SellerAuctionsListPageHostProps {
	/** The signed-in seller whose lots this page shows. */
	seller: string
}

/** The list page: the one live whole-arena read, projected to the seller's own lots. */
export function SellerAuctionsListPageHost({ seller }: SellerAuctionsListPageHostProps) {
	const [sort, setSort] = useState<ArenaListSort>('newest')
	const [hideEnded, setHideEnded] = useState(false)

	// The arena read: one live 1440 read, projected to the seller's own lots by
	// the host. `now` is projection input, fixed for this render, so the read is
	// not reopened when the clock ticks.
	const read = useArenaSurfacesRead()
	const now = Math.floor(Date.now() / 1000)

	const handleCreateAuction = () => {
		uiActions.openDrawer('createAuction')
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
					seller={seller}
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
