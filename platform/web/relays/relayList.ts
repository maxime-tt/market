import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createNdkPublishContext, getAppNdk, getAppSigner } from '@platform/web/ndkPublishContext'
import { createNdkReadContext } from '@platform/web/ndkReadContext'
import { parseRelayListTags, publishRelayListWorkflow, readRelayListWorkflow, relayListKeys, type RelayPreference } from '@sdk/core/relays'

export type { RelayPreference }
export { relayListKeys }

/**
 * Publishes the user's relay list as a kind 10002 event (NIP-65).
 *
 * This is a replaceable event that stores the user's preferred relays. Other
 * Nostr clients can read it to discover where to find the user's events.
 *
 * @param relays Array of relay preferences with read/write flags
 * @returns The event ID of the published relay list
 */
export async function publishRelayList(relays: RelayPreference[]): Promise<string> {
	const ndk = getAppNdk()
	if (!ndk) throw new Error('NDK not initialized')

	const signer = getAppSigner()
	if (!signer) throw new Error('User signer not available')

	const event = await publishRelayListWorkflow(await createNdkPublishContext(ndk, signer), relays)
	return event.id
}

/**
 * Parses relay tags from a kind 10002 event into RelayPreference objects
 */
export const parseRelayTags = parseRelayListTags

/**
 * Reads the user's relay list through the app read context. The read model itself
 * is framework-free (`readRelayListWorkflow`, `sdk/core/relays`); this hook owns the
 * react-query binding and resolves the port from `platform/web/ndkReadContext.ts`,
 * so no part of the read imports `@/lib/stores/ndk`.
 */
export function useUserRelayList(pubkey: string | undefined) {
	return useQuery({
		queryKey: relayListKeys.user(pubkey ?? ''),
		queryFn: () => readRelayListWorkflow(createNdkReadContext(), pubkey!),
		enabled: !!pubkey,
		staleTime: 5 * 60 * 1000, // 5 minutes
		gcTime: 10 * 60 * 1000, // 10 minutes
	})
}

/**
 * Publishes the user's relay list and invalidates its read. The NDK client used for
 * invalidation comes from `platform/web/ndkPublishContext.ts` rather than the SDK store.
 */
export function usePublishRelayList() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (relays: RelayPreference[]) => publishRelayList(relays),
		onSuccess: async () => {
			// Get user pubkey to invalidate their relay list
			const ndk = getAppNdk()
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
