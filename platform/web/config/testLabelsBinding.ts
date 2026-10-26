/**
 * platform/web/config/testLabelsBinding.ts — the React binding: bridge the SDK test-label state into the
 * house reactivity (`@tanstack/react-store`) so components read it reactively.
 *
 * Owner ruling (2026-10-25): nostr-derived state should be REACTIVE. The SDK test-label store
 * (`@sdk/config/test-labels`, built on `sdk/core/state`) hands a fresh value to a plain `subscribe` listener
 * and returns a plain unsubscribe; `@tanstack/react-store`'s `useStore` wants a source with a stable `state`
 * and a `subscribe`. A `Store` bridges the two, exactly as `platform/web/config/blacklistBinding.ts` does for
 * the blacklist: it holds the latest state, the SDK store pushes each change into it, and `useStore`
 * re-renders on change.
 *
 * A `Store` (rather than handing `useStore` the SDK store directly) is deliberate: `get()` returns the current
 * reference, so a source whose `state` is `get()` would be re-read on every render; the `Store`'s state only
 * changes when the SDK store emits.
 *
 * This is the real reactive surface. No consumer is rewired onto it in this increment — the `useStore` call
 * sites still read the temporary `testLabelStore` adapter in `src/lib/stores/testLabels.ts` — so consumers
 * migrate to `useTestLabelState` lazily.
 */
