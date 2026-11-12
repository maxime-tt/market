import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getAppNdk, publishAppNostrEvent } from '@platform/web/ndkPublishContext'
import { getActiveSignerCapability } from '@platform/web/auth/authStore'
import { createSignerPublishContext } from '@platform/web/sdkSigner'
import { createNdkReadContext, getCurrentPubkey } from '@platform/web/readContext'
import {
	DEFAULT_RELAY_PREFERENCES,
	publishRelayPreferencesWorkflow,
	readRelayPreferencesWorkflow,
	relayPreferencesKeys,
	RELAY_PREFERENCES_D_TAG,
	type RelayPreferencesSettings,
} from '@sdk/core/relays'

export { DEFAULT_RELAY_PREFERENCES, relayPreferencesKeys }
export type { RelayPreferencesSettings }

/**
 * Publishes the user's relay preferences as a kind 30078 event (NIP-78 Application Specific Data)
 *
 * This stores app-specific preferences like whether to include default fallback relays.
 * Using a d-tag makes this a parameterized replaceable event.
 *
 * @param preferences The relay preferences to save
 * @returns The event ID of the published preferences
 */
export async function publishRelayPreferences(preferences: RelayPreferencesSettings): Promise<string> {
	const ndk = getAppNdk()
	if (!ndk) throw new Error('NDK not initialized')

	const signer = getActiveSignerCapability()
	if (!signer) throw new Error('User signer not available')

	const event = await publishRelayPreferencesWorkflow(
		await createSignerPublishContext(signer, async (event) => {
			await publishAppNostrEvent(ndk, event)
		}),
		preferences,
	)
	return event.id
}

/**
 * Returns the d-tag used for relay preferences
 * Useful for building queries
 */
export function getRelayPreferencesDTag(): string {
	return RELAY_PREFERENCES_D_TAG
}

/**
 * Fetches user's relay preferences (kind 30078 with d-tag) through the app read
 * context. The framework-free read model (`readRelayPreferencesWorkflow`,
 * `sdk/core/relays`) takes the port as a parameter; the port comes from
 * `platform/web/readContext.ts`, so no part of the read imports the SDK NDK store.
 *
 * @param userPubkey The pubkey of the user to fetch preferences for
 * @returns RelayPreferencesSettings or null if not found
 */
export async function fetchRelayPreferences(userPubkey: string): Promise<RelayPreferencesSettings | null> {
	return readRelayPreferencesWorkflow(createNdkReadContext(), userPubkey)
}

/**
 * Hook to fetch user's relay preferences from Nostr
 * Returns default preferences if none are saved
 */
export function useRelayPreferences(pubkey: string | undefined) {
	return useQuery({
		queryKey: relayPreferencesKeys.user(pubkey ?? ''),
		queryFn: async () => {
			const prefs = await fetchRelayPreferences(pubkey!)
			return prefs ?? DEFAULT_RELAY_PREFERENCES
		},
		enabled: !!pubkey,
		staleTime: 5 * 60 * 1000, // 5 minutes
		gcTime: 10 * 60 * 1000, // 10 minutes
	})
}

/**
 * Publishes the user's relay preferences and invalidates its read. The NDK client used
 * for invalidation comes from the Platform publish bridge, not the SDK store.
 */
export function usePublishRelayPreferences() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (preferences: RelayPreferencesSettings) => publishRelayPreferences(preferences),
		onSuccess: async () => {
			// Get user pubkey to invalidate their preferences
			// A3.5: the identity comes from the auth machine, not NDK's signer-derived activeUser.
			const userPubkey = getCurrentPubkey()
			if (userPubkey) {
				try {
					queryClient.invalidateQueries({ queryKey: relayPreferencesKeys.user(userPubkey) })
				} catch (e) {
					console.error('Failed to invalidate relay preferences query:', e)
				}
			}
			// Also invalidate all preferences queries
			queryClient.invalidateQueries({ queryKey: relayPreferencesKeys.all })
		},
	})
}
