import { Button } from '@ui/wrappers/button'
import { AuctionSortSelect } from '@ui/auction/auction-overview-views'
import { EmptyState } from '@ui/shared/empty-state'
import { ErrorState } from '@ui/shared/error-state'
import { LoadingState } from '@ui/shared/loading-state'
import { PageHeader } from '@ui/layout/page-header'
import { authStore } from '@/lib/stores/auth'
import { uiActions } from '@/lib/stores/ui'
import { usePublishAuctionSettlementMutation } from '@/publish/auctions'
import { AuctionListItemHost } from '@/components/dashboard/AuctionListItemHost'
import {
	auctionsByPubkeyQueryOptions,
	getAuctionId,
	getAuctionRootEventId,
	useAuctionBidsForList,
	useAuctionPathReleasesForList,
	useAuctionSettlementsForList,
} from '@/queries/auctions'
import type { NDKEvent } from '@/lib/nostr/ndk-events'
import { useDashboardTitle } from '@platform/web/routes/_dashboard-layout'
import { parseSettlementEvent } from '@/lib/schemas/auction/settlementEvents'
import { useAutoAnimate } from '@formkit/auto-animate/react'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link, Outlet, useMatchRoute } from '@tanstack/react-router'
import { useSelector } from '@tanstack/react-store'
import { ExternalLink, Gavel } from 'lucide-react'
import { useMemo, useState } from 'react'
import { auctionSortOptionValues, getAuctionSortOptionTitle, useFilteredAuctions, type AuctionSortOption } from '@/lib/utils/auctions'

const getAuctionCoordinates = (auction: NDKEvent): string => {
	const auctionDTag = getAuctionId(auction)
	return auctionDTag ? `30408:${auction.pubkey}:${auctionDTag}` : ''
}

const compareEventRecencyDescending = (left: NDKEvent, right: NDKEvent): number => {
	const createdAtDelta = (right.created_at || 0) - (left.created_at || 0)
	if (createdAtDelta !== 0) return createdAtDelta
	return right.id.localeCompare(left.id)
}

const dedupeEventsById = (events: NDKEvent[]): NDKEvent[] => {
	const byId = new Map<string, NDKEvent>()
	for (const event of events) {
		if (!event?.id) continue
		byId.set(event.id, event)
	}
	return Array.from(byId.values())
}

const isCanonicalSellerSettlementForAuction = (
	event: NDKEvent,
	auction: NDKEvent,
	auctionRootEventId: string,
	auctionCoordinates: string,
): boolean => {
	const parsed = parseSettlementEvent(event)
	if (!parsed.ok) return false

	const authorMatchesSeller = event.pubkey === auction.pubkey || parsed.value.sellerPubkey === auction.pubkey
	if (!authorMatchesSeller) return false

	const rootReferenceMatches = parsed.value.auctionRootEventId === auctionRootEventId
	const coordinateReferenceMatches = parsed.value.auctionCoordinate === auctionCoordinates
	return rootReferenceMatches || coordinateReferenceMatches
}

const resolveLatestCanonicalSettlementForAuction = (
	auction: NDKEvent,
	auctionRootEventId: string,
	auctionCoordinates: string,
	settlementsByAuctionKey?: Map<string, NDKEvent[]>,
): NDKEvent | null => {
	const events = dedupeEventsById([
		...(settlementsByAuctionKey?.get(auctionRootEventId) ?? []),
		...(settlementsByAuctionKey?.get(auctionCoordinates) ?? []),
	])

	const matching = events.filter((event) => isCanonicalSellerSettlementForAuction(event, auction, auctionRootEventId, auctionCoordinates))
	if (matching.length === 0) return null

	return [...matching].sort(compareEventRecencyDescending)[0] ?? null
}

export const Route = createFileRoute('/_dashboard-layout/dashboard/products/auctions')({
	component: AuctionsOverviewComponent,
})

