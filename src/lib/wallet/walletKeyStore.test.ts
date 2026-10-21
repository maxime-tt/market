/**
 * Tests for `SealedWalletKeyStore`.
 *
 * The property that matters most is negative: the private half must not be readable from
 * storage. So the suite asserts what the stored record does NOT contain, and asserts that every
 * way of failing to open a record is a refusal rather than a recovery.
 */
import { describe, expect, test } from 'bun:test'

import { SealedWalletKeyStore, WalletKeySealerUnavailableError, WalletKeyStoreError, createSignerWalletKeySealer } from './walletKeyStore'
import type { WalletKeySealer, WalletKeyStorage } from './walletKeyStore'
import type { WalletKeyMaterial } from './walletKeys'

/** A user-scoped storage stand-in; the real one is `@/lib/wallet/storage`. */
const memoryStorage = (): WalletKeyStorage & { dump: () => Record<string, unknown> } => {
	const map = new Map<string, unknown>()
	return {
		load: <T>(key: string, fallback: T): T => (map.has(key) ? (map.get(key) as T) : fallback),
		save: <T>(key: string, value: T): void => void map.set(key, value),
		remove: (key: string): void => void map.delete(key),
		dump: () => Object.fromEntries(map.entries()),
	}
}

/**
 * A reversible sealer that is obviously not the plaintext, so "is the key in the clear?" can be
 * answered by inspecting the stored string. NIP-44 is the production implementation.
 */
const fakeSealer = (): WalletKeySealer => ({
	encrypt: async (_recipientPubkey, plaintext) => `sealed(${Buffer.from(plaintext, 'utf8').toString('base64')})`,
	decrypt: async (_senderPubkey, ciphertext) => {
		const match = /^sealed\((.*)\)$/.exec(ciphertext)
		if (!match) throw new Error('unopenable')
		return Buffer.from(match[1], 'base64').toString('utf8')
	},
})

const OWNER = 'a'.repeat(64)
const OTHER_OWNER = 'b'.repeat(64)
const P2PK = '02' + 'c'.repeat(64)
const PRIVKEY = 'd'.repeat(64)

const material = (overrides: Partial<WalletKeyMaterial> = {}): WalletKeyMaterial => ({
	ownerPubkey: OWNER,
	walletP2pk: P2PK,
	walletPrivkey: PRIVKEY,
	...overrides,
})

describe('SealedWalletKeyStore', () => {
	test('round-trips the pair', async () => {
		const { store, storage } = storeFactory()
		await store.save(material())
		expect(await store.load(OWNER)).toEqual(material({ ownerPubkey: OWNER }))
		expect(Object.keys(storage.dump())).toHaveLength(1)
	})

	test('the stored record does not contain the private half in the clear', async () => {
		const { store, storage } = storeFactory()
		await store.save(material())

		const persisted = JSON.stringify(storage.dump())
		expect(persisted).not.toContain(PRIVKEY)
		// and the public halves are not secret, so their presence is expected
		expect(persisted).toContain(P2PK)
	})

	test('an owner with no record answers null rather than another owner material', async () => {
		const { store } = storeFactory()
		await store.save(material())
		expect(await store.load(OTHER_OWNER)).toBeNull()
	})

	test('a record filed under another owner is refused', async () => {
		const { store, storage } = storeFactory()
		// someone moves a valid record into this owner's slot
		storage.save(`wallet_key_material:${OTHER_OWNER}`, {
			schemaVersion: 'wallet-key-v1',
			ownerPubkey: OWNER,
			walletP2pk: P2PK,
			sealedPrivkey: 'sealed(x)',
		})
		await expect(store.load(OTHER_OWNER)).rejects.toThrow(WalletKeyStoreError)
	})

	test('a malformed record is refused with a closed code', async () => {
		const { store, storage } = storeFactory()
		storage.save(`wallet_key_material:${OWNER}`, { schemaVersion: 'wallet-key-v0' })

		const err = await store.load(OWNER).then(
			() => null,
			(e: unknown) => e,
		)
		expect(err).toBeInstanceOf(WalletKeyStoreError)
		expect((err as WalletKeyStoreError).code).toBe('malformed')
		expect((err as Error).message).not.toContain(PRIVKEY)
	})

	test('a record that cannot be opened is refused, never returned unsealed', async () => {
		const { store, storage } = storeFactory()
		storage.save(`wallet_key_material:${OWNER}`, {
			schemaVersion: 'wallet-key-v1',
			ownerPubkey: OWNER,
			walletP2pk: P2PK,
			sealedPrivkey: 'not-a-sealed-value',
		})

		const err = await store.load(OWNER).then(
			() => null,
			(e: unknown) => e,
		)
		expect(err).toBeInstanceOf(WalletKeyStoreError)
		expect((err as WalletKeyStoreError).code).toBe('unopenable')
	})

	test('forget removes one owner and leaves the other alone', async () => {
		const { store } = storeFactory()
		await store.save(material())
		await store.save(material({ ownerPubkey: OTHER_OWNER }))
		await store.forget(OWNER)
		expect(await store.load(OWNER)).toBeNull()
		expect(await store.load(OTHER_OWNER)).not.toBeNull()
	})
})

