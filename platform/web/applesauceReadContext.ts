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
import { applesauceIo, createRelayStream, type NostrFilter } from '@platform/web/applesauceIo'
import {
	fetchNdkEventSet,
	mergeNdkEventSetsById,
	rehydrateVerifiedNdkEvent,
	type NDKEvent,
	type NDKFilter,
	type NDKSigner,
} from '@platform/web/ndk/ndkEvents'
import type { NostrEventLike } from '@sdk/core'
import { createIndexedDbEventDatabase } from '@platform/web/indexedDbEventDatabase'
import {
	createApplesauceEventStore,
	createEventReadContext,
	createStoreStream,
	type EventReadContext,
	type EventStorePort,
} from '@sdk/core/event-store'

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
// Backed by the applesauce `EventStorePort` adapter; the browser host injects the IndexedDB database (contract
// rev 2.21 decision 3) and a local-first miss-fetch loader (non-browser falls back to the in-memory default).
const rawEventStore = createApplesauceEventStore<NostrEventLike>({
	database: createIndexedDbEventDatabase(),
	eventLoader: async (pointer) => {
		const filters: NostrFilter[] =
			'id' in pointer
				? [{ ids: [pointer.id] }]
				: [{ kinds: [pointer.kind], authors: [pointer.pubkey], ...(pointer.d ? { '#d': [pointer.d] } : {}) }]
		const events = await applesauceIo.fetchEvents(filters)
		return (events[0] as unknown as NostrEventLike) ?? undefined
	},
})

export function getRawEventStore(): EventStorePort<NostrEventLike> {
	return rawEventStore
}

export function createApplesauceReadContext(): EventReadContext<NostrEventLike> {
	return createEventReadContext({
		store: rawEventStore,
		// Bounded reads (the derived `fetch`) use the bounded relay request; live reads hold a subscription.
		stream: createStoreStream({
			store: rawEventStore,
			source: (filters, options) => {
				if (options?.bounded) {
					return (async function* () {
						for (const event of await applesauceIo.fetchEvents(filters as NostrFilter[])) yield { type: 'event' as const, event }
						yield { type: 'caught-up' as const, info: { eose: [], pending: [], complete: true } }
					})()
				}
				return createRelayStream(filters as NostrFilter[], { signal: options?.signal })
			},
		}),
	})
}
