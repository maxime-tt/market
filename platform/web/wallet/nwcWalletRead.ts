import type NDK from '@nostr-dev-kit/ndk'
import type { NDKFilter } from '@nostr-dev-kit/ndk'
import { walletActions } from '@sdk/config/wallet'
import type { Wallet as UserNwcWallet } from '@sdk/config/wallet'
import {
	readNwcBalanceWorkflow,
	readNwcWalletsWorkflow,
	type NwcBalance,
	type NwcBalancePort,
	type NwcWalletEventLike,
	type NwcWalletListPort,
} from '@sdk/commerce/payments/wallet/nwcWalletRead'

/**
 * `src/lib/wallet/nwcWalletRead.ts` — the NDK adapter over the SDK NWC reads (store drain D1, slice 4).
 *
 * The read logic moved to `sdk/commerce/payments/wallet/nwcWalletRead.ts`; this file keeps the original
 * `(ndk, pubkey)` signatures and hands the SDK workflow a port built from the NDK instance. It exists
 * because `src/lib/stores/ndk.ts` calls the pair during sign-in and that file must not change — the
 * ndk store reaches the read layer through this adapter, not through `src/queries/wallet` (which is now
 * a shim over the Platform binding).
 *
 * `NwcBalance` is re-exported so the two former importers (`src/queries/wallet` before the move) keep
 * the same type source.
 */
export type { NwcBalance } from '@sdk/commerce/payments/wallet/nwcWalletRead'

/** The NDK instance as the SDK wallet-list read port: relay fetch, signer pubkey, NIP-44 self-decrypt. */
function createNdkWalletListPort(ndk: NDK): NwcWalletListPort<NwcWalletEventLike> {
	return {
		fetchEvents: async (filter) => Array.from(await ndk.fetchEvents(filter as unknown as NDKFilter)),
		getSignerPubkey: async () => {
			const signer = ndk.signer
			if (!signer) return null
			return (await signer.user()).pubkey
		},
		decrypt: async (content: string) => {
			const signer = ndk.signer
			if (!signer) throw new Error('No signer available')
			return signer.decrypt(await signer.user(), content)
		},
	}
}

/**
 * Fetches the user's NWC wallet list from Nostr. This event is encrypted by the user for themselves.
 */
export const fetchUserNwcWallets = async (ndk: NDK, userPubkey: string): Promise<UserNwcWallet[]> =>
	readNwcWalletsWorkflow(createNdkWalletListPort(ndk), userPubkey)

/**
 * Fetches the balance from an NWC wallet URI.
 * This function uses the cached NWC client (@getalby/sdk).
 */
export const fetchNwcWalletBalance = async (ndk: NDK, nwcUri: string): Promise<NwcBalance | null> => {
	if (!ndk.signer) {
		console.error('Main NDK instance or signer not available for NWC balance fetch')
		return null
	}

	const port: NwcBalancePort = {
		getNwcClient: (uri) => walletActions.getOrCreateNwcClient(uri, ndk.signer!),
	}
	return readNwcBalanceWorkflow(port, nwcUri)
}
