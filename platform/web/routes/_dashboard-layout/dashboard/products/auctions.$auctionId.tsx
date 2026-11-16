/**
 * `/dashboard/products/auctions/$auctionId` — one 1440 lot, read from relays,
 * **read-only**.
 *
 * The route param is the auction's **`d` tag**, not a 30408 event id: a `d` is
 * scoped to its seller, so a bare `d` can name more than one lot and the reader
 * may disambiguate with `?seller=<pubkey>` (`arenaLotRead.ts`). The route itself
 * is an assembler and nothing else: it owns the URL, the one clock the page
 * ticks, and the read, and renders
 * `platform/web/dashboard/SellerAuctionLotHost.tsx`, which resolves the `d` the
 * same way the public detail route does and composes `ArenaAuctionDetail` +
 * `ArenaVerdictPanel`.
 *
 * The 30408 pipeline this route used to drive (`auctionQueryOptions`, streaming
 * bids, verdicts, settlements, path releases, `30408:` coordinates,
 * `AuctionCountdownHost`, `AuctionVerdictPanelHost`, the manual settlement and
 * the cashu reclaim flow) is gone. The read is `useArenaSurfacesRead` — the
 * same one-shot read the list pages use — rather than the reopenable lot read:
 * nothing on a read-only page publishes, so there is no refresh key to bump, and
 * the reopenable variant lives in a module that imports the bid host, which a
 * read-only route has no reason to load.
 */

import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { z } from 'zod'
import { useArenaSurfacesRead } from '@platform/web/auctions/relay/auctionSurfacesRead'
import { SellerAuctionLotHost } from '@platform/web/dashboard/SellerAuctionLotHost'
import { useDashboardTitle } from '@platform/web/app/dashboardTitle'

const sellerAuctionDetailSearchSchema = z.object({
	/** Optional seller pubkey, to disambiguate a `d` that more than one seller published. */
	seller: z.string().optional(),
})

export const Route = createFileRoute('/_dashboard-layout/dashboard/products/auctions/$auctionId')({
	validateSearch: sellerAuctionDetailSearchSchema,
	component: DashboardAuctionDetailRoute,
})

function DashboardAuctionDetailRoute() {
	const { auctionId } = Route.useParams()
	const { seller } = Route.useSearch()

	useDashboardTitle('Auction Details')

	// One clock for the page: the detail's phase and every projection read the
	// same instant.
	const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
	useEffect(() => {
		const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000)
		return () => clearInterval(id)
	}, [])

	const read = useArenaSurfacesRead()

	return <SellerAuctionLotHost d={auctionId} seller={seller ?? null} now={now} read={read} />
}
