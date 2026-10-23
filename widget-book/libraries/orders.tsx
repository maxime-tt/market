import { useState } from 'react'
import { Zap } from 'lucide-react'
import { OrderActionsView, StockUpdateDialogView, type StockUpdateRow } from '@ui/orders/order-actions-view'
import {
	OrderBuyerCardView,
	OrderDetailLayoutView,
	OrderMissingView,
	OrderNotFoundView,
	OrderPaymentDetailsCardView,
	OrderProductsCardView,
	OrderTimelineView,
} from '@ui/orders/order-detail-layout'
import { OrderBuyerContactCard, OrderDetailHeader, OrderShippingCard, PrivateAuctionClaimCard } from '@ui/orders/order-detail-sections'
import {
	DeliveryAddressView,
	InvoiceCardView,
	OrderCardView,
	PaymentSummaryView,
	PrivateOrderDetailsView,
	TrackingInfoView,
} from '@ui/orders/order-detail-views'
import { OrderAmountText, OrderDateText, OrderReferenceBadge } from '@ui/orders/order-list-cells'
import { OrderListView, type OrderListRow } from '@ui/orders/order-list-view'
import { PickupAddressDisplay } from '@ui/orders/pickup-address-display'
import { ShippingInfoDisplay } from '@ui/orders/shipping-info-display'
import {
	ShippingOptionsEmptyState,
	ShippingOptionsLoading,
	ShippingOptionsMobileToolbar,
	ShippingOptionsToolbar,
} from '@ui/orders/shipping-options-views'
import { TimelineEventCard } from '@ui/orders/timeline-event-card'
import type { InvoiceWithSource, PrivateOrderDetailRow } from '@sdk/commerce/orders/orderDetail'
import type { OrderReadEvent } from '@sdk/commerce/orders'
import type { WidgetLibrary } from '../libraries'

/**
 * Order views drained into ui/orders. Every entry is a literal-prop render so
 * the gallery and the Playwright spec show a deterministic state; the only
 * SDK-shaped data is the tag-shaped `OrderReadEvent` and the invoice payload,
 * both plain objects.
 *
 * Dialogs (`OrderActionsView`, `StockUpdateDialogView`) are kept closed at rest
 * and opened from a trigger: a mounted open modal hides the whole catalogue
 * from the accessibility tree.
 */

/** A tag-shaped order event as the host would receive it from a relay. */
const sampleOrderEvent: OrderReadEvent = {
	tags: [
		['order', 'a1b2c3d4e5f6a7b8'],
		['amount', '21000'],
		['p', 'd943e96d0c7828b0e0c2b2d1f0a5b6c7d8e9f0a1b2c3d4e5f60718293a4b5c782'],
		['status', 'pending'],
	],
}

const sampleAddress = 'Satoshi Nakamoto\n21 Independence Ave\nSpringfield 12345\nGermany'

const pendingInvoice: InvoiceWithSource = {
	id: 'invoice-1',
	orderId: 'a1b2c3d4e5f6a7b8',
	bolt11: 'lnbc2100n1pjrtzqlsetsatoshilndao',
	amount: 21000,
	description: 'Merchant Payment',
	recipientName: 'Satoshi Nakamoto',
	status: 'pending',
	expiresAt: 1793000000,
	createdAt: 1792000000,
	recipientPubkey: 'd943e96d0c7828b0e0c2b2d1f0a5b6c7d8e9f0a1b2c3d4e5f60718293a4b5c782',
	type: 'merchant',
	source: 'request',
	localCopies: [],
}

const paidInvoice: InvoiceWithSource = {
	...pendingInvoice,
	status: 'paid',
	preimage: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
}

const summaryInvoices: InvoiceWithSource[] = [
	pendingInvoice,
	{
		...pendingInvoice,
		id: 'invoice-2',
		amount: 4000,
		description: 'V4V Community Payment',
		recipientName: 'Community Fund',
		type: 'v4v',
		bolt11: undefined,
	},
]

const sampleClaim = {
	shippingAddress: {
		name: 'Satoshi Nakamoto',
		firstLineOfAddress: '21 Independence Ave',
		city: 'Springfield',
		zipPostcode: '12345',
		country: 'Germany',
	},
	email: 'satoshi@example.com',
	phone: '+49 30 123456',
	notes: 'Please ship in the original box.',
}

const samplePrivateRows: PrivateOrderDetailRow[] = [
	{ label: 'Recipient', value: 'Satoshi Nakamoto' },
	{ label: 'Address', value: '21 Independence Ave\nSpringfield 12345\nGermany' },
	{ label: 'Order notes', value: 'Leave at the door.' },
]

