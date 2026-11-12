/**
 * platform/web/config/blacklistBinding.ts — the React binding: bridge the SDK blacklist state into the house
 * reactivity (`@tanstack/react-store`) so components read it reactively.
 *
 * Owner ruling (2026-10-25): nostr-derived state should be REACTIVE. The SDK blacklist store
 * (`@sdk/config/blacklist`, built on `sdk/core/state`) hands a fresh value to a plain `subscribe` listener
 * and returns a plain unsubscribe; `@tanstack/react-store`'s `useStore` wants a source with a stable `state`
 * and a `subscribe`. A `Store` bridges the two, exactly as `platform/web/notifications/binding.ts` does for
 * notifications: it holds the latest state, the SDK store pushes each change into it, and `useStore` re-renders
 * on change.
 *
 * A `Store` (rather than handing `useStore` the SDK store directly) is deliberate: `get()` returns the current
 * reference, so a source whose `state` is `get()` would be re-read on every render; the `Store`'s state only
 * changes when the SDK store emits.
 *
 * This is the real reactive surface. No consumer is rewired onto it in this increment — the route still reads
 * the temporary `blacklistStore` adapter in `src/lib/stores/blacklist.ts` (deleted in increment E1) — so
 * consumers migrate to `useBlacklistState` lazily.
 */
import { Store, useStore } from '@tanstack/react-store'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { createAppRelayReadContext, getAppRelayUrl } from '@platform/web/readContext'
import { getAppNdk } from '@platform/web/ndkPublishContext'
import type { NostrEventLike } from '@sdk/core/nostr/eventLike'
import {
	buildBlacklistFilter,
	getFormattedBlacklist,
	isBlacklisted,
	readBlacklistSettingsWorkflow,
	type BlacklistSettings as SdkBlacklistSettings,
} from '@sdk/commerce/curation'
import { configKeys } from '@sdk/core/query/queryKeyFactory'
import { blacklistState } from '@sdk/config/blacklist'
import type { BlacklistState } from '@sdk/config/blacklist'

/** A live, reactive view of the blacklist state. */
export interface BlacklistBinding {
	/** The reactive store a hook reads; its state is the latest blacklist state. */
	readonly store: Store<BlacklistState>
	/** The latest state, without subscribing. */
	snapshot(): BlacklistState
	/** Stop mirroring the SDK store into the reactive store. */
	dispose(): void
}

/**
 * Mirror the SDK blacklist state into a reactive store. The store starts at the current state and is updated
 * on every change; `dispose` unhooks the mirror. Exposed so a test (or a future per-scope instance) can build
 * its own; the app uses the module-level singleton below.
 */
export function createBlacklistBinding(state = blacklistState): BlacklistBinding {
	const store = new Store<BlacklistState>(state.get())
	const unsubscribe = state.subscribe((next) => store.setState(() => next))
	return {
		store,
		snapshot: () => store.state,
		dispose: unsubscribe,
	}
}

/** The app's binding over the singleton blacklist state. */
export const blacklistBinding: BlacklistBinding = createBlacklistBinding()

/** Read the blacklist state reactively. The hook a rewired component uses. */
export function useBlacklistState(): BlacklistState {
	return useStore(blacklistBinding.store)
}

// --- the blacklist relay read (store drain D1, slice 3) ------------------------------------------
//
// Separate concern from the state bridge above: `useBlacklistSettings` reads the app's kind-10000
// mute list from the relays. The read logic is framework-free (`readBlacklistSettingsWorkflow`,
// `sdk/commerce/curation`); this binding owns the react-query hook, the live invalidation
// subscription, and resolves the port from `platform/web/readContext.ts` (pinned to the app's
// main relay), so no part of the read imports `@/lib/stores/ndk` directly. The query key is
// literal-identical to the pre-drain value and to the writers' invalidation target.

export { getFormattedBlacklist, isBlacklisted }
export type BlacklistSettings = SdkBlacklistSettings<NostrEventLike>

/**
 * Fetches blacklist settings (kind 10000) for the app
 */
export const fetchBlacklistSettings = async (appPubkey?: string): Promise<BlacklistSettings | null> =>
	readBlacklistSettingsWorkflow(createAppRelayReadContext(), appPubkey)

/**
 * Hook to fetch blacklist settings for the app
 */
export const useBlacklistSettings = (appPubkey?: string) => {
	const queryClient = useQueryClient()
	const ndk = getAppNdk()
	const mainRelay = getAppRelayUrl()

	// Set up a live subscription to monitor blacklist changes
	useEffect(() => {
		if (!appPubkey || !ndk || !mainRelay) return

		const blacklistFilter = buildBlacklistFilter(appPubkey)

		let latestEventTime = 0
		let receivedEose = false

		const subscription = ndk.subscribe(blacklistFilter, {
			closeOnEose: false, // Keep subscription open
			relayUrls: [mainRelay],
			exclusiveRelay: true, // Reject stale copies from other relays in the pool
		})

		// Event handler for blacklist updates - only react to newer events after EOSE
		subscription.on('event', (newEvent) => {
			const eventTime = newEvent.created_at ?? 0
			if (receivedEose && eventTime > latestEventTime) {
				queryClient.invalidateQueries({ queryKey: configKeys.blacklist(appPubkey) })
			}
			if (eventTime > latestEventTime) {
				latestEventTime = eventTime
			}
		})

		subscription.on('eose', () => {
			receivedEose = true
		})

		// Clean up subscription when unmounting
		return () => {
			subscription.stop()
		}
	}, [appPubkey, ndk, mainRelay, queryClient])

	return useQuery({
		queryKey: configKeys.blacklist(appPubkey || ''),
		queryFn: () => fetchBlacklistSettings(appPubkey),
		enabled: !!appPubkey,
		staleTime: 30000, // Consider data stale after 30 seconds
		refetchOnMount: true,
		refetchOnWindowFocus: true,
		refetchOnReconnect: true,
	})
}
