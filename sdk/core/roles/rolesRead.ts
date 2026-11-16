import type { EventReadContext } from '../event-store/read'
import type { NostrEventLike } from '../nostr/eventLike'
import { buildCurationListFilter, type CurationListEvent } from '../curation/curationRead'
import type { CurationListKey } from '../curation/curationLists'
import { parseAdminSettings, parseEditorSettings } from './roles'
import type { AdminSettings, EditorSettings } from './types'

/**
 * The newest event for a role list from the app's own relay. Takes the host's `EventReadContext`;
 * the binding pins it to the instance's main relay. Exactly one fetch and no deletion lookup: this
 * is the `fetchLatestAppEvent` contract the pre-drain readers had (sort the set, take the newest).
 */
async function readNewestRoleListEvent<E extends NostrEventLike>(
	context: EventReadContext<E>,
	list: CurationListKey,
	appPubkey: string,
): Promise<E | null> {
	// fetch: one blacklist-settings coordinate (single-entity — justified)
	const events = await context.fetch([buildCurationListFilter(list, appPubkey)])
	return [...events].sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))[0] ?? null
}

/**
 * Admin-settings read (kind 30000, `d=admins`) over the host's `EventReadContext`. A missing app pubkey
 * is an error (as the pre-drain reader); no published list is null, matching `fetchLatestAppEvent`.
 */
export async function readAdminSettingsWorkflow<E extends NostrEventLike>(
	context: EventReadContext<E>,
	appPubkey?: string,
): Promise<AdminSettings<E> | null> {
	if (!appPubkey) throw new Error('App pubkey is required')

	const latestEvent = await readNewestRoleListEvent(context, 'admins', appPubkey)
	if (!latestEvent) {
		console.log(`No admin settings found for app pubkey: ${appPubkey}`)
		return null
	}

	return parseAdminSettings(latestEvent, appPubkey)
}

/**
 * Editor-settings read (kind 30000, `d=editors`) over the host's `EventReadContext`. No published list
 * is the empty settings record (the pre-drain reader parsed a null event) — deliberately unlike the
 * admin read, which returns null; both shapes are the pre-drain contract and are pinned by test.
 */
export async function readEditorSettingsWorkflow<E extends NostrEventLike>(
	context: EventReadContext<E>,
	appPubkey?: string,
): Promise<EditorSettings<E>> {
	if (!appPubkey) throw new Error('App pubkey is required')

	const latestEvent = await readNewestRoleListEvent(context, 'editors', appPubkey)
	if (!latestEvent) console.log(`No editor settings found for app pubkey: ${appPubkey}`)

	return parseEditorSettings(latestEvent)
}
