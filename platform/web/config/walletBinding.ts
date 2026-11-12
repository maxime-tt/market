/**
 * platform/web/config/walletBinding.ts — the React binding: bridge the SDK wallet state into the house
 * reactivity (`@tanstack/react-store`) so components read it reactively.
 *
 * Owner ruling (2026-10-25): nostr-derived state should be REACTIVE. The wallet state IS nostr-derived — the
 * wallet list is populated from a relay query (`walletActions.setNostrWallets`, fed by
 * `fetchUserNwcWallets(ndk, pubkey)` in `src/lib/stores/ndk.ts`) — so it gets this binding. The SDK wallet
 * store (`@sdk/commerce/payments/state/wallet`, built on `sdk/core/state`) hands a fresh value to a plain `subscribe`
 * listener and returns a plain unsubscribe; `@tanstack/react-store`'s `useStore` wants a source with a
 * stable `state` and a `subscribe`. A `Store` bridges the two, exactly as
 * `platform/web/config/blacklistBinding.ts` does for the blacklist: it holds the latest state, the SDK store
 * pushes each change into it, and `useStore` re-renders on change.
 *
 * A `Store` (rather than handing `useStore` the SDK store directly) is deliberate: `get()` returns the
 * current reference, so a source whose `state` is `get()` would be re-read on every render; the `Store`'s
 * state only changes when the SDK store emits.
 *
 * This is the real reactive surface. No consumer is rewired onto it in this increment — the three
 * `useWallets` call sites still read the temporary hook/adapter in `src/lib/stores/wallet.ts` — so
 * consumers migrate to `useWalletState` lazily.
 */
import { Store, useStore } from '@tanstack/react-store'
import { walletState } from '@sdk/commerce/payments/state/wallet'
import type { WalletState } from '@sdk/commerce/payments/state/wallet'

/** A live, reactive view of the wallet state. */
export interface WalletBinding {
	/** The reactive store a hook reads; its state is the latest wallet state. */
	readonly store: Store<WalletState>
	/** The latest state, without subscribing. */
	snapshot(): WalletState
	/** Stop mirroring the SDK store into the reactive store. */
	dispose(): void
}

/**
 * Mirror the SDK wallet state into a reactive store. The store starts at the current state and is updated on
 * every change; `dispose` unhooks the mirror. Exposed so a test (or a future per-scope instance) can build
 * its own; the app uses the module-level singleton below.
 */
export function createWalletBinding(state = walletState): WalletBinding {
	const store = new Store<WalletState>(state.get())
	const unsubscribe = state.subscribe((next) => store.setState(() => next))
	return {
		store,
		snapshot: () => store.state,
		dispose: unsubscribe,
	}
}

/** The app's binding over the singleton wallet state. */
export const walletBinding: WalletBinding = createWalletBinding()

/** Read the wallet state reactively. The hook a rewired component uses. */
export function useWalletState(): WalletState {
	return useStore(walletBinding.store)
}
