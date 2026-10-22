import { ndkActions } from '@/lib/stores/ndk'
import { useQuery } from '@tanstack/react-query'
import { walletKeys } from './queryKeyFactory'
import { fetchNwcWalletBalance, fetchUserNwcWallets, type NwcBalance } from '@/lib/wallet/nwcWalletRead'

export type { NwcBalance }

// Using the Wallet interface from the local store for now.
// If it diverges, we might need a separate UserNwcWallet interface here.
export type UserNwcWallet = import('@/lib/stores/wallet').Wallet

/**
 * The store-free readers in `@/lib/wallet/nwcWalletRead`, bound to the
 * connection this store holds. The readers take the ndk instance as an argument
 * so that the ndk store — which calls them during sign-in — does not have to
 * import this module back, which is what the cycle was. The "no connection yet"
 * guards live here, where the connection is owned.
 */
const fetchWalletsThroughStore = (userPubkey: string): Promise<UserNwcWallet[]> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) {
		console.error('NDK not initialized for fetching NWC wallets')
		throw new Error('NDK not initialized for fetching NWC wallets')
	}
	return fetchUserNwcWallets(ndk, userPubkey)
}

const fetchBalanceThroughStore = (nwcUri: string): Promise<NwcBalance | null> => {
	const ndk = ndkActions.getNDK()
	if (!ndk || !ndk.signer) {
		console.error('Main NDK instance or signer not available for NWC balance fetch')
		return Promise.resolve(null)
	}
	return fetchNwcWalletBalance(ndk, nwcUri)
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
