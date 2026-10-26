import { getAppRelaySet, getBugRelay, getMainRelay, ndkActions } from '@/lib/stores/ndk'
import { NDKRelaySet, type NDKEvent, type NDKFilter } from '@/lib/nostr/ndk-events'
import { createMemoryEventStore, type EventReadContext, type EventStorePort } from '@sdk/core/event-store'

// The browser host is one market instance, so module scope is the instance boundary for its store.
const ndkEventStore = createMemoryEventStore<NDKEvent>()

export function getNdkEventStore(): EventStorePort<NDKEvent> {
	return ndkEventStore
}

/** Platform adapter: SDK read workflows fetch through the host's NDK relay policy and merge into the shared store. */
export function createNdkReadContext(timeoutMs = 8000): EventReadContext<NDKEvent> {
	return {
		store: ndkEventStore,
		fetch: async (filters) => {
			const ndkFilters = filters as NDKFilter[]
			return Array.from(await ndkActions.fetchEventsWithTimeout(ndkFilters.length === 1 ? ndkFilters[0] : ndkFilters, { timeoutMs }))
		},
	}
}

/**
 * The app's main relay URL, or undefined while the host config is still loading. Lives here (the
 * file that already owns the `@/lib/stores/ndk` edge) so the config bindings can pin their live
 * subscriptions without importing `src/` themselves.
 */
export function getAppRelayUrl(): string | undefined {
	return getMainRelay()
}

/**
 * Platform adapter for app-settings reads (blacklist, NIP-05/vanity registries, test labels):
 * fetches are pinned to the instance's main relay (`getAppRelaySet`), so a stale copy on a
 * user-added relay cannot race the canonical answer. When the relay client is not ready the fetch
 * answers empty rather than reaching the network, mirroring the pre-drain readers.
 */
export function createAppRelayReadContext(timeoutMs = 8000): EventReadContext<NDKEvent> {
	return {
		store: ndkEventStore,
		fetch: async (filters) => {
			const ndk = ndkActions.getNDK()
			if (!ndk) return []

			const relaySet = getAppRelaySet()
			const ndkFilters = filters as NDKFilter[]
			return Array.from(
				await ndkActions.fetchEventsWithTimeout(ndkFilters.length === 1 ? ndkFilters[0] : ndkFilters, {
					timeoutMs,
					relaySet,
				}),
			)
		},
	}
}

/**
 * Platform adapter for the bug-report read: fetches are pinned to the instance's bug relay
 * (ADR-018 `bugRelay`, falling back to the main relay), so report history stays off the general
 * relay set. The SDK read model is `readBugReportsWorkflow`; this factory only owns the host's
 * relay policy, and the read deliberately does not merge into the shared store (so its kind-1
 * reports never reach the general kind-1 reads).
 */
export function createBugRelayReadContext(timeoutMs = 8000): EventReadContext<NDKEvent> {
	return {
		store: ndkEventStore,
		fetch: async (filters) => {
			const ndk = ndkActions.getNDK()
			if (!ndk) throw new Error('NDK not initialized')
			const relayUrl = getBugRelay()
			if (!relayUrl) throw new Error('App relay not configured')

			const relaySet = NDKRelaySet.fromRelayUrls([relayUrl], ndk)
			const ndkFilters = filters as NDKFilter[]
			return Array.from(
				await ndkActions.fetchEventsWithTimeout(ndkFilters.length === 1 ? ndkFilters[0] : ndkFilters, {
					timeoutMs,
					relaySet,
					subId: 'bug-reports',
				}),
			)
		},
	}
}
