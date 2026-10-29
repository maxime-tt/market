import { describe, expect, test } from 'bun:test'
import type { NDKSigner } from '@nostr-dev-kit/ndk'
import { createSignerFromKey } from '@sdk/core/signer'
import { generateSecretKey } from 'nostr-tools/pure'
import { bytesToHex } from 'nostr-tools/utils'
import { ndkSignerFromCapability } from './ndkSignerAdapter'

/**
 * The adapter is the one seam that keeps NDK-typed consumers (ndk.ts, the NIP-17
 * order/message helpers, the NWC pipeline) working after the auth store moved
 * onto the SDK signer session. These cases exercise it against a real SDK
 * capability — no mock of the thing under test.
 */
describe('ndkSignerFromCapability', () => {
	test('resolves identity through the capability (user, blockUntilReady, userSync)', async () => {
		const capability = createSignerFromKey(bytesToHex(generateSecretKey()))
		const signer: NDKSigner = ndkSignerFromCapability(capability)
		const expected = await capability.getPublicKey()

		expect((await signer.user()).pubkey).toBe(expected)
		expect((await signer.blockUntilReady()).pubkey).toBe(expected)
		// The synchronous getter is only valid once the identity has been resolved.
		expect(signer.pubkey).toBe(expected)
		expect(signer.userSync.pubkey).toBe(expected)
	})

	test('sign() delegates to the capability and mutates the event in place', async () => {
		const capability = createSignerFromKey(bytesToHex(generateSecretKey()))
		const signer: NDKSigner = ndkSignerFromCapability(capability)

		const event = { kind: 1, tags: [], content: 'hi', created_at: 1_700_000_000 } as unknown as Parameters<NDKSigner['sign']>[0]
		const sig = await signer.sign(event)

		expect(sig).toMatch(/^[0-9a-f]{128}$/)
		expect((event as unknown as { pubkey: string }).pubkey).toBe(await capability.getPublicKey())
	})

	test('reports the schemes the capability actually provides, never more (I4)', async () => {
		const capability = createSignerFromKey(bytesToHex(generateSecretKey()))
		const signer: NDKSigner = ndkSignerFromCapability(capability)

		const enabled = await signer.encryptionEnabled?.()
		expect(enabled).toContain('nip04')
		expect(enabled).toContain('nip44')
		expect(await signer.encryptionEnabled?.('nip44')).toEqual(['nip44'])
	})

	test('encrypt/decrypt round-trip through the capability (NIP-44)', async () => {
		const capability = createSignerFromKey(bytesToHex(generateSecretKey()))
		const signer: NDKSigner = ndkSignerFromCapability(capability)
		const peerSigner: NDKSigner = ndkSignerFromCapability(createSignerFromKey(bytesToHex(generateSecretKey())))

		const recipient = await peerSigner.user()
		const ciphertext = await signer.encrypt(recipient, 'secret', 'nip44')
		expect(await peerSigner.decrypt(await signer.user(), ciphertext, 'nip44')).toBe('secret')
	})
})
