import type { KeyValueStoragePort, NostrRelayPort, WalletPort, WalletRecoveryPort } from '@sdk/core'
import { getNostrIo } from '@/lib/nostr/io'
import type { NostrIo, NostrFilter as AppNostrFilter, NostrEvent as RawNostrEvent } from '@/lib/nostr/io'
import { loadUserData, removeUserData, saveUserData } from '@/lib/wallet/storage'
import { cashuActions, cashuStore } from '@/lib/stores/cashu'

type UserStorageBindings = {
	load<T>(key: string, fallback: T): T
	save<T>(key: string, value: T, options?: { strict?: boolean }): void
	remove(key: string): void
}

const defaultUserStorageBindings: UserStorageBindings = {
	load: loadUserData,
	save: saveUserData,
	remove: removeUserData,
}

/** Adapt the app Nostr I/O seam to SDK relay operations with explicit targets. */
export function createNostrRelayPort(
	io: Pick<NostrIo, 'fetchEvents' | 'subscribe' | 'publish'> = getNostrIo(),
): NostrRelayPort<RawNostrEvent> {
	return {
		fetchEvents: (filters, relayUrls) =>
			io.fetchEvents(filters as unknown as AppNostrFilter | AppNostrFilter[], { relayUrls: [...relayUrls] }),
		subscribe: (filters, onEvent, relayUrls) =>
			io.subscribe(filters as unknown as AppNostrFilter | AppNostrFilter[], onEvent, { relayUrls: [...relayUrls] }),
		publish: async (event, relayUrls) => {
			const result = await io.publish(event, { relayUrls: [...relayUrls] })
			return { acceptedRelays: [...result.publishedRelays] }
		},
	}
}

/**
 * Adapt user-scoped app storage to the SDK string port. Values are namespaced
 * and wrapped so SDK keys cannot collide with existing application records.
 */
export function createUserScopedKeyValueStoragePort(bindings: UserStorageBindings = defaultUserStorageBindings): KeyValueStoragePort {
	const scopedKey = (key: string) => `sdk_core_v1_${key}`
	const missing = {}

	return {
		get: async (key) => {
			const stored = bindings.load<unknown>(scopedKey(key), missing)
			if (stored === missing) return null
			if (!isRecord(stored) || stored.schemaVersion !== 'sdk-storage-v1' || typeof stored.value !== 'string') {
				throw new Error(`Stored SDK value for ${key} is malformed`)
			}
			return stored.value
		},
		set: async (key, value) => {
			bindings.save(scopedKey(key), { schemaVersion: 'sdk-storage-v1', value }, { strict: true })
		},
		remove: async (key) => {
			bindings.remove(scopedKey(key))
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
