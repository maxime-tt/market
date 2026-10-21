/**
 * Tests for reading a NIP-60 wallet event's content, and for the rule that it never picks a
 * key on the caller's behalf.
 */
import { describe, expect, test } from 'bun:test'

import { Nip60WalletEventError, parseNip60WalletEventContent, selectWalletKeyPair } from './nip60WalletEvent'

/** privkey 1 and its compressed pubkey — a real pair. */
const PRIV_ONE = '0000000000000000000000000000000000000000000000000000000000000001'
const PUB_ONE = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'
/** privkey 2 and its compressed pubkey. */
const PRIV_TWO = '0000000000000000000000000000000000000000000000000000000000000002'
const PUB_TWO = '02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5'

// deliberately loose: one case feeds a non-array entry to prove it is skipped
const content = (entries: unknown[]): string => JSON.stringify(entries)

describe('parseNip60WalletEventContent', () => {
	test('reads mints, relays and derives the pubkey for each privkey', () => {
		const parsed = parseNip60WalletEventContent(
			content([
				['mint', 'https://mint.one'],
				['relay', 'wss://relay.one'],
				['privkey', PRIV_ONE],
			]),
		)

		expect(parsed.mints).toEqual(['https://mint.one'])
		expect(parsed.relays).toEqual(['wss://relay.one'])
		expect(parsed.pairs).toEqual([{ walletP2pk: PUB_ONE, walletPrivkey: PRIV_ONE }])
	})

	test('returns every key the event carries, in order, rather than one of them', () => {
		const parsed = parseNip60WalletEventContent(
			content([
				['privkey', PRIV_TWO],
				['privkey', PRIV_ONE],
			]),
		)

		expect(parsed.pairs.map((p) => p.walletP2pk)).toEqual([PUB_TWO, PUB_ONE])
	})

	test('skips entries that do not fit the shape but keeps the rest', () => {
		const parsed = parseNip60WalletEventContent(
			content([['mint', 'https://mint.one'], ['privkey', 'not-hex'], 'nonsense', [], ['privkey', PRIV_ONE]]),
		)

		expect(parsed.pairs).toHaveLength(1)
		expect(parsed.pairs[0].walletP2pk).toBe(PUB_ONE)
	})

	test('refuses content that is not a pair-list, rather than reporting an empty wallet', () => {
		expect(() => parseNip60WalletEventContent('not json')).toThrow(Nip60WalletEventError)
		expect(() => parseNip60WalletEventContent('{"a":1}')).toThrow(Nip60WalletEventError)
		expect(() => parseNip60WalletEventContent(content([['mint', 'https://mint.one']]))).toThrowError(
			expect.objectContaining({ code: 'no-keys' }),
		)
	})

	test('the private half is the only key-like value it returns, and it is the one parsed', () => {
		const parsed = parseNip60WalletEventContent(content([['privkey', PRIV_ONE.toUpperCase()]]))
		expect(parsed.pairs[0].walletPrivkey).toBe(PRIV_ONE) // normalised, not echoed differently
	})
})

describe('selectWalletKeyPair', () => {
	test('names the pair by its expected pubkey', () => {
		const pairs = [
			{ walletP2pk: PUB_ONE, walletPrivkey: PRIV_ONE },
			{ walletP2pk: PUB_TWO, walletPrivkey: PRIV_TWO },
		]

		expect(selectWalletKeyPair(pairs, PUB_TWO)?.walletPrivkey).toBe(PRIV_TWO)
		expect(selectWalletKeyPair(pairs, PUB_ONE)?.walletPrivkey).toBe(PRIV_ONE)
	})

	test('an expected pubkey that is not there selects nothing', () => {
		const pairs = [{ walletP2pk: PUB_ONE, walletPrivkey: PRIV_ONE }]
		expect(selectWalletKeyPair(pairs, PUB_TWO)).toBeNull()
	})

	test('with no expectation, a single key is unambiguous and several are not', () => {
		expect(selectWalletKeyPair([{ walletP2pk: PUB_ONE, walletPrivkey: PRIV_ONE }], undefined)).not.toBeNull()
		// the rule that keeps an HD root from moving: never guess between keys
		expect(
			selectWalletKeyPair(
				[
					{ walletP2pk: PUB_ONE, walletPrivkey: PRIV_ONE },
					{ walletP2pk: PUB_TWO, walletPrivkey: PRIV_TWO },
				],
				undefined,
			),
		).toBeNull()
	})
})
