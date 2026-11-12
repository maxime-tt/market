import { useAuth } from '@platform/web/auth/authStore'
import { usePublishDeletionMutation, usePublishReactionMutation } from '@platform/web/messaging/reactionPublish'
import { groupReactionsByContent, useEventReactions, type Reaction } from '@platform/web/messaging/reactionQuery'
import { ReactionsListView } from '@ui/community/social-lists'
import type { NostrEventLike } from '@sdk/core/nostr/eventLike'

interface ReactionsListHostProps {
	event: NostrEventLike
	asChildren?: boolean
}

/**
 * Host for the pure `@ui/community/social-lists` reactions list. Moved
 * verbatim from the retiring `src/components/social/ReactionsList.tsx`
 * (H-b kit 6 social cluster) onto the platform reaction bindings and auth
 * store; the event type arrives through the read facade, so this host names
 * no transport.
 */
export const ReactionsListHost = ({ event, asChildren = false }: ReactionsListHostProps) => {
	const { user, isAuthenticated } = useAuth()
	const { data: reactions } = useEventReactions(event)
	const reactionsGrouped = reactions && groupReactionsByContent(reactions)
	const reactionsOwnUser = reactions?.filter((reaction) => reaction.authorPubkey == user?.pubkey)

	const mutationPublish = usePublishReactionMutation()
	const mutationDelete = usePublishDeletionMutation()

	const handlePublishReaction = async (emoji: string) => {
		if (!isAuthenticated || !emoji || !event.id || !event.pubkey) return
		await mutationPublish.mutateAsync({ emoji, event })
	}

	const handleDeleteReaction = async (reaction: Reaction) => {
		if (!isAuthenticated || !reaction.id || !reaction.authorPubkey) return
		await mutationDelete.mutateAsync({ reactionEvent: reaction })
	}

	const handleToggle = (emoji: string) => {
		const own = reactionsOwnUser?.find((reaction) => reaction.emoji === emoji)
		void (own ? handleDeleteReaction(own) : handlePublishReaction(emoji))
	}

	const groups = Array.from(reactionsGrouped?.entries() ?? []).map(([emoji, values]) => ({
		emoji,
		count: values.length,
		isOwn: !!reactionsOwnUser?.some((reaction) => reaction.emoji == emoji),
	}))

	return <ReactionsListView groups={groups} onToggle={handleToggle} asChildren={asChildren} />
}