import { Store, useStore } from '@tanstack/react-store'
import { useQuery, type QueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { createMemoryEventStore, type EventReadContext } from '@sdk/core/event-store'
import type { NDKEvent, NDKFilter } from '@/lib/nostr/ndk-events'
import { configActions } from '@/lib/stores/config'
import { collectTestLabelCoordinates, filterTestLabeledEvents } from '@/lib/utils/testLabelFilters'
import type { NostrEventLike } from '@/lib/nostr/eventLike'
import { testLabelState, type TestLabelInfo } from '@sdk/config/test-labels'
import type { TestLabelState } from '@sdk/config/test-labels'
import {
	fetchTestLabelsWorkflow,
	getLabelTargetCoordinates,
	invalidateTestLabelCache,
	isLabelDeletionForLabel,
	isValidAuthorizedTestLabel,
	reconcileActiveTestLabels,
	resetAuthorizedLabelersCache,
	resolveAuthorizedLabelers,
	setCachedTestLabel,
	type TestLabelReadDeps,
} from '@sdk/config/testLabelRead'
import { testLabelKeys } from '@sdk/core/query/queryKeyFactory'

/** A live, reactive view of the test-label state. */
export interface TestLabelBinding {
	/** The reactive store a hook reads; its state is the latest test-label state. */
	readonly store: Store<TestLabelState>
	/** The latest state, without subscribing. */
	snapshot(): TestLabelState
	/** Stop mirroring the SDK store into the reactive store. */
	dispose(): void
}

/**
 * Mirror the SDK test-label state into a reactive store. The store starts at the current state and is updated
 * on every change; `dispose` unhooks the mirror. Exposed so a test (or a future per-scope instance) can build
 * its own; the app uses the module-level singleton below.
 */
export function createTestLabelBinding(state = testLabelState): TestLabelBinding {
	const store = new Store<TestLabelState>(state.get())
	const unsubscribe = state.subscribe((next) => store.setState(() => next))
	return {
		store,
		snapshot: () => store.state,
		dispose: unsubscribe,
	}
}

/** The app's binding over the singleton test-label state. */
export const testLabelBinding: TestLabelBinding = createTestLabelBinding()

/** Read the test-label state reactively. The hook a rewired component uses. */
export function useTestLabelState(): TestLabelState {
	return useStore(testLabelBinding.store)
}

// --- the test-label relay read (store drain D1, slice 3) -----------------------------------------
//
// Separate concern from the state bridge above: `useTestLabels` reads the active NIP-32 `test`
// labels from the relays and reconciles the SDK store. The read and its module caches are
// framework-free (`sdk/config/testLabelRead.ts`); this binding owns the react-query hooks, the
// authorized-labeler settings loader, and the relay port (a dynamic `@/lib/stores/ndk` import,
// exactly as the pre-drain file did), so no part of the read imports NDK. The query keys are
// literal-identical to the pre-drain values.

export {
	getLabelTargetCoordinates,
	invalidateTestLabelCache,
	isLabelDeletionForLabel,
	isValidAuthorizedTestLabel,
	reconcileActiveTestLabels,
	resetAuthorizedLabelersCache,
	setCachedTestLabel,
}
export type { TestLabelInfo }

/** How long a fetched label result stays fresh (mirrors the SDK module cache TTL). */
const TEST_LABEL_CACHE_TTL_MS = 15_000

/**
 * Read the authorized-labeler set = the app's EDITORS union its ADMINS (ADR-0009).
 *
 * Editors are the day-to-day curation role and admins are curated content authorities, so both may
 * mark / unmark test listings. The settings read is the still-`src`-owned app-settings query, so it
 * stays a dynamic import here (the mock seams in the label/auction tests hook it): the read must not
 * pull `@/queries/app-settings` into the sdk read model.
 *
 * Returns null when neither settings set could be read (relay/config not ready) — callers must treat
 * that as "cannot determine authorization" and fail open (no labels applied, store not marked
 * loaded).
 */
const readAuthorizedLabelers = async (): Promise<string[] | null> => {
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

/** The authorized labelers, through the SDK read model's TTL cache. */
export const getAuthorizedLabelerPubkeys = async (): Promise<string[] | null> => resolveAuthorizedLabelers(readAuthorizedLabelers)

/** The test-label read never consults a store, but `EventReadContext` carries one. */
const testLabelEventStore = createMemoryEventStore<NDKEvent>()

/**
 * Build the relay port for the test-label read, pinned to the app's main relay.
 *
 * `@/lib/stores/ndk` is imported dynamically here, exactly as the pre-drain
 * `src/queries/testLabels.tsx` did: the read must not require the relay store to be loaded (or a
 * test's mock of it to export every symbol) until it actually fetches, and the host's relay policy
 * stays on the host side.
 */
const createTestLabelReadDeps = async (timeoutMs = 8000): Promise<TestLabelReadDeps<NDKEvent>> => {
	const { ndkActions, getAppRelaySet } = await import('@/lib/stores/ndk')

	const context: EventReadContext<NDKEvent> = {
		store: testLabelEventStore,
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

	return { context, readAuthorizedLabelers, isReady: () => !!ndkActions.getNDK() }
}

/**
 * Fetch the active test labels for a set of item coordinates, populating the SDK store and the
 * module cache. A freshly un-labeled item is not kept hidden by a stale cached label.
 *
 * @returns Map of coordinate → label metadata for coordinates with an ACTIVE label
 */
export const fetchTestLabels = async (coordinates: string[]): Promise<Map<string, TestLabelInfo>> =>
	fetchTestLabelsWorkflow(await createTestLabelReadDeps(), coordinates)

/**
 * Fetch labels for all item coordinates in an event list, then filter out test-labeled items. This
 * is the complete per-fetch label check used across the product/auction fetch pipeline.
 *
 * Pipeline position: NDK fetch → filterDeleted* → filterBlacklistedEvents →
 * excludeTestLabeledEvents → (business filters) → return.
 */
export const excludeTestLabeledEvents = async <T extends NostrEventLike>(events: T[]): Promise<T[]> => {
	// Show-test-listings toggle: reveal test-labeled items without filtering.
	if (testLabelState.get().showTestListings) return events

	const coordinates = collectTestLabelCoordinates(events)
	if (coordinates.length === 0) return events

	await fetchTestLabels(coordinates)

	return filterTestLabeledEvents(events)
}

/**
 * Fetch test labels for a batch of coordinates and populate the label store.
 * The query key is the sorted, deduplicated coordinate set so different orderings don't bust the
 * cache.
 */
export const useTestLabels = (coordinates: string[]) => {
	const stableCoordinates = useMemo(() => Array.from(new Set(coordinates.filter(Boolean))).sort(), [coordinates.join(',')])

	return useQuery({
		queryKey: testLabelKeys.forCoordinates(stableCoordinates),
		queryFn: () => fetchTestLabels(stableCoordinates),
		enabled: stableCoordinates.length > 0,
		staleTime: TEST_LABEL_CACHE_TTL_MS,
		gcTime: 60_000,
	})
}

/**
 * Reactive label state for a single coordinate. Fetches the label from the relay on mount
 * (populating the store) and keeps the component in sync with store updates (e.g. optimistic
 * mark/un-mark).
 */
export const useTestLabelForCoordinate = (coordinate: string | undefined) => {
	useTestLabels(coordinate ? [coordinate] : [])

	const isLabeled = useStore(testLabelBinding.store, (state) => (coordinate ? state.testLabelCoordinates.has(coordinate) : false))
	const labelEventId = useStore(testLabelBinding.store, (state) => (coordinate ? (state.labelEventIds.get(coordinate) ?? '') : ''))
	const labelerPubkey = useStore(testLabelBinding.store, (state) => (coordinate ? (state.labelerPubkeys.get(coordinate) ?? '') : ''))

	return { isLabeled, labelEventId, labelerPubkey }
}

/**
 * Invalidate the React Query test-label cache after a label or deletion was published. Deliberately
 * leaves the module-level cache populated by {@link setCachedTestLabel} intact: it holds the
 * optimistic entry through relay propagation, and dropping it would let a refetch revert the
 * optimistic update. The module cache is discarded only on publish failure (see `testLabelActions`).
 *
 * The optional `coordinate` argument is now unused — it is retained rather than removed from the
 * helper signature in this fix.
 */
export const invalidateTestLabelCaches = async (queryClient: QueryClient, coordinate?: string) => {
	void coordinate
	await queryClient.invalidateQueries({ queryKey: testLabelKeys.all })
}
