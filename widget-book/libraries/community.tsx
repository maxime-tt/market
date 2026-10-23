import { CollectionSkeletons, MerchantSkeletons } from '@ui/community/community-skeletons'
import { CommentButtonView, ReactionButtonView, ShareButtonView, ZapButtonView } from '@ui/community/social-buttons'
import { ReactionsListView, ZapsListView, type ReactionGroup, type ZapListItem } from '@ui/community/social-lists'
import type { WidgetLibrary } from '../libraries'

/**
 * Community-surface placeholders, social buttons, and social lists. Each entry
 * is a literal-prop render so the gallery and the Playwright spec show a
 * deterministic state.
 *
 * The `data-testid`s are part of the contract the community
 * progressive-loading suite asserts on, so the spec pins them here too.
 *
 * Resolving a pubkey into an avatar is host work, so the lists take render
 * props and the book passes plain nodes (same pattern as `auction.tsx`'s
 * `SamplePartyIdentity`).
 */

/** Stand-in for the host's `<AvatarUser>` resolution; sizing comes from the list. */
function SampleAvatar(pubkey: string, className: string) {
	return (
		<span
			className={'flex items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground ' + className}
		>
			{pubkey.slice(0, 2).toUpperCase()}
		</span>
	)
}

const sampleReactionGroups: ReactionGroup[] = [
	{ emoji: '❤️', count: 3, isOwn: true },
	{ emoji: '🔥', count: 1, isOwn: false },
	{ emoji: '😂', count: 2, isOwn: false },
]

const sampleZaps: ZapListItem[] = [
	{
		id: 'zap-1',
		senderPubkey: 'ab12c34d56e78f90a1b2c3d4e5f60718293a4b5c782d943e96d0c7828b0e0c2b',
		amountMillisats: 21_000,
		message: 'Great listing, thanks!',
	},
	{
		id: 'zap-2',
		senderPubkey: 'cd34e56f7890a1b2c3d4e5f60718293a4b5c782d943e96d0c7828b0e0c2b2d1f0',
		amountMillisats: 5_000,
	},
	{
		id: 'zap-3',
		senderPubkey: 'ef567890a1b2c3d4e5f60718293a4b5c782d943e96d0c7828b0e0c2b2d1f0a5b6',
		amountMillisats: 100_000,
		message: 'This message is long enough to hit the forty-character truncation limit.',
	},
]

export const community: WidgetLibrary = {
	name: 'community',
	entries: [
		{
			name: 'CollectionSkeletons',
			render: () => (
				<div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
					<CollectionSkeletons count={4} />
				</div>
			),
		},
		{
			name: 'MerchantSkeletons',
			render: () => (
				<div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
					<MerchantSkeletons count={3} />
				</div>
			),
		},
		{
			name: 'CommentButtonView',
			render: () => (
				<div className="flex flex-wrap gap-3">
					<CommentButtonView onPress={() => {}} />
					<CommentButtonView variant="ghost" onPress={() => {}} />
				</div>
			),
		},
		{
			name: 'ShareButtonView',
			render: () => <ShareButtonView onPress={() => {}} />,
		},
		{
			name: 'ReactionButtonView',
			render: () => (
				<div className="min-h-20">
					<ReactionButtonView latestEmoji={null} canPickEmoji tooltip="React" onPress={() => {}} onSelectEmoji={() => {}} />
				</div>
			),
		},
		{
			name: 'ReactionButtonViewActive',
			render: () => (
				<div className="min-h-20">
					<ReactionButtonView latestEmoji="🔥" canPickEmoji onPress={() => {}} onSelectEmoji={() => {}} />
				</div>
			),
		},
		{
			name: 'ZapButtonView',
			render: () => (
				<div className="min-h-20">
					<ZapButtonView isCheckingCapability={false} canReceiveZaps isZapping={false} onPress={() => {}} />
				</div>
			),
		},
		{
			name: 'ZapButtonViewDisabled',
			render: () => (
				<div className="min-h-20">
					<ZapButtonView isCheckingCapability={false} canReceiveZaps={false} isZapping={false} onPress={() => {}} />
				</div>
			),
		},
		{
			name: 'ReactionsListView',
			render: () => <ReactionsListView groups={sampleReactionGroups} onToggle={() => {}} />,
		},
		{
			name: 'ZapsListView',
			render: () => <ZapsListView zaps={sampleZaps} renderAvatar={SampleAvatar} />,
		},
	],
}
