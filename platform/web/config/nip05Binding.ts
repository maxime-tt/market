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
import { nip05State } from '@sdk/config/nip05'
import type { Nip05State } from '@sdk/config/nip05'

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
