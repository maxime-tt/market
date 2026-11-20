/**
 * `arenaPurchaseColumns.tsx` — the columns for the buyer's auction wins.
 *
 * The rows come from `arenaPurchases.ts` (projected from the arena read; there
 * is no order event and none is fabricated). The wording is the read's own:
 * `refundReceiptLabel` / `settleReceiptLabel` / `ARENA_NO_RECEIPT_LABEL`, so the
 * purchase row cannot drift from the lot page.
 *
 * The **Claim** column surfaces the receipt's claim state per lot
 * (`arenaReceiptClaimState.ts`) and offers the existing wallet action
 * (`walletOps.claimAuctionReceipts({ force: true })`). A refusal is shown by its
 * name; an unread receipt keeps the read's "no receipt read" wording; a wallet
 * whose key is not known yet offers no action at all.
 */
import { useEffect, useMemo, useState } from 'react'
import { useStore } from '@tanstack/react-store'
import { Link } from '@tanstack/react-router'
import type { ColumnDef } from '@tanstack/react-table'
import type { ArenaPurchaseRow } from '@platform/web/orders/arenaPurchases'
import { ARENA_NO_RECEIPT_LABEL, refundReceiptLabel, settleReceiptLabel, shortKey } from '@ui/auction/arena/model'
import { StatusBadge, type StatusTone } from '@ui/shared/status-badge'
import { Button } from '@ui/primitives/button'
import { authStore } from '@platform/web/auth/authStore'
import { cashuStore, walletOps } from '@platform/web/wallet/walletOps'
import { loadArenaReceiptClaimRecord, type ArenaReceiptClaimRefusalName } from '@platform/web/auctions/relay/arenaReceiptClaims'
import { arenaReceiptClaimStateFor, type ArenaReceiptClaimState } from '@platform/web/auctions/relay/arenaReceiptClaimState'

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

/** The props the claim cell renders from — the state the helper computed, and the action. */
export interface ArenaClaimCellViewProps {
	state: ArenaReceiptClaimState
	/** A claim run is in flight. */
	isClaiming: boolean
	/** The refusal the last claim run named, shown by name in place of the button. */
	runRefusal: ArenaReceiptClaimRefusalName | null
	onClaim: () => void
}

/**
 * The claim cell's presentation, split from the host so it renders (and is
 * tested) without a wallet: the state is a plain value.
 */
export function ArenaClaimCellView({ state, isClaiming, runRefusal, onClaim }: ArenaClaimCellViewProps) {
	const refusal = runRefusal ?? (state.kind === 'refused' ? state.refusal : null)
	const refusalDetail = state.kind === 'refused' ? state.detail : undefined

	if (refusal !== null) {
		return (
			<span className="font-mono text-xs text-text-mid" title={refusalDetail}>
				{refusal}
			</span>
		)
	}
	if (state.kind === 'claimed') return <span className="text-xs font-medium text-text-mid">Claimed</span>
	if (state.kind === 'no-receipt') return <span className="text-xs text-text-mid">{ARENA_NO_RECEIPT_LABEL}</span>
	// The wallet's own key is not known yet: there is nothing to match against, so
	// the cell offers no action — deliberately not a spinner on an unknowable.
	if (state.kind === 'wallet-unavailable') return null

	return (
		<Button size="sm" variant="outline" disabled={isClaiming} onClick={onClaim}>
			{isClaiming ? 'Claiming…' : 'Claim'}
		</Button>
	)
}

/**
 * The host: reads the wallet's own key + the persisted claim record, computes
 * the state with {@link arenaReceiptClaimStateFor}, and runs the existing claim
 * action on demand.
 */
function ArenaClaimCell({ row }: { row: ArenaPurchaseRow }) {
	const { user } = useStore(authStore)
	const pubkey = user?.pubkey ?? null
	const walletStatus = useStore(cashuStore, (state) => state.status)
	const walletMints = useStore(cashuStore, (state) => state.mints)
	const defaultMint = useStore(cashuStore, (state) => state.defaultMint)

	const [isClaiming, setIsClaiming] = useState(false)
	const [runRefusal, setRunRefusal] = useState<ArenaReceiptClaimRefusalName | null>(null)
	// Bumped after a claim records a move, so the record is re-read and the cell
	// turns into "Claimed" without a reload.
	const [recordRevision, setRecordRevision] = useState(0)
	// Self-heal the wallet key: the startup bootstrap resolves it best-effort, and
	// the module returns null until it has. A wallet that was not ready then would
	// otherwise show "no action" for the whole session.
	const [keyResolved, setKeyResolved] = useState(() => walletOps.getAuctionWalletP2pk() !== null)
	useEffect(() => {
		if (keyResolved || walletStatus !== 'ready') return
		let cancelled = false
		void walletOps
			.ensureAuctionWalletKey()
			.then(() => {
				if (!cancelled) setKeyResolved(true)
			})
			.catch(() => {})
		return () => {
			cancelled = true
		}
	}, [keyResolved, walletStatus])

	const record = useMemo(() => loadArenaReceiptClaimRecord(pubkey), [pubkey, recordRevision])
	const walletP2pk = walletStatus === 'ready' && keyResolved ? walletOps.getAuctionWalletP2pk() : null
	const state = arenaReceiptClaimStateFor({
		receipt: row.receipt,
		record,
		walletP2pk,
		expectedMintUrl: defaultMint ?? null,
		walletMints: walletMints ?? [],
	})

	const onClaim = async () => {
		setIsClaiming(true)
		setRunRefusal(null)
		try {
			const run = await walletOps.claimAuctionReceipts({ force: true })
			if (run === null) return
			// The action claims every verified receipt, not only this row's — so a
			// refusal is surfaced only when it names this row's own receipt.
			const rowRefusal = run.refusals.find((refusal) => refusal.eventId === row.receipt?.eventId)
			if (rowRefusal) setRunRefusal(rowRefusal.refusal)
			if (run.claimed.length > 0) setRecordRevision((revision) => revision + 1)
		} finally {
			setIsClaiming(false)
		}
	}

	return <ArenaClaimCellView state={state} isClaiming={isClaiming} runRefusal={runRefusal} onClaim={onClaim} />
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
		id: 'claim',
		header: 'Claim',
		cell: ({ row }) => <ArenaClaimCell row={row.original} />,
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
