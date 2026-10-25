/**
 * src/lib/stores/ui.ts — the shim: `src/`'s view of the SDK ui module, plus a temporary adapter.
 *
 * The UI state and actions moved to `@sdk/config/ui` (rebuilt on `sdk/core/state`). Every existing call site
 * keeps importing `@/lib/stores/ui` unchanged:
 *
 *   - `uiActions.*` — plain functions. The `export *` below re-exports them from the SDK module.
 *   - `useUI` — the non-reactive accessor; re-exported from the SDK module.
 *   - `uiStore` — a `@tanstack/store` `Store`. This adapter IS needed, and unlike the blacklist shim it is
 *     bidirectional. Two consumers force the legacy shape:
 *       - `useStore(uiStore)` and `uiStore.state` — 15 components read the store reactively
 *         (`platform/web/routes/_dashboard-layout.tsx:68`, `src/components/DialogRegistry.tsx:12`, …) and
 *         `uiStore.state.selectedCurrency` is read imperatively (`src/lib/stores/product.ts:144`,
 *         `platform/.../shipping-options.tsx:96`); the SDK primitive exposes `get`/`subscribe`, not `state`.
 *       - `uiStore.setState(...)` — several consumers WRITE the store directly
 *         (`src/components/DialogRegistry.tsx:34`, `src/components/SheetRegistry.tsx:36`,
 *         `src/components/wallet/QRScannerDialog.tsx:41`, `platform/.../making-payments.tsx:664`,
 *         `src/lib/stores/product-session.test.ts:31`). A one-way mirror (the blacklist pattern) would drop
 *         those writes on the floor, so this adapter routes a direct `setState` into the SDK store, which then
 *         mirrors back — the SDK `uiState` stays the single source of truth for both the tanstack store and
 *         `uiActions`.
 *
 * This adapter is TEMPORARY: it is deleted when these consumers are rewired to a reactive binding. It may
 * become a `platform/web/config/uiBinding.ts` if a cross-tree reactive surface is wanted; today none is, and
 * the owner's ruling is that app state (this is not nostr-derived) does not automatically get one.
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
