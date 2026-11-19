import { ArenaAuctionsListHost, type ArenaListSort } from '@platform/web/auctions/relay/ArenaAuctionsListHost'
import { useArenaSurfacesRead } from '@platform/web/auctions/relay/auctionSurfacesRead'
import { uiActions } from '@platform/web/app/uiStore'
import { authStore } from '@platform/web/auth/authStore'
import { createFileRoute } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import { useState } from 'react'

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
	const read = useArenaSurfacesRead()
	const { isAuthenticated } = useStore(authStore)
	const [sort, setSort] = useState<ArenaListSort>('newest')
	const [hideEnded, setHideEnded] = useState(false)

	// Projection input, not read input: fixed for this render, so the page does
	// not reopen a subscription when the clock ticks.
	const now = Math.floor(Date.now() / 1000)

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
		/>
	)
}
