import { readThroughStore, type EventReadContext } from '../event-store/read'
import type { NostrEventLike } from '../nostr/eventLike'
import {
	APP_SPECIFIC_DATA_KIND,
	DEFAULT_RELAY_PREFERENCES,
	parseRelayListTags,
	RELAY_LIST_KIND,
	RELAY_PREFERENCES_D_TAG,
	type RelayPreference,
	type RelayPreferencesSettings,
} from './relayListPublish'

// A type alias (not interface) so it stays assignable to relay-client filters with `#${string}` index signatures.
export type RelayListFilter = {
	kinds: number[]
	authors: string[]
	'#d'?: string[]
	limit?: number
}

export function buildRelayListFilter(pubkey: string): RelayListFilter {
	return { kinds: [RELAY_LIST_KIND], authors: [pubkey], limit: 1 }
}

export function buildRelayPreferencesFilter(pubkey: string): RelayListFilter {
	return { kinds: [APP_SPECIFIC_DATA_KIND], authors: [pubkey], '#d': [RELAY_PREFERENCES_D_TAG], limit: 1 }
}

/** First event with the highest positive `created_at`; events without one never win. */
export function pickMostRecentTimestampedEvent<E extends { created_at?: number }>(events: Iterable<E>): E | undefined {
	let mostRecent: E | undefined
	let mostRecentTimestamp = 0
	for (const event of events) {
		if (event.created_at && event.created_at > mostRecentTimestamp) {
			mostRecent = event
			mostRecentTimestamp = event.created_at
		}
	}
	return mostRecent
}

export function parseRelayListEvents(events: Iterable<{ tags: string[][]; created_at?: number }>): RelayPreference[] {
	const event = pickMostRecentTimestampedEvent(events)
	return event ? parseRelayListTags(event.tags) : []
}

/** Missing `includeAppDefaults` falls back to the default. Throws on invalid JSON or `null` content. */
export function parseRelayPreferencesContent(content: string): RelayPreferencesSettings {
	const parsed = JSON.parse(content)
	return { includeAppDefaults: parsed.includeAppDefaults ?? DEFAULT_RELAY_PREFERENCES.includeAppDefaults }
}

/**
 * Query keys for the relay-list read. Framework-free so the SDK read model and the
 * React binding in `platform/web/relays/` share one key. Key shape is unchanged by the
 * store drain.
 */
export const relayListKeys = {
	all: ['relay-list'] as const,
	user: (pubkey: string) => [...relayListKeys.all, pubkey] as const,
} as const

/** Query keys for the relay-preferences read. */
export const relayPreferencesKeys = {
	all: ['relay-preferences'] as const,
	user: (pubkey: string) => [...relayPreferencesKeys.all, pubkey] as const,
} as const

/**
 * Discovery read: the user's current NIP-65 relay list, merged through the host's
 * `EventReadContext` (fetch + store) so superseded and author-deleted versions never
 * surface. Takes the port as a parameter; the binding owns the connection.
 */
export async function readRelayListWorkflow<E extends NostrEventLike>(
	context: EventReadContext<E>,
	userPubkey: string,
): Promise<RelayPreference[]> {
	const events = await readThroughStore(context, [buildRelayListFilter(userPubkey)])
	return parseRelayListEvents(events)
}

/**
 * Discovery read: the user's current kind-30078 relay preferences, or `null` when none is
 * published. Malformed content is treated as absent, matching the historical reader.
 */
export async function readRelayPreferencesWorkflow<E extends NostrEventLike>(
	context: EventReadContext<E>,
	userPubkey: string,
): Promise<RelayPreferencesSettings | null> {
	const events = await readThroughStore(context, [buildRelayPreferencesFilter(userPubkey)])
	const mostRecentEvent = pickMostRecentTimestampedEvent(events)
	if (!mostRecentEvent) return null
	try {
		return parseRelayPreferencesContent(mostRecentEvent.content)
	} catch (error) {
		console.error('Error parsing relay preferences:', error)
		return null
	}
}
