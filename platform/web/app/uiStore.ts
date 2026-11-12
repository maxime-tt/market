/**
 * platform/web/app/uiStore.ts — the platform home of the temporary `@tanstack/store` `uiStore` adapter.
 *
 * The UI state and actions live in `@sdk/config/ui` (rebuilt on `sdk/core/state`). This adapter IS needed,
 * and it is BIDIRECTIONAL: 12 `platform/web` files and several `src/` components read it with
 * `useStore(uiStore)` and `uiStore.state` (e.g. `platform/web/routes/_dashboard-layout.tsx`,
 * `src/components/DialogRegistry.tsx`), while 5+ consumers WRITE it with `uiStore.setState(...)`
 * (`src/components/DialogRegistry.tsx`, `src/components/SheetRegistry.tsx`,
 * `platform/web/wallet/QRScannerDialog.tsx`, `platform/web/routes/_dashboard-layout/dashboard/account/making-payments.tsx`,
 * `src/lib/stores/product-session.test.ts`). The SDK primitive exposes `get`/`subscribe`, not `state`, so a
 * direct `setState` routes into the SDK store, which then mirrors back — the SDK `uiState` stays the single
 * source of truth for both the tanstack store and `uiActions`.
 *
 * Moved out of `src/lib/stores/ui.ts` in Wave E adapter drain W-E3.5; that file is now the src shim.
 *
 * The adapter is TEMPORARY: it is deleted when the `useStore(uiStore)` consumers are rewired to a reactive
 * binding and the `setState` writers stop writing the tanstack store directly.
 */
export * from '@sdk/config/ui'

import { Store } from '@tanstack/store'
import { uiState } from '@sdk/config/ui'
import type { UIState } from '@sdk/config/ui'

/**
 * The `@tanstack/store` view of the SDK UI state. It starts at the current state and the SDK store pushes every
 * change into it, so `useStore(uiStore)` and `uiStore.state` render the live value.
 */
export const uiStore = new Store<UIState>(uiState.get())

/** The raw prototype updater, captured before the write-through override below installs on the instance. */
const setLocal = uiStore.setState.bind(uiStore)

// SDK -> tanstack: mirror every SDK change into the reactive store.
uiState.subscribe((next) => setLocal(() => next))

/**
 * tanstack -> SDK: a consumer that calls `uiStore.setState` writes through to the single source of truth. The
 * SDK store then mirrors the new value back via the subscription above (or, for a referentially-equal result,
 * is left as-is and the local store is pinned to it explicitly).
 */
uiStore.setState = ((updater: (prev: UIState) => UIState) => {
	const prev = uiState.get()
	const next = updater(prev)
	uiState.set(next)
	if (Object.is(next, prev)) setLocal(() => next)
}) as typeof uiStore.setState
