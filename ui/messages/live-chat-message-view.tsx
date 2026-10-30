import type { ReactNode } from 'react'
import { cn } from '../utils/cn'

/**
 * One NIP-53 live-chat message row. Presentational only: the resolved author
 * card arrives as a host-built node (`authorCard` — the legacy host rendered
 * `UserCard` inline, which is app wiring, not presentation), and the relative
 * timestamp arrives pre-formatted (`timeLabel`) because the clock is data, not
 * markup. Extracted from the retiring `src/components/LiveChatMessage.tsx`
 * (H-b kit 4); the row markup is unchanged apart from the raw palette
 * `text-[10px]` sizing, which stays: it is a size, not a palette class.
 */
export interface LiveChatMessageViewProps {
	/** Resolved author card node (host-owned identity wiring). */
	authorCard: ReactNode
	/** Pre-formatted relative time label, e.g. `5m ago`. */
	timeLabel: string
	/** The message body text. */
	content: string
	className?: string
}

export function LiveChatMessageView({ authorCard, timeLabel, content, className }: LiveChatMessageViewProps) {
	return (
		<div className={cn('flex gap-2 px-3 py-2', className)}>
			<div className="min-w-0 flex-1">
				<div className="flex items-baseline justify-between gap-2">
					{authorCard}
					<span className="text-[10px] text-muted-foreground">{timeLabel}</span>
				</div>
				<p className="text-sm mt-2 text-muted-foreground break-words">{content}</p>
			</div>
		</div>
	)
}
