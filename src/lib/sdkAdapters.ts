import type { KeyValueStoragePort, WalletPort, WalletRecoveryPort } from '@sdk/core'
import { loadUserData, removeUserData, saveUserData } from '@/lib/wallet/storage'
import { cashuActions, cashuStore } from '@/lib/stores/cashu'

type UserStorageBindings = {
	load<T>(key: string, fallback: T, pubkey: string | null): T
	save<T>(key: string, value: T, pubkey: string | null, options?: { strict?: boolean }): void
	remove(key: string, pubkey: string | null): void
}

const defaultUserStorageBindings: UserStorageBindings = {
	load: loadUserData,
	save: saveUserData,
	remove: removeUserData,
}

/**
 * Adapt user-scoped app storage to the SDK string port. Values are namespaced
 * and wrapped so SDK keys cannot collide with existing application records.
 *
 * The identity is a **parameter**: `getPubkey` is supplied by the assembly (the
 * app reads the signer), and resolved per operation so a switch is picked up
 * without rebuilding the port.
 */
export function createUserScopedKeyValueStoragePort(
	getPubkey: () => string | null,
	bindings: UserStorageBindings = defaultUserStorageBindings,
): KeyValueStoragePort {
	const scopedKey = (key: string) => `sdk_core_v1_${key}`
	const missing = {}

	return {
		get: async (key) => {
			const stored = bindings.load<unknown>(scopedKey(key), missing, getPubkey())
			if (stored === missing) return null
			if (!isRecord(stored) || stored.schemaVersion !== 'sdk-storage-v1' || typeof stored.value !== 'string') {
				throw new Error(`Stored SDK value for ${key} is malformed`)
			}
			return stored.value
		},
		set: async (key, value) => {
			bindings.save(scopedKey(key), { schemaVersion: 'sdk-storage-v1', value }, getPubkey(), { strict: true })
		},
		remove: async (key) => {
			bindings.remove(scopedKey(key), getPubkey())
		},
	}
}

export interface Nip60SdkAccount {
	provider: 'nip60'
}

export interface Nip60WalletAdapterBindings {
	isReady(): boolean
	getMintBalance(mintUrl: string): number
	payLightningInvoice(invoice: string): Promise<{ preimage?: string }>
	receiveEcash(token: string): Promise<boolean>
	reclaimToken(tokenId: string, options?: { manual?: boolean }): Promise<void>
}

export function createNip60WalletPort(
	bindings: Nip60WalletAdapterBindings = {
		isReady: () => cashuStore.state.status === 'ready' && cashuStore.state.manager !== null,
		getMintBalance: (mintUrl) => cashuStore.state.balances[mintUrl] ?? 0,
		payLightningInvoice: async (invoice) => {
			const mintUrl = cashuStore.state.mints[0]
			if (!mintUrl) throw new Error('No mint available to melt invoice')
			await cashuActions.melt(mintUrl, invoice)
			return {}
		},
		receiveEcash: (token) => cashuActions.receive(token),
		reclaimToken: async (tokenId) => {
			await cashuActions.reclaimToken(tokenId)
		},
	},
): WalletPort<
	Nip60SdkAccount,
	string,
	number,
	{ invoice: string },
	{ status: 'wallet_acknowledged'; preimage?: string },
	{ token: string },
	{ status: 'received' | 'not_received' }
> {
	return {
		getAccount: async () => (bindings.isReady() ? { provider: 'nip60' } : null),
		getBalance: async (mintUrl) => bindings.getMintBalance(mintUrl),
		pay: async ({ invoice }) => {
			const result = await bindings.payLightningInvoice(invoice)
			return { status: 'wallet_acknowledged', ...(result.preimage ? { preimage: result.preimage } : {}) }
		},
		receive: async ({ token }) => ({ status: (await bindings.receiveEcash(token)) ? 'received' : 'not_received' }),
	}
}

export function createNip60WalletRecoveryPort(
	bindings: Pick<Nip60WalletAdapterBindings, 'reclaimToken'> = {
		reclaimToken: async (tokenId) => {
			await cashuActions.reclaimToken(tokenId)
		},
	},
): WalletRecoveryPort<{ tokenId: string; manual?: boolean }, void> {
	return {
		reclaim: ({ tokenId, manual }) => bindings.reclaimToken(tokenId, manual ? { manual: true } : undefined),
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}
