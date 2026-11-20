/**
 * `arenaWinRead.ts` — the winner fact the arena read carries, as one pure
 * selector: one lot's canonical view → "this bidder won it", or nothing.
 *
 * This is the **source of truth** the global "you won" notification watches
 * (`useAuctionWinMonitor`). It is not the retired 30408 pipeline: a winner is a
 * kind-1445 verdict with `outcome: 'winner'` whose `bidId` names the winning
 * **bid event**, and the winning bidder is that event's author — the read's own
 * projection (`arenaAuctionRead.ts`), never a re-derived tally.
 *
 * The rule mirrors `arenaPurchases.ts`'s `winningVerdictFor`: the verdict is the
 * authority, and only the **latest** verdict counts. An older `winner` beneath a
 * newer contradicting row is a disagreement the read refuses to resolve, so it
 * is not a win to announce. A read that has not delivered a verdict carries no
 * `verdicts`, so nothing fires — an unread lot is never upgraded to a win.
 *
 * Pure: no React, no relay. It reads the already-projected view.
 */

import type { ArenaAuctionView } from '@platform/web/auctions/relay/arenaAuctionRead'

/** The lot's own identity plus the winning bid, as the notification producer needs it. */
export interface ArenaWinFact {
	/** `1440:<seller>:<d>`. */
	coordinate: string
	/** The first 1440 for `(seller, d)` — the id the queue de-duplicates a lot on. */
	rootEventId: string
	/** The winning bid's **event id** (the verdict's `bidId`). */
	bidEventId: string
	/** The winner's derived position (`Σ` their live legs), or `null` when the read could not state it. */
	bidAmount: number | null
	/** The lot's `d` tag, for the lot-page address. */
	d: string
	/** The lot's seller pubkey, for the lot-page address. */
	seller: string
}

/**
 * The win this lot carries for `bidderPubkey`, or `null`.
 *
 * Answers `null` unless the **latest** verdict names `winner` and its `bidId`
 * resolves to a bid authored by `bidderPubkey`. A verdict naming another
 * bidder's bid, a non-winner verdict, an empty verdict list (a read that has not
 * yet delivered a verdict) and a `bidId` the read holds no bid for all answer
 * `null` — the modal fires only on a proven win, never on a read that has not
 * delivered one.
 */
export function arenaWinFactFor(view: ArenaAuctionView, bidderPubkey: string): ArenaWinFact | null {
	if (!bidderPubkey) return null
	// `verdicts` is ordered by anchored height descending, so `[0]` is the
	// authority; an older `winner` beneath a newer contradicting row is a
	// disagreement the read refuses to resolve (the rule `arenaPurchases.ts`
	// applies too).
	const latest = view.verdicts[0]
	if (!latest || latest.outcome !== 'winner' || latest.bidId === null) return null
	const winningBid = view.bids.find((bid) => bid.eventId === latest.bidId)
	if (!winningBid || winningBid.bidder !== bidderPubkey) return null

	return {
		coordinate: view.coordinate,
		rootEventId: view.rootEventId,
		bidEventId: latest.bidId,
		bidAmount: view.positions[bidderPubkey] ?? winningBid.amount,
		d: view.d,
		seller: view.seller,
	}
}
