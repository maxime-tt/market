import { getProductVisibility, type ProductReadEvent } from '@sdk/commerce/discovery'
import { getOrderRecipientPubkey, type OrderReadEvent } from '@sdk/commerce/orders'
import { Banknote, MessagesSquare, Package, ShoppingBag } from 'lucide-react'
import { DashboardIconTile } from './dashboard-icon-tile'

export interface DashboardOverviewOrder {
	order: OrderReadEvent & { pubkey?: string }
}

export interface DashboardOverviewStatsProps {
	products: readonly ProductReadEvent[]
	orders: readonly DashboardOverviewOrder[]
	userPubkey: string
	conversationCount: number
	isLoading: boolean
}

const metrics = [
	{ key: 'listings', label: 'Active Listings', detail: 'total products', icon: Package },
	{ key: 'sales', label: 'Sales', detail: 'Orders received', icon: Banknote },
	{ key: 'purchases', label: 'Purchases', detail: 'Orders placed', icon: ShoppingBag },
	{ key: 'messages', label: 'Messages', detail: 'Conversations', icon: MessagesSquare },
] as const

/** SDK-backed dashboard counts; fetching, identity, and loading state come from the route. */
export function DashboardOverviewStats({ products, orders, userPubkey, conversationCount, isLoading }: DashboardOverviewStatsProps) {
	const activeListings = products.filter((product) => getProductVisibility(product)?.[1] !== 'hidden').length
	const buyerOrders = orders.filter((order) => order.order.pubkey === userPubkey).length
	const sellerOrders = orders.filter((order) => getOrderRecipientPubkey(order.order) === userPubkey).length
	const values = {
		listings: activeListings,
		sales: sellerOrders,
		purchases: buyerOrders,
		messages: conversationCount,
	}

	return (
		<section className="grid gap-4 md:grid-cols-2 lg:grid-cols-4" aria-label="Dashboard overview statistics">
			{metrics.map((metric) => (
				<article key={metric.key} className="rounded-2xl border border-border-default bg-surface-raised text-text-high shadow-sm">
					<div className="flex items-center justify-between p-6 pb-2">
						<h2 className="text-sm font-medium">{metric.label}</h2>
						<DashboardIconTile icon={metric.icon} />
					</div>
					<div className="p-6 pt-2">
						{isLoading ? (
							<div className="h-8 w-20 animate-pulse rounded bg-surface-sunken" aria-label={`Loading ${metric.label}`} />
						) : (
							<>
								<div className="text-3xl font-semibold tabular-nums tracking-tight">{values[metric.key]}</div>
								<p className="text-xs text-text-mid">{metric.key === 'listings' ? `${products.length} ${metric.detail}` : metric.detail}</p>
							</>
						)}
					</div>
				</article>
			))}
		</section>
	)
}
