/**
 * platform/web/wallet/cashuStore.ts — the platform home of the cashu wallet store adapter.
 *
 * The wallet state and the `cashuActions` surface live in `@sdk/config/cashu` (rebuilt on
 * `sdk/core/state`). This file is also the **assembly** for that module: the SDK cannot read the signed-in
 * identity, so `createCashuStore` takes a `getPubkey` accessor and this file supplies it — resolved **per
 * call** so an account switch is picked up rather than frozen at construction.
 *
 * The `@tanstack/store` `Store` this module exposes is BIDIRECTIONAL: nine components read it with
 * `useStore(cashuStore)` and `walletOps` plus the tests write it with `cashuStore.setState(...)`, so the
 * SDK primitive is the single source of truth, a direct `setState` writes through to it, and the SDK store
 * mirrors every change back into the `Store`.
 *
 * Moved out of `src/lib/stores/cashu.ts` in Wave D walletOps drain S0 (the src/ file was deleted by the
 * E1b mega-deletion, 2026-10-30).
 *
 * The adapter is TEMPORARY: it is deleted when the `useStore(cashuStore)` consumers are rewired to a reactive
 * binding and `walletOps.ts`/the tests stop writing the tanstack store directly.
 */
export * from '@sdk/config/cashu'

import { Store } from '@tanstack/store'
import { createCashuStore } from '@sdk/config/cashu'
import type { CashuState } from '@sdk/config/cashu'
import { authBinding } from '@platform/web/auth/authBinding'

/**
 * The signed-in pubkey, or `null` before the auth machine is composed.
 *
 * The legacy `src/lib/stores/cashu.ts` read `authStore.state.user?.pubkey ?? null`; the platform
 * binding is the machine's own accessor, which throws `AuthMachineNotRegisteredError` before
 * `src/lib/stores/auth.ts` registers the machine. Catching that and returning `null` reproduces the
 * legacy observable value exactly (the accessor is only ever consulted per action/.state read), and
 * keeps a `src/`-free test that imports this module working the way it did.
 */
const currentPubkeyOrNull = (): string | null => {
	try {
		return authBinding.getCurrentPubkey()
	} catch {
		return null
	}
}

/** The one wallet store, built by the assembly with the app's auth accessor (read lazily, per call). */
const { cashuState, cashuActions } = createCashuStore(currentPubkeyOrNull)

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
