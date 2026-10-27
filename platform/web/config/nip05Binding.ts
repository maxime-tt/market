/**
 * platform/web/config/nip05Binding.ts — the React binding: bridge the SDK NIP-05 state into the house
 * reactivity (`@tanstack/react-store`) so components read it reactively.
 *
 * Owner ruling (2026-10-25): nostr-derived state should be REACTIVE. The SDK NIP-05 store
 * (`@sdk/config/nip05`, built on `sdk/core/state`) hands a fresh value to a plain `subscribe` listener and
 * returns a plain unsubscribe; `@tanstack/react-store`'s `useStore` wants a source with a stable `state` and a
 * `subscribe`. A `Store` bridges the two, exactly as `platform/web/config/blacklistBinding.ts` does for the
 * blacklist: it holds the latest state, the SDK store pushes each change into it, and `useStore` re-renders on
 * change.
 *
 * A `Store` (rather than handing `useStore` the SDK store directly) is deliberate: `get()` returns the current
 * reference, so a source whose `state` is `get()` would be re-read on every render; the `Store`'s state only
 * changes when the SDK store emits.
 *
 * This is the real reactive surface. No consumer is rewired onto it in this increment — no consumer reads the
 * NIP-05 state reactively yet; the two call sites import `nip05Actions` only, through the shim
 * `src/lib/stores/nip05.ts` — so consumers migrate to `useNip05State` lazily.
 */
import { Store, useStore } from '@tanstack/react-store'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { createNdkReadContext } from '@platform/web/readContext'
import { getAppNdk, type NDKEvent } from '@platform/web/ndkPublishContext'
import { nip05State } from '@sdk/config/nip05'
import type { Nip05State } from '@sdk/config/nip05'
import {
	buildNip05RegistryFilter,
	getExpiredNip05ForPubkey,
	getNip05ForPubkey,
	isNip05Available,
	readNip05SettingsWorkflow,
	type Nip05Settings as SdkNip05Settings,
} from '@sdk/core/profile'
import { configKeys } from '@sdk/core/query/queryKeyFactory'

/** A live, reactive view of the NIP-05 state. */
export interface Nip05Binding {
	/** The reactive store a hook reads; its state is the latest NIP-05 state. */
	readonly store: Store<Nip05State>
	/** The latest state, without subscribing. */
	snapshot(): Nip05State
	/** Stop mirroring the SDK store into the reactive store. */
	dispose(): void
}

/**
 * Mirror the SDK NIP-05 state into a reactive store. The store starts at the current state and is updated on
 * every change; `dispose` unhooks the mirror. Exposed so a test (or a future per-scope instance) can build its
 * own; the app uses the module-level singleton below.
 */
export function createNip05Binding(state = nip05State): Nip05Binding {
	const store = new Store<Nip05State>(state.get())
	const unsubscribe = state.subscribe((next) => store.setState(() => next))
	return {
		store,
		snapshot: () => store.state,
		dispose: unsubscribe,
	}
}

/** The app's binding over the singleton NIP-05 state. */
export const nip05Binding: Nip05Binding = createNip05Binding()

/** Read the NIP-05 state reactively. The hook a rewired component uses. */
export function useNip05State(): Nip05State {
	return useStore(nip05Binding.store)
}

// --- the NIP-05 relay read (store drain D1, slice 2) ---------------------------------------------
//
// Separate concern from the state bridge above: `useNip05Settings` reads the app's kind-30000
// `d=nip05-names` registry from the relays. The read logic is framework-free
// (`readNip05SettingsWorkflow`, `sdk/core/profile`); this binding owns the react-query hook, the
// live invalidation subscription, and resolves the port from `platform/web/readContext.ts`,
// so no part of the read imports `@/lib/stores/ndk`. The query key is literal-identical to the
// pre-drain value.

export { getExpiredNip05ForPubkey, getNip05ForPubkey, isNip05Available }
export type { Nip05Entry } from '@sdk/core/profile'

export type Nip05Settings = SdkNip05Settings<NDKEvent>

/**
 * Fetches NIP-05 registry (kind 30000 with d=nip05-names) for the app
 */
export const fetchNip05Settings = async (appPubkey?: string): Promise<Nip05Settings | null> =>
	readNip05SettingsWorkflow(createNdkReadContext(), appPubkey)

/**
 * Hook to fetch NIP-05 settings for the app
 */
export const useNip05Settings = (appPubkey?: string) => {
	const queryClient = useQueryClient()
	const ndk = getAppNdk()

	// Set up a live subscription to monitor nip05 changes
	useEffect(() => {
		if (!appPubkey || !ndk) return

		const nip05Filter = buildNip05RegistryFilter(appPubkey)

		const subscription = ndk.subscribe(nip05Filter, {
			closeOnEose: false,
		})

		subscription.on('event', () => {
			queryClient.invalidateQueries({ queryKey: configKeys.nip05(appPubkey) })
		})

		return () => {
			subscription.stop()
		}
	}, [appPubkey, ndk, queryClient])

	return useQuery({
		queryKey: configKeys.nip05(appPubkey || ''),
		queryFn: () => fetchNip05Settings(appPubkey),
		enabled: !!appPubkey,
		staleTime: 30000,
		refetchOnMount: true,
		refetchOnWindowFocus: true,
		refetchOnReconnect: true,
	})
}
