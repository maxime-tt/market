import { UserCardHost } from '@platform/web/profiles/userCardHosts'
import { LiveChatMessageView } from '@ui/messages/live-chat-message-view'
import type { LiveChatMessage } from '@sdk/core/nostr/nip53'

/**
 * Host for the pure `@ui/messages/live-chat-message-view`: resolves the author
 * card and the relative timestamp. Reproduces the retiring
 * `src/components/LiveChatMessage.tsx` (H-b kit 4); the relative-time clock
 * stays host-side so the view renders deterministically in the widget book.
 */
export function LiveChatMessageHost({ message }: { message: LiveChatMessage }) {
	return (
		<LiveChatMessageView
			authorCard={<UserCardHost pubkey={message.authorPubkey} size="xs" />}
			timeLabel={formatRelativeTime(message.createdAt)}
			content={message.content}
		/>
	)
}

function formatRelativeTime(timestamp: number): string {
	const seconds = Math.floor(Date.now() / 1000) - timestamp
	if (seconds < 60) return 'just now'
	if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
	if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
	return `${Math.floor(seconds / 86400)}d`
}
