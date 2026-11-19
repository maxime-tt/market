/**
 * `/dashboard/products/auctions/$auctionId` — one 1440 lot, read from relays,
 * **read-only**.
 *
 * The route param is the auction's **`d` tag**, not a 30408 event id: a `d` is
 * scoped to its seller, so a bare `d` can name more than one lot and the reader
 * may disambiguate with `?seller=<pubkey>` (`arenaLotRead.ts`). The route itself
 * is an assembler and nothing else: it owns the URL, the one clock the page
 * ticks, and the read's reopen key, and renders
 * `platform/web/dashboard/SellerAuctionLotHost.tsx`, which resolves the `d` the
 * same way the public detail route does and composes the Layout A detail
 * (`CatalogueDetailView`) + `ArenaVerdictPanel`.
 *
 * The read is **lot-scoped** (`arenaLotFilters`, via `useArenaLotRead`): it asks
 * the relays for this one lot rather than subscribing to the whole-arena
 * firehose, which is the subscription the app relay is slow to answer. It is
 * also reopenable: the retry affordance bumps the key, so a read that ended
 * without every relay answering can be run again without a page reload. The
 * parent list route does not mount its own read while this route is on screen.
 *
 * The 30408 pipeline this route used to drive (`auctionQueryOptions`, streaming
 * bids, verdicts, settlements, path releases, `30408:` coordinates,
 * `AuctionCountdownHost`, `AuctionVerdictPanelHost`, the manual settlement and
 * the cashu reclaim flow) is gone.
 */

import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useReducer, useState } from 'react'
import { z } from 'zod'
import { useArenaLotRead } from '@platform/web/auctions/relay/ArenaAuctionLotHost'
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

	// The reopen key: the retry affordance bumps it and the read runs again.
	const [refreshKey, bumpRefresh] = useReducer((key: number) => key + 1, 0)
	const read = useArenaLotRead({ d: auctionId, seller: seller ?? null, refreshKey })

	return (
		<SellerAuctionLotHost d={auctionId} seller={seller ?? null} now={now} read={read} onRetry={() => bumpRefresh()} />
	)
}
