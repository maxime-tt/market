/**
 * PRIVATE ADAPTER — do not import from a feature binding.
 *
 * This module is the host's raw/applesauce read adapter and owns the `platform -> src` edge to
 * the relay client's NDK event helpers. Feature bindings import `@platform/web/readContext`
 * instead, which re-exports the accessors they need and chooses the adapter by configuration
 * (D1 seam `d1-neutral-seam`). Direction is one-way: `readContext.ts -> this adapter`, never
 * the reverse.
 */
import { useEffect, useRef, useState } from 'react'
import { applesauceIo, type NostrFilter } from '@platform/web/applesauceIo'
import {
	fetchNdkEventSet,
	mergeNdkEventSetsById,
	rehydrateVerifiedNdkEvent,
	type NDKEvent,
	type NDKFilter,
	type NDKSigner,
} from '@platform/web/ndk/ndkEvents'
import type { NostrEventLike } from '@sdk/core'
import { createApplesauceEventStore, type EventReadContext, type EventStorePort } from '@sdk/core/event-store'

/**
 * Re-exported so Platform bindings (the order reads) can consume the NDK event
 * helpers without adding a new `platform -> src` edge: this file owns the
 * raw/applesauce read surface.
 */
export { applesauceIo, fetchNdkEventSet, mergeNdkEventSetsById, rehydrateVerifiedNdkEvent }
export type { NDKEvent, NDKFilter, NDKSigner, NostrFilter }

/**
 * Live subscription to a Nostr filter via the applesauce I/O adapter.
 *
 * Streams events as they arrive (deduped by id, sorted newest-first) and
 * tracks an `isStreaming` flag that flips off once the subscription has been
 * established for a grace period. The legacy-shaped `NostrIo` port deliberately
 * has no EOSE callback, so the grace timeout is the only signal that
 * "loading" is done.
 *
 * Returns a cleanup-safe unsubscribe on unmount and when `filter`/`enabled`
 * change. Moved verbatim out of the retired
 * `src/lib/nostr/useSubscriptionEvents.ts` (J-0).
 */
export function useSubscriptionEvents(
	filter: NostrFilter | NostrFilter[] | null,
	enabled: boolean,
): { events: NostrEventLike[]; isStreaming: boolean } {
	const [events, setEvents] = useState<NostrEventLike[]>([])
	const [isStreaming, setIsStreaming] = useState(false)
	const seenIds = useRef(new Set<string>())

	// Serialize the filter so we only re-subscribe when it actually changes,
	// not on every render where the caller allocates a fresh array.
	const filterKey = filter ? JSON.stringify(filter) : null

	useEffect(() => {
		if (!enabled || !filter) return

		seenIds.current.clear()
		setEvents([])
		setIsStreaming(true)

		const unsubscribe = applesauceIo.subscribe(filter, (event) => {
			if (seenIds.current.has(event.id)) return
			seenIds.current.add(event.id)
			setEvents((prev) => {
				if (prev.some((e) => e.id === event.id)) return prev
				return [...prev, event].sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
			})
		})

		// Flip the streaming flag off after a grace window so loading states
		// resolve even when the relay never reaches (or reports) EOSE.
		const timer = setTimeout(() => setIsStreaming(false), 10000)

		return () => {
			clearTimeout(timer)
			unsubscribe()
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [enabled, filterKey])

	return { events, isStreaming }
}

// Raw-event reads (the applesauce seam used by auctions) get their own store; NDKEvent reads use ndkReadContext.
// Backed by the applesauce `EventStorePort` adapter (default in-memory `EventMemory` database for now).
const rawEventStore = createApplesauceEventStore<NostrEventLike>()

export function getRawEventStore(): EventStorePort<NostrEventLike> {
	return rawEventStore
}

export function createApplesauceReadContext(): EventReadContext<NostrEventLike> {
	return {
		store: rawEventStore,
		fetch: (filters) => applesauceIo.fetchEvents(filters.length === 1 ? (filters[0] as NostrFilter) : (filters as NostrFilter[])),
	}
}
