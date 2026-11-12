import type { NostrEvent } from 'nostr-tools'
import { profileKeys } from '@sdk/core/query/queryKeyFactory'
import { getAppNdk, publishAppNostrEvent } from '@platform/web/ndkPublishContext'
import { getActiveSignerCapability } from '@platform/web/auth/authStore'
import { createSignerPublishContext } from '@platform/web/sdkSigner'
import { mergeProfileField, publishProfileWorkflow, type ProfileMetadata } from '@sdk/core/profile'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { getCurrentPubkey } from '@platform/web/readContext'

async function publishToAnyRelay(ndk: NonNullable<ReturnType<typeof getAppNdk>>, event: NostrEvent): Promise<void> {
	const publishedRelays = await publishAppNostrEvent(ndk, event)
	if (publishedRelays.size === 0) {
		throw new Error('Profile was not published to any relays. Check your relay connections.')
	}
}

/**
 * Updates the user's profile on the Nostr network.
 *
 * @param profile The profile data to publish
 * @returns Promise that resolves when the profile is published
 */
export const updateProfile = async (profile: ProfileMetadata): Promise<void> => {
	const ndk = getAppNdk()
	if (!ndk) throw new Error('NDK not initialized')

	// A3.5: the signer comes from the auth session's capability, not NDK's instance signer.
	const signer = getActiveSignerCapability()
	if (!signer) throw new Error('No signer available')

	if (!profile) throw new Error('Profile data is required')
	const connectedRelays = ndk.pool?.connectedRelays() || []
	if (connectedRelays.length === 0) {
		throw new Error('No connected relays. Please check your relay connections and try again.')
	}

	try {
		await publishProfileWorkflow(
			await createSignerPublishContext(signer, async (event) => {
				await publishToAnyRelay(ndk, event)
			}),
			profile,
		)
	} catch (error) {
		console.error('❌ Error during profile publish:', error)
		console.error('Connected relays at time of error:', ndk.pool?.connectedRelays()?.map((r) => r.url) || [])
		throw error
	}
}

/**
 * Mutation hook for updating a user profile.
 * Handles invalidating the related queries for proper cache updates.
 */
export const useUpdateProfileMutation = () => {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: updateProfile,
		onSuccess: async () => {
			// Get the pubkey of the active user (A3.5: from the auth machine, not NDK's signer-derived activeUser).
			const pubkey = getCurrentPubkey()

			if (pubkey) {
				// Invalidate relevant queries to trigger refetching
				await queryClient.invalidateQueries({ queryKey: profileKeys.details(pubkey) })

				toast.success('Profile updated successfully')
			}
		},
		onError: (error) => {
			console.error('Failed to update profile:', error)
			toast.error('Failed to update profile')
		},
	})
}

/**
 * Updates a specific field of the user's profile.
 * Useful for single field updates without affecting other fields.
 *
 * @param field The profile field to update
 * @param value The new value for the field
 */
export const useUpdateProfileFieldMutation = () => {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: async ({ field, value }: { field: string; value: string | undefined }) => {
			// A3.5: the signer comes from the auth session's capability; the merge
			// base stays the NDK user cache exactly as before (kind 0 is replaceable,
			// so the base is load-bearing — see the comment in the merge).
			const signer = getActiveSignerCapability()
			if (!signer) throw new Error('No signer available')

			const user = getAppNdk()?.activeUser
			const updatedProfile = mergeProfileField(user?.profile || {}, field, value)
			await publishProfileWorkflow(
				await createSignerPublishContext(signer, async (event) => {
					const ndk = getAppNdk()
					if (!ndk) throw new Error('NDK not initialized')
					await publishAppNostrEvent(ndk, event)
				}),
				updatedProfile,
			)

			return updatedProfile
		},
		onSuccess: async (updatedProfile, { field }) => {
			// Get the pubkey of the active user (A3.5: from the auth machine, not NDK's signer-derived activeUser).
			const pubkey = getCurrentPubkey()

			if (pubkey) {
				// Invalidate relevant queries
				await queryClient.invalidateQueries({ queryKey: profileKeys.details(pubkey) })

				// If the updated field was nip05, invalidate that query too
				if (field === 'nip05') {
					await queryClient.invalidateQueries({ queryKey: profileKeys.nip05(pubkey) })
				}

				toast.success(`Profile ${field} updated successfully`)
			}
		},
		onError: (error) => {
			console.error('Failed to update profile field:', error)
			toast.error('Failed to update profile')
		},
	})
}
