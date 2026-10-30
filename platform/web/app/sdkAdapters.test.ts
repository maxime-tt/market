import { describe, expect, test } from 'bun:test'
import type { NostrEvent } from 'nostr-tools/pure'
import { createNip60WalletPort, createNip60WalletRecoveryPort, createUserScopedKeyValueStoragePort } from './sdkAdapters'

describe('SDK host adapters', () => {
	test('user-scoped storage adapter namespaces values and uses strict writes', async () => {
		const values = new Map<string, string>()
		const storage = createUserScopedKeyValueStoragePort(() => 'f'.repeat(64), {
			load: <Value>(key: string, fallback: Value, _pubkey: string | null): Value => {
				const raw = values.get(key)
				return raw === undefined ? fallback : (JSON.parse(raw) as Value)
			},
			save: (key, value, _pubkey, options) => {
				if (options?.strict !== true) throw new Error('SDK storage write must be strict')
				values.set(key, JSON.stringify(value))
			},
			remove: (key, _pubkey) => {
				values.delete(key)
			},
		})

		expect(await storage.get('retry-cache')).toBeNull()
		await storage.set('retry-cache', 'opaque-json')
		expect(await storage.get('retry-cache')).toBe('opaque-json')
		expect([...values.keys()]).toEqual(['sdk_core_v1_retry-cache'])
		await storage.remove('retry-cache')
		expect(await storage.get('retry-cache')).toBeNull()
	})

	test('NIP-60 wallet adapter keeps ACK and receive outcomes explicit', async () => {
		const calls: string[] = []
		const bindings = {
			isReady: () => true,
			getMintBalance: (mintUrl: string) => (mintUrl === 'https://mint.example' ? 120 : 0),
			payLightningInvoice: async (invoice: string) => {
				calls.push(`pay:${invoice}`)
				return { preimage: 'preimage' }
			},
			receiveEcash: async (token: string) => {
				calls.push(`receive:${token}`)
				return true
			},
			reclaimToken: async (tokenId: string, options?: { manual?: boolean }) => {
				calls.push(`reclaim:${tokenId}:${options?.manual === true}`)
			},
		}
		const wallet = createNip60WalletPort(bindings)
		const recovery = createNip60WalletRecoveryPort(bindings)

		expect(await wallet.getAccount()).toEqual({ provider: 'nip60' })
		expect(await wallet.getBalance('https://mint.example')).toBe(120)
		expect(await wallet.pay({ invoice: 'bolt11' })).toEqual({ status: 'wallet_acknowledged', preimage: 'preimage' })
		expect(await wallet.receive({ token: 'cashu-token' })).toEqual({ status: 'received' })
		await recovery.reclaim({ tokenId: 'pending-token', manual: true })
		expect(calls).toEqual(['pay:bolt11', 'receive:cashu-token', 'reclaim:pending-token:true'])
	})
})
