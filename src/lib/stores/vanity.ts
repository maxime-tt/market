/**
 * src/lib/stores/vanity.ts — the shim: `src/`'s view of the SDK vanity module, plus a temporary adapter.
 *
 * The vanity state and actions moved to `@sdk/config/vanity` (rebuilt on `sdk/core/state`). Every existing
 * call site keeps importing `@/lib/stores/vanity` unchanged:
 *
 *   - `vanityActions.*` and `VanityEntry` — re-exported by the `export *` below from the SDK module.
 *   - `useVanity` — the non-reactive accessor; kept here, now reading the SDK state store.
 *   - `vanityStore` — a `@tanstack/store` `Store`, read by `useStore(vanityStore, selector)` in
 *     `platform/web/routes/$vanityName.tsx:15-16`. That consumer wants a store-shaped object (`.state`,
 *     `.subscribe`), which the SDK primitive deliberately is not, so this file bridges the two: the `Store`
 *     is kept in step by the SDK store's `subscribe`. This adapter is TEMPORARY and is deleted when the route
 *     is rewired to the real reactive binding (`platform/web/config/vanityBinding.ts`, `useVanityState`); no
 *     consumer is rewired in this increment.
 *
 * Owner ruling (2026-10-25): nostr-derived state should be REACTIVE. The reactive binding therefore lives in
 * the platform layer next to the state it renders, not in this shim; consumers migrate to it lazily.
 */
export * from '@sdk/config/vanity'

import { Store } from '@tanstack/store'
import { vanityActions, vanityState } from '@sdk/config/vanity'
import type { VanityState } from '@sdk/config/vanity'

/**
 * TEMPORARY (deleted when the `useStore` call site is rewired): a `@tanstack/store` view of the SDK vanity
 * state.
 *
 * `useStore` needs a source with a stable `state` and a `subscribe`; the SDK primitive exposes `get`/
 * `subscribe` instead. A `Store` bridges them: it starts at the current state and the SDK store pushes each
 * change into it.
 */
export const vanityStore = new Store<VanityState>(vanityState.get())
vanityState.subscribe((state) => vanityStore.setState(() => state))

/**
 * Non-reactive accessor: the current vanity state merged with the actions. Kept for the call sites that read
 * it imperatively; a component that must re-render on a vanity change uses the reactive binding in the
 * platform layer instead.
 */
export const useVanity = () => {
	return {
		...vanityState.get(),
		...vanityActions,
	}
}
