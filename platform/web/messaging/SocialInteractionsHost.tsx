import { ZapButtonHost } from '@platform/web/payments/ZapButtonHost'
import { ReactionButtonHost } from '@platform/web/messaging/ReactionButtonHost'
import { CommentButtonHost } from '@platform/web/messaging/CommentButtonHost'
import { ShareButtonHost } from '@platform/web/messaging/ShareButtonHost'
import { ReactionsListHost } from '@platform/web/messaging/ReactionsListHost'
import { ZapsListHost } from '@platform/web/messaging/ZapsListHost'
import { SocialInteractionsView } from '@ui/community/social-interactions-view'
import { Reply } from 'lucide-react'
import type { NDKEvent } from '@platform/web/readContext'
import type { ButtonVariant } from '@ui/wrappers/button-props'

interface SocialInteractionsHostProps {
	event: NDKEvent
	onCommentButtonPressed?: () => void
	showCommentAsReplyIcon?: boolean
	hideShareButton?: boolean
	buttonVariant?: ButtonVariant
	combineZapsAndReactions?: boolean
	className?: string
}

/**
 * Host for the pure `@ui/community/social-interactions-view`: composes the
 * four sibling action hosts (reaction/zap/comment/share) and the two list
 * hosts around the event. Reproduces the retiring
 * `src/components/social/SocialInteractions.tsx` (H-b kit 6); the members are
 * the H-e3 social cluster's leaves and retire with their own slices, so they
 * are still imported from src/ here under the measured drain.
 */
export function SocialInteractionsHost({
	event,
	onCommentButtonPressed,
	showCommentAsReplyIcon = false,
	hideShareButton = false,
	buttonVariant,
	combineZapsAndReactions = false,
	className,
}: SocialInteractionsHostProps) {
	return (
		<SocialInteractionsView
			reactionButton={<ReactionButtonHost event={event} variant={buttonVariant} />}
			zapButton={<ZapButtonHost event={event} variant={buttonVariant} />}
			commentButton={
				<CommentButtonHost
					event={event}
					onClick={onCommentButtonPressed}
					icon={showCommentAsReplyIcon ? <Reply className="w-6 h-6" /> : undefined}
					tooltip={showCommentAsReplyIcon ? 'Reply' : undefined}
					variant={buttonVariant}
				/>
			}
			shareButton={!hideShareButton ? <ShareButtonHost event={event} variant={buttonVariant} /> : null}
			zapsList={<ZapsListHost event={event} />}
			reactionsList={<ReactionsListHost event={event} />}
			combineZapsAndReactions={combineZapsAndReactions}
			hideShareButton={hideShareButton}
			className={className}
		/>
	)
}
