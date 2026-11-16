import type { Result } from '../result'
import { failure, success } from '../result'
import type { RoleChange, RoleChangeIssue, RoleChangePlan, RoleListsState } from './types'

/** Pure role-transition rules: owner and last admin are protected; editors may become empty. */
export function planRoleChange(change: RoleChange, state: RoleListsState, user: string): Result<RoleChangePlan, RoleChangeIssue> {
	const admins = state.admins ?? []
	const editors = state.editors ?? []
	// Named `has*`, not `is*`: these are booleans over the plan's own lists and must not shadow the
	// exported `isAdmin` / `isEditor` predicates of the same subject.
	const hasAdminRole = admins.includes(user)
	const hasEditorRole = editors.includes(user)
	const withoutUser = (list: string[]) => list.filter((pubkey) => pubkey !== user)

	switch (change) {
		case 'addAdmin':
			return hasAdminRole ? failure('already-admin') : success({ admins: [...admins, user] })
		case 'removeAdmin':
			if (!state.admins) return failure('no-admin-list')
			if (!hasAdminRole) return failure('not-admin')
			if (admins.length === 1) return failure('last-admin')
			return success({ admins: withoutUser(admins) })
		case 'addEditor':
			return hasEditorRole ? failure('already-editor') : success({ editors: [...editors, user] })
		case 'removeEditor':
		case 'demoteEditorToUser':
			if (!state.editors) return failure('no-editor-list')
			if (!hasEditorRole) return failure('not-editor')
			return success({ editors: withoutUser(editors) })
		case 'promoteEditorToAdmin':
			if (!state.admins) return failure('no-admin-list')
			if (hasAdminRole) return failure('already-admin')
			if (!hasEditorRole) return failure('not-editor')
			return success({ admins: [...admins, user], editors: withoutUser(editors) })
		case 'demoteAdminToEditor':
			if (!state.admins) return failure('no-admin-list')
			if (!hasAdminRole) return failure('not-admin')
			if (state.owner === user) return failure('owner-protected')
			if (admins.length === 1) return failure('last-admin')
			return success({ admins: withoutUser(admins), editors: hasEditorRole ? editors : [...editors, user] })
		case 'promoteUserToEditor':
			if (hasAdminRole) return failure('already-admin')
			if (hasEditorRole) return failure('already-editor')
			return success({ editors: [...editors, user] })
		case 'removeFromAllRoles': {
			const plan: RoleChangePlan = {}
			if (state.admins && hasAdminRole) {
				if (state.owner === user) return failure('owner-protected')
				if (admins.length === 1) return failure('last-admin')
				plan.admins = withoutUser(admins)
			}
			if (state.editors && hasEditorRole) plan.editors = withoutUser(editors)
			return plan.admins || plan.editors ? success(plan) : failure('no-roles')
		}
	}
}
