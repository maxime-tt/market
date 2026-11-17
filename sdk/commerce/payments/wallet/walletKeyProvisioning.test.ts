import { describe, expect, test } from 'bun:test'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { schnorrSignDigest, schnorrVerifyDigest } from '@cashu/cashu-ts'
import { auctionP2pkPubkeysMatch, toCompressedAuctionP2pkPubkey } from '@sdk/commerce/auctions/auctionP2pk'
import {
	provisionWalletKeyMaterial,
	walletKeyPortFromKeyRing,
	type WalletKeyP2pkPair,
	type WalletKeyPort,
} from '@sdk/commerce/payments/wallet/walletKeyProvisioning'
import { WalletKeyMaterialError } from '@sdk/commerce/payments/wallet/walletKeys'

// Test-only material: fixed, obviously-derived bytes. Never a real wallet key.
const bytesToHex = (bytes: Uint8Array): string =>
	Array.from(bytes)
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('')

const secret = (fill: number): Uint8Array => new Uint8Array(32).fill(fill)
const owner = (fill: number): string => bytesToHex(new Uint8Array(32).fill(fill))

/** The parity-correct compressed encoding of a secret — the form this module stores. */
const compressed = (secretKey: Uint8Array): string => bytesToHex(secp256k1.getPublicKey(secretKey, true))

/** coco's spelling of a `p2pk` key: always the 02-prefixed x-only form. */
const cocoSpelling = (secretKey: Uint8Array): string => `02${compressed(secretKey).slice(2)}`

const cocoPair = (secretKey: Uint8Array, ownerPubkey?: string): WalletKeyP2pkPair => ({
	publicKeyHex: cocoSpelling(secretKey),
	secretKey,
	...(ownerPubkey !== undefined ? { ownerPubkey } : {}),
})

/** A port whose `latestP2pk` answers whatever is queued and whose generate is counted. */
const port = (latest: () => Promise<WalletKeyP2pkPair | null>, generated: () => Promise<WalletKeyP2pkPair>) => {
	const counts = { generate: 0 }
	return {
		counts,
		port: {
			latestP2pk: latest,
			generateP2pk: async () => {
				counts.generate += 1
				return generated()
			},
		} satisfies WalletKeyPort,
	}
}

const codeOf = async (run: () => Promise<unknown>): Promise<string> => {
	try {
		await run()
	} catch (error) {
		if (error instanceof WalletKeyMaterialError) return error.code
		throw error
	}
	throw new Error('expected a WalletKeyMaterialError')
}

