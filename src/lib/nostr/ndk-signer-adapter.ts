import { NDKUser, type NDKSigner, type NDKEncryptionScheme } from '@nostr-dev-kit/ndk'
import type { NostrEvent as SignerEvent, SignedEvent, SignerCapability } from '@sdk/core/signer'

/**
 * `ndk-signer-adapter.ts` — bridge an SDK signer **capability** (`@sdk/core/signer`) onto NDK's
 * `NDKSigner` interface, for the parts of the app that still speak NDK.
 *
 * The app's login moved onto the SDK signer session (store-drain B3 part 2, `src/lib/stores/auth.ts`),
 * but the ndk store is NOT drained (owner ruling): `ndkActions.setSigner`, `runSignerOnboarding`, the
 * NIP-17 order/message helpers and the NWC pipeline all consume an `NDKSigner`. This file is the one
 * seam that keeps those library-typed consumers compiling — it constructs the one `NDKUser` NDK's own
 * `encrypt`/`decrypt` signatures require, and delegates every cryptographic operation to the SDK
 * capability rather than recomputing it locally.
 *
 * It is deliberately kept out of `auth.ts` so the store owns no NDK signer *class* — only this adapter
 * does, and only to satisfy NDK's structural type.
 */
export function ndkSignerFromCapability(capability: SignerCapability): NDKSigner {
	let resolved: string | undefined

	const identity = async (): Promise<string> => {
		if (!resolved) resolved = await capability.getPublicKey()
		return resolved
	}

	const userFor = (pubkey: string): NDKUser => new NDKUser({ pubkey })

	const notReady = (): never => {
		throw new Error('Signer not ready — call blockUntilReady() (or user()) first')
	}

	const schemeOf = (scheme: NDKEncryptionScheme | undefined) => (scheme === 'nip04' ? capability.nip04 : capability.nip44)

	return {
		get pubkey(): string {
			return resolved ?? notReady()
		},

		get userSync(): NDKUser {
			return resolved ? userFor(resolved) : notReady()
		},

		async blockUntilReady(): Promise<NDKUser> {
			return userFor(await identity())
		},

		async user(): Promise<NDKUser> {
			return userFor(await identity())
		},

		async sign(event: SignerEvent): Promise<string> {
			const signed: SignedEvent = await capability.signEvent({
				kind: event.kind,
				tags: event.tags,
				content: event.content,
				created_at: event.created_at,
			})
			// NDK signers mutate the event in place and return the signature.
			Object.assign(event, { id: signed.id, pubkey: signed.pubkey, sig: signed.sig })
			return signed.sig
		},

		async encryptionEnabled(scheme?: NDKEncryptionScheme): Promise<NDKEncryptionScheme[]> {
			const enabled: NDKEncryptionScheme[] = []
			if (capability.nip04) enabled.push('nip04')
			if (capability.nip44) enabled.push('nip44')
			return scheme ? enabled.filter((s) => s === scheme) : enabled
		},

		async encrypt(recipient: NDKUser, value: string, scheme?: NDKEncryptionScheme): Promise<string> {
			const impl = schemeOf(scheme)
			if (!impl) throw new Error(`This signer does not provide ${scheme ?? 'nip44'} encryption`)
			return impl.encrypt(recipient.pubkey, value)
		},

		async decrypt(sender: NDKUser, value: string, scheme?: NDKEncryptionScheme): Promise<string> {
			const impl = schemeOf(scheme)
			if (!impl) throw new Error(`This signer does not provide ${scheme ?? 'nip44'} encryption`)
			return impl.decrypt(sender.pubkey, value)
		},

		toPayload(): string {
			return ''
		},
	}
}
