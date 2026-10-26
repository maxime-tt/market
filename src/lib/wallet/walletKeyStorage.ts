/**
 * walletKeyStorage.ts — the app's binding for `WalletKeyStore`'s two ports.
 *
 * `walletKeyStore.ts` keeps the store free of the signer and of storage on purpose; this is
 * where the app says which ones it means. It is a separate file so that importing the store
 * never drags in the auth store: the store's tests need neither.
 *
 * The identity is a **parameter**: the assembly passes a `getPubkey` accessor (the app reads
 * the signer), and the read no longer reaches back into the auth store itself. The value is
 * resolved per call so an account switch is picked up without rebuilding the storage.
 *
 * The save is **fail-closed** (`{ strict: true }` on the existing user-scoped storage, the same
 * option `#1235` introduced for the bidder record). That comment's rule applies here unchanged:
 * strict is for writes whose silent loss is unrecoverable, and this record is the only durable
 * copy of the pair that reconstructs the wallet. A storage failure must therefore surface, not
 * be swallowed into a wallet that appears to have been saved and was not.
 */
import { loadUserData, removeUserData, saveUserData } from './storage'
import type { WalletKeySealer, WalletKeyStorage } from './walletKeyStore'
import { SealedWalletKeyStore, createSignerWalletKeySealer } from './walletKeyStore'
import type { WalletKeySigner } from './walletKeyStore'

/**
 * The user-scoped local storage the rest of the wallet's records already use. The signed-in
 * pubkey is read from `getPubkey` at call time — the assembly supplies it, this module never
 * resolves an identity of its own.
 */
export const createAppWalletKeyStorage = (getPubkey: () => string | null): WalletKeyStorage => ({
	load: (key, fallback) => loadUserData(key, fallback, getPubkey()),
	save: (key, value) => saveUserData(key, value, getPubkey(), { strict: true }),
	remove: (key) => removeUserData(key, getPubkey()),
})

/**
 * The store the app runs: sealed by the current signer, kept in the user's own scoped storage.
 * The signer and the pubkey are read lazily through their accessors because neither is
 * available at module load and both change when the user switches accounts. With no
 * `getPubkey` the storage scopes to no user — the logged-out behaviour.
 */
export const createAppWalletKeyStore = (options?: {
	getSigner?: () => WalletKeySigner | null | undefined
	getPubkey?: () => string | null
	sealer?: WalletKeySealer
	storage?: WalletKeyStorage
}): SealedWalletKeyStore => {
	const sealer = options?.sealer ?? createSignerWalletKeySealer(options?.getSigner ?? (() => null))
	const storage = options?.storage ?? createAppWalletKeyStorage(options?.getPubkey ?? (() => null))
	return new SealedWalletKeyStore({ sealer, storage })
}
