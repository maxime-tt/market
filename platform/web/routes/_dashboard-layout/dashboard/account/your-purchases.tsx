import { OrderDataTable } from '@platform/web/orders/OrderDataTable'
import { arenaPurchaseColumns } from '@platform/web/orders/arenaPurchaseColumns'
import { arenaPurchaseRows } from '@platform/web/orders/arenaPurchases'
import { purchaseColumns } from '@platform/web/orders/orderColumns'
import { useArenaSurfacesRead } from '@platform/web/auctions/relay/auctionSurfacesRead'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@ui/primitives/select'
import { readMarks } from '@platform/web/notifications'
import { useOrdersByBuyer } from '@platform/web/orders/ordersQuery'
import { useDashboardTitle } from '@platform/web/app/dashboardTitle'
import { filterAndSortOrderListings } from '@sdk/commerce/orders'
import { authStore } from '@platform/web/readContext'
import { createFileRoute } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import { useEffect, useMemo, useState } from 'react'

export const Route = createFileRoute('/_dashboard-layout/dashboard/account/your-purchases')({
	component: YourPurchasesComponent,
})

function YourPurchasesComponent() {
	useDashboardTitle('Your Purchases')
	const { user } = useStore(authStore)
	const [statusFilter, setStatusFilter] = useState<string>('any')
	const [orderBy, setOrderBy] = useState<string>('newest')
	const { data: purchases, isLoading } = useOrdersByBuyer(user?.pubkey || '')
	// Auction wins are purchases too (owner ruling): projected from the arena read,
	// because an arena win has no order event and none is fabricated for it.
	const arenaRead = useArenaSurfacesRead()
	const arenaWins = useMemo(
		() => arenaPurchaseRows(arenaRead.snapshot?.auctions ?? [], user?.pubkey ?? ''),
		[arenaRead.snapshot, user?.pubkey],
	)

	// Mark all purchase updates as seen when the page is viewed
	useEffect(() => {
		readMarks.markPurchasesSeen()
	}, [])

	const filteredPurchases = useMemo(
		() => filterAndSortOrderListings(purchases ?? [], statusFilter, orderBy),
		[purchases, statusFilter, orderBy],
	)

	return (
		<div className="h-full space-y-10">
			{arenaWins.length > 0 && (
				<OrderDataTable
					heading={<h2 className="text-xl font-bold">Auction wins</h2>}
					data={arenaWins}
					columns={arenaPurchaseColumns}
					isLoading={arenaRead.status === 'loading'}
					emptyMessage="No auction wins read."
					showSearch={false}
					showOrderBy={false}
				/>
			)}
			<OrderDataTable
				heading={<h1 className="text-2xl font-bold">Your Purchases</h1>}
				data={filteredPurchases}
				columns={purchaseColumns(user?.pubkey)}
				isLoading={isLoading}
				filterColumn="status"
				showStatusFilter={true}
				onStatusFilterChange={setStatusFilter}
				statusFilter={statusFilter}
				showSearch={false}
				showOrderBy={true}
				onOrderByChange={setOrderBy}
				orderBy={orderBy}
				emptyMessage="You haven't purchased anything yet."
			/>
		</div>
	)
}