describe('provisionWalletKeyMaterial — read, then generate exactly once', () => {
	test('an existing pair is returned and generate is NEVER called', async () => {
		const pair = cocoPair(secret(7))
		const { port: p, counts } = port(
			async () => pair,
			async () => pair,
		)

		const material = await provisionWalletKeyMaterial({ port: p, ownerPubkey: owner(1) })

		expect(counts.generate).toBe(0)
		expect(material.ownerPubkey).toBe(owner(1))
		expect(material.walletPrivkey).toBe(bytesToHex(secret(7)))
		// The stored key is the parity-correct compressed form, not coco's 02-prefixed x-only spelling.
		expect(material.walletP2pk).toBe(compressed(secret(7)))
		expect(auctionP2pkPubkeysMatch(material.walletP2pk, pair.publicKeyHex)).toBe(true)
	})

	test('no pair → generate is called exactly once, and its result is validated and returned', async () => {
		const generated = cocoPair(secret(8))
		const { port: p, counts } = port(
			async () => null,
			async () => generated,
		)

		const material = await provisionWalletKeyMaterial({ port: p, ownerPubkey: owner(2) })

		expect(counts.generate).toBe(1)
		expect(material.walletP2pk).toBe(compressed(secret(8)))
		expect(material.walletPrivkey).toBe(bytesToHex(secret(8)))
	})

	test('a generated pair whose halves disagree is refused (mismatched-pair) and nothing is used', async () => {
		// coco reported a key for one secret but handed back a different secret.
		const generated: WalletKeyP2pkPair = { publicKeyHex: cocoSpelling(secret(10)), secretKey: secret(11) }
		const { port: p, counts } = port(
			async () => null,
			async () => generated,
		)

		expect(await codeOf(() => provisionWalletKeyMaterial({ port: p, ownerPubkey: owner(3) }))).toBe('mismatched-pair')
		// The read/generate happened once; the module has no store, so a refusal wrote nothing.
		expect(counts.generate).toBe(1)
	})

	test('a malformed, x-only or wrong-length public key is refused', async () => {
		const good = secret(12)

		const xOnly: WalletKeyP2pkPair = { publicKeyHex: compressed(good).slice(2), secretKey: good }
		expect(await codeOf(() => provision({ pair: xOnly }))).toBe('wrong-length')

		const notHex: WalletKeyP2pkPair = { publicKeyHex: `02${'zz'.repeat(32)}`, secretKey: good }
		expect(await codeOf(() => provision({ pair: notHex }))).toBe('not-hex')

		const short: WalletKeyP2pkPair = { publicKeyHex: compressed(good).slice(0, 60), secretKey: good }
		expect(await codeOf(() => provision({ pair: short }))).toBe('wrong-length')

		// 66 chars of hex but not a secp256k1 compressed point (prefix 05).
		const badPrefix: WalletKeyP2pkPair = { publicKeyHex: `05${compressed(good).slice(2)}`, secretKey: good }
		expect(await codeOf(() => provision({ pair: badPrefix }))).toBe('wrong-length')

		const empty: WalletKeyP2pkPair = { publicKeyHex: '   ', secretKey: good }
		expect(await codeOf(() => provision({ pair: empty }))).toBe('missing')

		// A secret that is not 32 bytes.
		const shortSecret: WalletKeyP2pkPair = { publicKeyHex: cocoSpelling(good), secretKey: good.slice(0, 31) }
		expect(await codeOf(() => provision({ pair: shortSecret }))).toBe('wrong-length')
	})

	test('a pair stamped for another owner is refused (wrong-owner)', async () => {
		const pair = cocoPair(secret(13), owner(99))
		expect(await codeOf(() => provision({ pair }))).toBe('wrong-owner')

		// The same key, stamped for the caller's owner, is accepted.
		const rightOwner = cocoPair(secret(13), owner(4))
		const material = await provision({ pair: rightOwner, ownerPubkey: owner(4) })
		expect(material.walletP2pk).toBe(compressed(secret(13)))
	})

	test('refusal codes never interpolate key material', async () => {
		const reported = cocoSpelling(secret(14))
		const wrongSecret = secret(15)
		const pair: WalletKeyP2pkPair = { publicKeyHex: reported, secretKey: wrongSecret }

		try {
			await provision({ pair })
			throw new Error('expected a refusal')
		} catch (error) {
			const message = (error as Error).message
			expect(message).toBe('wallet key material refused: mismatched-pair')
			expect(message).not.toContain(bytesToHex(wrongSecret))
			expect(message).not.toContain(reported)
		}
	})
})

/** Provision a pair through a one-shot port that answers it as "existing". */
const provision = (input: { pair: WalletKeyP2pkPair; ownerPubkey?: string }) =>
	provisionWalletKeyMaterial({
		port: port(
			async () => input.pair,
			async () => input.pair,
		).port,
		ownerPubkey: input.ownerPubkey ?? owner(1),
	})

