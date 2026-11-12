import { walletActions } from '@sdk/commerce/payments/state/wallet'
import type { Wallet as UserNwcWallet } from '@sdk/commerce/payments/state/wallet'
import type { SignerCapability } from '@sdk/core/signer'
import {
	readNwcBalanceWorkflow,
	readNwcWalletsWorkflow,
	type NwcBalance,
	type NwcBalancePort,
	type NwcWalletEventLike,
	type NwcWalletListFilter,
	type NwcWalletListPort,
} from '@sdk/commerce/payments/wallet/nwcWalletRead'

/**
 * `src/lib/wallet/nwcWalletRead.ts` — the NWC reads (store drain D1, slice 4).
 *
 * The read logic lives in `sdk/commerce/payments/wallet/nwcWalletRead.ts`; this binding
 * answers it from the auth session's **signer capability** (the A3.4 `createCapabilityWalletListPort`
 * below) since A3.7 deleted the ndk store's onboarding callers of the old `(ndk, pubkey)`
 * overloads (runSignerOnboarding / selectAndSetInitialNwcWallet — the rebuilt onboarding
 * lives in `platform/web/auth/authStore.ts`).
 *
 * `NwcBalance` is re-exported so the former importers keep the same type source.
 */
export type { NwcBalance } from '@sdk/commerce/payments/wallet/nwcWalletRead'

/**
 * A3.4: the **capability-typed** wallet-list port. The signer reads come from an
 * SDK signer capability (the auth session's `currentSigner()`, never the NDK
 * instance's signer), the self-decrypt is NIP-44 over the capability's own
 * pair, and the relay fetch is INJECTED. The fetch is a parameter (not a
 * port import) because the callers supply the read they go through — the app
 * composition passes the read context's fetch, tests their own.
 */
export function createCapabilityWalletListPort(
	capability: SignerCapability,
	fetchEvents: (filter: NwcWalletListFilter) => Promise<Iterable<NwcWalletEventLike>>,
): NwcWalletListPort<NwcWalletEventLike> {
	return {
		fetchEvents,
		getSignerPubkey: () => capability.getPublicKey(),
		decrypt: async (content) => {
			const pair = capability.nip44
			if (!pair) throw new Error('No NIP-44 capability available to decrypt the NWC wallet list')
			// NIP-44 to the signer's own key: the wallet list event is encrypted by the user for themselves.
			return pair.decrypt(await capability.getPublicKey(), content)
		},
	}
}

/**
 * Capability-typed variant of {@link fetchUserNwcWallets}: the relay fetch is
 * injected (see {@link createCapabilityWalletListPort}).
 */
export const fetchUserNwcWalletsWithCapability = async (
	capability: SignerCapability,
	userPubkey: string,
	fetchEvents: (filter: NwcWalletListFilter) => Promise<Iterable<NwcWalletEventLike>>,
): Promise<UserNwcWallet[]> => readNwcWalletsWorkflow(createCapabilityWalletListPort(capability, fetchEvents), userPubkey)

/**
 * Capability-typed variant of {@link fetchNwcWalletBalance}. The signer ref the
 * NWC client factory takes is a cache-identity object only (`WalletSignerRef`):
 * the client builds its own signer from the URI, so the capability object is a
 * valid ref.
 */
export const fetchNwcWalletBalanceWithCapability = async (capability: SignerCapability, nwcUri: string): Promise<NwcBalance | null> => {
	const port: NwcBalancePort = {
		getNwcClient: (uri) => walletActions.getOrCreateNwcClient(uri, capability),
	}
	return readNwcBalanceWorkflow(port, nwcUri)
}

/**
 * Fetches the balance from an NWC wallet URI via the host's cached client.
 * A3.7: the capability-typed variant above answers; the `(ndk, uri)` overload is
 * retired with the ndk store's onboarding that called it.
 */
