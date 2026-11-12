/**
 * platform/web/config/appConfigBinding.ts — the React binding: bridge the SDK app-config state into the house
 * reactivity (`@tanstack/react-store`) so components read it reactively.
 *
 * Owner ruling (2026-10-25): nostr-derived state should be REACTIVE. The resolved public app-config is the
 * instance's nostr-published app-settings (kind 31990) resolved server-side and fetched from `/api/config`, so
 * it is nostr-derived and gets a binding. The SDK store (`@sdk/config/app-config`, built on `sdk/core/state`)
 * hands a fresh value to a plain `subscribe` listener and returns a plain unsubscribe; `@tanstack/react-store`'s
 * `useStore` wants a source with a stable `state` and a `subscribe`. A `Store` bridges the two, exactly as
 * `platform/web/config/blacklistBinding.ts` does for the blacklist and `platform/web/notifications/binding.ts`
 * does for notifications: it holds the latest state, the SDK store pushes each change into it, and `useStore`
 * re-renders on change.
 *
 * A `Store` (rather than handing `useStore` the SDK store directly) is deliberate: `get()` returns the current
 * reference, so a source whose `state` is `get()` would be re-read on every render; the `Store`'s state only
 * changes when the SDK store emits.
 *
 * This is the real reactive surface. No consumer is rewired onto it in this increment — the existing callers
 * still read the temporary `configStore` adapter in `src/lib/stores/config.ts` (deleted when those consumers are
 * rewired) — so consumers migrate to `useAppConfigState` lazily.
 */
import { Store, useStore } from '@tanstack/react-store'
import { configStore as configState } from '@sdk/config/app-config'
import type { ConfigState } from '@sdk/config/app-config'

/** A live, reactive view of the app-config state. */
export interface AppConfigBinding {
	/** The reactive store a hook reads; its state is the latest app-config state. */
	readonly store: Store<ConfigState>
	/** The latest state, without subscribing. */
	snapshot(): ConfigState
	/** Stop mirroring the SDK store into the reactive store. */
	dispose(): void
}

/**
 * Mirror the SDK app-config state into a reactive store. The store starts at the current state and is updated
 * on every change; `dispose` unhooks the mirror. Exposed so a test (or a future per-scope instance) can build
 * its own; the app uses the module-level singleton below.
 */
export function createAppConfigBinding(state = configState): AppConfigBinding {
	const store = new Store<ConfigState>(state.get())
	const unsubscribe = state.subscribe((next) => store.setState(() => next))
	return {
		store,
		snapshot: () => store.state,
		dispose: unsubscribe,
	}
}

/** The app's binding over the singleton app-config state. */
export const appConfigBinding: AppConfigBinding = createAppConfigBinding()

/** Read the app-config state reactively. The hook a rewired component uses. */
export function useAppConfigState(): ConfigState {
	return useStore(appConfigBinding.store)
}
