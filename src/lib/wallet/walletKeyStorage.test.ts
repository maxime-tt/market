/**
 * Tests for the app binding. The store's own behaviour is covered in walletKeyStore.test.ts;
 * what matters here is that the binding is wired to the right storage options — in particular
 * that its save is the fail-closed one.
 */
import { describe, expect, test } from 'bun:test'

import { createAppWalletKeyStorage, createAppWalletKeyStore } from './walletKeyStorage'

describe('createAppWalletKeyStorage', () => {
	test('save is fail-closed: with no authenticated user scope it throws instead of skipping', () => {
		const storage = createAppWalletKeyStorage()
		// `saveUserData(..., { strict: true })` refuses when there is no scope to write under.
		// If this ever stops throwing, the binding has lost the fail-closed option and a lost
		// keypair would look like a successful save.
		expect(() => storage.save('wallet_key_material:test', { a: 1 })).toThrow()
	})

	test('load answers the caller fallback rather than throwing when nothing is stored', () => {
		const storage = createAppWalletKeyStorage()
		expect(storage.load('wallet_key_material:absent', 'fallback')).toBe('fallback')
	})

	test('remove on an absent key is not an error', () => {
		const storage = createAppWalletKeyStorage()
		expect(() => storage.remove('wallet_key_material:absent')).not.toThrow()
	})
})

describe('createAppWalletKeyStore', () => {
	test('composes a store over an injected sealer and storage', async () => {
		const store = createAppWalletKeyStore({
			sealer: {
				encrypt: async (_r, plaintext) => `sealed(${plaintext})`,
				decrypt: async (_s, ciphertext) => ciphertext.replace(/^sealed\((.*)\)$/, '$1'),
			},
			storage: {
				load: (_key, fallback) => fallback,
				save: () => undefined,
				remove: () => undefined,
			},
		})

		expect(await store.load('a'.repeat(64))).toBeNull()
	})
})
