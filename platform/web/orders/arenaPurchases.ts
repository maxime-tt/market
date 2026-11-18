/**
 * `arenaPurchases.ts` — the buyer's auction wins, as purchase rows.
 *
 * The owner's ruling: a win **is** a purchase, and it shows up where the buyer
 * already looks for purchases (the orders surface) rather than in a parallel
 * "my wins" list. An arena win has no kind-16 order event and this module
 * **never fabricates one** — the row is projected from the arena read the app
 * already has, and its money facts come from the receipts (`1443` refund,
 * `1444` settle) that the read verified.
 *
 * The honesty rules are the read's own:
 * - a verdict is a **claim**; a receipt is money that moved — so "won" says the
 *   outcome, and "paid" is only ever stated from a `1444`;
 * - no settle receipt reads **"no receipt read"**, never "unpaid";
 * - an outbid bid whose `1443` was read reads **refunded**, not locked;
 * - every unknown is `null` and is rendered in words by the caller.
 */
import type { ArenaAuctionView, ArenaBidView } from '@platform/web/auctions/relay/arenaAuctionRead'
import { lotHref } from '@platform/web/auctions/relay/arenaLotRead'
import { toReceiptModel } from '@platform/web/auctions/relay/auctionSurfacesRead'
import type { ParsedArenaReceipt } from '@platform/web/auctions/relay/arenaReceiptsRead'
import type { ArenaReceiptModel } from '@ui/auction/arena/model'

/** What the buyer's relationship to the lot is, from the read alone. */
export type ArenaPurchaseState = 'won' | 'refunded' | 'leading'

/** One purchase row for one lot the signed-in buyer took part in. */
export interface ArenaPurchaseRow {
	coordinate: string
	/** `/auctions/<d>?seller=<seller>` — the lot the buyer can open. */
	lotHref: string
	title: string | null
	imageUrl: string | null
	seller: string
	d: string
	/** The buyer's bid this row is about (their winning, refunded or leading one). */
	bidEventId: string
	state: ArenaPurchaseState
	/** The buyer's derived position on the lot; `null` when a delta was unreadable. */
	amount: number | null
	/** The `1444` that paid this bid, as a surface renders it, or `null` when none was read. */
	settle: ArenaReceiptModel | null
	/** The `1443` that refunded this bid, as a surface renders it, or `null` when none was read. */
	refund: ArenaReceiptModel | null
	/** The anchored height of the winning verdict, when one names this bid. */
	verdictHeight: number | null
	/** The verdict's words when it names the winner (`winner`), or `null`. */
	verdictOutcome: string | null
}

const byCreatedAtDesc = (a: ArenaBidView, b: ArenaBidView): number => b.createdAt - a.createdAt

/** A parsed receipt as the surface model, or `null` — the read's own mapper, no params held. */
const toModel = (receipt: ParsedArenaReceipt | undefined): ArenaReceiptModel | null =>
	receipt === undefined ? null : toReceiptModel(receipt, null)

/**
 * The highest-anchored verdict (the read sorts them height-descending) when it
 * names this bid as the winner. Mirrors `winningVerdictOf` in the dashboard: an
 * older `winner` beneath a newer contradicting row is a disagreement the read
 * refuses to resolve, not a win to act on.
 */
function winningVerdictFor(view: ArenaAuctionView, bidId: string) {
	const latest = view.verdicts[0]
	if (!latest || latest.outcome !== 'winner' || latest.bidId !== bidId) return null
	return latest
}

/**
 * Project one auction's bids by one buyer into a single purchase row, or `null`
 * when the buyer took no part in it.
 *
 * One row per lot, not per bid: a buyer who bid twice bought one thing. The
 * winning bid wins the row; otherwise a refunded bid says refunded; otherwise
 * the newest bid is the position they still hold.
 */
export function arenaPurchaseRowFor(view: ArenaAuctionView, buyerPubkey: string): ArenaPurchaseRow | null {
	if (!buyerPubkey) return null
	const bids = view.bids.filter((bid) => bid.bidder === buyerPubkey).sort(byCreatedAtDesc)
	if (bids.length === 0) return null

	const paidBid = bids.find((bid) => view.settleForBid[bid.eventId] !== undefined || winningVerdictFor(view, bid.eventId) !== null)
	const refundedBid = bids.find((bid) => view.refundForBid[bid.eventId] !== undefined)
	const chosen = paidBid ?? refundedBid ?? bids[0]
	const verdict = winningVerdictFor(view, chosen.eventId)
	const state: ArenaPurchaseState = paidBid ? 'won' : refundedBid ? 'refunded' : 'leading'

	return {
		coordinate: view.coordinate,
		lotHref: lotHref(view.d, view.seller),
		title: view.content.title,
		imageUrl: view.content.image,
		seller: view.seller,
		d: view.d,
		bidEventId: chosen.eventId,
		state,
		amount: view.positions[buyerPubkey] ?? null,
		// Rendered through the read's own mapper, with no held params reading: the
		// version is recorded, and a comparison is only possible when the caller
		// holds one (`paramsVersionMismatch: null` means "not compared").
		settle: toModel(view.settleForBid[chosen.eventId]),
		refund: toModel(view.refundForBid[chosen.eventId]),
		verdictHeight: verdict?.height ?? null,
		verdictOutcome: verdict?.outcome ?? null,
	}
}

/**
 * Every lot the buyer took part in, newest first. A lot whose create the read
 * refused is not here at all — it is not a purchase the app can describe.
 */
export function arenaPurchaseRows(views: readonly ArenaAuctionView[], buyerPubkey: string): ArenaPurchaseRow[] {
	const rows: ArenaPurchaseRow[] = []
	for (const view of views) {
		const row = arenaPurchaseRowFor(view, buyerPubkey)
		if (row !== null) rows.push(row)
	}
	return rows.sort((a, b) => a.d.localeCompare(b.d))
}
