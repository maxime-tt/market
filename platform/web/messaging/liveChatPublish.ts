import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { liveActivityKeys } from '@sdk/core/query/queryKeyFactory'
import { publishLiveChatMessageWorkflow } from '@sdk/commerce/messaging'
import { createNdkPublishContext, getAppNdk } from '@platform/web/ndkPublishContext'

/**
 * The live-chat message publish binding (store drain D2, slice 7).
 *
 * Moved from `src/publish/liveChat.tsx`. The binding resolves the app NDK through the
 * Platform publish bridge (`getAppNdk`) instead of importing `@/lib/stores/ndk`, and takes
 * its query keys from the relocated `@sdk/core/query/queryKeyFactory` subpath — so a
 * Platform host module consumes it without a counted `platform -> src` edge. A shim remains
 * at the vacated src path for existing call sites; deleted in E1.
 */

interface PublishLiveChatMessageParams {
	liveActivityCoord: string
	content: string
}

export const publishLiveChatMessage = async ({ liveActivityCoord, content }: PublishLiveChatMessageParams) => {
	const ndk = getAppNdk()
	if (!ndk) throw new Error('NDK not initialized')
	if (!ndk.signer) throw new Error('No signer available')

	const connectedRelays = ndk.pool?.connectedRelays() || []
	if (connectedRelays.length === 0) {
		throw new Error('No connected relays')
	}

	const relayHint = connectedRelays[0]?.url ?? ''
	const context = await createNdkPublishContext(ndk, ndk.signer)
	return publishLiveChatMessageWorkflow(context, { liveActivityCoord, content, relayHint })
}

export const usePublishLiveChatMessageMutation = () => {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: publishLiveChatMessage,
		onSuccess: async (_event, variables) => {
			await queryClient.invalidateQueries({
				queryKey: liveActivityKeys.chatMessages(variables.liveActivityCoord),
			})
		},
		onError: (error) => {
			console.error('Failed to send chat message:', error)
			toast.error('Failed to send message')
		},
	})
}
