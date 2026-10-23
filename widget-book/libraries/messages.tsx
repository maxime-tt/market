import { ChatMessageBubbleView, ChatOrderItemView, type ChatMessageEvent } from '@ui/messages/chat-message-bubble-view'
import { ConversationListItemView, ConversationViewLayout, MessageInputView } from '@ui/messages/messaging-views'
import type { ReactNode } from 'react'
import type { WidgetLibrary } from '../libraries'

/**
 * Messaging views drained into ui/messages.
 *
 * The bubbles read a minimal event shape the host normally resolves from NDK,
 * so the entries pass literal events. `renderOrderItem` is the host's product
 * resolver; here it maps the `item` tag to a literal `ChatOrderItemView`.
 */

/** Inline SVG data URI so product thumbnails render without any network. */
const svgImage = (fill: string) =>
	`data:image/svg+xml,${encodeURIComponent(
		`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="${fill}"/><circle cx="100" cy="100" r="55" fill="rgba(255,255,255,0.7)"/></svg>`,
	)}`

const DEMO_IMAGE = svgImage('#3b82f6')

function SampleProfileCard() {
	return (
		<span className="flex items-center gap-2">
			<span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-sm font-semibold">S</span>
			<span className="text-sm font-medium">satoshi</span>
		</span>
	)
}

const OTHER_MESSAGE: ChatMessageEvent = {
	kind: 14,
	content: 'Hey! Is the mug still available?',
	tags: [],
	created_at: 1_760_000_000,
	pubkey: 'abcd',
}

const OWN_MESSAGE: ChatMessageEvent = {
	kind: 14,
	content: 'Yes — one left. Shipping is 500 sats.',
	tags: [],
	created_at: 1_760_000_000,
	pubkey: 'ef01',
}

/** Kind 16, type 1: an order creation the host resolves into item rows. */
const ORDER_MESSAGE: ChatMessageEvent = {
	kind: 16,
	content: '',
	tags: [
		['type', '1'],
		['order', 'order-123'],
		['amount', '17000'],
		['item', '30402:pubkey:mug', '2'],
		['item', '30402:pubkey:vase', '1'],
		['shipping', 'Standard Post'],
		['address', '21 Generation Street, London'],
	],
	pubkey: 'abcd',
}

/** Stand-in for the host's product resolver: `item` tag → literal row. */
function renderOrderItem(itemTag: string[], index: number): ReactNode {
	const label = itemTag[1]?.split(':').pop() ?? 'item'
	return (
		<ChatOrderItemView
			key={index}
			title={label === 'mug' ? 'Handmade mug' : 'Frosted vase'}
			quantity={itemTag[2] ?? '1'}
			price="12,000 sats"
			imageUrl={label === 'mug' ? DEMO_IMAGE : undefined}
		/>
	)
}

const layoutReadyMessages = (
	<div className="space-y-2">
		<ChatMessageBubbleView event={OTHER_MESSAGE} isCurrentUser={false} renderOrderItem={() => null} />
		<ChatMessageBubbleView event={OWN_MESSAGE} isCurrentUser renderOrderItem={() => null} />
	</div>
)

export const messages: WidgetLibrary = {
	name: 'messages',
	entries: [
		{
			// Kind 14 plain chat, one side per alignment.
			name: 'ChatMessageBubbleView',
			render: () => (
				<div className="max-w-md space-y-2">
					<ChatMessageBubbleView event={OTHER_MESSAGE} isCurrentUser={false} renderOrderItem={() => null} />
					<ChatMessageBubbleView event={OWN_MESSAGE} isCurrentUser renderOrderItem={() => null} />
				</div>
			),
		},
		{
			// Kind 16, type 1: the structured order-creation bubble.
			name: 'ChatMessageBubbleViewOrder',
			render: () => (
				<div className="max-w-md">
					<ChatMessageBubbleView event={ORDER_MESSAGE} isCurrentUser={false} renderOrderItem={renderOrderItem} />
				</div>
			),
		},
		{
			name: 'ChatOrderItemView',
			render: () => (
				<ul className="max-w-sm">
					<ChatOrderItemView title="Handmade mug" quantity="2" price="12,000 sats" imageUrl={DEMO_IMAGE} />
					<ChatOrderItemView title="Frosted vase" quantity="1" price={null} />
				</ul>
			),
		},
		{
			name: 'ConversationListItemView',
			render: () => (
				<div className="max-w-sm space-y-3">
					<ConversationListItemView
						href="/messages/satoshi"
						userCard={<SampleProfileCard />}
						lastMessageAt={1_760_000_000}
						lastMessageSnippet="Is the mug still available?"
						unseenCount={3}
						isMobile={false}
						isActive={false}
					/>
					<ConversationListItemView
						href="/messages/alice"
						userCard={<SampleProfileCard />}
						lastMessageAt={1_760_000_000}
						lastMessageSnippet="Thanks, shipped today!"
						unseenCount={0}
						isMobile={false}
						isActive
					/>
					<ConversationListItemView
						href="/messages/bob"
						userCard={<SampleProfileCard />}
						lastMessageAt={1_760_000_000}
						lastMessageSnippet="Mobile timestamp slot"
						unseenCount={0}
						isMobile
						isActive={false}
					/>
				</div>
			),
		},
		{
			// The four resolved states of the conversation pane, side by side.
			name: 'ConversationViewLayout',
			render: () => (
				<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
					{[
						{
							key: 'ready',
							node: (
								<ConversationViewLayout
									isLoading={false}
									errorMessage={null}
									onRetry={() => {}}
									isEmpty={false}
									messages={layoutReadyMessages}
									endRef={() => {}}
									input={<MessageInputView onSendMessage={async () => {}} isSending={false} isLoggedIn />}
								/>
							),
						},
						{
							key: 'loading',
							node: (
								<ConversationViewLayout
									isLoading
									errorMessage={null}
									onRetry={() => {}}
									isEmpty={false}
									messages={null}
									endRef={() => {}}
									input={null}
								/>
							),
						},
						{
							key: 'empty',
							node: (
								<ConversationViewLayout
									isLoading={false}
									errorMessage={null}
									onRetry={() => {}}
									isEmpty
									messages={null}
									endRef={() => {}}
									input={null}
								/>
							),
						},
						{
							key: 'error',
							node: (
								<ConversationViewLayout
									isLoading={false}
									errorMessage="The relay did not respond in time."
									onRetry={() => {}}
									isEmpty={false}
									messages={null}
									endRef={() => {}}
									input={null}
								/>
							),
						},
					].map(({ key, node }) => (
						<div key={key} data-slot={`conversation-layout-${key}`} className="h-64 overflow-hidden rounded-md border p-2">
							{node}
						</div>
					))}
				</div>
			),
		},
		{
			name: 'MessageInputView',
			render: () => (
				<div className="max-w-md">
					<MessageInputView onSendMessage={async () => {}} isSending={false} isLoggedIn />
				</div>
			),
		},
		{
			// Disabled with reason: the placeholder tells the signed-out visitor why.
			name: 'MessageInputViewLoggedOut',
			render: () => (
				<div className="max-w-md">
					<MessageInputView onSendMessage={async () => {}} isSending={false} isLoggedIn={false} />
				</div>
			),
		},
	],
}