/** Seller action bar. Cancel, confirm, process and ship open their own dialogs inside the view. */
function OrderActionsViewDemo() {
	const [log, setLog] = useState<string[]>([])
	const append = (message: string) => setLog((previous) => [...previous, message])

	return (
		<div className="space-y-3">
			<OrderActionsView
				actions={{ canCancel: true, canConfirm: true, canProcess: true, canShip: true, canReceive: false }}
				status="pending"
				isUpdatingStatus={false}
				isUpdatingShipping={false}
				onConfirm={() => append('payment confirmed')}
				onProcess={() => append('order processed')}
				onReceive={() => append('item received')}
				onCancel={(reason) => append(`cancelled: ${reason || 'no reason given'}`)}
				onShip={(trackingUrl) => append(`shipped: ${trackingUrl || 'no tracking'}`)}
			/>
			{log.length > 0 && (
				<p className="text-sm text-muted-foreground" data-testid="orders-actions-log">
					{log.join(' · ')}
				</p>
			)}
		</div>
	)
}

/** Stock update dialog, closed at rest and opened from a trigger. */
function StockUpdateDialogDemo() {
	const [open, setOpen] = useState(false)
	const [rows, setRows] = useState<StockUpdateRow[]>([
		{ productRef: 'mug-1', productName: 'Handmade mug', quantityOrdered: 2, currentStock: 5, newStock: 3 },
		{ productRef: 'bowl-1', productName: 'Stoneware bowl', quantityOrdered: 1, currentStock: 0, newStock: 0 },
	])

	return (
		<div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
			<button type="button" className="rounded-md border px-3 py-1.5 text-sm" onClick={() => setOpen(true)}>
				Open stock update
			</button>
			<StockUpdateDialogView
				open={open}
				onOpenChange={setOpen}
				rows={rows}
				loading={false}
				onStockChange={(productRef, value) =>
					setRows((previous) => previous.map((row) => (row.productRef === productRef ? { ...row, newStock: Number(value) || 0 } : row)))
				}
				onSubmit={() => setOpen(false)}
			/>
		</div>
	)
}

