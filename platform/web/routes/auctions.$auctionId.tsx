/**
 * `/auctions/$auctionId` — one 1440 auction lot, read from relays.
 *
 * The route param is the auction's **`d` tag**, not a 30408 event id: that is
 * the address the storefront's `AuctionList` block builds
 * (`StorefrontBlockSlots.tsx:238-241`) and the one `getAuctionId` reads. A `d`
 * is scoped to its seller, so a bare `d` can name more than one lot; the reader
 * can disambiguate with `?seller=<pubkey>` (`arenaLotRead.ts`).
 *
 * The route itself is an assembler and nothing else (`ui/auction/auction-detail-views.tsx:9-12`):
 * it owns the URL, the one clock the page ticks, and the reopen key a published
 * bid bumps. All reading, projection, and the view composition live in
 * `ArenaAuctionLotHost`; the 30408 pipeline this route used to drive
 * (`auctionQueryOptions`, streaming bids, verdicts, settlements, path
 * releases, `30408:` coordinates) is gone.
 */

import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useReducer, useState } from 'react'
import { z } from 'zod'
import { ArenaAuctionLotHost, useArenaLotRead } from '@platform/web/auctions/relay/ArenaAuctionLotHost'

const auctionDetailSearchSchema = z.object({
	/** Optional seller pubkey, to disambiguate a `d` that more than one seller published. */
	seller: z.string().optional(),
})

export const Route = createFileRoute('/auctions/$auctionId')({
	validateSearch: auctionDetailSearchSchema,
	component: AuctionDetailRoute,
})

function AuctionDetailRoute() {
	const { auctionId } = Route.useParams()
	const { seller } = Route.useSearch()

	// One clock for the whole page: the detail's phase, the bid panel's end
	// check and every projection read the same instant.
	const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
	useEffect(() => {
		const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000)
		return () => clearInterval(id)
	}, [])

	// The surfaces read is one-shot. A bid the app published exists, for this
	// page, only once a relay serves it — so a successful publish bumps this key
	// and reopens the read (see `useArenaLotRead`).
	const [refreshKey, bumpRefresh] = useReducer((key: number) => key + 1, 0)
	const read = useArenaLotRead(refreshKey)

	return (
		<ArenaAuctionLotHost
			d={auctionId}
			seller={seller ?? null}
			now={now}
			read={read}
			onPublished={() => bumpRefresh()}
		/>
	)
}
