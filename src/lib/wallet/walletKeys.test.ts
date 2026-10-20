import { describe, expect, test } from 'bun:test'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { auctionP2pkPubkeysMatch, deriveAuctionChildP2pkPubkeyFromXpub } from '@/lib/auctionP2pk'

import {
	InMemoryWalletKeyStore,
	WalletKeyMaterialError,
	deriveAuctionChildPrivkey,
	deriveAuctionHdXpub,
	loadWalletKeyMaterial,
	normalizeWalletKeyMaterial,
} from './walletKeys'

// Test-only material: fixed, obviously-derived bytes. Never a real wallet key.
const bytesToHex = (bytes: Uint8Array): string =>
	Array.from(bytes)
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('')

const hexToBytes = (hex: string): Uint8Array => {
	const bytes = new Uint8Array(hex.length / 2)
	for (let index = 0; index < bytes.length; index += 1) {
		bytes[index] = parseInt(hex.slice(index * 2, index * 2 + 2), 16)
	}
	return bytes
}

const secretHex = (fill: number): string => bytesToHex(new Uint8Array(32).fill(fill))
const compressedPubkey = (privkey: string): string => bytesToHex(secp256k1.getPublicKey(hexToBytes(privkey), true))
const ownerPubkey = (fill: number): string => bytesToHex(new Uint8Array(32).fill(fill))

const pairFor = (fill: number) => {
	const walletPrivkey = secretHex(fill)
	return { ownerPubkey: ownerPubkey(fill), walletP2pk: compressedPubkey(walletPrivkey), walletPrivkey }
}

const codeOf = (run: () => unknown): string => {
	try {
		run()
	} catch (error) {
		if (error instanceof WalletKeyMaterialError) return error.code
		throw error
	}
	throw new Error('expected a WalletKeyMaterialError')
}

describe('wallet key material — the pair the auction HD root derives from', () => {
	test('accepts a matching pair and normalizes its case and padding', () => {
		const pair = pairFor(7)
		const material = normalizeWalletKeyMaterial({
			ownerPubkey: `  ${pair.ownerPubkey.toUpperCase()}  `,
			walletP2pk: pair.walletP2pk.toUpperCase(),
			walletPrivkey: ` ${pair.walletPrivkey} `,
		})

		expect(material).toEqual(pair)
	})

	test('refuses a private key that does not produce the stored pubkey', () => {
		const first = pairFor(7)
		const second = pairFor(8)

		// The halves disagree: this pair would derive a *different* HD root, so it is a
		// different wallet rather than a repair, and using it would move every auction address.
		expect(
			codeOf(() =>
				normalizeWalletKeyMaterial({
					ownerPubkey: first.ownerPubkey,
					walletP2pk: first.walletP2pk,
					walletPrivkey: second.walletPrivkey,
				}),
			),
		).toBe('mismatched-pair')
	})

	test('refuses an x-only pubkey, a non-hex value and a short secret', () => {
		const pair = pairFor(9)

		expect(
			codeOf(() =>
				normalizeWalletKeyMaterial({
					ownerPubkey: pair.ownerPubkey,
					walletP2pk: pair.walletP2pk.slice(2),
					walletPrivkey: pair.walletPrivkey,
				}),
			),
		).toBe('wrong-length')

		expect(
			codeOf(() => normalizeWalletKeyMaterial({ ownerPubkey: pair.ownerPubkey, walletP2pk: 'zz', walletPrivkey: pair.walletPrivkey })),
		).toBe('not-hex')

		expect(
			codeOf(() =>
				normalizeWalletKeyMaterial({
					ownerPubkey: pair.ownerPubkey,
					walletP2pk: pair.walletP2pk,
					walletPrivkey: 'not-hex',
				}),
			),
		).toBe('not-hex')

		expect(
			codeOf(() => normalizeWalletKeyMaterial({ ownerPubkey: pair.ownerPubkey, walletP2pk: pair.walletP2pk, walletPrivkey: 'ff' })),
		).toBe('wrong-length')
	})

	test('refuses empty material rather than defaulting it', () => {
		expect(codeOf(() => normalizeWalletKeyMaterial({ ownerPubkey: '', walletP2pk: '', walletPrivkey: '' }))).toBe('missing')
	})

	test('round-trips a pair through the injected store', async () => {
		const store = new InMemoryWalletKeyStore()
		const pair = pairFor(11)

		await store.save(pair)
		const loaded = await loadWalletKeyMaterial(store, pair.ownerPubkey)

		expect(loaded).toEqual(pair)
		expect(await loadWalletKeyMaterial(store, ownerPubkey(12))).toBeNull()
	})

	test('a store answering for another owner is refused', async () => {
		const store = new InMemoryWalletKeyStore()
		const pair = pairFor(13)
		await store.save(pair)

		// A store that hands back a valid pair for the wrong owner is still wrong: the
		// answer is re-checked against the owner that was asked for.
		await expect(loadWalletKeyMaterial(store, ownerPubkey(14))).resolves.toBeNull()

		const lyingStore = {
			load: async () => pair,
			save: async () => {},
		}
		await expect(loadWalletKeyMaterial(lyingStore, ownerPubkey(14))).rejects.toMatchObject({ code: 'wrong-owner' })
	})

	test('a corrupted pair from the store is refused on load, not used', async () => {
		const pair = pairFor(15)
		const other = pairFor(16)
		const corrupted = { load: async () => ({ ...pair, walletPrivkey: other.walletPrivkey }), save: async () => {} }

		await expect(loadWalletKeyMaterial(corrupted, pair.ownerPubkey)).rejects.toMatchObject({ code: 'mismatched-pair' })
	})
})

describe('auction HD derivation from the stored pair', () => {
	test('the child private key is the one the xpub names for the path', async () => {
		const material = normalizeWalletKeyMaterial(pairFor(21))
		const xpub = await deriveAuctionHdXpub(material)
		const derivationPath = '0/0'

		const childPrivkey = await deriveAuctionChildPrivkey(material, { derivationPath })
		const namedPubkey = deriveAuctionChildP2pkPubkeyFromXpub(xpub, derivationPath)

		expect(auctionP2pkPubkeysMatch(compressedPubkey(childPrivkey), namedPubkey)).toBe(true)
	})

	test('a derivation that lands on an unexpected pubkey is refused before anything is locked', async () => {
		const material = normalizeWalletKeyMaterial(pairFor(22))
		const otherPubkey = deriveAuctionChildP2pkPubkeyFromXpub(await deriveAuctionHdXpub(material), '0/1')

		await expect(deriveAuctionChildPrivkey(material, { derivationPath: '0/0', expectedPubkey: otherPubkey })).rejects.toMatchObject({
			code: 'unexpected-child',
		})
	})

	test('the root is deterministic for one pair and differs for another', async () => {
		const first = normalizeWalletKeyMaterial(pairFor(23))
		const same = normalizeWalletKeyMaterial(pairFor(23))
		const different = normalizeWalletKeyMaterial(pairFor(24))

		expect(await deriveAuctionHdXpub(first)).toBe(await deriveAuctionHdXpub(same))
		expect(await deriveAuctionHdXpub(first)).not.toBe(await deriveAuctionHdXpub(different))
	})
})
