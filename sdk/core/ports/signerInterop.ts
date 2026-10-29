import { hasNip44 } from '@sdk/core/signer'
import type { SignedEvent, SignerCapability } from '@sdk/core/signer'
import { UnsupportedSignerOperationError } from './encryptingSigner'
import type { EncryptingSigner, SignableRumorLike } from './encryptingSigner'

/**
 * Adapt an SDK signer **capability** (`@sdk/core/signer`, the session's
 * `currentSigner()` shape) onto the library-free `EncryptingSigner` port the
 * NIP-04/44/59/17 logic consumes.
 *
 * This is the capability-typed twin of the retired NDK adapter
 * (`src/lib/nostr/ndkEncryptingSigner.ts`, deleted in A3.4): it holds zero
 * cryptography and
 * delegates every operation, so an NIP-07 extension, a vaulted key or a
 * NIP-46 bunker all flow through unchanged. The NIP-44 pair is carried
 * **only when the capability exposes it** (I4): `supportsNip44` answers from
 * capability presence — fail-closed, never a promise of what might be — and
 * `encrypt`/`decrypt` refuse with `UnsupportedSignerOperationError` when the
 * pair is absent instead of synthesising one.
 */
export function asEncryptingSigner(capability: SignerCapability): EncryptingSigner {
	return {
		getPublicKey: () => capability.getPublicKey(),

		signEvent: async (event: SignableRumorLike): Promise<string> => {
			// The capability signs the whole template and returns the full signed
			// event; the port wants the raw signature, mirroring how signers
			// return a signature rather than an event.
			const signed: SignedEvent = await capability.signEvent({
				kind: event.kind,
				content: event.content,
				created_at: event.created_at,
				tags: event.tags,
			})
			return signed.sig
		},

		encrypt: async (recipientPubkey: string, plaintext: string): Promise<string> => {
			const pair = nip44PairOf(capability)
			if (!pair) throw new UnsupportedSignerOperationError('The active signer provides no NIP-44 encryption')
			return pair.encrypt(recipientPubkey, plaintext)
		},

		decrypt: async (senderPubkey: string, ciphertext: string): Promise<string> => {
			const pair = nip44PairOf(capability)
			if (!pair) throw new UnsupportedSignerOperationError('The active signer provides no NIP-44 decryption')
			return pair.decrypt(senderPubkey, ciphertext)
		},

		supportsNip44: async () => hasNip44(capability),
	}
}

function nip44PairOf(capability: SignerCapability) {
	return hasNip44(capability) ? capability.nip44 : undefined
}
