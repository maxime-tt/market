/**
 * platform/web/auctions/AuctionTimelineChartHost.tsx — host for the auction
 * timeline scatter chart.
 *
 * Legacy source: `src/components/AuctionTimelineChart.tsx` (deleted in this
 * fused slice, D4 S5b). It keeps the exact legacy prop surface and injects the
 * wave-3 `UserCardHost` identity with the same size/subtitle/onPress the legacy
 * `<UserCard>` used, so the props-only
 * `@ui/auction/auction-timeline-chart-view` holds no platform-to-src edge.
 */
import type { NostrEventLike } from '@sdk/core/nostr/eventLike'
import { UserCardHost } from '@platform/web/profiles/userCardHosts'
import { AuctionTimelineChartView } from '@ui/auction/auction-timeline-chart-view'

interface Props {
	bids: NostrEventLike[]
	auction: NostrEventLike | null
}

export function AuctionTimelineChartHost({ bids, auction }: Props) {
	return (
		<AuctionTimelineChartView
			bids={bids}
			auction={auction}
			renderUserCard={(pubkey) => <UserCardHost pubkey={pubkey} size="sm" subtitle="none" onPress="profile" />}
		/>
	)
}
