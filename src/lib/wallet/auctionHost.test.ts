import { describe, expect, test } from 'bun:test'
import { secp256k1 } from '@noble/curves/secp256k1.js'

import { createAuctionHost, type AuctionHost } from './auctionHost'
import type { PendingToken, PendingTokenContext } from './types'
import { deriveAuctionHdXpub, normalizeWalletKeyMaterial } from './walletKeys'

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

const materialFor = (fill: number) => {
	const walletPrivkey = secretHex(fill)
	return normalizeWalletKeyMaterial({
		ownerPubkey: bytesToHex(new Uint8Array(32).fill(fill)),
		walletP2pk: compressedPubkey(walletPrivkey),
		walletPrivkey,
	})
}

const pendingToken = (id: string): PendingToken => ({
	id,
	token: `token-${id}`,
	amount: 21,
	mintUrl: 'https://mint.example',
	createdAt: 1_700_000_000,
	status: 'pending',
})

const contextFor = (bidEventId: string): PendingTokenContext => ({
	kind: 'auction_bid',
	auctionEventId: 'a'.repeat(64),
	sellerPubkey: 'b'.repeat(64),
	pathIssuerPubkey: '',
	lockPubkey: 'c'.repeat(66),
	refundPubkey: 'd'.repeat(66),
	locktime: 1_700_000_000,
	bidEventId,
})

/** A host with a spy on the pending-token write and the key-material read. */
const makeHost = (overrides: Partial<AuctionHost> = {}) => {
	const writes: PendingToken[][] = []
	let keyMaterialReads = 0
	const base: AuctionHost = {
		isWalletReady: () => true,
		resolveKeyMaterial: async () => materialFor(7),
		getPendingTokens: () => [pendingToken('one'), pendingToken('two')],
		setPendingTokens: (tokens) => {
			writes.push(tokens)
		},
		...overrides,
	}
	// Wrap last so the read is counted whichever `resolveKeyMaterial` an override supplies.
	const host: AuctionHost = {
		...base,
		resolveKeyMaterial: async () => {
			keyMaterialReads += 1
			return base.resolveKeyMaterial()
		},
	}
	return { host, writes, keyMaterialReads: () => keyMaterialReads }
}

describe('auction host — the HD xpub an auction publishes', () => {
	test('derives the same xpub the key material does, so xpub and child key cannot disagree', async () => {
		const material = materialFor(7)
		const { host, keyMaterialReads } = makeHost({ resolveKeyMaterial: async () => material })

		const xpub = await createAuctionHost(host).getAuctionP2pkXpub()

		expect(xpub).toBe(await deriveAuctionHdXpub(material))
		expect(keyMaterialReads()).toBe(1)
	})

	test('refuses a wallet that is not ready, and reads no key material', async () => {
		const { host, keyMaterialReads } = makeHost({ isWalletReady: () => false })

		await expect(createAuctionHost(host).getAuctionP2pkXpub()).rejects.toThrow('NIP-60 wallet not ready')
		expect(keyMaterialReads()).toBe(0)
	})
})

describe('auction host — the pending-token context attach', () => {
	test('replaces exactly the matching token context and persists the list once', () => {
		const { host, writes } = makeHost()
		const context = contextFor('bid-event-1')

		const updated = createAuctionHost(host).updatePendingTokenContext('one', context)

		expect(updated?.id).toBe('one')
		expect(updated?.context).toEqual(context)
		expect(writes).toHaveLength(1)
		expect(writes[0]).toHaveLength(2)
		// The unmatched token is carried through unchanged.
		expect(writes[0][1]).toEqual(pendingToken('two'))
	})

	test('returns null and writes nothing when the id is unknown', () => {
		const { host, writes } = makeHost()

		const updated = createAuctionHost(host).updatePendingTokenContext('missing', contextFor('bid-event-2'))

		expect(updated).toBeNull()
		expect(writes).toHaveLength(0)
	})
})
