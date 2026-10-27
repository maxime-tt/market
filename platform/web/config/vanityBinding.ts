/**
 * platform/web/config/vanityBinding.ts — the React binding: bridge the SDK vanity state into the house
 * reactivity (`@tanstack/react-store`) so components read it reactively.
 *
 * Owner ruling (2026-10-25): nostr-derived state should be REACTIVE. The SDK vanity store
 * (`@sdk/config/vanity`, built on `sdk/core/state`) hands a fresh value to a plain `subscribe` listener and
 * returns a plain unsubscribe; `@tanstack/react-store`'s `useStore` wants a source with a stable `state` and a
 * `subscribe`. A `Store` bridges the two, exactly as `platform/web/config/blacklistBinding.ts` does for the
 * blacklist: it holds the latest state, the SDK store pushes each change into it, and `useStore` re-renders on
 * change.
 *
 * A `Store` (rather than handing `useStore` the SDK store directly) is deliberate: `get()` returns the current
 * reference, so a source whose `state` is `get()` would be re-read on every render; the `Store`'s state only
 * changes when the SDK store emits.
 *
 * This is the real reactive surface. No consumer is rewired onto it in this increment — the route still reads
 * the temporary `vanityStore` adapter in `src/lib/stores/vanity.ts` — so consumers migrate to `useVanityState`
 * lazily.
 */
import { Store, useStore } from '@tanstack/react-store'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { createNdkReadContext } from '@platform/web/readContext'
import { getAppNdk, type NDKEvent } from '@platform/web/ndkPublishContext'
import { vanityState } from '@sdk/config/vanity'
import type { VanityState } from '@sdk/config/vanity'
import {
	buildVanityRegistryFilter,
	getExpiredVanityForPubkey,
	getVanityForPubkey,
	isVanityAvailable,
	readVanitySettingsWorkflow,
	resolveVanity,
	type VanitySettings as SdkVanitySettings,
} from '@sdk/commerce/curation'
import { configKeys } from '@sdk/core/query/queryKeyFactory'

/** A live, reactive view of the vanity state. */
export interface VanityBinding {
	/** The reactive store a hook reads; its state is the latest vanity state. */
	readonly store: Store<VanityState>
	/** The latest state, without subscribing. */
	snapshot(): VanityState
	/** Stop mirroring the SDK store into the reactive store. */
	dispose(): void
}

/**
 * Mirror the SDK vanity state into a reactive store. The store starts at the current state and is updated on
 * every change; `dispose` unhooks the mirror. Exposed so a test (or a future per-scope instance) can build its
 * own; the app uses the module-level singleton below.
 */
export function createVanityBinding(state = vanityState): VanityBinding {
	const store = new Store<VanityState>(state.get())
	const unsubscribe = state.subscribe((next) => store.setState(() => next))
	return {
		store,
		snapshot: () => store.state,
		dispose: unsubscribe,
	}
}

/** The app's binding over the singleton vanity state. */
export const vanityBinding: VanityBinding = createVanityBinding()

/** Read the vanity state reactively. The hook a rewired component uses. */
export function useVanityState(): VanityState {
	return useStore(vanityBinding.store)
}

// --- the vanity relay read (store drain D1, slice 2) ---------------------------------------------
//
// Separate concern from the state bridge above: `useVanitySettings` reads the app's kind-30000
// `d=vanity-urls` registry from the relays. The read logic is framework-free
// (`readVanitySettingsWorkflow`, `sdk/commerce/curation`); this binding owns the react-query hook,
// the live invalidation subscription, and resolves the port from
// `platform/web/readContext.ts`, so no part of the read imports `@/lib/stores/ndk`. The query
// key is literal-identical to the pre-drain value.

export { getExpiredVanityForPubkey, getVanityForPubkey, isVanityAvailable, resolveVanity }
export type { VanityEntry } from '@sdk/commerce/curation'

export type VanitySettings = SdkVanitySettings<NDKEvent>

/**
 * Fetches vanity registry (kind 30000 with d=vanity-urls) for the app
 */
export const fetchVanitySettings = async (appPubkey?: string): Promise<VanitySettings | null> =>
	readVanitySettingsWorkflow(createNdkReadContext(), appPubkey)

/**
 * Hook to fetch vanity settings for the app
 */
export const useVanitySettings = (appPubkey?: string) => {
	const queryClient = useQueryClient()
	const ndk = getAppNdk()

	// Set up a live subscription to monitor vanity changes
	useEffect(() => {
		if (!appPubkey || !ndk) return

		const vanityFilter = buildVanityRegistryFilter(appPubkey)

		const subscription = ndk.subscribe(vanityFilter, {
			closeOnEose: false,
		})

		// Event handler for vanity updates
		subscription.on('event', () => {
			queryClient.invalidateQueries({ queryKey: configKeys.vanity(appPubkey) })
		})

		// Clean up subscription when unmounting
		return () => {
			subscription.stop()
		}
	}, [appPubkey, ndk, queryClient])

	return useQuery({
		queryKey: configKeys.vanity(appPubkey || ''),
		queryFn: () => fetchVanitySettings(appPubkey),
		enabled: !!appPubkey,
		staleTime: 30000,
		refetchOnMount: true,
		refetchOnWindowFocus: true,
		refetchOnReconnect: true,
	})
}
