import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { reactionKeys } from '@sdk/core/query/queryKeyFactory'
import { publishReactionDeletionWorkflow, publishReactionWorkflow, type ReactionRecord } from '@sdk/commerce/messaging'
import { getAppNdk, publishAppNostrEvent, type NDKEvent } from '@platform/web/ndkPublishContext'
import { getActiveSignerCapability } from '@platform/web/auth/authStore'
import { createSignerPublishContext } from '@platform/web/sdkSigner'
import type { NostrEvent } from 'nostr-tools'

/**
 * The NIP-25 reaction publish binding (store drain D2, slice 15).
 *
 * Moved from `src/publish/reactions.tsx`. The binding resolves the app NDK and signer through the
 * Platform publish bridge (`getAppNdk` + the A3.5 capability accessor) instead of importing `@/lib/stores/ndk`, and
 * takes its query keys from `@sdk/core/query/queryKeyFactory` — so a Platform host module consumes
 * it without a counted `platform -> src` edge. A shim remains at the vacated src path for existing
 * call sites; deleted in E1.
 */

type Reaction = ReactionRecord<NDKEvent>

interface PublishReactionParams {
	emoji: string
	event: NDKEvent
}

interface PublishDeletionParams {
	reactionEvent: Reaction
}

/**
 * Publishes a NIP-25 reaction to an event
 *
 * @param emoji - The reaction emoji/content (e.g., '+', '-', '❤️', ':custom:')
 * @param event - The target NDKEvent to react to
 * @returns Promise that resolves to the published reaction event
 */
export const publishReaction = async ({ emoji, event }: PublishReactionParams): Promise<NostrEvent> => {
	const ndk = getAppNdk()
	if (!ndk) throw new Error('NDK not initialized')
	const signer = getActiveSignerCapability()
	if (!signer) throw new Error('No signer available')

	const connectedRelays = ndk.pool?.connectedRelays() || []
	if (connectedRelays.length === 0) {
		throw new Error('No connected relays. Please check your relay connections and try again.')
	}

	try {
		// A3.5: the context's publish half still routes through the NDK publish binding.
		const context = await createSignerPublishContext(signer, async (reactionEvent) => {
			const publishedRelays = await publishAppNostrEvent(ndk, reactionEvent)
			if (publishedRelays.size === 0) throw new Error('Reaction was not published to any relays.')
		})
		return await publishReactionWorkflow(context, { content: emoji, targetEvent: event })
	} catch (error) {
		console.error('Error publishing reaction:', error)
		throw error
	}
}

/**
 * Publishes a deletion event for reactions (NIP-09)
 * This event references reactions to be deleted using 'e' tags
 * @param reactionEvent Reaction Event to Delete
 * @returns Promise awaiting deletion event publish
 */
export const publishDeletionEvent = async ({ reactionEvent }: PublishDeletionParams): Promise<NostrEvent> => {
	console.log('Requesting deletion...')

	const ndk = getAppNdk()
	if (!ndk) throw new Error('NDK not initialized')
	const signer = getActiveSignerCapability()
	if (!signer) throw new Error('No signer available')

	try {
		const context = await createSignerPublishContext(signer, async (deletionEvent) => {
			await publishAppNostrEvent(ndk, deletionEvent)
		})
		return await publishReactionDeletionWorkflow(context, {
			reactionId: reactionEvent.id,
			reactionAuthorPubkey: reactionEvent.authorPubkey,
			emoji: reactionEvent.emoji,
		})
	} catch (error) {
		console.error('Error publishing deletion event:', error)
		throw error
	}
}

/**
 * Mutation hook for publishing a reaction
 */
export const usePublishReactionMutation = () => {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: publishReaction,
		onSuccess: async (_, variables) => {
			// Invalidate reactions query for the target event
			await queryClient.invalidateQueries({
				queryKey: reactionKeys.byEvent(variables.event.id, variables.event.pubkey),
			})
			toast.success('Reaction posted!')
		},
		onError: (error) => {
			console.error('Failed to publish reaction:', error)
			toast.error('Failed to post reaction')
		},
	})
}

/**
 * Mutation hook for publishing a deletion event
 */
export const usePublishDeletionMutation = () => {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: publishDeletionEvent,
		onSuccess: async (_, variables) => {
			// Invalidate reactions query for the target event
			await queryClient.invalidateQueries({
				queryKey: reactionKeys.byEvent(variables.reactionEvent.targetEvent.id, variables.reactionEvent.targetEvent.pubkey),
			})
		},
		onError: (error) => {
			console.error('Failed to publish deletion event:', error)
			toast.error('Failed to remove reaction')
		},
	})
}
