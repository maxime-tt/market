/**
 * PRIVATE ADAPTER — do not import from a feature binding.
 *
 * This module is the host's raw/applesauce read adapter and owns the `platform -> src` edge to
 * the relay client's NDK event helpers. Feature bindings import `@platform/web/readContext`
 * instead, which re-exports the accessors they need and chooses the adapter by configuration
 * (D1 seam `d1-neutral-seam`). Direction is one-way: `readContext.ts -> this adapter`, never
 * the reverse.
 */
import { useEffect, useState } from 'react'
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
	type EventFilter,
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
 * Live subscription to a Nostr filter over the store stream (contract rev 2.21/2.22).
 *
 * Consumes `createApplesauceReadContext().stream(...)`: already-stored matches replay first, live relay
 * arrivals follow, and the `caught-up` marker flips `isStreaming` off — no grace timeout needed, because the
 * stream now carries a real EOSE boundary. Deduped by id, sorted newest-first.
 *
 * Returns a cleanup-safe unsubscribe on unmount and when `filter`/`enabled` change.
 */
export function useSubscriptionEvents(
	filter: NostrFilter | NostrFilter[] | null,
	enabled: boolean,
): { events: NostrEventLike[]; isStreaming: boolean } {
	const [events, setEvents] = useState<NostrEventLike[]>([])
	const [isStreaming, setIsStreaming] = useState(false)

	// Serialize the filter so we only re-subscribe when it actually changes,
	// not on every render where the caller allocates a fresh array.
	const filterKey = filter ? JSON.stringify(filter) : null

	useEffect(() => {
		if (!enabled || !filter) return

		setEvents([])
		setIsStreaming(true)
		const controller = new AbortController()
		let cancelled = false
		const filters = (Array.isArray(filter) ? filter : [filter]) as unknown as EventFilter[]

		const run = async () => {
			try {
				for await (const item of createApplesauceReadContext().stream(filters, { signal: controller.signal })) {
					if (cancelled) break
					if (item.type === 'caught-up') {
						setIsStreaming(false)
						continue
					}
					setEvents((prev) => {
						if (prev.some((e) => e.id === item.event.id)) return prev
						return [...prev, item.event].sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
					})
				}
			} catch {
				// aborted on unmount / filter change
			}
		}
		void run()

		return () => {
			cancelled = true
			controller.abort()
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
