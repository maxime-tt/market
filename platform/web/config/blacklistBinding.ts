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
