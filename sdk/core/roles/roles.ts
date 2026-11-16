import { readCurationListItems } from '../curation/curationLists'
import type { CurationListEvent } from '../curation/curationRead'
import type { AdminSettings, EditorSettings, UserRole } from './types'

/** Owner is the first listed admin, falling back to the app pubkey. */
export function parseAdminSettings<E extends CurationListEvent>(event: E, appPubkey: string): AdminSettings<E> {
	const admins = readCurationListItems('admins', event.tags)
	return { admins, owner: admins[0] || appPubkey, lastUpdated: event.created_at ?? 0, event }
}

export function parseEditorSettings<E extends CurationListEvent>(event: E | null): EditorSettings<E> {
	if (!event) return { editors: [], lastUpdated: 0, event: null }
	return { editors: readCurationListItems('editors', event.tags), lastUpdated: event.created_at ?? 0, event }
}

/**
 * Membership is an exact `includes` match on the hex pubkey, not `isHexPubkey`'s case-insensitive
 * regex: a differently-cased pubkey is simply not an admin. Pinned by `roles.test.ts` — see `roles.md`.
 */
export function isAdmin(adminSettings: AdminSettings<unknown> | null | undefined, pubkey: string): boolean {
	if (!adminSettings || !pubkey) return false
	return adminSettings.admins.includes(pubkey)
}

export function isOwner(adminSettings: AdminSettings<unknown> | null | undefined, pubkey: string): boolean {
	if (!adminSettings || !pubkey) return false
	return adminSettings.owner === pubkey
}

export function isEditor(editorSettings: EditorSettings<unknown> | null | undefined, pubkey: string): boolean {
	if (!editorSettings || !pubkey) return false
	return editorSettings.editors.includes(pubkey)
}

export function getFormattedAdmins(adminSettings: AdminSettings<unknown> | null | undefined) {
	if (!adminSettings) return []
	return adminSettings.admins.map((pubkey, index) => ({ pubkey, isOwner: pubkey === adminSettings.owner, index }))
}

export function getFormattedEditors(editorSettings: EditorSettings<unknown> | null | undefined) {
	if (!editorSettings || !editorSettings.editors) return []
	return editorSettings.editors.map((pubkey) => ({ pubkey, role: 'editor' as const }))
}

/** The highest role the pubkey holds: owner beats admin beats editor beats user. */
export function getUserRoleForPubkey(
	adminSettings: AdminSettings<unknown> | null | undefined,
	editorSettings: EditorSettings<unknown> | null | undefined,
	pubkey: string,
): UserRole {
	if (isOwner(adminSettings, pubkey)) return 'owner'
	if (isAdmin(adminSettings, pubkey)) return 'admin'
	if (isEditor(editorSettings, pubkey)) return 'editor'
	return 'user'
}
