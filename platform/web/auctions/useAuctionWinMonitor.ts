/**
 * `useAuctionWinMonitor.ts` — the app-wide "you won" monitor.
 *
 * It watches the lots the signed-in user has bid on and, when the **arena** read
 * delivers a winner verdict for one of their own bids, queues the active
 * "you won" notification the globally-mounted `AuctionWonModal` renders. The win
 * is surfaced wherever the user is in the app, not only on the lot's own page.
 *
 * ## Repointed at the arena (retired the 30408 pipeline)
 *
 * The monitor used to read the retired `cashu_p2pk_bidder_path_v1` series —
 * kind-1023 bids and kind-30408 creates/settlements through `auctionsQuery.ts` —
 * so for a 1440-series arena lot it could never fire. It now reads the arena:
 *
 *  - **discovery** — the user's own kind-1441 bids name the lots (`arenaBidBinding`
 *    reads the `a` coordinate and the root `e` id), and are the only lot handles
 *    the watch list needs;
 *  - **verdict** — each watched lot is read with the arena read
 *    (`createWebArenaAuctionRead` + `arenaLotFilters`); the winner is the read's
 *    own projection — a kind-1445 verdict with `outcome: 'winner'` whose `bidId`
 *    resolves to a bid the user authored (`arenaWinRead.ts`). A read that has not
 *    delivered a verdict carries no `verdicts` and fires nothing.
 *
 * There is no winner-side settle action in the arena — the chain settles — so
 * the modal's CTA opens the lot page where the claim/fulfilment flow lives; the
 * monitor never calls `settleAuctionAsWinner` nor reads settlements/path releases.
 *
 * The decision itself lives in `arenaWinCheck.ts` (`checkAuctionWins`), a pure
 * function over injected ports, so it is tested without a relay; this file is
 * only the transport and the queue binding.
 */
import { useEffect, useRef } from 'react'
import { useStore } from '@tanstack/react-store'
import type { EventStorePort } from '@sdk/core'
import type { Event } from '@sdk/core/nostr-io'
import { ARENA_AUCTION_BID_KIND } from '@sdk/commerce/auctions/constants'
import type { NDKFilter } from '@nostr-dev-kit/ndk'
import { authStore } from '@platform/web/auth/authStore'
import { ndkActions } from '@platform/web/ndk/ndkStore'
import { getReadContext } from '@platform/web/readContext'
import { webRelayPolicy } from '@platform/web/sdkNostrIo'
import {
	appNotifications,
	enqueueAuctionWin,
	removeAuctionWinsForAuction,
	retainAuctionWinsForBidder,
} from '@platform/web/notifications'
import { arenaBidBinding } from '@platform/web/notifications/arenaMonitorRules'
import {
	arenaLotFilters,
	arenaLotFollowUpFilters,
	createWebArenaAuctionRead,
	type ArenaAuctionView,
} from '@platform/web/auctions/relay/arenaAuctionRead'
import { collectArenaSurfacesRead } from '@platform/web/auctions/relay/auctionSurfacesRead'
import { resolveArenaLot } from '@platform/web/auctions/relay/arenaLotRead'
import { checkAuctionWins, type AuctionWinWatchPorts, type WatchableLot } from '@platform/web/auctions/relay/arenaWinCheck'

const POLL_INTERVAL_MS = 20_000
const BID_DISCOVERY_LIMIT = 500
const DISCOVERY_TIMEOUT_MS = 8000

/** The arena bid kind as NDK's filter type — a bare number is not assignable to `NDKFilter['kinds']`. */
const AUCTION_BID_KIND_NDK = ARENA_AUCTION_BID_KIND as NonNullable<NDKFilter['kinds']>[number]

/** Read the user's own 1441 bids and reduce them to the lots the watch list reads. */
async function discoverBidLots(pubkey: string): Promise<WatchableLot[]> {
	const events = await ndkActions.fetchEventsWithTimeout(
		{ kinds: [AUCTION_BID_KIND_NDK], authors: [pubkey], limit: BID_DISCOVERY_LIMIT },
		{ timeoutMs: DISCOVERY_TIMEOUT_MS },
	)
	const byCoordinate = new Map<string, WatchableLot>()
	for (const event of events) {
		const binding = arenaBidBinding(event)
		if (!binding?.coordinate || !binding.rootEventId) continue
		if (byCoordinate.has(binding.coordinate)) continue
		byCoordinate.set(binding.coordinate, {
			coordinate: binding.coordinate,
			seller: binding.coordinate.split(':')[1] ?? '',
			// A `d` may itself contain `:`, so the coordinate's tail is rejoined, never sliced to one field.
			d: binding.auctionId || binding.coordinate.split(':').slice(2).join(':'),
			rootEventId: binding.rootEventId,
		})
	}
	return [...byCoordinate.values()]
}

/** Read one lot with the arena read, to its caught-up marker, and resolve it. */
async function readAuctionLot(lot: WatchableLot): Promise<ArenaAuctionView | null> {
	const read = createWebArenaAuctionRead({
		relays: [...webRelayPolicy('query')],
		store: getReadContext().store as unknown as EventStorePort<Event>,
		filters: arenaLotFilters(lot.seller || null, lot.d),
		followUpFilters: arenaLotFollowUpFilters(lot.seller || null, lot.d),
	})
	try {
		const state = await collectArenaSurfacesRead(read)
		if (state.snapshot === null) return null
		const lookup = resolveArenaLot(state.snapshot, lot.d, lot.seller || null)
		return lookup.kind === 'found' ? lookup.view : null
	} finally {
		read.close()
	}
}

/**
 * Globally watches the arena lots the current user has bid on and queues the
 * active "you won" notification once the read delivers a winner verdict for one
 * of their own bids.
 */
export function useAuctionWinMonitor() {
	const { isAuthenticated, user } = useStore(authStore)
	const pubkey = user?.pubkey
	const announcedRoots = useRef<Set<string>>(new Set())
	const isChecking = useRef(false)

	// The queue is per-bidder: keep the signed-in bidder's wins and drop the rest,
	// so switching accounts never leaves another user's win on screen.
	useEffect(() => {
		announcedRoots.current = new Set()
		if (isAuthenticated && pubkey) retainAuctionWinsForBidder(appNotifications, pubkey)
		else appNotifications.queue.clear()
	}, [isAuthenticated, pubkey])

	useEffect(() => {
		if (!isAuthenticated || !pubkey) return

		let cancelled = false

		const runCheck = async () => {
			if (isChecking.current) return
			isChecking.current = true
			try {
				const ports: AuctionWinWatchPorts = {
					discoverBidLots,
					readAuctionLot,
					enqueueWin: (payload) => {
						if (cancelled || !authStore.state.isAuthenticated || authStore.state.user?.pubkey !== pubkey) return
						enqueueAuctionWin(appNotifications, payload, Math.floor(Date.now() / 1000))
					},
					removeWinForAuction: (auctionRootEventId) => removeAuctionWinsForAuction(appNotifications, auctionRootEventId),
				}
				await checkAuctionWins(pubkey, ports, announcedRoots.current)
			} catch (error) {
				console.error('[AuctionWinMonitor] Failed to check for arena wins:', error)
			} finally {
				isChecking.current = false
			}
		}

		void runCheck()
		const interval = setInterval(() => void runCheck(), POLL_INTERVAL_MS)

		return () => {
			cancelled = true
			clearInterval(interval)
		}
	}, [isAuthenticated, pubkey])
}
