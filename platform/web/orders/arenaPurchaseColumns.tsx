/**
 * `arenaPurchaseColumns.tsx` — the columns for the buyer's auction wins.
 *
 * The rows come from `arenaPurchases.ts` (projected from the arena read; there
 * is no order event and none is fabricated). The wording is the read's own:
 * `refundReceiptLabel` / `settleReceiptLabel` / `ARENA_NO_RECEIPT_LABEL`, so the
 * purchase row cannot drift from the lot page.
 */
import type { ArenaPurchaseRow } from '@platform/web/orders/arenaPurchases'
import { ARENA_NO_RECEIPT_LABEL, refundReceiptLabel, settleReceiptLabel, shortKey } from '@ui/auction/arena/model'
import { StatusBadge, type StatusTone } from '@ui/shared/status-badge'
import { Link } from '@tanstack/react-router'
import type { ColumnDef } from '@tanstack/react-table'

/** The outcome word and tone for a row: a verdict claim, or money that moved. */
export function arenaPurchaseStatus(row: ArenaPurchaseRow): { word: string; detail: string; tone: StatusTone } {
	if (row.state === 'won') {
		return {
			word: 'Won',
			detail: row.settle === null ? ARENA_NO_RECEIPT_LABEL : settleReceiptLabel(row.settle),
			tone: row.settle === null ? 'warning' : 'success',
		}
	}
	if (row.state === 'refunded') {
		return {
			word: 'Refunded',
			detail: row.refund === null ? ARENA_NO_RECEIPT_LABEL : refundReceiptLabel(row.refund.height),
			tone: row.refund === null ? 'warning' : 'success',
		}
	}
	return { word: 'Leading', detail: 'your bid is the highest read; no money has moved', tone: 'neutral' }
}

export const arenaPurchaseColumns: ColumnDef<ArenaPurchaseRow>[] = [
	{
		accessorKey: 'title',
		header: 'Lot',
		cell: ({ row }) => (
			<div className="flex flex-col gap-1">
				<Link to="/auctions/$auctionId" params={{ auctionId: row.original.d }} className="font-medium hover:underline">
					{row.original.title ?? 'Untitled lot'}
				</Link>
				<span className="font-mono text-xs text-text-mid">{shortKey(row.original.seller)}</span>
			</div>
		),
	},
	{
		id: 'outcome',
		header: 'Outcome',
		cell: ({ row }) => {
			const status = arenaPurchaseStatus(row.original)
			return (
				<div className="flex flex-col gap-1">
					<StatusBadge status={status.word} tone={status.tone} />
					<span className="text-xs text-text-mid">{status.detail}</span>
				</div>
			)
		},
	},
	{
		id: 'amount',
		header: () => <div className="text-right">Amount</div>,
		cell: ({ row }) => (
			<div className="text-right font-mono text-sm">
				{row.original.amount === null ? 'unknown' : `${row.original.amount.toLocaleString()} sats`}
			</div>
		),
	},
	{
		id: 'actions',
		header: '',
		cell: ({ row }) => (
			<Link to="/auctions/$auctionId" params={{ auctionId: row.original.d }} className="text-xs font-medium hover:underline">
				View lot
			</Link>
		),
	},
]
