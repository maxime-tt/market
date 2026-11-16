import { getActiveSignerCapability } from '@platform/web/auth/authStore'
import { ndkActions } from '@platform/web/ndk/ndkStore'
import { publishAppNostrEvent } from '@platform/web/ndkPublishContext'

export interface DeletionResult {
	success: boolean
	error?: string
	requestedEvents?: string[]
}

/**
 * Delete PII events using NIP-09 Event Deletion
 * @param eventIds Array of event IDs to delete
 * @param onProgress Callback to report deletion progress
 * @returns DeletionResult with status
 */
export async function deletePIIEvents(eventIds: string[], onProgress?: (deletedCount: number) => void): Promise<DeletionResult> {
	const ndk = ndkActions.getNDK()
	if (!ndk) {
		return { success: false, error: 'NDK not initialized' }
	}

	// A3.6: the signer is the active capability; the identity it answers (hex
	// pubkey) replaces the NDK user object read.
	const signer = getActiveSignerCapability()
	if (!signer) {
		return { success: false, error: 'No signer available' }
	}

	// Get current user pubkey
	const currentUserPubkey = await signer.getPublicKey()
	if (!currentUserPubkey) {
		return { success: false, error: 'Unable to determine current user pubkey' }
	}

	try {
		// Fetch and validate target events
		const filter = {
			ids: eventIds,
			limit: eventIds.length,
		}

		// Use timeout-safe fetch to prevent hanging
		const events = await ndkActions.fetchEventsWithTimeout(filter, { timeoutMs: 10000 })
		const eventsArray = Array.from(events)
		const foundEventIds = eventsArray.map((event) => event.id)
		const invalidEvents = eventIds.filter((id) => !foundEventIds.includes(id))

		if (invalidEvents.length > 0) {
			return {
				success: false,
				error: `Validation failed: ${invalidEvents.length} events not found`,
			}
		}

		// Validate that all events are kind 16 and authored by current user
		const unauthorizedEvents = eventsArray.filter((event) => event.kind !== 16 || event.pubkey !== currentUserPubkey)

		if (unauthorizedEvents.length > 0) {
			return {
				success: false,
				error: `Validation failed: ${unauthorizedEvents.length} events are not authorized for deletion (must be kind 16 and authored by you)`,
			}
		}

		// Deletion event (kind 5) per NIP-09. This is an `e`-tag deletion of specific
		// events, with `k` tags naming the kinds — NOT the addressable `a`-tag form
		// that `sdk/core/publishing.buildAddressableDeletion` builds, so the SDK
		// helper is not a drop-in here.
		const tags: string[][] = eventIds.map((id) => ['e', id])
		// Add 'k' tags for kinds being deleted (16 for order events)
		tags.push(['k', '16'])

		// Sign through the capability, publish through the NDK publish binding.
		const signedDeletion = await signer.signEvent({
			kind: 5, // Deletion event kind
			content: 'Deleting PII exposure events',
			created_at: Math.floor(Date.now() / 1000),
			tags,
		})
		const publishedRelays = await publishAppNostrEvent(ndk, signedDeletion)

		console.log(`Deletion request published to ${publishedRelays.size} relays`)

		// Call progress callback with total count
		if (onProgress) {
			onProgress(eventIds.length)
		}

		return {
			success: true,
			requestedEvents: eventIds,
		}
	} catch (error) {
		console.error('Failed to request PII event deletion:', error)
		return {
			success: false,
			error: error instanceof Error ? error.message : 'Failed to request deletion',
		}
	}
}

/**
 * Verify that events have been deleted
 * Note: This is best-effort since relays may not immediately delete events
 * @param eventIds Array of event IDs to check
 * @param timeoutMs Timeout in milliseconds for verification
 * @returns Verification result
 */
export async function verifyDeletion(eventIds: string[], timeoutMs: number = 10000): Promise<{ verified: boolean; foundEvents: string[] }> {
	const ndk = ndkActions.getNDK()
	if (!ndk) {
		return { verified: false, foundEvents: [] }
	}

	try {
		// Try to fetch the events we're trying to delete
		const filter = {
			ids: eventIds,
			limit: eventIds.length,
		}

		const events = await ndkActions.fetchEventsWithTimeout(filter, { timeoutMs })
		const foundEventIds = Array.from(events).map((event) => event.id)

		// If we found any of the events, deletion may not be complete
		return {
			verified: foundEventIds.length === 0,
			foundEvents: foundEventIds,
		}
	} catch (error) {
		console.error('Failed to verify deletion:', error)
		return { verified: false, foundEvents: [] }
	}
}
