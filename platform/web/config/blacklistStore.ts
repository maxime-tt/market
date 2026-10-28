/**
 * platform/web/config/blacklistStore.ts — the platform home of the temporary blacklist
 * `@tanstack/store` adapter.
 *
 * The blacklist state and actions live in `@sdk/config/blacklist` (rebuilt on `sdk/core/state`). One
 * call site wants a store-shaped object (`.state`, `.subscribe`) rather than the SDK primitive's
 * `get`/`subscribe`, so this file bridges the two with a one-way mirror (`blacklistState.subscribe`).
 * Nothing writes this store directly, so no write-through is needed.
 *
 * The READ path (`useStore(blacklistStore, selector)` in
 * `platform/web/routes/community.index.tsx`) and the non-reactive `useBlacklist()` accessor now
 * resolve here. Moved out of `src/lib/stores/blacklist.ts` in Wave E adapter drain W-E3.2; that file
 * is the src/ shim. The adapter is TEMPORARY: it is deleted when the `useStore` call site is rewired
 * to the reactive binding (`platform/web/config/blacklistBinding.ts`, `useBlacklistState`).
 */
export * from '@sdk/config/blacklist'

import { Store } from '@tanstack/store'
import { blacklistActions, blacklistState } from '@sdk/config/blacklist'
import type { BlacklistState } from '@sdk/config/blacklist'

/**
 * The `@tanstack/store` view of the SDK blacklist state: it starts at the current state and the SDK
 * store pushes every change into it, so `useStore(blacklistStore, selector)` and `blacklistStore.state`
 * render the live value. One-way mirror — no consumer writes it.
 */
export const blacklistStore = new Store<BlacklistState>(blacklistState.get())
blacklistState.subscribe((state) => blacklistStore.setState(() => state))

/**
 * Non-reactive accessor: the current blacklist state merged with the actions. Kept for the call sites
 * that read it imperatively; a component that must re-render on a blacklist change uses the reactive
 * binding in the platform layer instead.
 */
export const useBlacklist = () => {
	return {
		...blacklistState.get(),
		...blacklistActions,
	}
}
