import { authStore } from '@/lib/stores/auth'
import { useStore } from '@tanstack/react-store'
import { MessageInputView } from '@ui/messages/messaging-views'

interface MessageInputProps {
	onSendMessage: (content: string) => Promise<void>
	isSending: boolean
}

export function MessageInput({ onSendMessage, isSending }: MessageInputProps) {
	const { user } = useStore(authStore)
	return <MessageInputView onSendMessage={onSendMessage} isSending={isSending} isLoggedIn={!!user} />
}
