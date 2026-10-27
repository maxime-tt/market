import { getAppRelaySet, getBugRelay, getMainRelay, ndkActions, ndkStore } from '@/lib/stores/ndk'
import { NDKRelaySet, type NDKEvent, type NDKFilter } from '@/lib/nostr/ndk-events'
import { authStore } from '@/lib/stores/auth'
import { configActions } from '@sdk/config/app-config'
import { createMemoryEventStore, type EventReadContext, type EventStorePort } from '@sdk/core/event-store'

/** Re-exported so Platform bindings can type their read context without a `platform -> src` edge. */
export type { NDKEvent, NDKFilter }

/**
 * The private-auction-claim helpers, re-exported so the auction read binding keeps the
 * signer-bound claim lookup without adding a new `platform -> src` edge: this file already owns
 * the `@/lib/stores/ndk` edge the decrypt path reads its active signer from (D1 slice 8).
 */
export {
	decryptPrivateAuctionClaimMessageForActiveSigner,
	getAuctionClaimPublicMarkerFields,
	privateAuctionClaimMatchesPublicMarker,
	type PrivateAuctionClaimMessage,
} from '@/lib/auctions/privateAuctionClaimMessage'

/**
 * Re-exported so Platform bindings (the messaging reads) can read the current
 * user without adding a new `platform -> src` edge: this file already owns the
 * `@/lib/stores/ndk` edge.
 */
export { authStore }

// The browser host is one market instance, so module scope is the instance boundary for its store.
const ndkEventStore = createMemoryEventStore<NDKEvent>()

export function getNdkEventStore(): EventStorePort<NDKEvent> {
	return ndkEventStore
}

/**
 * The app-relay pinning used by the reads of app-owned lists, re-exported so a Platform binding (the
 * featured-list subscription) can pin a live subscription to it without importing `src/` itself. The
 * `@/lib/stores/ndk` edge already lives in this file.
 */
export { getAppRelaySet }

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
 * Add explicit relays through the same action the migration read used before the drain (the store
 * mirror is updated too). Lives here so the migration binding adds no `platform -> src` edge.
 */
export function addAppExplicitRelays(relayUrls: string[]): string[] {
	return ndkActions.addExplicitRelay(relayUrls)
}

/**
 * Whether the host's NDK client is ready. Lives here so the config bindings can gate a read that
 * must fail open before the relay client exists, without importing `src/` themselves.
 */
export function isAppRelayReady(): boolean {
	return !!ndkActions.getNDK()
}

/**
 * Connect the app's relays with a timeout. Lives here so the product/collection bindings can
 * trigger a connection without importing `src/` themselves.
 */
export function connectAppRelays(timeoutMs = 10000): void {
	void ndkActions.connect(timeoutMs)
}

/**
 * The configured explicit relay URLs from the NDK store. Lives here so the NIP-50 discovery
 * binding can read them without importing `src/` themselves.
 */
export function getConfiguredRelayUrls(): string[] {
	return ndkStore.state.explicitRelayUrls
}

/**
 * Fetch an event by its NIP-19 naddr. The raw NDK handle stays here so the binding needs no
 * `src/` edge.
 */
export async function fetchEventByNaddr(naddr: string): Promise<NDKEvent | null> {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')
	return await ndk.fetchEvent(naddr)
}

/**
 * Fetch an event by its event ID. The raw NDK handle stays here so the binding needs no
 * `src/` edge.
 */
export async function fetchEventById(id: string): Promise<NDKEvent | null> {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')
	return await ndk.fetchEvent(id)
}

/**
 * Fetch events by a filter. The raw NDK handle stays here so the binding needs no
 * `src/` edge.
 */
export async function fetchEventsByFilter(filter: NDKFilter): Promise<NDKEvent[]> {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')
	const events = await ndk.fetchEvents(filter)
	return Array.from(events)
}

/**
 * The app's admin ∪ editor pubkeys (ADR-0009) — the authorized test-labeler set, read through the
 * still-`src`-owned app-settings query.
 *
 * Editors are the day-to-day curation role and admins are curated content authorities, so both may
 * mark / unmark test listings. The settings read stays a DYNAMIC import so the framework-free SDK
 * read model never pulls `@/queries/app-settings` in, and so the label/auction suites' mock seam for
 * that path still intercepts.
 *
 * Returns null when neither settings set could be read (relay/config not ready) — callers must treat
 * that as "cannot determine authorization" and fail open (no labels applied, store not marked
 * loaded).
 */
export const readAuthorizedLabelers = async (): Promise<string[] | null> => {
	try {
		const { fetchAdminSettings, fetchEditorSettings } = await import('@/queries/app-settings')
		const appPubkey = configActions.getAppPublicKey()
		const [adminSettings, editorSettings] = await Promise.all([fetchAdminSettings(appPubkey), fetchEditorSettings(appPubkey)])
		// Both reads unavailable → authorization is undeterminable, not empty.
		if (!adminSettings && !editorSettings) return null
		return Array.from(new Set([...(adminSettings?.admins ?? []), ...(editorSettings?.editors ?? [])]))
	} catch (error) {
		console.warn('Failed to fetch authorized labelers (admin/editor settings):', error)
		return null
	}
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
