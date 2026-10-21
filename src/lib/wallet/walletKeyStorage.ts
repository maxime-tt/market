/**
 * walletKeyStorage.ts — the app's binding for `WalletKeyStore`'s two ports.
 *
 * `walletKeyStore.ts` keeps the store free of the signer and of storage on purpose; this is
 * where the app says which ones it means. It is a separate file so that importing the store
 * never drags in the auth store: the store's tests need neither.
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

/** The user-scoped local storage the rest of the wallet's records already use. */
export const createAppWalletKeyStorage = (): WalletKeyStorage => ({
	load: (key, fallback) => loadUserData(key, fallback),
	save: (key, value) => saveUserData(key, value, { strict: true }),
	remove: (key) => removeUserData(key),
})

/**
 * The store the app runs: sealed by the current signer, kept in the user's own scoped storage.
 * The signer is read lazily through `getSigner` because it is not available at module load and
 * changes when the user switches accounts.
 */
export const createAppWalletKeyStore = (options?: {
	getSigner?: () => WalletKeySigner | null | undefined
	sealer?: WalletKeySealer
	storage?: WalletKeyStorage
}): SealedWalletKeyStore => {
	const sealer = options?.sealer ?? createSignerWalletKeySealer(options?.getSigner ?? (() => null))
	const storage = options?.storage ?? createAppWalletKeyStorage()
	return new SealedWalletKeyStore({ sealer, storage })
}
