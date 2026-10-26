import { readThroughStore, type EventReadContext } from '../event-store/read'
import type { NostrEventLike } from '../nostr/eventLike'
import { PROFILE_METADATA_KIND } from './profilePublish'

// A type alias (not interface) so it stays assignable to relay-client filters with `#${string}` index signatures.
export type ProfileFilter = {
	kinds: number[]
	authors: string[]
	'#d'?: string[]
	limit?: number
}

export interface ProfileDisplayFields {
	displayName?: unknown
	name?: unknown
	nip05?: unknown
	picture?: unknown
}

export interface ProfileMetadataEvent {
	pubkey: string
	content: string
	tags: string[][]
	created_at?: number
}

export type NostrAuthor = {
	id: string
	name?: string
	about?: string
	picture?: string
	nip05?: string
}

export type ZapMethod = 'nip57' | 'nip61'

export interface ZapCapabilityInfo {
	canReceiveZaps: boolean
	methods: ZapMethod[]
	hasLightning: boolean // nip57 - traditional Lightning zaps
	hasCashu: boolean // nip61 - Cashu/Nutzaps
}

export function buildProfileMetadataFilter(pubkey: string): ProfileFilter {
	return { kinds: [PROFILE_METADATA_KIND], authors: [pubkey] }
}

export function normalizeOptionalString(value: unknown): string | null {
	if (typeof value !== 'string') return null
	const trimmed = value.trim()
	return trimmed.length > 0 ? trimmed : null
}

export function normalizeOptionalPubkey(identifier: string | undefined): string | undefined {
	if (typeof identifier !== 'string') return undefined
	const trimmed = identifier.trim()
	return trimmed.length > 0 ? trimmed : undefined
}

export function getNormalizedProfileDisplayName(profile: ProfileDisplayFields | null | undefined): string | null {
	return normalizeOptionalString(profile?.displayName) ?? normalizeOptionalString(profile?.name)
}

export function getNormalizedProfileNip05(profile: ProfileDisplayFields | null | undefined): string | null {
	return normalizeOptionalString(profile?.nip05)
}

export function getNormalizedProfilePicture(profile: ProfileDisplayFields | null | undefined): string {
	return normalizeOptionalString(profile?.picture) ?? ''
}

/** Newest by `created_at` (missing counts as 0); ties keep input order. */
export function pickLatestEvent<E extends { created_at?: number }>(events: Iterable<E>): E | undefined {
	return [...events].sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))[0]
}

/** A `name` tag wins over content `name`. Throws on invalid JSON content. */
export function parseNostrAuthor(event: ProfileMetadataEvent): NostrAuthor {
	const content = JSON.parse(event.content)
	return {
		id: event.pubkey,
		name: event.tags.find((t) => t[0] === 'name')?.[1] || content?.name,
		about: content?.about,
		picture: content?.picture,
		nip05: content?.nip05,
	}
}

export function isNpubIdentifier(npub: string): boolean {
	return !!npub && npub.startsWith('npub')
}

export function emptyZapCapabilityInfo(): ZapCapabilityInfo {
	return { canReceiveZaps: false, methods: [], hasLightning: false, hasCashu: false }
}

export function summarizeZapMethods(methods: Iterable<string>): ZapCapabilityInfo {
	const list = [...methods] as ZapMethod[]
	return {
		canReceiveZaps: list.length > 0,
		methods: list,
		hasLightning: list.includes('nip57'),
		hasCashu: list.includes('nip61'),
	}
}

/** Exactly 64 hex characters — the same rule as the legacy `isValidHexKey` (`HEX_KEYS_REGEX`). */
export function isValidProfilePubkey(pubkey: string): boolean {
	return /^(?:[0-9a-fA-F]{64})$/.test(pubkey)
}

/**
 * Discovery read: the newest kind-0 profile metadata for `pubkey`, merged through the host's
 * `EventReadContext` so superseded and author-deleted versions never surface. A malformed pubkey
 * is rejected before any relay I/O; no metadata is an error, matching the historical reader.
 */
export async function readAuthorWorkflow<E extends NostrEventLike>(context: EventReadContext<E>, pubkey: string): Promise<NostrAuthor> {
	if (!isValidProfilePubkey(pubkey)) throw new Error('Author pubkey is required')

	const events = await readThroughStore(context, [buildProfileMetadataFilter(pubkey)])
	const latestEvent = pickLatestEvent(events)

	if (!latestEvent) {
		throw new Error('Author not found')
	}

	return parseNostrAuthor(latestEvent)
}
