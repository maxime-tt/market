import type { ReactNode } from 'react'

/**
 * Props-only layout for the social action row (H-b kit 6). The four action
 * buttons and two lists arrive as host-built nodes — the retiring
 * `src/components/social/SocialInteractions.tsx` composed its sibling hosts
 * inline, and that wiring (auth, reaction/zap publishing, share/comment
 * dialogs) is app wiring that lives in the platform hosts. This view owns only
 * the row structure the legacy component owned: the button strip and the
 * combined/separated lists layout.
 */
export interface SocialInteractionsViewProps {
	reactionButton: ReactNode
	zapButton: ReactNode
	commentButton: ReactNode
	shareButton: ReactNode
	zapsList: ReactNode
	reactionsList: ReactNode
	/** Render both lists side by side instead of stacked. */
	combineZapsAndReactions?: boolean
	/** Hide the share button (the legacy prop; the comment icon variant is chosen by the host). */
	hideShareButton?: boolean
	/** Extra comment-button content, e.g. the reply icon — forwarded inside the comment slot. */
	commentIcon?: ReactNode
	className?: string
}

export function SocialInteractionsView({
	reactionButton,
	zapButton,
	commentButton,
	shareButton,
	zapsList,
	reactionsList,
	combineZapsAndReactions = false,
	hideShareButton = false,
	commentIcon,
	className,
}: SocialInteractionsViewProps) {
	return (
		<div className={'flex flex-col gap-2 my-2 ' + (className ?? '')} data-testid="social-interactions">
			<div className={'max-w-md flex gap-1 justify-start'}>
				{reactionButton}
				{zapButton}
				{commentIcon ? <span className="flex">{commentIcon}</span> : null}
				{commentButton}
				{!hideShareButton && shareButton}
			</div>
			{combineZapsAndReactions ? (
				<div className="flex flex-wrap gap-2">
					{zapsList}
					{reactionsList}
				</div>
			) : (
				<>
					{zapsList}
					{reactionsList}
				</>
			)}
		</div>
	)
}
