/**
 * The permission flags a component may be told about.
 *
 * This is a props contract, not a data source: `useEntityPermissions()` in
 * `platform/web/permissions/` derives it from the app config, the user role and
 * the entity's owner, then passes it down. It lives in `ui/` because the view
 * that consumes it (`entity-actions-menu`) may not import from `platform/`;
 * the platform hook imports the type from here instead.
 */
export interface EntityPermissions {
	// User role information
	userRole: 'owner' | 'admin' | 'editor' | 'user'
	currentUserPubkey: string | undefined

	// Entity ownership
	isEntityOwner: boolean

	// Permissions
	canEdit: boolean
	canDelete: boolean
	canBlacklist: boolean
	canSetFeatured: boolean
	/** ADR-0009: may mark/unmark test listings (editors UNION admins, + owner). */
	canManageTestLabel: boolean
	canAddToCart: boolean

	// Loading state
	isLoading: boolean
}