function AuctionsOverviewComponent() {
	const { user, isAuthenticated } = useSelector(authStore)
	const matchRoute = useMatchRoute()
	const [sort, setSort] = useState<AuctionSortOption>('newest')
	const sortOptions = auctionSortOptionValues.map((value) => ({ value, label: getAuctionSortOptionTitle(value) }))
	const settlementMutation = usePublishAuctionSettlementMutation()
	const [settlingAuctionId, setSettlingAuctionId] = useState<string | null>(null)
	const [animationParent] = useAutoAnimate()

	const isOnChildRoute = matchRoute({
		to: '/dashboard/products/auctions/$auctionId',
		fuzzy: true,
	})

	useDashboardTitle(isOnChildRoute ? 'Auction Details' : 'Auctions')

	const {
		data: auctions,
		isLoading,
		error,
	} = useQuery({
		// Owner surface: this list is the seller's own inventory, so it keeps
		// malformed events visible (`includeInvalid`) while the public browse
		// surfaces drop them. A seller has to see the event to republish a
		// corrected version; the detail page carries the notice that says why.
		...auctionsByPubkeyQueryOptions(user?.pubkey ?? '', 100, { includeInvalid: true }),
		enabled: !!user?.pubkey && isAuthenticated,
	})

	const auctionRootEventIdsForBids = useMemo(
		() => (auctions ?? []).map((auction) => getAuctionRootEventId(auction) || auction.id),
		[auctions],
	)
	const auctionCoordinatesForList = useMemo(() => (auctions ?? []).map((auction) => getAuctionCoordinates(auction)), [auctions])
	const { data: bidsByAuctionId } = useAuctionBidsForList(auctionRootEventIdsForBids)
	const { data: settlementsByAuctionKey } = useAuctionSettlementsForList(auctionRootEventIdsForBids, auctionCoordinatesForList, 5)
	const { data: pathReleasesByAuctionCoordinate } = useAuctionPathReleasesForList(auctionCoordinatesForList, 200)
	const sortedAuctions = useFilteredAuctions({ auctions: auctions ?? [], filters: { sort: sort }, bidsByAuctionId, tag: undefined })

	const handlePublishSettlement = async (auction: NDKEvent) => {
		const auctionRootEventId = getAuctionRootEventId(auction)
		const auctionCoordinates = getAuctionCoordinates(auction)
		setSettlingAuctionId(auction.id)
		try {
			// Backend computes the actual outcome (settled / reserve_not_met)
			// from bids + reserve; we don't pre-pick a status here.
			await settlementMutation.mutateAsync({
				auctionEventId: auctionRootEventId || auction.id,
				auctionCoordinates,
			})
		} catch {
			// Toast handled by mutation hook.
		} finally {
			setSettlingAuctionId(null)
		}
	}

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
					<AuctionSortSelect
						value={sort}
						onValueChange={(value) => setSort(value as AuctionSortOption)}
						options={sortOptions}
						triggerClassName="w-56"
					/>
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
				<div className="lg:hidden space-y-4">
					<AuctionSortSelect
						value={sort}
						onValueChange={(value) => setSort(value as AuctionSortOption)}
						options={sortOptions}
						triggerClassName="w-full"
					/>
					<Button
						onClick={handleCreateAuction}
						data-testid="add-auction-button-mobile"
						className="w-full bg-neutral-800 hover:bg-neutral-700 text-white flex items-center justify-center gap-2 py-3 text-base font-semibold rounded-t-md rounded-b-none border-b border-neutral-600"
					>
						<Gavel className="w-4 h-4" /> Add An Auction
					</Button>
				</div>

				<div>
					{isLoading && <LoadingState label="Loading auctions…" />}

					{error && <ErrorState title="Failed to load your auctions" message={error instanceof Error ? error.message : 'Unknown error'} />}

					{!isLoading && !error && sortedAuctions.length === 0 && (
						<EmptyState
							className="rounded-lg border"
							icon={<Gavel />}
							title="No auctions yet"
							description={'Click the "Add An Auction" button to create your first one.'}
							action={
								<Button onClick={handleCreateAuction} className="bg-neutral-800 text-white hover:bg-neutral-700">
									Add An Auction
								</Button>
							}
						/>
					)}

					{!isLoading && !error && sortedAuctions.length > 0 && (
						<ul ref={animationParent} className="flex flex-col gap-4 mt-4">
							{sortedAuctions.map((auction) => (
								<li key={auction.id}>
									{(() => {
										const auctionRootEventId = getAuctionRootEventId(auction) || auction.id
										const auctionCoordinates = getAuctionCoordinates(auction)
										const bids = bidsByAuctionId?.get(auctionRootEventId) ?? []
										const latestSettlement = resolveLatestCanonicalSettlementForAuction(
											auction,
											auctionRootEventId,
											auctionCoordinates,
											settlementsByAuctionKey,
										)
										const pathReleases = pathReleasesByAuctionCoordinate?.get(auctionCoordinates) ?? []

										return (
											<AuctionListItemHost
												auction={auction}
												bids={bids}
												latestSettlement={latestSettlement}
												pathReleases={pathReleases}
												auctionCoordinates={auctionCoordinates}
												onPublishSettlement={() => void handlePublishSettlement(auction)}
												isSettling={settlingAuctionId === auction.id && settlementMutation.isPending}
											/>
										)
									})()}
								</li>
							))}
						</ul>
					)}
				</div>
			</div>
		</div>
	)
}
