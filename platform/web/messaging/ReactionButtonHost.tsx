import { useAuth } from '@platform/web/auth/authStore'
import { usePublishDeletionMutation, usePublishReactionMutation } from '@platform/web/messaging/reactionPublish'
import { useEventReactions } from '@platform/web/messaging/reactionQuery'
import { ReactionButtonView } from '@ui/community/social-buttons'
import { toast } from 'sonner'
import type { ButtonProps } from '@ui/wrappers/button-props'
import type { NDKEvent } from '@platform/web/readContext'

interface ReactionButtonHostProps extends ButtonProps {
	event: NDKEvent
}

/**
 * Host for the pure `@ui/community/social-buttons` reaction button. Moved
 * verbatim from the retiring `src/components/social/ReactionButton.tsx`
 * (H-b kit 6 social cluster) onto its platform homes: the auth store and the
 * platform reaction query/publish bindings. The event type arrives through the
 * read facade, so this host names no transport.
 */
export function ReactionButtonHost({ event, onClick: _onClick, ...props }: ReactionButtonHostProps) {
	const { user, isAuthenticated } = useAuth()
	const { data: reactionsAll } = useEventReactions(event)
	const mutationPublish = usePublishReactionMutation()
	const mutationDelete = usePublishDeletionMutation()

	const latestReaction = reactionsAll?.filter((reaction) => reaction.authorPubkey == user?.pubkey)?.[0]

	const handlePublishReaction = async (emoji: string) => {
		if (!isAuthenticated || !emoji || !event.id || !event.pubkey) return
		await mutationPublish.mutateAsync({ emoji, event })
	}

	const handleDeleteReaction = async () => {
		if (!isAuthenticated || !latestReaction?.id || !latestReaction.authorPubkey) return
		await mutationDelete.mutateAsync({ reactionEvent: latestReaction })
	}

	return (
		<ReactionButtonView
			{...props}
			latestEmoji={latestReaction?.emoji ?? null}
			canPickEmoji={isAuthenticated}
			onPress={() => {
				if (!isAuthenticated) {
					toast.error('You must be logged in to react.')
					return
				}
				void (latestReaction ? handleDeleteReaction() : handlePublishReaction('❤️'))
			}}
			onSelectEmoji={(emoji) => void handlePublishReaction(emoji)}
			disabled={!event.ndk}
			tooltip={isAuthenticated ? undefined : 'React'}
		/>
	)
}
