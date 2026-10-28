/**
 * platform/web/config/walletStore.ts — the platform home of the temporary bidirectional
 * `@tanstack/store` `walletStore` adapter over `@sdk/config/wallet`, plus the reactive `useWallets`
 * hook.
 *
 * The wallet state and actions live in `@sdk/config/wallet` (rebuilt on `sdk/core/state`). The
 * adapter IS needed, and it IS bidirectional:
 *   - `walletActions.*` — plain functions. The `export *` below re-exports them from the SDK module.
 *   - `Wallet`, `WalletState`, `NwcClient`, `parseNwcUri` — types and a helper; re-exported from the SDK.
 *   - `walletStore` — a `@tanstack/store` `Store`. The `export *` would re-export the SDK's PRIMITIVE
 *     `walletState` (`StateStore<WalletState>`), not a `Store`; the legacy name `walletStore` was a
 *     tanstack `Store`, so this file provides it as the adapter below. An explicit local export takes
 *     precedence over an `export *` of a same-named symbol; here the name differs (`walletStore` vs the
 *     SDK's `walletState`) so there is no shadowing — this file simply adds the legacy `Store` under its
 *     original name.
 *   - `useWallets` — the React hook. It is REACTIVE (`useState` + `subscribe`) and it has three consumers
 *     that render on `wallets`/`isLoading`, so reactivity is preserved. Because `@sdk/config/wallet` is
 *     React-free, the hook lives HERE, reading the SDK store — the same split the blacklist shim uses for
 *     its `useBlacklist`.
 *
 * `src/lib/stores/ndk.ts` (the only external consumer) WRITES the store directly with
 * `walletStore.setState(...)` to toggle `isLoading` (`src/lib/stores/ndk.ts:842`, `:860`, `:896`), and
 * `walletActions.initialize()`/`useWallets` read the `isLoading`/`isInitialized`/`wallets` it sets. A
 * one-way mirror (the blacklist pattern) would drop those writes on the floor, so — like `ui.ts` and
 * `config.ts` — this adapter is bidirectional: a direct `setState` routes into the SDK store, which then
 * mirrors back, keeping the SDK `walletState` the single source of truth for the tanstack store,
 * `walletActions` and `useWallets`.
 *
 * Moved out of `src/lib/stores/wallet.ts` in Wave E adapter drain W-E3.7; that file is now the src shim.
 * The adapter is TEMPORARY: it is deleted when `src/lib/stores/ndk.ts` and the `useWallets` consumers are
 * rewired to the reactive binding (`platform/web/config/walletBinding.ts`, `useWalletState`); consumers
 * migrate lazily. The wallet list is nostr-derived, so per the owner's ruling it gets that binding.
 */
export * from '@sdk/config/wallet'

import { Store } from '@tanstack/store'
import { useEffect, useState } from 'react'
import { walletActions, walletState } from '@sdk/config/wallet'
import type { WalletState } from '@sdk/config/wallet'

/**
 * The `@tanstack/store` view of the SDK wallet state. It starts at the current state and the SDK store
 * pushes every change into it, so `walletStore.state` renders the live value.
 */
export const walletStore = new Store<WalletState>(walletState.get())

/** The raw prototype updater, captured before the write-through override below installs on the instance. */
const setLocal = walletStore.setState.bind(walletStore)

// SDK -> tanstack: mirror every SDK change into the reactive store.
walletState.subscribe((next) => setLocal(() => next))

/**
 * tanstack -> SDK: a consumer that calls `walletStore.setState` writes through to the single source of truth.
 * The SDK store then mirrors the new value back via the subscription above (or, for a referentially-equal
 * result, is left as-is and the local store is pinned to it explicitly).
 */
walletStore.setState = ((updater: (prev: WalletState) => WalletState) => {
	const prev = walletState.get()
	const next = updater(prev)
	walletState.set(next)
	if (Object.is(next, prev)) setLocal(() => next)
}) as typeof walletStore.setState

/**
 * React hook for consuming the wallet store. Reactive: it seeds from the SDK state and re-renders on every
 * change, exactly as the source hook did (which subscribed to the `Store`). Kept here rather than in the SDK
 * so `@sdk/config/wallet` stays React-free.
 */
export const useWallets = () => {
	const [state, setState] = useState(walletState.get())

	useEffect(() => {
		const unsubscribe = walletState.subscribe(() => {
			setState(walletState.get())
		})
		return unsubscribe
	}, [])

	return {
		wallets: state.wallets,
		isLoading: state.isLoading,
		isInitialized: state.isInitialized,
		...walletActions,
	}
}
