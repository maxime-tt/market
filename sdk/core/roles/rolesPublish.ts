import type { EventPublishContext } from '../ports/eventPublish'
import type { SignedEventLike } from '../ports/signer'
import { publishCurationListWorkflow, type CurationPublishIssue } from '../curation/curationPublish'
import type { RoleChangePlan } from './types'

export type RoleChangePublishOutcome<SignedEvent> =
	| { ok: true; adminEvent?: SignedEvent; editorEvent?: SignedEvent }
	| ({ ok: false; list: 'admins' | 'editors' } & CurationPublishIssue)

/** Admin list first, then editors; not atomic — a failure after the first publish leaves the first change in place. */
export async function publishRoleChangeWorkflow<SignedEvent extends SignedEventLike>(
	context: EventPublishContext<SignedEvent>,
	plan: RoleChangePlan,
): Promise<RoleChangePublishOutcome<SignedEvent>> {
	const result: { ok: true; adminEvent?: SignedEvent; editorEvent?: SignedEvent } = { ok: true }
	if (plan.admins) {
		const outcome = await publishCurationListWorkflow(context, 'admins', plan.admins)
		if (!outcome.ok) return { ...outcome, list: 'admins' }
		result.adminEvent = outcome.event
	}
	if (plan.editors) {
		const outcome = await publishCurationListWorkflow(context, 'editors', plan.editors)
		if (!outcome.ok) return { ...outcome, list: 'editors' }
		result.editorEvent = outcome.event
	}
	return result
}
