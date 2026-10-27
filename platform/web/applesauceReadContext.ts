import { applesauceIo, type NostrFilter } from '@/lib/nostr/io'
import {
	fetchNdkEventSet,
	mergeNdkEventSetsById,
	rehydrateVerifiedNdkEvent,
	type NDKEvent,
	type NDKFilter,
	type NDKSigner,
} from '@/lib/nostr/ndk-events'
import type { NostrEventLike } from '@sdk/core'
import { createMemoryEventStore, type EventReadContext, type EventStorePort } from '@sdk/core/event-store'

/**
 * Re-exported so Platform bindings (the order reads) can consume the NDK event
 * helpers without adding a new `platform -> src` edge: this file already owns
 * the `@/lib/nostr/io` edge.
 */
export { applesauceIo, fetchNdkEventSet, mergeNdkEventSetsById, rehydrateVerifiedNdkEvent }
export type { NDKEvent, NDKFilter, NDKSigner, NostrFilter }

/**
 * Re-exported so the auction read binding can keep the live-subscription hook
 * without adding a new `platform -> src` edge: this file already owns the
 * applesauce seam the hook subscribes through (D1 slice 8).
 */
export { useSubscriptionEvents } from '@/lib/nostr/useSubscriptionEvents'

// Raw-event reads (the applesauce seam used by auctions) get their own store; NDKEvent reads use ndkReadContext.
const rawEventStore = createMemoryEventStore<NostrEventLike>()

export function getRawEventStore(): EventStorePort<NostrEventLike> {
	return rawEventStore
}

export function createApplesauceReadContext(): EventReadContext<NostrEventLike> {
	return {
		store: rawEventStore,
		fetch: (filters) => applesauceIo.fetchEvents(filters.length === 1 ? (filters[0] as NostrFilter) : (filters as NostrFilter[])),
	}
}
