import { ndkActions } from '@/lib/stores/ndk'
import { type RelayPreference } from '@/publish/relay-list'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { publishRelayList } from '@/publish/relay-list'
import { fetchUserRelayListWithPreferences } from '@/lib/nostr/relayListRead'

export const relayListKeys = {
	all: ['relay-list'] as const,
	user: (pubkey: string) => [...relayListKeys.all, pubkey] as const,
} as const

/**
 * The store-free reader in `@/lib/nostr/relayListRead`, bound to the
 * connection this store holds. The reader itself takes the ndk instance as an
 * argument so that it — and the ndk store that calls it — do not import this
 * query module back, which is what the cycle was.
 */
async function fetchRelayListThroughStore(userPubkey: string): Promise<RelayPreference[]> {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	return fetchUserRelayListWithPreferences(ndk, userPubkey)
}

/**
 * Hook to fetch user's relay list from Nostr
 */
export function useUserRelayList(pubkey: string | undefined) {
	return useQuery({
		queryKey: relayListKeys.user(pubkey ?? ''),
		queryFn: () => fetchRelayListThroughStore(pubkey!),
		enabled: !!pubkey,
		staleTime: 5 * 60 * 1000, // 5 minutes
		gcTime: 10 * 60 * 1000, // 10 minutes
	})
}

/**
 * Hook to publish user's relay list to Nostr
 */
export function usePublishRelayList() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (relays: RelayPreference[]) => publishRelayList(relays),
		onSuccess: async () => {
			// Get user pubkey to invalidate their relay list
			const ndk = ndkActions.getNDK()
			if (ndk?.signer) {
				try {
					const user = await ndk.signer.user()
					if (user?.pubkey) {
						queryClient.invalidateQueries({ queryKey: relayListKeys.user(user.pubkey) })
					}
				} catch (e) {
					console.error('Failed to invalidate relay list query:', e)
				}
			}
			// Also invalidate all relay list queries
			queryClient.invalidateQueries({ queryKey: relayListKeys.all })
		},
	})
}
