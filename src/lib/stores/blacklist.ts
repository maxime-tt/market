/**
 * src/lib/stores/blacklist.ts — the shim: `src/`'s view of the SDK blacklist module, plus a temporary adapter.
 *
 * The blacklist state and actions moved to `@sdk/config/blacklist` (rebuilt on `sdk/core/state`). Every
 * existing call site keeps importing `@/lib/stores/blacklist` unchanged:
 *
 *   - `blacklistActions.*` — plain functions. The `export *` below re-exports them from the SDK module.
 *   - `useBlacklist` — the non-reactive accessor; kept here, now reading the SDK state store.
 *   - `blacklistStore` — a `@tanstack/store` `Store`, read by `useStore(blacklistStore)` in
 *     `platform/web/routes/community.index.tsx`. That consumer wants a store-shaped object (`.state`,
 *     `.subscribe`), which the SDK primitive deliberately is not, so this file bridges the two: the
 *     `Store` is kept in step by the SDK store's `subscribe`. This adapter is TEMPORARY and is deleted in
 *     increment E1, when the route is rewired to the real reactive binding
 *     (`platform/web/config/blacklistBinding.ts`, `useBlacklistState`); no consumer is rewired in this
 *     increment.
 *
 * Owner ruling (2026-10-25): nostr-derived state should be REACTIVE. The reactive binding therefore lives in
 * the platform layer next to the state it renders, not in this shim; consumers migrate to it lazily.
 */
export * from '@sdk/config/blacklist'

import { Store } from '@tanstack/store'
import { blacklistActions, blacklistState } from '@sdk/config/blacklist'
import type { BlacklistState } from '@sdk/config/blacklist'

/**
 * TEMPORARY (deleted in increment E1): a `@tanstack/store` view of the SDK blacklist state.
 *
 * `useStore` needs a source with a stable `state` and a `subscribe`; the SDK primitive exposes `get`/
 * `subscribe` instead. A `Store` bridges them: it starts at the current state and the SDK store pushes each
 * change into it. Delete this the moment `community.index.tsx` reads `useBlacklistState` from
 * `@platform/web/config/blacklistBinding`.
 */
export const blacklistStore = new Store<BlacklistState>(blacklistState.get())
blacklistState.subscribe((state) => blacklistStore.setState(() => state))

/**
 * Non-reactive accessor: the current blacklist state merged with the actions. Kept for the call sites that
 * read it imperatively; a component that must re-render on a blacklist change uses the reactive binding in
 * the platform layer instead.
 */
export const useBlacklist = () => {
	return {
		...blacklistState.get(),
		...blacklistActions,
	}
}