function storeFactory() {
	const storage = memoryStorage()
	return { storage, store: new SealedWalletKeyStore({ sealer: fakeSealer(), storage }) }
}

describe('createSignerWalletKeySealer', () => {
	/** A signer stand-in: NIP-44 in the shape the app's signer offers it. */
	const signerWith = (nip44?: {
		encrypt: (r: string, p: string) => Promise<string>
		decrypt: (s: string, c: string) => Promise<string>
	}) => (nip44 ? { nip44 } : {})

	const workingNip44 = () => ({
		encrypt: async (_r: string, plaintext: string) => `sealed(${Buffer.from(plaintext, 'utf8').toString('base64')})`,
		decrypt: async (_s: string, ciphertext: string) => {
			const match = /^sealed\((.*)\)$/.exec(ciphertext)
			if (!match) throw new Error('cannot open')
			return Buffer.from(match[1], 'base64').toString('utf8')
		},
	})

	test('seals and opens through the signer, so the store round-trips', async () => {
		const storage = memoryStorage()
		const store = new SealedWalletKeyStore({
			sealer: createSignerWalletKeySealer(() => signerWith(workingNip44())),
			storage,
		})

		await store.save(material())

		expect(await store.load(OWNER)).toEqual(material({ ownerPubkey: OWNER }))
		expect(JSON.stringify(storage.dump())).not.toContain(PRIVKEY)
	})

	test('a signer with no nip44 stops the save and stores nothing', async () => {
		const storage = memoryStorage()
		const store = new SealedWalletKeyStore({ sealer: createSignerWalletKeySealer(() => signerWith()), storage })

		const err = await store.save(material()).then(
			() => null,
			(e: unknown) => e,
		)

		expect(err).toBeInstanceOf(WalletKeySealerUnavailableError)
		// the point of the whole module: no seal means no private half anywhere near storage
		expect(storage.dump()).toEqual({})
	})

	test('no signer at all stops the save too', async () => {
		const storage = memoryStorage()
		const store = new SealedWalletKeyStore({ sealer: createSignerWalletKeySealer(() => undefined), storage })

		const err = await store.save(material()).then(
			() => null,
			(e: unknown) => e,
		)

		expect(err).toBeInstanceOf(WalletKeySealerUnavailableError)
		expect(storage.dump()).toEqual({})
	})

	test('a record the current signer cannot open is unopenable, not absent', async () => {
		const storage = memoryStorage()
		const savingStore = new SealedWalletKeyStore({
			sealer: createSignerWalletKeySealer(() => signerWith(workingNip44())),
			storage,
		})
		await savingStore.save(material())

		const otherSignerStore = new SealedWalletKeyStore({
			sealer: createSignerWalletKeySealer(() =>
				signerWith({
					encrypt: async () => 'x',
					decrypt: async () => {
						throw new Error('no')
					},
				}),
			),
			storage,
		})

		const err = await otherSignerStore.load(OWNER).then(
			() => null,
			(e: unknown) => e,
		)
		expect(err).toBeInstanceOf(WalletKeyStoreError)
		expect((err as WalletKeyStoreError).code).toBe('unopenable')
	})
})
