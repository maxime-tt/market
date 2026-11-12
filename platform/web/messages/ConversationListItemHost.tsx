import { useBreakpoint } from '@platform/web/app/useBreakpoint'
import { appNotificationsBinding, unseenMessagesFor } from '@platform/web/notifications'
import { UserCardHost } from '@platform/web/profiles/userCardHosts'
import { ConversationListItemView } from '@ui/messages/messaging-views'
import { useRouterState } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'

export interface ConversationItemData {
	pubkey: string
	profile: { displayName?: string; name?: string; avatar?: string } | undefined
	lastMessageAt: number | undefined
	lastMessageSnippet: string
	lastMessageKind: number | undefined
	isUnread?: boolean
}

export const conversationHref = (pubkey: string) => `/dashboard/sales/messages/${pubkey}`

interface ConversationListItemHostProps {
	conversation: ConversationItemData
}

/**
 * Platform host for the messages conversation row. It wires the derived unseen
 * counts and route state and delegates rendering to
 * `@ui/messages/messaging-views`; the identity rendering is delegated to the
 * reusable `UserCardHost`. Replaces the retiring
 * `src/components/messages/ConversationListItem.tsx`.
 */
export function ConversationListItemHost({ conversation }: ConversationListItemHostProps) {
	const { pubkey, lastMessageAt, lastMessageSnippet } = conversation
	const breakpoint = useBreakpoint()
	const ledgerCounts = useStore(appNotificationsBinding.store, (snapshot) => snapshot.ledger.counts)
	const href = conversationHref(pubkey)
	const isActive = useRouterState({ select: (state) => state.location.pathname === href })

	return (
		<ConversationListItemView
			href={href}
			userCard={<UserCardHost pubkey={pubkey} size="sm" onPress="none" />}
			lastMessageAt={lastMessageAt}
			lastMessageSnippet={lastMessageSnippet}
			unseenCount={unseenMessagesFor(ledgerCounts, pubkey)}
			isMobile={breakpoint === 'sm'}
			isActive={isActive}
		/>
	)
}
