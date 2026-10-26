/**
 * src/lib/stores/cashu.ts — the shim: `src/`'s view of the SDK cashu store, plus a temporary adapter.
 *
 * The wallet state and the `cashuActions` surface moved to `@sdk/config/cashu` (rebuilt on `sdk/core/state`)
 * in increment B4e. This file is also the **assembly** for that module: the SDK cannot read the signed-in
 * identity from `authStore`, so `createCashuStore` takes a `getPubkey` accessor and this file supplies it —
 * resolved **per call** so an account switch is picked up rather than frozen at construction.
 *
 * Every existing call site keeps importing `@/lib/stores/cashu` unchanged:
 *   - `cashuActions` and the pure exports (`CashuState`, `depositStatusForPhase`, the `CashuDeposit*` types,
 *     the deposit fee helpers, `validateAuctionDepositInvoiceQuote`, `waitForDepositConfirmation`,
 *     `CASHU_DEPOSIT_CONFIRMATION_TIMEOUT_MS`, `PendingToken`) — re-exported from the SDK module by the
 *     `export *` below; `cashuActions` is the one `createCashuStore(...)` instance built here.
 *   - `cashuStore` — a `@tanstack/store` `Store`. Nine components read it with `useStore(cashuStore)` and
 *     `src/lib/stores/walletOps.ts` plus the tests write it with `cashuStore.setState(...)`, so this adapter
 *     is BIDIRECTIONAL (the `wallet.ts`/`ui.ts` pattern): the SDK primitive is the single source of truth, a
 *     direct `setState` writes through to it, and the SDK store mirrors every change back into the `Store`.
 *
 * The adapter is TEMPORARY: it is deleted when the `useStore(cashuStore)` consumers are rewired to a reactive
 * binding and `walletOps.ts`/the tests stop writing the tanstack store directly.
 */
export * from '@sdk/config/cashu'

import { Store } from '@tanstack/store'
import { createCashuStore } from '@sdk/config/cashu'
import type { CashuState } from '@sdk/config/cashu'
import { authStore } from './auth'

/** The one wallet store, built by the assembly with the app's auth accessor (read lazily, per call). */
const { cashuState, cashuActions } = createCashuStore(() => authStore.state.user?.pubkey ?? null)

export { cashuActions }

/**
 * The `@tanstack/store` view of the SDK wallet state. It starts at the current state and the SDK store pushes
 * every change into it, so `cashuStore.state` renders the live value.
 */
export const cashuStore = new Store<CashuState>(cashuState.get())

/** The raw prototype updater, captured before the write-through override below installs on the instance. */
const setLocal = cashuStore.setState.bind(cashuStore)

// SDK -> tanstack: mirror every SDK change into the reactive store.
cashuState.subscribe((next) => setLocal(() => next))

/**
 * tanstack -> SDK: a consumer that calls `cashuStore.setState` writes through to the single source of truth.
 * The SDK store then mirrors the new value back via the subscription above (or, for a referentially-equal
 * result, is left as-is and the local store is pinned to it explicitly).
 */
cashuStore.setState = ((updater: (prev: CashuState) => CashuState) => {
	const prev = cashuState.get()
	const next = updater(prev)
	cashuState.set(next)
	if (Object.is(next, prev)) setLocal(() => next)
}) as typeof cashuStore.setState
