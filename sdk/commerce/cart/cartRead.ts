import { normalizePersistedCart, parseCartPersistenceContent, type PersistedCartContent } from './cartIntent'
import { CART_PERSISTENCE_D_TAG, CART_PERSISTENCE_KIND } from './cartSnapshotPublish'

export const CART_SNAPSHOT_FETCH_LIMIT = 20

// A type alias (not interface) so it stays assignable to relay-client filters with `#${string}` index signatures.
export type CartSnapshotFilter = {
	kinds: number[]
	authors: string[]
	'#d': string[]
	limit: number
}

export function buildCartSnapshotFilter(userPubkey: string): CartSnapshotFilter {
	return {
		kinds: [CART_PERSISTENCE_KIND],
		authors: [userPubkey],
		'#d': [CART_PERSISTENCE_D_TAG],
		limit: CART_SNAPSHOT_FETCH_LIMIT,
	}
}

/** Returns the normalized cart intent, or null when the content fails validation. */
export function parseCartSnapshotEvent(event: { content: string }): PersistedCartContent | null {
	const parsed = parseCartPersistenceContent(event.content)
	if (!parsed) return null
	return normalizePersistedCart(parsed)
}

/** The minimal event shape the snapshot selection needs; a host may pass its richer NDKEvent. */
export interface CartSnapshotEventLike {
	id?: string
	kind?: number
	tags: string[][]
	content: string
	created_at?: number
}

/** Host-supplied relay read: the snapshot history for one buyer. */
export interface CartSnapshotReadPort<E extends CartSnapshotEventLike = CartSnapshotEventLike> {
	fetchEvents(filter: CartSnapshotFilter): Promise<Iterable<E>>
}

function compareStrings(a: string, b: string): number {
	if (a < b) return -1
	if (a > b) return 1
	return 0
}

/** The kind + `d`-tag guard the app adapter applied before content validation. */
function isExpectedCartSnapshotEvent(event: CartSnapshotEventLike): boolean {
	return event.kind === CART_PERSISTENCE_KIND && event.tags.find((tag) => tag[0] === 'd')?.[1] === CART_PERSISTENCE_D_TAG
}

/**
 * The newest valid snapshot: highest `created_at`, `id` descending on ties. An event whose content fails
 * validation is dropped. This is the selection the app adapter (`src/lib/cart-persistence.ts`) delegated
 * to, moved here so the read is framework-free; the app adapter now re-exports it.
 */
export function chooseNewerCartSnapshotEvent<E extends CartSnapshotEventLike>(events: Iterable<E>): E | null {
	const validEvents = [...events].filter(
		(event) => isExpectedCartSnapshotEvent(event) && parseCartPersistenceContent(event.content) !== null,
	)
	if (validEvents.length === 0) return null

	validEvents.sort((a, b) => {
		const byCreatedAt = (b.created_at || 0) - (a.created_at || 0)
		if (byCreatedAt !== 0) return byCreatedAt
		return compareStrings(b.id || '', a.id || '')
	})

	return validEvents[0] ?? null
}

/**
 * Discovery read: the newest valid kind-30078 cart snapshot for `userPubkey` over the host's relay port.
 * An empty pubkey is null without a fetch; no valid snapshot is null. The pre-drain `fetchLatestCartSnapshot`
 * checked the NDK client before this read, so the binding keeps that guard.
 */
export async function readLatestCartSnapshotWorkflow<E extends CartSnapshotEventLike>(
	port: CartSnapshotReadPort<E>,
	userPubkey: string,
): Promise<PersistedCartContent | null> {
	if (!userPubkey) return null

	const events = await port.fetchEvents(buildCartSnapshotFilter(userPubkey))
	const latestEvent = chooseNewerCartSnapshotEvent(events)
	if (!latestEvent) return null

	return parseCartSnapshotEvent(latestEvent)
}
