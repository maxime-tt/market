import type { CurationListEvent } from '../curation/curationRead'

/** The app's admin list (kind 30000, `d=admins`), owner first. `event` is the list event itself. */
export interface AdminSettings<E = CurationListEvent> {
	admins: string[]
	owner: string
	lastUpdated: number
	event: E
}

/** The app's editor list (kind 30000, `d=editors`); `null` when no list has been published. */
export interface EditorSettings<E = CurationListEvent> {
	editors: string[]
	lastUpdated: number
	event: E | null
}

/** The four platform roles, highest first. */
export type UserRole = 'owner' | 'admin' | 'editor' | 'user'

/** Current role lists; `null` means no list event was found. */
export interface RoleListsState {
	admins: string[] | null
	editors: string[] | null
	owner?: string
}

/** Lists to republish; omitted lists are unchanged. */
export interface RoleChangePlan {
	admins?: string[]
	editors?: string[]
}

export type RoleChangeIssue =
	| 'no-admin-list'
	| 'no-editor-list'
	| 'already-admin'
	| 'already-editor'
	| 'not-admin'
	| 'not-editor'
	| 'last-admin'
	| 'owner-protected'
	| 'no-roles'

export type RoleChange =
	| 'addAdmin'
	| 'removeAdmin'
	| 'addEditor'
	| 'removeEditor'
	| 'promoteEditorToAdmin'
	| 'demoteAdminToEditor'
	| 'promoteUserToEditor'
	| 'demoteEditorToUser'
	| 'removeFromAllRoles'
