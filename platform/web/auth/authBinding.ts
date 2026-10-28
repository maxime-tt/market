/**
 * platform/web/auth/authBinding.ts — the platform surface over the one auth machine.
 *
 * `src/lib/stores/auth.ts` builds the machine (it is the composition root: it owns the
 * browser storage, the lazily-created signer session and every cross-store port) and
 * registers it here once, at module scope. Hosts read state and call actions through
 * this binding, so no `platform/web/<feature>` host has to import `@/lib/stores/auth`.
 *
 * Reactivity comes from the machine's own `subscribe`/`getState` — this module does not
 * touch `@tanstack/store`. That keeps the binding independent of the legacy store shape
 * (which exists only for the remaining `src/` consumers).
 *
 * No `@/` specifiers by design (D3D4-CONTRACT rev 2.4 §2: M2 is a hard pre-filter).
 */
import { AuthMachineNotRegisteredError, INITIAL_AUTH_STATE } from '@sdk/core/auth'
import type { AuthMachine, AuthState } from '@sdk/core/auth'
import { useSyncExternalStore } from 'react'

/** The one machine, registered by the adapter. Module-level on purpose: there is exactly one identity. */
let machine: AuthMachine | undefined

/** Called once by `src/lib/stores/auth.ts` when it composes the machine. */
export function registerAuthMachine(next: AuthMachine): void {
	machine = next
}

const requireMachine = (): AuthMachine => {
	if (!machine) throw new AuthMachineNotRegisteredError()
	return machine
}

/** Stable `useSyncExternalStore` binding: the machine's own subscription. */
const subscribe = (onStoreChange: () => void): (() => void) => requireMachine().subscribe(() => onStoreChange())

/** The reactive auth state. Hosts use this instead of `useStore(authStore)`. */
export function useAuthState(): AuthState {
	return useSyncExternalStore(
		subscribe,
		() => requireMachine().getState(),
		() => INITIAL_AUTH_STATE,
	)
}

/**
 * The non-hook reads and the action handle, for hosts that do not need reactivity
 * (and for imperative call sites that previously reached for `authActions`).
 */
export const authBinding = {
	getState: (): AuthState => requireMachine().getState(),
	getCurrentPubkey: (): string | null => requireMachine().getCurrentPubkey(),
	getNeedsMigration: (): boolean => requireMachine().getNeedsMigration(),
	getAvailableNostrExtensions: (): string[] => requireMachine().getAvailableNostrExtensions(),
	subscribe: (listener: (state: AuthState) => void): (() => void) => requireMachine().subscribe(listener),
	/** The machine's action surface (`loginWith*`, `logout`, `decryptAndLogin`, `migrateToEncryptedKey`, …). */
	get actions(): AuthMachine {
		return requireMachine()
	},
}
