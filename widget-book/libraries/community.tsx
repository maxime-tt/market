import { CollectionSkeletons, MerchantSkeletons } from '@ui/community/community-skeletons'
import type { WidgetLibrary } from '../libraries'

/**
 * Community-surface placeholders. Each entry is a literal-prop render so the
 * gallery and the Playwright spec show a deterministic state.
 *
 * The `data-testid`s are part of the contract the community
 * progressive-loading suite asserts on, so the spec pins them here too.
 */

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
	],
}
