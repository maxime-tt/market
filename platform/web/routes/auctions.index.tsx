import { ArenaAuctionsListHost, type ArenaListSort } from '@platform/web/auctions/relay/ArenaAuctionsListHost'
import { ArenaAuctionLotHost, useArenaLotRead } from '@platform/web/auctions/relay/ArenaAuctionLotHost'
import { uiActions } from '@platform/web/app/uiStore'
import { authStore } from '@platform/web/auth/authStore'
import { createFileRoute } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import { useEffect, useReducer, useState } from 'react'

/**
 * `/auctions` — the auctions index, read from the arena 1440 series.
 *
 * The route is an assembler: it owns the read and the filter state, and it
 * renders the one host that shows the lots
 * (`platform/web/auctions/relay/ArenaAuctionsListHost.tsx`). The retired 30408
 * pipeline (`AuctionCardHost` + `AuctionSectionGrid`, the category chips, the
 * test-listing toggle, the featured-auction carousel) is gone from this page —
 * the modules still exist for a later stage to remove, but nothing here reads
 * them, and the page renders no second, dual-sourced list.
 */
export const Route = createFileRoute('/auctions/')({
	component: AuctionsRoute,
})

function AuctionsRoute() {
	// Reopenable read: a bid placed on the featured lot bumps the key so the
	// page shows it once a relay serves it.
	const [refreshKey, bumpRefresh] = useReducer((key: number) => key + 1, 0)
	// The whole arena (`d: null`): the index lists every lot, so it must not ask
	// for one lot's filters.
	const read = useArenaLotRead({ d: null, seller: null, refreshKey })
	const { isAuthenticated } = useStore(authStore)
	const [sort, setSort] = useState<ArenaListSort>('newest')
	const [hideEnded, setHideEnded] = useState(false)

	// One ticking clock for the page: the featured lot's ring and the cards'
	// phases read the same instant. Projection input only; it never reopens the read.
	const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
	useEffect(() => {
		const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000)
		return () => clearInterval(id)
	}, [])

	const handleCreateAuction = () => {
		if (isAuthenticated) {
			uiActions.openDrawer('createAuction')
		} else {
			uiActions.openDialog('login')
		}
	}

	return (
		<ArenaAuctionsListHost
			snapshot={read.snapshot}
			status={read.status}
			relayHealth={read.relayHealth}
			now={now}
			sort={sort}
			hideEnded={hideEnded}
			onSortChange={(value) => setSort(value as ArenaListSort)}
			onToggleHideEnded={() => setHideEnded((prev) => !prev)}
			onReset={() => {
				setSort('newest')
				setHideEnded(false)
			}}
			onCreate={handleCreateAuction}
			renderFeatured={(card) => (
				<ArenaAuctionLotHost d={card.d} seller={card.seller} now={now} read={read} onPublished={() => bumpRefresh()} backHref={null} />
			)}
		/>
	)
}
