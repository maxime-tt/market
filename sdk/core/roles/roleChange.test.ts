/**
 * `roleChange.test.ts` — the role-transition matrix.
 *
 * The branch order inside `planRoleChange` *is* the invariant set, so each verb gets one success and
 * every refusal it can produce. Also pinned: an input `RoleListsState` is never mutated (the functions
 * use `filter`/spread; an in-place `splice` would silently corrupt the caller's cache).
 */
import { describe, expect, test } from 'bun:test'
import { planRoleChange } from './roleChange'
import type { RoleListsState } from './types'

const pk = (char: string) => char.repeat(64)
const owner = pk('o')
const admin = pk('a')
const editor = pk('e')
const stranger = pk('z')

const state: RoleListsState = { admins: [owner, admin], editors: [editor], owner }

describe('planRoleChange — the nine verbs', () => {
	test('addAdmin: appends, refuses an existing admin', () => {
		expect(planRoleChange('addAdmin', state, stranger)).toEqual({ ok: true, value: { admins: [owner, admin, stranger] } })
		expect(planRoleChange('addAdmin', state, admin)).toEqual({ ok: false, error: 'already-admin' })
		// Adding the owner back is also "already" — no duplicate is appended.
		expect(planRoleChange('addAdmin', state, owner)).toEqual({ ok: false, error: 'already-admin' })
	})

	test('removeAdmin: removes, refuses a missing list, a non-admin, and the last admin', () => {
		expect(planRoleChange('removeAdmin', state, admin)).toEqual({ ok: true, value: { admins: [owner] } })
		expect(planRoleChange('removeAdmin', { admins: null, editors: null }, admin)).toEqual({ ok: false, error: 'no-admin-list' })
		expect(planRoleChange('removeAdmin', state, stranger)).toEqual({ ok: false, error: 'not-admin' })
		expect(planRoleChange('removeAdmin', { admins: [admin], editors: null }, admin)).toEqual({ ok: false, error: 'last-admin' })
	})

	test('addEditor: appends, refuses an existing editor', () => {
		expect(planRoleChange('addEditor', state, stranger)).toEqual({ ok: true, value: { editors: [editor, stranger] } })
		expect(planRoleChange('addEditor', state, editor)).toEqual({ ok: false, error: 'already-editor' })
	})

	test('removeEditor and demoteEditorToUser: remove, refuse a missing list and a non-editor', () => {
		for (const change of ['removeEditor', 'demoteEditorToUser'] as const) {
			expect(planRoleChange(change, state, editor)).toEqual({ ok: true, value: { editors: [] } })
			expect(planRoleChange(change, { admins: null, editors: null }, editor)).toEqual({ ok: false, error: 'no-editor-list' })
			expect(planRoleChange(change, state, stranger)).toEqual({ ok: false, error: 'not-editor' })
		}
		// Editors may become empty — only admins may not.
		expect(planRoleChange('removeEditor', { admins: null, editors: [editor] }, editor).ok).toBe(true)
	})

	test('promoteEditorToAdmin: moves across both lists, refuses no list, already-admin, not-editor', () => {
		expect(planRoleChange('promoteEditorToAdmin', state, editor)).toEqual({
			ok: true,
			value: { admins: [owner, admin, editor], editors: [] },
		})
		expect(planRoleChange('promoteEditorToAdmin', { admins: null, editors: [editor] }, editor)).toEqual({
			ok: false,
			error: 'no-admin-list',
		})
		expect(planRoleChange('promoteEditorToAdmin', state, admin)).toEqual({ ok: false, error: 'already-admin' })
		expect(planRoleChange('promoteEditorToAdmin', state, stranger)).toEqual({ ok: false, error: 'not-editor' })
	})

	test('demoteAdminToEditor: protects the owner and the last admin, adds to editors once', () => {
		expect(planRoleChange('demoteAdminToEditor', state, admin)).toEqual({
			ok: true,
			value: { admins: [owner], editors: [editor, admin] },
		})
		expect(planRoleChange('demoteAdminToEditor', { admins: null, editors: [] }, admin)).toEqual({ ok: false, error: 'no-admin-list' })
		expect(planRoleChange('demoteAdminToEditor', state, stranger)).toEqual({ ok: false, error: 'not-admin' })
		expect(planRoleChange('demoteAdminToEditor', state, owner)).toEqual({ ok: false, error: 'owner-protected' })
		expect(planRoleChange('demoteAdminToEditor', { admins: [admin], editors: [], owner }, admin)).toEqual({
			ok: false,
			error: 'last-admin',
		})
	})

	test('demoteAdminToEditor: an admin who is already an editor is not duplicated', () => {
		const both: RoleListsState = { admins: [owner, admin], editors: [admin], owner }
		expect(planRoleChange('demoteAdminToEditor', both, admin)).toEqual({
			ok: true,
			value: { admins: [owner], editors: [admin] },
		})
	})

	test('promoteUserToEditor: appends, refuses already-admin and already-editor', () => {
		expect(planRoleChange('promoteUserToEditor', state, stranger)).toEqual({ ok: true, value: { editors: [editor, stranger] } })
		expect(planRoleChange('promoteUserToEditor', state, admin)).toEqual({ ok: false, error: 'already-admin' })
		expect(planRoleChange('promoteUserToEditor', state, editor)).toEqual({ ok: false, error: 'already-editor' })
	})

	test('removeFromAllRoles: both lists, editor-only, owner-protected, last-admin, no-roles', () => {
		const both: RoleListsState = { admins: [owner, admin], editors: [admin], owner }
		expect(planRoleChange('removeFromAllRoles', both, admin)).toEqual({ ok: true, value: { admins: [owner], editors: [] } })
		expect(planRoleChange('removeFromAllRoles', state, editor)).toEqual({ ok: true, value: { editors: [] } })
		expect(planRoleChange('removeFromAllRoles', state, owner)).toEqual({ ok: false, error: 'owner-protected' })
		expect(planRoleChange('removeFromAllRoles', { admins: [admin], editors: [], owner }, admin)).toEqual({
			ok: false,
			error: 'last-admin',
		})
		expect(planRoleChange('removeFromAllRoles', state, stranger)).toEqual({ ok: false, error: 'no-roles' })
	})
})

describe('planRoleChange — the input is never mutated', () => {
	test('no verb touches the caller state arrays', () => {
		const admins = [owner, admin]
		const editors = [editor, admin]
		const snapshot = { admins: [...admins], editors: [...editors] }
		const live: RoleListsState = { admins, editors, owner }

		planRoleChange('removeAdmin', live, admin)
		planRoleChange('demoteAdminToEditor', live, admin)
		planRoleChange('promoteEditorToAdmin', live, editor)
		planRoleChange('removeFromAllRoles', live, admin)
		planRoleChange('addEditor', live, stranger)
		planRoleChange('addAdmin', live, stranger)

		expect(admins).toEqual(snapshot.admins)
		expect(editors).toEqual(snapshot.editors)
		expect(live.admins).toBe(admins)
		expect(live.editors).toBe(editors)
	})
})
