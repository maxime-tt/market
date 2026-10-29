/**
 * platform/web/wallet/walletQuery.ts — the React binding for the NWC wallet-list and balance reads
 * (store drain D1, slice 4).
 *
 * The read logic lives framework-free in `sdk/commerce/payments/wallet/nwcWalletRead`; this file owns
 * the react-query hooks and resolves the ports from the platform context. `walletActions` supplies the
 * cached NIP-47 client (`getOrCreateNwcClient(nwcUri, signer)`), and `getAppNdk` supplies the relay fetch
 * and signer — so this binding has no `platform -> src` import and the ndk store's own helper
 * (`platform/web/wallet/nwcWalletRead.ts`, now an adapter over the SDK reads) is untouched. Query keys are
 * literal-identical to the pre-drain values.
 */
import { useQuery } from '@tanstack/react-query'
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
import { walletKeys } from '@sdk/core/query/queryKeyFactory'
import { getAppNdk } from '@platform/web/ndkPublishContext'
import { getActiveSignerCapability } from '@platform/web/auth/authStore'
import { createCapabilityWalletListPort } from '@platform/web/wallet/nwcWalletRead'

export type { NwcBalance }
export type { Wallet as UserNwcWallet } from '@sdk/config/wallet'

/** The host's relay fetch + NIP-44 self-decrypt for the wallet-list read. A3.5: the signer reads come from the active signer capability (`createCapabilityWalletListPort`, `nwcWalletRead`), not NDK's instance signer. */
function createWalletListPort(ndk: NonNullable<ReturnType<typeof getAppNdk>>): NwcWalletListPort<NwcWalletEventLike> {
	return createCapabilityWalletListPort(getActiveSignerCapabilityOrThrow(), async (filter) =>
		Array.from(await ndk.fetchEvents(filter as unknown as NDKFilter)),
	)
}

/** The active capability, refusing when no session is active (the host's read cannot answer without its own signer). */
function getActiveSignerCapabilityOrThrow() {
	const capability = getActiveSignerCapability()
	if (!capability) throw new Error('No signer available')
	return capability
}

/**
 * The store-free readers in `@sdk/commerce/payments/wallet/nwcWalletRead`, bound to the connection
 * this host holds. The "no connection yet" guards live here, where the connection is owned.
 */
const fetchWalletsThroughStore = (userPubkey: string): Promise<UserNwcWallet[]> => {
	const ndk = getAppNdk()
	if (!ndk) {
		console.error('NDK not initialized for fetching NWC wallets')
		throw new Error('NDK not initialized for fetching NWC wallets')
	}
	return readNwcWalletsWorkflow(createWalletListPort(ndk), userPubkey)
}

const fetchBalanceThroughStore = (nwcUri: string): Promise<NwcBalance | null> => {
	// A3.5: the NWC client factory's signer ref is a cache-identity object; the
	// active capability is a valid ref, and the signer read no longer touches the
	// NDK instance.
	const capability = getActiveSignerCapability()
	if (!capability) {
		console.error('No signer capability available for NWC balance fetch')
		return Promise.resolve(null)
	}
	const port: NwcBalancePort = {
		getNwcClient: (uri) => walletActions.getOrCreateNwcClient(uri, capability),
	}
	return readNwcBalanceWorkflow(port, nwcUri)
}

/**
 * React Query hook for fetching the user's NWC wallet list.
 */
export const useUserNwcWalletsQuery = (userPubkey: string | undefined) => {
	return useQuery<UserNwcWallet[], Error>({
		queryKey: walletKeys.userNwcWallets(userPubkey || ''),
		queryFn: () => {
			if (!userPubkey) return Promise.resolve([])
			return fetchWalletsThroughStore(userPubkey)
		},
		enabled: !!userPubkey,
		// Consider staleTime or refetchOnWindowFocus based on app needs
	})
}

/**
 * React Query hook for fetching NWC wallet balance.
 */
export const useNwcWalletBalanceQuery = (nwcUri: string | undefined, enabled: boolean = false) => {
	return useQuery<NwcBalance | null, Error>({
		queryKey: walletKeys.nwcBalance(nwcUri || ''),
		queryFn: async () => {
			if (!nwcUri) return null
			return fetchBalanceThroughStore(nwcUri)
		},
		enabled: !!nwcUri && enabled,
		staleTime: 1000 * 60 * 2, // 2 minutes (reduced from 5 for more frequent updates)
		refetchOnWindowFocus: false,
		retry: (failureCount, error) => {
			// Retry up to 2 times for network errors, but not for wallet connection errors
			if (failureCount >= 2) return false
			if (error?.message?.includes('timed out') || error?.message?.includes('connection')) {
				return false // Don't retry connection timeouts
			}
			return true
		},
		retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 5000), // Exponential backoff, max 5s
	})
}
