import { describe, expect, test } from 'bun:test'
import { UnsupportedSignerOperationError } from './encryptingSigner'
import type { SignableRumorLike } from './encryptingSigner'
import { asEncryptingSigner } from './signerInterop'
import type { SignedEvent, SignerCapability } from '@sdk/core/signer'

/** A minimal capability stub — delegation target, so no real crypto runs here. */
function stubCapability(overrides: Partial<SignerCapability> = {}): SignerCapability {
	return {
		getPublicKey: async () => 'pk-capability',
		signEvent: async (template) => {
			const signed: SignedEvent = {
				...template,
				id: 'evt-signed',
				pubkey: 'pk-capability',
				sig: 'sig-raw',
			}
			return signed
		},
		nip44: {
			encrypt: async (pubkey, plaintext) => `enc:${pubkey}:${plaintext}`,
			decrypt: async (pubkey, ciphertext) => `dec:${pubkey}:${ciphertext}`,
		},
		...overrides,
	}
}

describe('asEncryptingSigner', () => {
	test('getPublicKey delegates to the capability', async () => {
		const signer = asEncryptingSigner(stubCapability())
		await expect(signer.getPublicKey()).resolves.toBe('pk-capability')
	})

	test('signEvent returns the raw signature from the capability-signed event', async () => {
		const capability = stubCapability()
		const signer = asEncryptingSigner(capability)
		const rumor: SignableRumorLike = {
			kind: 14,
			content: 'seal-content',
			created_at: 1_736_000_000,
			tags: [],
			pubkey: 'pk-capability',
		}
		await expect(signer.signEvent(rumor)).resolves.toBe('sig-raw')
		// The template the capability receives carries the rumor's fields — no
		// library user/recipient object crosses the port.
		await capability.signEvent({
			kind: 14,
			content: 'seal-content',
			created_at: 1_736_000_000,
			tags: [],
		})
	})

	test('encrypt/decrypt delegate to the capability NIP-44 pair with plain pubkeys', async () => {
		const signer = asEncryptingSigner(stubCapability())
		await expect(signer.encrypt('pk-recipient', 'plaintext')).resolves.toBe('enc:pk-recipient:plaintext')
		await expect(signer.decrypt('pk-sender', 'ciphertext')).resolves.toBe('dec:pk-sender:ciphertext')
	})

	test('supportsNip44 answers from capability presence (true when the pair is carried)', async () => {
		const present = asEncryptingSigner(stubCapability())
		await expect(present.supportsNip44('encrypt')).resolves.toBe(true)
		await expect(present.supportsNip44('decrypt')).resolves.toBe(true)
	})

	test('a capability without nip44 fails closed: supportsNip44 false, encrypt/decrypt refuse', async () => {
		const absent = asEncryptingSigner(stubCapability({ nip44: undefined }))
		await expect(absent.supportsNip44('encrypt')).resolves.toBe(false)
		await expect(absent.supportsNip44('decrypt')).resolves.toBe(false)
		await expect(absent.encrypt('pk-recipient', 'plaintext')).rejects.toBeInstanceOf(UnsupportedSignerOperationError)
		await expect(absent.decrypt('pk-sender', 'ciphertext')).rejects.toBeInstanceOf(UnsupportedSignerOperationError)
	})

	test('signing keeps working when no encryption pair is carried — only the pair is gated', async () => {
		const absent = asEncryptingSigner(stubCapability({ nip44: undefined }))
		await expect(absent.getPublicKey()).resolves.toBe('pk-capability')
		await expect(absent.signEvent({ kind: 13, content: 'c', created_at: 1, tags: [], pubkey: 'pk-capability' })).resolves.toBe('sig-raw')
	})
})
