/**
 * `arenaWinCheck.ts` — the arena win check's decision, lifted out of the monitor
 * hook so it is testable without a relay or React.
 *
 * The hook (`useAuctionWinMonitor.ts`) owns the transport: it discovers the
 * user's own bids, reads each watched lot with the arena read, and hands the
 * reads here. This module decides what to do with them — queue a win for a
 * proven verdict, drop a stale one, and never confuse a failed read with a loss.
 *
 * Pure: no React, no NDK, no relay. Every side effect is an injected port.
 */

import type { ArenaAuctionView } from '@platform/web/auctions/relay/arenaAuctionRead'
import { arenaWinFactFor, type ArenaWinFact } from '@platform/web/auctions/relay/arenaWinRead'
import type { AuctionWonPayload } from '@platform/web/notifications'

/** One lot the user bid on: enough to read it and to address its page. */
export interface WatchableLot {
	/** `1440:<seller>:<d>`. */
	coordinate: string
	/** The lot's seller pubkey. */
	seller: string
	/** The lot's `d` tag. */
	d: string
	/** The lot's root 1440 event id — the identity the queue de-duplicates on. */
	rootEventId: string
}

/** The I/O the win check runs against, injected so the decision is testable without a relay. */
export interface AuctionWinWatchPorts {
	/** Discover the lots `pubkey` has bid on. */
	discoverBidLots(pubkey: string): Promise<WatchableLot[]>
	/** Read one lot's canonical arena view, or `null` when the read delivered no lot. */
	readAuctionLot(lot: WatchableLot): Promise<ArenaAuctionView | null>
	/** Queue a win (the queue de-duplicates by notification id). */
	enqueueWin(payload: AuctionWonPayload): void
	/** Drop any queued win for this auction root. */
	removeWinForAuction(auctionRootEventId: string): void
}

/** The winning fact as the notification payload the modal renders. */
export function auctionWinPayloadFor(fact: ArenaWinFact, bidderPubkey: string): AuctionWonPayload {
	return {
		bidderPubkey,
		auctionRootEventId: fact.rootEventId,
		bidEventId: fact.bidEventId,
		bidAmount: fact.bidAmount,
		lotD: fact.d,
		lotSeller: fact.seller,
	}
}

/**
 * One pass of the win check.
 *
 * For every lot the user bid on: read it, and
 *  - a winner verdict for the user's own bid → queue the win (and remember the
 *    root as announced);
 *  - a delivered read that does **not** name the user the winner → drop a win
 *    previously queued for that root;
 *  - a read that delivered **no** lot (`null`) → do nothing. A failed read is not
 *    evidence of anything, and must never dismiss a win that really was queued.
 *
 * `announced` is the caller's cross-poll memory of the roots a win was queued for.
 */
export async function checkAuctionWins(
	pubkey: string,
	ports: AuctionWinWatchPorts,
	announced: Set<string>,
): Promise<void> {
	const lots = await ports.discoverBidLots(pubkey)
	for (const lot of lots) {
		const view = await ports.readAuctionLot(lot)
		if (view === null) continue

		const fact = arenaWinFactFor(view, pubkey)
		if (fact === null) {
			if (announced.delete(lot.rootEventId)) ports.removeWinForAuction(lot.rootEventId)
			continue
		}

		announced.add(fact.rootEventId)
		ports.enqueueWin(auctionWinPayloadFor(fact, pubkey))
	}
}
