import type { EventPublishContext } from '../ports/eventPublish'
import type { SignedEventLike } from '../ports/signer'
import { signAndPublish } from '../publishing'
import {
	buildBlacklistEventData,
	buildCurationListEventData,
	isHexPubkey,
	isValidCurationListItem,
	type BlacklistData,
	type CurationListKey,
} from './curationLists'

export type CurationPublishIssue = { issue: 'invalid-item'; item: string } | { issue: 'admins-required' }

export type CurationPublishOutcome<SignedEvent> = { ok: true; event: SignedEvent } | ({ ok: false } & CurationPublishIssue)

/**
 * Curation lists are signed by the curator; the host's `publish` decides where they go
 * (the web host submits them to the app server, which re-signs with the app key).
 */
export async function publishCurationListWorkflow<SignedEvent extends SignedEventLike>(
	context: EventPublishContext<SignedEvent>,
	list: CurationListKey,
	items: readonly string[],
): Promise<CurationPublishOutcome<SignedEvent>> {
	if (list === 'admins' && items.length === 0) return { ok: false, issue: 'admins-required' }
	const invalid = items.find((item) => !isValidCurationListItem(list, item))
	if (invalid !== undefined) return { ok: false, issue: 'invalid-item', item: invalid }

	return { ok: true, event: await signAndPublish(context, buildCurationListEventData(list, items)) }
}

export async function publishBlacklistWorkflow<SignedEvent extends SignedEventLike>(
	context: EventPublishContext<SignedEvent>,
	data: BlacklistData,
): Promise<CurationPublishOutcome<SignedEvent>> {
	const invalid = data.blacklistedPubkeys.find((pubkey) => !isHexPubkey(pubkey))
	if (invalid !== undefined) return { ok: false, issue: 'invalid-item', item: invalid }

	return { ok: true, event: await signAndPublish(context, buildBlacklistEventData(data)) }
}
