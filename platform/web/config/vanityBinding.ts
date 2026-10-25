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
import { vanityState } from '@sdk/config/vanity'
import type { VanityState } from '@sdk/config/vanity'

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
