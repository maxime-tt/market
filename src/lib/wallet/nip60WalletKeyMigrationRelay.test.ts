/**
 * Tests for the migration source the app runs, composed the way `walletOps.ts` composes it:
 * `createWalletEventReader` over a relay read and the signer, then
 * `createRelayWalletKeyMigrationSource` over the reader.
 *
 * The cases that matter are refusals, and both are about an HD root not moving: an event that
 * cannot be opened must RAISE rather than read as "no wallet" (the migration maps an empty
 * candidate list to `nothing-to-migrate`, which a caller can turn into a fresh wallet over a
 * real one), and an event carrying several keys must never be resolved by picking one.
 *
 * No relay and no signer here: both halves are stand-ins.
 */
import { describe, expect, test } from 'bun:test'

import { WalletEventUnreadableError, createRelayWalletKeyMigrationSource } from './nip60WalletEventSource'
import { createWalletEventReader } from './walletEventReader'
import type { WalletEventOpener, WalletEventRelay } from './walletEventReader'
import { migrateWalletKeyMaterial } from './walletKeyMigration'
import { SealedWalletKeyStore } from './walletKeyStore'
import type { WalletKeySealer, WalletKeyStorage } from './walletKeyStore'

const OWNER = 'a'.repeat(64)
/** privkey 1 and its compressed pubkey — a real pair. */
const PRIV_ONE = '0000000000000000000000000000000000000000000000000000000000000001'
const PUB_ONE = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'
/** privkey 2 and its compressed pubkey. */
const PRIV_TWO = '0000000000000000000000000000000000000000000000000000000000000002'
const PUB_TWO = '02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5'

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

/** The app's wiring: a relay read, the signer's decrypt, then the migration source. */
const wire = (deps: { relay: WalletEventRelay; opener: WalletEventOpener }) =>
	createRelayWalletKeyMigrationSource(createWalletEventReader(deps))

const relayWith = (content: string | null): WalletEventRelay => ({
	fetchLatestWalletEvent: async () => (content === null ? null : { content, createdAt: 1 }),
})

/** A signer whose NIP-44 "opens" the event by handing back its content — no key material here. */
const opener = (): WalletEventOpener => ({
	decrypt: async (_owner, ciphertext) => ciphertext,
})

const sealedStore = () => new SealedWalletKeyStore({ sealer: sealer(), storage: memoryStorage() })

describe('the relay-backed migration source, wired as the app wires it', () => {
	test('reads the owner event, opens it, and migrates its single key', async () => {
		const source = wire({
			relay: relayWith(
				JSON.stringify([
					['mint', 'https://mint.one'],
					['privkey', PRIV_ONE],
				]),
			),
			opener: opener(),
		})
		const store = sealedStore()

		const result = await migrateWalletKeyMaterial({ store, source, ownerPubkey: OWNER })

		expect(result.outcome).toBe('migrated')
		expect(result.material).toEqual({ ownerPubkey: OWNER, walletP2pk: PUB_ONE, walletPrivkey: PRIV_ONE })
		expect(await store.load(OWNER)).toEqual({ ownerPubkey: OWNER, walletP2pk: PUB_ONE, walletPrivkey: PRIV_ONE })
	})

	test('an event that cannot be opened RAISES, and does not read as an owner with no wallet', async () => {
		const source = wire({
			relay: relayWith(JSON.stringify([['privkey', PRIV_ONE]])),
			opener: {
				decrypt: async () => {
					throw new Error('no nip44 key')
				},
			},
		})
		const store = sealedStore()

		const err = await source.loadWalletPairs(OWNER).then(
			() => null,
			(e: unknown) => e,
		)
		expect(err).toBeInstanceOf(WalletEventUnreadableError)

		// the migration is not handed an empty list it would read as "no wallet"
		await expect(migrateWalletKeyMaterial({ store, source, ownerPubkey: OWNER })).rejects.toBeInstanceOf(WalletEventUnreadableError)
		// and nothing was written on the way to the failure
		expect(await store.load(OWNER)).toBeNull()
	})

	test('an event carrying two keys is refused, never guessed, and nothing is written', async () => {
		const source = wire({
			relay: relayWith(
				JSON.stringify([
					['privkey', PRIV_ONE],
					['privkey', PRIV_TWO],
				]),
			),
			opener: opener(),
		})
		const store = sealedStore()

		const result = await migrateWalletKeyMaterial({ store, source, ownerPubkey: OWNER })

		expect(result.outcome).toBe('no-matching-pair')
		expect(result.material).toBeNull()
		expect(await store.load(OWNER)).toBeNull()

		// naming the key it means is the only non-guess, and it resolves
		const named = await migrateWalletKeyMaterial({ store, source, ownerPubkey: OWNER, expectedP2pk: PUB_TWO })
		expect(named.outcome).toBe('migrated')
		expect(named.material?.walletPrivkey).toBe(PRIV_TWO)
	})

	test('an owner with no wallet event is a genuine absence, not a failure', async () => {
		const source = wire({ relay: relayWith(null), opener: opener() })
		const store = sealedStore()

		const result = await migrateWalletKeyMaterial({ store, source, ownerPubkey: OWNER })

		expect(result.outcome).toBe('nothing-to-migrate')
		expect(result.material).toBeNull()
		expect(await store.load(OWNER)).toBeNull()
	})

	test('the signer opens the event as its owner (a self-encrypted event names the sender)', async () => {
		let sender = ''
		const source = wire({
			relay: relayWith(JSON.stringify([['privkey', PRIV_ONE]])),
			opener: {
				decrypt: async (owner, ciphertext) => {
					sender = owner
					return ciphertext
				},
			},
		})

		await source.loadWalletPairs(OWNER)

		expect(sender).toBe(OWNER)
	})
})
