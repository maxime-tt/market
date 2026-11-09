import { EntityActionsMenu } from '@ui/permissions/entity-actions-menu'
import type { EntityPermissions } from '@ui/permissions/entity-permissions'

import type { WidgetLibrary } from '../libraries'

/**
 * Permission-gated entity actions, drained into ui/permissions.
 *
 * `EntityActionsMenu` is props-only: the host resolves the role, the ownership
 * and the callbacks (`useEntityPermissions()` in `platform/web/permissions/`)
 * and passes them in. Each entry is therefore a literal `EntityPermissions`
 * object, one per meaningful role, so the catalogue shows exactly which arms a
 * role unlocks.
 */

const SELLER_PUBKEY = 'd943e96d0c7828b0e0c2b2d1f0a5b6c7d8e9f0a1b2c3d4e5f60718293a4b5c782'
const BUYER_PUBKEY = 'aabb0011223344556677889900aabbccddeeff0011223344556677889900aabb'

const OWNER: EntityPermissions = {
	userRole: 'owner',
	currentUserPubkey: SELLER_PUBKEY,
	isEntityOwner: true,
	canEdit: true,
	canDelete: true,
	canBlacklist: true,
	canSetFeatured: true,
	canManageTestLabel: true,
	canAddToCart: false,
	isLoading: false,
}

/** An operator looking at somebody else's listing: moderation arms only. */
const OPERATOR: EntityPermissions = {
	userRole: 'editor',
	currentUserPubkey: BUYER_PUBKEY,
	isEntityOwner: false,
	canEdit: false,
	canDelete: false,
	canBlacklist: true,
	canSetFeatured: true,
	canManageTestLabel: true,
	canAddToCart: true,
	isLoading: false,
}

const BUYER: EntityPermissions = {
	userRole: 'user',
	currentUserPubkey: BUYER_PUBKEY,
	isEntityOwner: false,
	canEdit: false,
	canDelete: false,
	canBlacklist: false,
	canSetFeatured: false,
	canManageTestLabel: false,
	canAddToCart: true,
	isLoading: false,
}

export const permissions: WidgetLibrary = {
	name: 'permissions',
	entries: [
		{
			name: 'EntityActionsMenuOwner',
			render: () => (
				<EntityActionsMenu
					permissions={OWNER}
					entityType="product"
					entityId="30402:owner:item"
					entityCoords="30402:owner:item"
					canManageTestLabel
					onEdit={() => {}}
					onBlacklist={() => {}}
					onSetFeatured={() => {}}
					onMarkTestLabel={() => {}}
				/>
			),
		},
		{
			name: 'EntityActionsMenuOperator',
			render: () => (
				<EntityActionsMenu
					permissions={OPERATOR}
					entityType="collection"
					entityId="30405:owner:autumn-drops"
					entityCoords="30405:owner:autumn-drops"
					isBlacklisted
					onBlacklist={() => {}}
					onSetFeatured={() => {}}
				/>
			),
		},
		{
			// The menu returns null when a role unlocks nothing; the note keeps the
			// absence visible in the catalogue instead of rendering an empty cell.
			name: 'EntityActionsMenuBuyer',
			render: () => (
				<div className="flex flex-col gap-2">
					<EntityActionsMenu permissions={BUYER} entityType="profile" entityId={SELLER_PUBKEY} />
					<p className="text-xs text-muted-foreground">
						A buyer has no owner or moderation arms on somebody else&apos;s profile, so the menu renders nothing.
					</p>
				</div>
			),
		},
	],
}
