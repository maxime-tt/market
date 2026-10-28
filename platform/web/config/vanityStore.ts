/**
 * platform/web/config/vanityStore.ts — the platform home of the temporary vanity `@tanstack/store`
 * adapter.
 *
 * The vanity state and actions live in `@sdk/config/vanity` (rebuilt on `sdk/core/state`). Two call
 * sites want a store-shaped object (`.state`, `.subscribe`) rather than the SDK primitive's
 * `get`/`subscribe`, so this file bridges the two with a one-way mirror (`vanityState.subscribe`).
 * Nothing writes this store directly, so no write-through is needed.
 *
 * The READ path (`useStore(vanityStore, selector)` in `platform/web/routes/$vanityName.tsx`) and the
 * non-reactive `useVanity()` accessor now resolve here. Moved out of `src/lib/stores/vanity.ts` in
 * Wave E adapter drain W-E3.1; that file is the src/ shim. The adapter is TEMPORARY: it is deleted
 * when the `useStore` call sites are rewired to the reactive binding
 * (`platform/web/config/vanityBinding.ts`, `useVanityState`).
 */
export * from '@sdk/config/vanity'

import { Store } from '@tanstack/store'
import { vanityActions, vanityState } from '@sdk/config/vanity'
import type { VanityState } from '@sdk/config/vanity'

/**
 * The `@tanstack/store` view of the SDK vanity state: it starts at the current state and the SDK store
 * pushes every change into it, so `useStore(vanityStore, selector)` and `vanityStore.state` render the
 * live value. One-way mirror — no consumer writes it.
 */
export const vanityStore = new Store<VanityState>(vanityState.get())
vanityState.subscribe((state) => vanityStore.setState(() => state))

/**
 * Non-reactive accessor: the current vanity state merged with the actions. Kept for the call sites
 * that read it imperatively; a component that must re-render on a vanity change uses the reactive
 * binding in the platform layer instead.
 */
export const useVanity = () => {
	return {
		...vanityState.get(),
		...vanityActions,
	}
}
