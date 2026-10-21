/**
 * Tests for the relay-backed migration source.
 *
 * The case that matters is the failure one: an event that cannot be opened must raise, never
 * answer as an empty candidate list.
 */
import { describe, expect, test } from 'bun:test'

import { WalletEventUnreadableError, createRelayWalletKeyMigrationSource } from './nip60WalletEventSource'
import type { WalletEventReader } from './nip60WalletEventSource'
import { Nip60WalletEventError } from './nip60WalletEvent'

const OWNER = 'a'.repeat(64)
const PRIV = '0000000000000000000000000000000000000000000000000000000000000001'
const PUB = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'

const reader = (overrides: Partial<WalletEventReader> = {}): WalletEventReader => ({
	readWalletEventContent: async () => JSON.stringify([['privkey', PRIV]]),
	decrypt: async (_owner, ciphertext) => ciphertext,
	...overrides,
})

describe('createRelayWalletKeyMigrationSource', () => {
	test('answers the pairs the event carries', async () => {
		const source = createRelayWalletKeyMigrationSource(reader())

		const pairs = await source.loadWalletPairs(OWNER)

		expect(pairs).toEqual([{ walletP2pk: PUB, walletPrivkey: PRIV }])
	})

	test('an owner with no event is an empty candidate list', async () => {
		const source = createRelayWalletKeyMigrationSource(reader({ readWalletEventContent: async () => null }))

		expect(await source.loadWalletPairs(OWNER)).toEqual([])
	})

	test('an event that cannot be opened raises, and does not read as "no wallet"', async () => {
		const source = createRelayWalletKeyMigrationSource(
			reader({
				decrypt: async (_owner) => {
					throw new Error('cannot decrypt')
				},
			}),
		)

		const err = await source.loadWalletPairs(OWNER).then(
			() => null,
			(e: unknown) => e,
		)
		// the migration maps an empty list to `nothing-to-migrate`, which can create a wallet
		expect(err).toBeInstanceOf(WalletEventUnreadableError)
	})

	test('opened content that is not a pair-list still refuses through the parser', async () => {
		const source = createRelayWalletKeyMigrationSource(reader({ readWalletEventContent: async () => '{"a":1}' }))

		await expect(source.loadWalletPairs(OWNER)).rejects.toBeInstanceOf(Nip60WalletEventError)
	})

	test('the reader is asked for the owner it was given', async () => {
		let asked = ''
		const source = createRelayWalletKeyMigrationSource(
			reader({
				readWalletEventContent: async (owner) => {
					asked = owner
					return null
				},
			}),
		)

		await source.loadWalletPairs(OWNER)
		expect(asked).toBe(OWNER)
	})
})
