import type { OrderWithRelatedEvents } from '@platform/web/orders/ordersQuery'
import { getOrderRecipientPubkey, getOrderReference } from '@sdk/commerce/orders'
import { Link } from '@tanstack/react-router'
import type { ColumnDef } from '@tanstack/react-table'
import { OrderAmountText, OrderDateText, OrderReferenceBadge } from '@ui/orders/order-list-cells'
import { OrderActions } from './OrderActions'
import { UserCardHost } from '@platform/web/profiles/userCardHosts'

// Base columns that are common to all order lists
export const baseOrderColumns: ColumnDef<OrderWithRelatedEvents>[] = [
	{
		accessorKey: 'orderId',
		header: 'Order ID',
		cell: ({ row }) => (
			<OrderReferenceBadge
				order={row.original.order}
				renderLink={(orderId, children) => (
					<Link to="/dashboard/orders/$orderId" params={{ orderId }} className="font-mono text-xs hover:underline">
						{children}
					</Link>
				)}
			/>
		),
	},
	{
		accessorKey: 'date',
		header: 'Time & Date',
		cell: ({ row }) => <OrderDateText order={row.original.order} />,
	},
	{
		accessorKey: 'amount',
		header: () => <div className="text-right">Amount</div>,
		cell: ({ row }) => <OrderAmountText order={row.original.order} />,
	},
]

// Actions column for purchases (buyer's perspective)
//
// This module is NOT a component: the columns are module-level constants and `cell` runs inside
// react-table during another component's render, so `useStore` is illegal here and a one-shot read
// would not re-render on login. The identity is therefore a factory parameter, supplied by the route
// from its own reactive auth read.
const purchaseActionsColumn = (pubkey: string | undefined): ColumnDef<OrderWithRelatedEvents> => ({
	accessorKey: 'actions',
	header: 'Actions',
	cell: ({ row }) =>
		pubkey ? (
			<div onClick={(e) => e.stopPropagation()} className="flex flex-col gap-2">
				<OrderActions order={row.original} userPubkey={pubkey} />
			</div>
		) : null,
})

// Actions column for sales (seller's perspective)
const salesActionsColumn = (pubkey: string | undefined): ColumnDef<OrderWithRelatedEvents> => ({
	accessorKey: 'actions',
	header: 'Actions',
	cell: ({ row }) =>
		pubkey ? (
			<div onClick={(e) => e.stopPropagation()} className="flex flex-col gap-2">
				<OrderActions order={row.original} userPubkey={pubkey} />
			</div>
		) : null,
})

const sellerColumn: ColumnDef<OrderWithRelatedEvents> = {
	accessorKey: 'seller',
	header: 'Seller',
	cell: ({ row }) => <UserCardHost pubkey={getOrderRecipientPubkey(row.original.order) || ''} size="xs" onPress="none" />,
}

const buyerColumn: ColumnDef<OrderWithRelatedEvents> = {
	accessorKey: 'buyer',
	header: 'Buyer',
	cell: ({ row }) => <UserCardHost pubkey={row.original.order.pubkey || ''} size="xs" onPress="none" />,
}

// Columns for purchases (buyer's perspective)
export const purchaseColumns = (pubkey: string | undefined): ColumnDef<OrderWithRelatedEvents>[] => [
	baseOrderColumns[0], // Order ID
	sellerColumn,
	baseOrderColumns[1], // Date
	baseOrderColumns[2], // Amount
	purchaseActionsColumn(pubkey), // Actions
]

// Columns for sales (seller's perspective)
export const salesColumns = (pubkey: string | undefined): ColumnDef<OrderWithRelatedEvents>[] => [
	{
		...baseOrderColumns[0], // Order ID
		accessorFn: (row) => getOrderReference(row.order) ?? undefined,
	},
	{
		...buyerColumn,
		accessorFn: (row) => row.order.pubkey,
	},
	baseOrderColumns[1], // Date
	baseOrderColumns[2], // Amount
	salesActionsColumn(pubkey), // Actions
]

// Full columns (showing both buyer and seller)
export const fullOrderColumns = (pubkey: string | undefined): ColumnDef<OrderWithRelatedEvents>[] => [
	baseOrderColumns[0], // Order ID
	sellerColumn,
	buyerColumn,
	baseOrderColumns[1], // Date
	baseOrderColumns[2], // Amount
	{
		...salesActionsColumn(pubkey),
		header: 'Actions',
	},
]
