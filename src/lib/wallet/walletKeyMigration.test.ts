/**
 * Tests for the one-way key migration.
 *
 * The suite is about the refusal rules, not the happy path: each test that matters pins a way
 * this could have moved someone's HD root.
 */
import { describe, expect, test } from 'bun:test'

import { migrateWalletKeyMaterial } from './walletKeyMigration'
import type { WalletKeyMigrationSource } from './walletKeyMigration'
import { SealedWalletKeyStore } from './walletKeyStore'
import type { WalletKeySealer, WalletKeyStorage } from './walletKeyStore'

const OWNER = 'a'.repeat(64)
const OTHER = 'b'.repeat(64)
/** A real secp256k1 pair: 1 and its compressed public key. */
const P2PK = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'
const PRIVKEY = '0000000000000000000000000000000000000000000000000000000000000001'

const memoryStorage = (): WalletKeyStorage => {
	const map = new Map<string, unknown>()
	return {
		load: <T>(key: string, fallback: T): T => (map.has(key) ? (map.get(key) as T) : fallback),
		save: <T>(key: string, value: T): void => void map.set(key, value),
		remove: (key: string): void => void map.delete(key),
	}
}

const sealer = (): WalletKeySealer => ({
	encrypt: async (_r, plaintext) => `sealed(${plaintext})`,
	decrypt: async (_s, ciphertext) => {
		const match = /^sealed\((.*)\)$/.exec(ciphertext)
		if (!match) throw new Error('unopenable')
		return match[1]
	},
})

const fixture = (pair: { walletP2pk: string; walletPrivkey: string } | null) => {
	let sourceCalls = 0
	const source: WalletKeyMigrationSource = {
		loadWalletPair: async () => {
			sourceCalls += 1
			return pair
		},
	}
	const store = new SealedWalletKeyStore({ sealer: sealer(), storage: memoryStorage() })
	return { source, store, sourceCalls: () => sourceCalls }
}

describe('migrateWalletKeyMaterial', () => {
	test('moves the pair from the relay event into the local store', async () => {
		const { source, store } = fixture({ walletP2pk: P2PK, walletPrivkey: PRIVKEY })

		const result = await migrateWalletKeyMaterial({ store, source, ownerPubkey: OWNER })

		expect(result.outcome).toBe('migrated')
		expect(result.material).toEqual({ ownerPubkey: OWNER, walletP2pk: P2PK, walletPrivkey: PRIVKEY })
		// and it is durable: a fresh read answers the same pair
		const reread = await store.load(OWNER)
		expect(reread).toEqual({ ownerPubkey: OWNER, walletP2pk: P2PK, walletPrivkey: PRIVKEY })
	})

	test('a local copy is final: the source is never consulted once it exists', async () => {
		const { source, store, sourceCalls } = fixture({ walletP2pk: P2PK, walletPrivkey: PRIVKEY })
		await migrateWalletKeyMaterial({ store, source, ownerPubkey: OWNER })

		// a second run, and a source that would now answer something else
		const other = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'
		const second = await migrateWalletKeyMaterial({
			store,
			source: { loadWalletPair: async () => ({ walletP2pk: other, walletPrivkey: '02'.repeat(32) }) },
			ownerPubkey: OWNER,
		})

		expect(second.outcome).toBe('already-local')
		expect(second.material?.walletPrivkey).toBe(PRIVKEY)
		expect(sourceCalls()).toBe(1) // only the first run read the relay
	})

	test('nothing on the relay and nothing local writes nothing', async () => {
		const { source, store } = fixture(null)

		const result = await migrateWalletKeyMaterial({ store, source, ownerPubkey: OWNER })

		expect(result.outcome).toBe('nothing-to-migrate')
		expect(result.material).toBeNull()
		expect(await store.load(OWNER)).toBeNull()
	})

	test('a mismatched pair from the relay is refused before it is saved', async () => {
		// the private half does not produce the stored public half
		const { source, store } = fixture({ walletP2pk: P2PK, walletPrivkey: '02'.repeat(32) })

		let threw = false
		try {
			await migrateWalletKeyMaterial({ store, source, ownerPubkey: OWNER })
		} catch {
			threw = true
		}

		expect(threw).toBe(true)
		// the whole point: a bad pair never reaches the store
		expect(await store.load(OWNER)).toBeNull()
	})

	test('a local record that cannot be opened stops the migration instead of overwriting it', async () => {
		const storage = memoryStorage()
		// a record filed for this owner that the sealer cannot open
		storage.save(`wallet_key_material:${OWNER}`, {
			schemaVersion: 'wallet-key-v1',
			ownerPubkey: OWNER,
			walletP2pk: P2PK,
			sealedPrivkey: 'corrupt',
		})
		const store = new SealedWalletKeyStore({ sealer: sealer(), storage })
		const { source, sourceCalls } = fixture({ walletP2pk: P2PK, walletPrivkey: PRIVKEY })

		const result = await migrateWalletKeyMaterial({ store, source, ownerPubkey: OWNER })

		expect(result.outcome).toBe('local-unreadable')
		expect(result.material).toBeNull()
		expect(sourceCalls()).toBe(0) // and it did not go looking for a replacement
	})

	test('one owner cannot migrate material filed under another', async () => {
		const { source, store } = fixture({ walletP2pk: P2PK, walletPrivkey: PRIVKEY })
		await migrateWalletKeyMaterial({ store, source, ownerPubkey: OTHER })

		const result = await migrateWalletKeyMaterial({ store, source, ownerPubkey: OWNER })
		// OWNER has no local record of its own, so it migrates its own rather than reading OTHER's
		expect(result.outcome).toBe('migrated')
		expect(result.material?.ownerPubkey).toBe(OWNER)
	})
})
