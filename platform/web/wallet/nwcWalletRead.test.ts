/**
 * A3.4 probes: the **capability-typed** NWC wallet-read ports
 * (`createCapabilityWalletListPort` / `fetchUserNwcWalletsWithCapability`).
 *
 * The `(ndk, …)` overloads beside them stay until A3.7 (the ndk store's
 * onboarding still calls them); these tests pin the capability path's
 * behaviour instead: the signer reads come from the capability, the
 * self-decrypt is NIP-44 over the capability's own pair, and a capability
 * without the pair fails closed.
 */
import { describe, expect, test } from 'bun:test'
import { generateSecretKey, getPublicKey, nip44 } from 'nostr-tools'
import type { SignerCapability } from '@sdk/core/signer'
import { USER_NWC_WALLET_LIST_KIND, USER_NWC_WALLET_LIST_LABEL } from '@sdk/commerce/payments/nwcWalletList'
import type { NwcWalletEventLike, NwcWalletListFilter } from '@sdk/commerce/payments/wallet/nwcWalletRead'
import { fetchUserNwcWalletsWithCapability } from './nwcWalletRead'

/** A real-crypto test capability: NIP-44 over a raw test key, exactly like the adapters it replaces. */
function testCapability(privateKey: Uint8Array): SignerCapability {
	const pubkey = getPublicKey(privateKey)
	return {
		getPublicKey: async () => pubkey,
		signEvent: async (template) => ({ ...template, id: 'test', pubkey, sig: 'test' }),
		nip44: {
			encrypt: async (peer, plaintext) => nip44.v2.encrypt(plaintext, nip44.v2.utils.getConversationKey(privateKey, peer)),
			decrypt: async (peer, ciphertext) => nip44.v2.decrypt(ciphertext, nip44.v2.utils.getConversationKey(privateKey, peer)),
		},
	}
}

describe('nwcWalletRead capability ports (A3.4)', () => {
	test('the capability port self-decrypts the NWC wallet list over its own NIP-44 pair', async () => {
		const privateKey = generateSecretKey()
		const pubkey = getPublicKey(privateKey)
		const nwcUri = 'nostr+wallet://test-wallet'
		// The wallet list event is encrypted by the user for themselves — NIP-44
		// under a conversation key with their own key.
		const plaintext = JSON.stringify([{ id: 'w1', name: 'Main', nwcUri, pubkey, relays: [] }])
		const ciphertext = nip44.v2.encrypt(plaintext, nip44.v2.utils.getConversationKey(privateKey, pubkey))

		const captured: NwcWalletListFilter[] = []
		const fetchEvents = async (filter: NwcWalletListFilter): Promise<NwcWalletEventLike[]> => {
			captured.push(filter)
			return [{ pubkey, content: ciphertext, created_at: 1_736_000_000 }]
		}

		const wallets = await fetchUserNwcWalletsWithCapability(testCapability(privateKey), pubkey, fetchEvents)

		// The injected fetch received the workflow's kind/label pin unchanged.
		expect(captured).toEqual([{ kinds: [USER_NWC_WALLET_LIST_KIND], authors: [pubkey], '#l': [USER_NWC_WALLET_LIST_LABEL] }])
		// The list decrypted through the capability's own pair — the self-decrypt path.
		expect(wallets).toHaveLength(1)
		expect(wallets[0]?.nwcUri).toBe(nwcUri)
	})

	test('a capability without a NIP-44 pair fails closed — ciphertext never leaks as a wallet', async () => {
		const authorPubkey = getPublicKey(generateSecretKey())
		const capability: SignerCapability = {
			getPublicKey: async () => authorPubkey,
			signEvent: async (template) => ({ ...template, id: 'test', pubkey: authorPubkey, sig: 'test' }),
		}
		const fetchEvents = async (): Promise<NwcWalletEventLike[]> => [{ pubkey: authorPubkey, content: 'not-plaintext', created_at: 1 }]

		// The port refuses the decrypt (no pair to decrypt with); the workflow's
		// plaintext fallback cannot parse the ciphertext, so the answer is an
		// empty list — never a wallet parsed out of encrypted content.
		const wallets = await fetchUserNwcWalletsWithCapability(capability, authorPubkey, fetchEvents)
		expect(wallets).toEqual([])
	})
})