/** Filterable, sortable order table with its controls held in local state. */
function OrderListViewDemo() {
	const [search, setSearch] = useState('')
	const [orderBy, setOrderBy] = useState('newest')
	const [statusFilter, setStatusFilter] = useState('any')

	const rows: OrderListRow[] = [
		{
			id: 'order-1',
			onOpen: () => {},
			cells: [
				{ id: 'reference', label: 'Order', content: <span className="font-medium">Purchase #a1b2c3d4</span> },
				{ id: 'buyer', label: 'Buyer', content: <span>satoshi</span> },
				{ id: 'amount', label: 'Amount', content: <span>21,000 sats</span> },
				{ id: 'status', label: 'Status', content: <span>pending</span> },
				{ id: 'date', label: 'Date', content: <OrderDateText order={{ created_at: 1792000000 }} /> },
			],
			primaryCellId: 'reference',
			actionsCellId: 'status',
		},
	]

	return (
		<div className="h-96 overflow-hidden rounded-lg border">
			<OrderListView
				heading={<h2 className="font-header text-lg font-semibold">Sales</h2>}
				search={{ value: search, onChange: setSearch }}
				orderBy={{ value: orderBy, onChange: setOrderBy }}
				statusFilter={{ value: statusFilter, onChange: setStatusFilter }}
				isCompact={false}
				isLoading={false}
				rows={rows}
				emptyMessage="No sales yet"
			/>
		</div>
	)
}

export const orders: WidgetLibrary = {
	name: 'orders',
	entries: [
		{
			name: 'OrderActionsView',
			render: () => <OrderActionsViewDemo />,
		},
		{
			name: 'OrderActionsViewWaiting',
			render: () => (
				<OrderActionsView
					actions={{ canCancel: false, canConfirm: false, canProcess: false, canShip: false, canReceive: false }}
					status="completed"
					isUpdatingStatus={false}
					isUpdatingShipping={false}
					onConfirm={() => {}}
					onProcess={() => {}}
					onReceive={() => {}}
					onCancel={() => {}}
					onShip={() => {}}
				/>
			),
		},
		{
			name: 'StockUpdateDialogView',
			render: () => <StockUpdateDialogDemo />,
		},
		{
			name: 'OrderBuyerCardView',
			render: () => (
				<OrderBuyerCardView
					userCard={
						<div className="flex items-center gap-2">
							<span className="flex h-7 w-7 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground">
								S
							</span>
							<span className="text-sm font-medium text-foreground">satoshi</span>
						</div>
					}
				/>
			),
		},
		{
			name: 'OrderDetailLayoutView',
			render: () => (
				<OrderDetailLayoutView dialogs={<p className="text-xs text-muted-foreground">Order dialogs mount here.</p>}>
					<div className="rounded-lg border p-4 text-sm">Header card</div>
					<div className="rounded-lg border p-4 text-sm">Detail sections</div>
				</OrderDetailLayoutView>
			),
		},
		{
			name: 'OrderMissingView',
			render: () => <OrderMissingView />,
		},
		{
			name: 'OrderNotFoundView',
			render: () => <OrderNotFoundView />,
		},
		{
			name: 'OrderPaymentDetailsCardView',
			render: () => (
				<OrderPaymentDetailsCardView
					totalInvoices={2}
					summary={<PaymentSummaryView enrichedInvoices={summaryInvoices} />}
					banner={
						<div className="rounded-lg border border-warning-border bg-warning-muted p-3 text-sm text-warning-foreground">
							One invoice is expiring soon.
						</div>
					}
					progress={<p className="text-sm text-muted-foreground">1 of 2 invoices paid.</p>}
					invoices={<div className="rounded-lg border p-3 text-sm">Invoice 2 · 4,000 sats · pending</div>}
					footer={<p className="text-xs text-muted-foreground">Invoices are settled over Lightning.</p>}
				/>
			),
		},
		{
			name: 'OrderProductsCardView',
			render: () => (
				<OrderProductsCardView
					items={[
						{ id: 'item-1', product: <p className="text-sm font-medium">Handmade mug</p>, quantity: 2 },
						{ id: 'item-2', product: <p className="text-sm font-medium">Stoneware bowl</p>, quantity: 1 },
					]}
				/>
			),
		},
		{
			name: 'OrderTimelineView',
			render: () => (
				<OrderTimelineView>
					<div className="rounded-lg border p-4 text-sm">Order placed</div>
					<div className="rounded-lg border p-4 text-sm">Payment confirmed</div>
				</OrderTimelineView>
			),
		},
		{
			name: 'OrderBuyerContactCard',
			render: () => <OrderBuyerContactCard deliveryContact="satoshi@example.com" />,
		},
		{
			name: 'OrderDetailHeader',
			render: () => (
				<OrderDetailHeader
					title="Handmade mug × 2 and a stoneware bowl"
					subText="Order a1b2c3d4"
					totalSats={25000}
					createdAt={1792000000}
					status={{
						label: 'Pending',
						iconName: 'clock',
						headerBgColor: 'bg-info-muted',
						badgeBgColor: 'bg-info-muted',
						explanation: 'Awaiting payment confirmation from the seller.',
					}}
					actions={<p className="text-xs text-muted-foreground">Order management controls mount here.</p>}
				/>
			),
		},
		{
			name: 'OrderShippingCard',
			render: () => (
				<OrderShippingCard
					mode="shipping"
					shippingInfo={{
						title: 'Tracked standard',
						price: { amount: '2.50', currency: 'EUR' },
						service: 'standard',
						carrier: 'DHL',
						duration: { min: '2', max: '4', unit: 'days' },
						countries: ['DE', 'AT'],
						description: 'Ships from Berlin.',
					}}
					deliveryAddress={<DeliveryAddressView shippingAddress={sampleAddress} />}
				/>
			),
		},
		{
			name: 'PrivateAuctionClaimCard',
			render: () => <PrivateAuctionClaimCard isLoading={false} claim={sampleClaim} unavailableMessage="Claim details are unavailable." />,
		},
		{
			name: 'PrivateAuctionClaimCardLoading',
			render: () => <PrivateAuctionClaimCard isLoading claim={null} unavailableMessage="Claim details are unavailable." />,
		},
		{
			name: 'DeliveryAddressView',
			render: () => <DeliveryAddressView shippingAddress={sampleAddress} />,
		},
		{
			name: 'InvoiceCardView',
			render: () => (
				<InvoiceCardView
					invoice={pendingInvoice}
					index={0}
					totalInvoices={2}
					isBuyer
					isGenerating={false}
					onPay={() => {}}
					onGenerateNew={() => {}}
					onCopy={() => {}}
				/>
			),
		},
		{
			name: 'InvoiceCardViewPaid',
			render: () => (
				<InvoiceCardView
					invoice={paidInvoice}
					index={0}
					totalInvoices={2}
					isBuyer
					isGenerating={false}
					onPay={() => {}}
					onGenerateNew={() => {}}
					onCopy={() => {}}
				/>
			),
		},
		{
			name: 'OrderCardView',
			render: () => (
				<OrderCardView href="#/orders/a1b2c3d4" orderEventId="a1b2c3d4e5f6a7b8" isBuyer status="pending" createdAt={1792000000} />
			),
		},
		{
			name: 'PaymentSummaryView',
			render: () => <PaymentSummaryView enrichedInvoices={summaryInvoices} />,
		},
		{
			name: 'PrivateOrderDetailsView',
			render: () => <PrivateOrderDetailsView rows={samplePrivateRows} orderId="a1b2c3d4e5f6a7b8" />,
		},
		{
			name: 'PrivateOrderDetailsViewLocked',
			render: () => <PrivateOrderDetailsView rows={null} orderId="a1b2c3d4e5f6a7b8" />,
		},
		{
			name: 'TrackingInfoView',
			render: () => (
				<TrackingInfoView trackingNumber="https://dhl.com/track/JJD0001234567" carrier="DHL" shippingStatus="shipped" onCopy={() => {}} />
			),
		},
		{
			name: 'OrderAmountText',
			render: () => (
				<div className="max-w-xs">
					<OrderAmountText order={sampleOrderEvent} />
				</div>
			),
		},
		{
			name: 'OrderDateText',
			render: () => (
				<div className="max-w-xs">
					<OrderDateText order={{ created_at: 1792000000 }} />
				</div>
			),
		},
		{
			name: 'OrderReferenceBadge',
			render: () => (
				<OrderReferenceBadge
					order={sampleOrderEvent}
					renderLink={(reference, children) => <a href={`#/orders/${reference}`}>{children}</a>}
				/>
			),
		},
		{
			name: 'OrderListView',
			render: () => <OrderListViewDemo />,
		},
		{
			name: 'OrderListViewEmpty',
			render: () => (
				<div className="h-64 overflow-hidden rounded-lg border">
					<OrderListView isCompact={false} isLoading={false} rows={[]} emptyMessage="No sales match your filters." />
				</div>
			),
		},
		{
			name: 'PickupAddressDisplay',
			render: () => <PickupAddressDisplay pickupAddress="Makerspace Berlin, Ritterstraße 12, 10969 Berlin" />,
		},
		{
			name: 'ShippingInfoDisplay',
			render: () => (
				<ShippingInfoDisplay
					shippingInfo={{
						title: 'Tracked standard',
						price: { amount: '2.50', currency: 'EUR' },
						service: 'standard',
						carrier: 'DHL',
						duration: { min: '2', max: '4', unit: 'days' },
						countries: ['DE', 'AT'],
					}}
				/>
			),
		},
		{
			name: 'ShippingOptionsEmptyState',
			render: () => (
				<ShippingOptionsEmptyState
					serviceFilter="all"
					serviceTypes={[
						{ value: 'standard', label: 'Standard' },
						{ value: 'express', label: 'Express' },
					]}
				/>
			),
		},
		{
			name: 'ShippingOptionsLoading',
			render: () => <ShippingOptionsLoading />,
		},
		{
			name: 'ShippingOptionsMobileToolbar',
			render: () => (
				<ShippingOptionsMobileToolbar
					serviceFilter="all"
					onServiceFilterChange={() => {}}
					serviceTypes={[{ value: 'standard', label: 'Standard' }]}
					onAdd={() => {}}
				/>
			),
		},
		{
			name: 'ShippingOptionsToolbar',
			render: () => (
				<ShippingOptionsToolbar
					serviceFilter="all"
					onServiceFilterChange={() => {}}
					serviceTypes={[{ value: 'standard', label: 'Standard' }]}
					onAdd={() => {}}
				/>
			),
		},
		{
			name: 'TimelineEventCard',
			render: () => (
				<TimelineEventCard
					event={{
						id: 'event-1',
						created_at: 1792000000,
						content: 'Payment received for order a1b2c3d4.',
						tags: [
							['amount', '21000'],
							[
								'payment',
								'lightning',
								'lnbc2100n1pjrtzqlsetsatoshilndao',
								'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
							],
						],
					}}
					title="Payment"
					icon={<Zap className="h-5 w-5" />}
					type="payment"
					timelineIndex={2}
					onCopyPreimage={() => {}}
				/>
			),
		},
	],
}