describe('the two-spellings hazard of a P2PK key', () => {
	test('02-prefixed x-only and 03-prefixed compressed compare equal x-only, but a bare x-only key is not compressed', () => {
		// Use a secret whose Y is odd so the honest compressed prefix is 03, while coco would
		// call the same key '02'. Small scalars (fill 1..100) are all valid group elements.
		let oddSecret: Uint8Array | null = null
		for (let fill = 1; fill <= 100; fill += 1) {
			if (compressed(secret(fill)).startsWith('03')) {
				oddSecret = secret(fill)
				break
			}
		}
		expect(oddSecret).not.toBeNull()
		const odd = oddSecret as Uint8Array
		expect(compressed(odd).startsWith('03')).toBe(true)
		const x = compressed(odd).slice(2)

		// The same key under the two spellings must compare equal — never by string equality.
		expect(auctionP2pkPubkeysMatch(`02${x}`, `03${x}`)).toBe(true)
		expect(`02${x}` === `03${x}`).toBe(false)

		// A bare x-only key is not an acceptable compressed form.
		expect(() => toCompressedAuctionP2pkPubkey(x)).toThrow()
		expect(toCompressedAuctionP2pkPubkey(`02${x}`)).toBe(`02${x}`)
		expect(toCompressedAuctionP2pkPubkey(`03${x}`)).toBe(`03${x}`)
	})
})

describe('walletKeyPortFromKeyRing — the coco seam', () => {
	const fakeKeyRing = (pair: { publicKeyHex: string; secretKey: Uint8Array } | null) => {
		const calls = { generate: 0 }
		return {
			calls,
			keyring: {
				getLatestKeyPair: async () => pair,
				generateKeyPair: async (_dump: true) => {
					calls.generate += 1
					if (!pair) throw new Error('no pair to generate in this fake')
					return pair
				},
			},
		}
	}

	test('maps coco’s pair through the port verbatim and stores the parity-correct compressed key', async () => {
		const secretKey = secret(20)
		const { keyring } = fakeKeyRing({ publicKeyHex: cocoSpelling(secretKey), secretKey })
		const p = walletKeyPortFromKeyRing(keyring, owner(5))

		const reported = await p.latestP2pk()
		expect(reported).not.toBeNull()
		// The adapter passes coco's publicKeyHex and secretKey through unchanged, and stamps the owner.
		expect(reported?.publicKeyHex).toBe(cocoSpelling(secretKey))
		expect(reported?.secretKey).toBe(secretKey)
		expect(reported?.ownerPubkey).toBe(owner(5))

		const material = await provisionWalletKeyMaterial({ port: p, ownerPubkey: owner(5) })
		expect(material.walletP2pk).toBe(compressed(secretKey))
		expect(auctionP2pkPubkeysMatch(material.walletP2pk, cocoSpelling(secretKey))).toBe(true)
		expect(material.walletPrivkey).toBe(bytesToHex(secretKey))
	})

	test('a key ring with no pair generates one, and the signer signs a digest with the returned secret key', async () => {
		const secretKey = secret(21)
		let latest: { publicKeyHex: string; secretKey: Uint8Array } | null = null
		const calls = { generate: 0 }
		const keyring = {
			getLatestKeyPair: async () => latest,
			generateKeyPair: async (_dump: true) => {
				calls.generate += 1
				latest = { publicKeyHex: cocoSpelling(secretKey), secretKey }
				return latest
			},
		}
		const p = walletKeyPortFromKeyRing(keyring, owner(6))

		const material = await provisionWalletKeyMaterial({ port: p, ownerPubkey: owner(6) })
		expect(calls.generate).toBe(1)

		// The signer `walletOps.getAuctionBidWalletSigner` builds: it signs a 32-byte digest with
		// the material's secret key and advertises the material's pubkey.
		const signer = {
			pubkey: material.walletP2pk,
			signDigest: (digestHex: string) => schnorrSignDigest(digestHex, material.walletPrivkey),
		}
		const digest = bytesToHex(sha256(new TextEncoder().encode('auction escrow template')))
		const signature = signer.signDigest(digest)

		expect(signature).toMatch(/^[0-9a-f]{128}$/)
		expect(schnorrVerifyDigest(signature, digest, signer.pubkey)).toBe(true)
		// A second ensure over the same ring reads the pair back without generating again.
		const again = await provisionWalletKeyMaterial({ port: p, ownerPubkey: owner(6) })
		expect(calls.generate).toBe(1)
		expect(again.walletP2pk).toBe(material.walletP2pk)
	})
})
