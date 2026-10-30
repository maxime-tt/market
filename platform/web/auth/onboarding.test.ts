/**
 * A3.7 (C5) probes: the rebuilt post-login onboarding pipeline
 * (`onboardActiveSigner` — the relay-list load + NWC wallet select that used to
 * live in `ndkActions.runSignerOnboarding`) and the logout cleanup
 * (`teardownSignerAndWallet` → `ndkActions.setActiveNwcWalletUri(null)`).
 *
 * Both legs run over the **signer capability** (the auth session's
 * `currentSigner()`): the relay list is read through the io seam's fetch and
 * loaded into the NDK client, the NWC wallet list is decrypted by the
 * capability's own NIP-44 pair, and the highest-balance wallet becomes the
 * store's active NWC choice.
 */
import { afterEach, describe, expect, mock, test } from 'bun:test'
import { generateSecretKey, getPublicKey, nip44 } from 'nostr-tools'
import type { SignerCapability } from '@sdk/core/signer'

// The NWC client factory + wallet actions the select reads through, mocked so
// no NWC connection is attempted (Test Isolation).
const getOrCreateNwcClient = mock(async (nwcUri: string) => ({
	wallet: {
		getBalance: async () => ({
			balance: nwcUri.includes('rich') ? 1_234_000 : 1_000,
		}),
	},
}))
const initializeWallets = mock(async () => [])
const setNostrWallets = mock((_wallets: unknown[]) => {})
const getWallets = mock(() => [
	{ id: 'w-rich', name: 'Rich', nwcUri: 'nostr+wallet://rich' },
	{ id: 'w-poor', name: 'Poor', nwcUri: 'nostr+wallet://poor' },
])
mock.module('@sdk/config/wallet', () => ({
	walletActions: { initialize: initializeWallets, setNostrWallets, getWallets, getOrCreateNwcClient },
	walletStore: { state: {}, setState: mock((_updater: unknown) => {}) },
}))

// The applesauce port fetch the onboarding reads the user's events through.
const fetchEvents = mock(async (filter: { kinds: number[] }) => {
	if (filter.kinds.includes(10002)) {
		return [
			{
				id: 'relay-list-1',
				pubkey: OWNER_PUBKEY,
				created_at: 1_700_000_000,
				kind: 10002,
				content: '',
				tags: [
					['r', 'wss://relay.owner.example', 'read'],
					['r', 'wss://owner-write.example', 'write'],
				],
				sig: 'sig',
			},
		]
	}
	const conversationKey = nip44.v2.utils.getConversationKey(OWNER_PRIVATE_KEY, OWNER_PUBKEY)
	return [
		{
			id: 'wallet-list-1',
			pubkey: OWNER_PUBKEY,
			created_at: 1_700_000_000,
			kind: 30078,
			content: nip44.v2.encrypt(
				JSON.stringify([{ id: 'w-rich', name: 'Rich', nwcUri: 'nostr+wallet://rich', pubkey: OWNER_PUBKEY, relays: [] }]),
				conversationKey,
			),
			tags: [['l', 'market_user_nwc_wallets']],
			sig: 'sig',
		},
	]
})
mock.module('@platform/web/applesauceIo', () => ({
	applesauceIo: { fetchEvents },
}))

// The ndk store: only the two onboarding effects it observes.
const addSingleRelay = mock((_url: string) => {})
const setActiveNwcWalletUri = mock((_uri: string | null) => {})
mock.module('@/lib/stores/ndk', () => ({
	ndkActions: { addSingleRelay, setActiveNwcWalletUri, getNDK: () => ({}) },
	ndkStore: { state: { explicitRelayUrls: [], writeRelayUrls: [] }, setState: mock((_u: unknown) => {}) },
}))
mock.module('@platform/web/ndk/ndkStore', () => ({
	ndkActions: { addSingleRelay, setActiveNwcWalletUri, getNDK: () => ({}) },
	ndkStore: { state: { explicitRelayUrls: [], writeRelayUrls: [] }, setState: mock((_u: unknown) => {}) },
}))

import { onboardActiveSigner } from './authStore'

const OWNER_PRIVATE_KEY = generateSecretKey()
const OWNER_PUBKEY = getPublicKey(OWNER_PRIVATE_KEY)

function ownerCapability(): SignerCapability {
	return {
		getPublicKey: async () => OWNER_PUBKEY,
		signEvent: async (template) => ({ ...template, id: 'test', pubkey: OWNER_PUBKEY, sig: 'test' }),
		nip44: {
			encrypt: async (peer, plaintext) => nip44.v2.encrypt(plaintext, nip44.v2.utils.getConversationKey(OWNER_PRIVATE_KEY, peer)),
			decrypt: async (peer, ciphertext) => nip44.v2.decrypt(ciphertext, nip44.v2.utils.getConversationKey(OWNER_PRIVATE_KEY, peer)),
		},
	}
}

describe('A3.7 rebuilt onboarding (onboardActiveSigner)', () => {
	afterEach(() => {
		addSingleRelay.mockClear()
		setActiveNwcWalletUri.mockClear()
		setNostrWallets.mockClear()
		getOrCreateNwcClient.mockClear()
		initializeWallets.mockClear()
	})

	test('loads the relay list into the NDK client from the kind-10002 event', async () => {
		await onboardActiveSigner(ownerCapability())

		expect(fetchEvents).toHaveBeenCalledWith(expect.objectContaining({ kinds: [10002], authors: [OWNER_PUBKEY] }))
		expect(addSingleRelay).toHaveBeenCalledWith('wss://relay.owner.example')
		expect(addSingleRelay).toHaveBeenCalledWith('wss://owner-write.example')
	})

	test('selects the highest-balance NWC wallet: list decrypted by the capability, balance probed per URI', async () => {
		await onboardActiveSigner(ownerCapability())

		// The wallet list event was fetched with the NWC label pin and decrypted
		// through the capability's own pair into the store's wallet list.
		expect(fetchEvents).toHaveBeenCalledWith(
			expect.objectContaining({ kinds: [30078], authors: [OWNER_PUBKEY], '#l': ['market_user_nwc_wallets'] }),
		)
		expect(initializeWallets).toHaveBeenCalledTimes(1)
		expect(setNostrWallets).toHaveBeenCalledWith([expect.objectContaining({ id: 'w-rich', nwcUri: 'nostr+wallet://rich' })])

		// Every wallet's balance was probed through the cached NWC client.
		expect(getOrCreateNwcClient).toHaveBeenCalledWith('nostr+wallet://rich', expect.anything())
		expect(getOrCreateNwcClient).toHaveBeenCalledWith('nostr+wallet://poor', expect.anything())

		// The highest-balance wallet became the store's active NWC choice.
		expect(setActiveNwcWalletUri).toHaveBeenCalledWith('nostr+wallet://rich')
	})

	test('with no NWC wallets at all, the active choice is cleared (not stale)', async () => {
		getWallets.mockImplementation(() => [])
		try {
			await onboardActiveSigner(ownerCapability())
			// The pipeline must still resolve (login is never gated on it).
			expect(setActiveNwcWalletUri).toHaveBeenCalledWith(null)
		} finally {
			getWallets.mockImplementation(() => [
				{ id: 'w-rich', name: 'Rich', nwcUri: 'nostr+wallet://rich' },
				{ id: 'w-poor', name: 'Poor', nwcUri: 'nostr+wallet://poor' },
			])
		}
	})
})
