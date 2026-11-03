import { isAddressableKind } from 'nostr-tools/kinds'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { getEventAddress } from '@sdk/core/nostr/eventLike'
import { commentKeys } from '@sdk/core/query/queryKeyFactory'
import { publishCommentWorkflow, type CommentRecord } from '@sdk/commerce/messaging'
import { getAppNdk, publishAppNostrEvent } from '@platform/web/ndkPublishContext'
import type { NostrEventLike } from '@sdk/core/nostr/eventLike'
import { getActiveSignerCapability } from '@platform/web/auth/authStore'
import { createSignerPublishContext } from '@platform/web/sdkSigner'
import type { NostrEvent } from 'nostr-tools'

/**
 * The NIP-22 comment publish binding (store drain D2, slice 15).
 *
 * Moved from `src/publish/comments.tsx`. The binding resolves the app NDK and signer through the
 * Platform publish bridge (`getAppNdk` + the A3.5 capability accessor) instead of importing `@/lib/stores/ndk`, and
 * takes its query keys and address helper from the SDK subpaths — so a Platform host module
 * consumes it without a counted `platform -> src` edge. A shim remains at the vacated src path for
 * existing call sites; deleted in E1.
 */

type Comment = CommentRecord

interface PublishCommentParams {
	content: string
	targetEvent: NostrEventLike // The event being commented on (Product, Comment, etc.)
	parentComment?: Comment // For replies to other comments
}

/**
 * Publishes a NIP-22 comment on a target event (Product, Comment, etc.)
 * Automatically handles both addressable (A/a tags) and regular (E/e tags) events.
 */
export const publishComment = async ({ content, targetEvent, parentComment }: PublishCommentParams): Promise<NostrEvent> => {
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
		const context = await createSignerPublishContext(signer, async (event) => {
			const publishedRelays = await publishAppNostrEvent(ndk, event)
			if (publishedRelays.size === 0) throw new Error('Comment was not published to any relays.')
		})
		return await publishCommentWorkflow(context, {
			content,
			targetEvent,
			parentComment: parentComment ? { id: parentComment.id, authorPubkey: parentComment.authorPubkey } : undefined,
		})
	} catch (error) {
		console.error('Error publishing comment:', error)
		throw error
	}
}

/**
 * Mutation hook for publishing a comment
 */
export const usePublishCommentMutation = () => {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: publishComment,
		onSuccess: async (event, variables) => {
			const targetCoordinates = isAddressableKind(variables.targetEvent.kind)
				? getEventAddress(variables.targetEvent)
				: variables.targetEvent.id

			await queryClient.invalidateQueries({
				queryKey: commentKeys.byProduct(targetCoordinates),
			})
			toast.success('Comment posted!')
		},
		onError: (error) => {
			console.error('Failed to publish comment:', error)
			toast.error('Failed to post comment')
		},
	})
}
