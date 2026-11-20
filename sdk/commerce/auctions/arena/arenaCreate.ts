/**
 * `arenaCreate.ts` — the pure parse of a **1440 arena auction create**, lifted
 * out of the platform read adapter (`platform/web/auctions/relay/arenaAuctionRead.ts`)
 * so that every consumer of a 1440 create — the web read and the ContextVM
 * live-activity worker (`contextvm/tools/live-activity-worker.ts`) — shares one
 * parse instead of each writing its own (`sdk/AGENTS.md`, "Place a module by
 * what it _is_"; `notes/PLAN-modularization-migration.md` §4 B1).
 *
 * Pure: no network, no React, no relay. A `nostr-tools` `NostrEvent` and a
 * relay-store event are both structurally assignable to
 * {@link ArenaCreateEventLike}.
 *
 * ## What a 1440 is
 *
 * A 1440 is a NIP-01 **regular** kind: the relay stores every version side by
 * side and replaces nothing (`notes/DECISION-auction-kinds-and-editable-allowlist.md`
 * §4). So the identity is `(seller, d)` and:
 *
 * - the **root** is the earliest 1440 by `created_at` for `(seller, d)`;
 * - a later version is a supersession only if its `e` tag names the root;
 * - a supersession is accepted only if every field in
 *   {@link ARENA_CREATE_IMMUTABLE_FIELDS} is unchanged — "display is mutable;
 *   money, time and cryptography are not";
 * - the **canonical** version is the latest accepted one by `created_at`.
 *
 * {@link resolveArenaCreateVersions} applies that rule; the lot's coordinate is
 * `1440:<seller>:<d>` ({@link arenaAuctionCoordinate}), our own convention
 * because a regular kind is not addressable.
 */

import { parseLotMedia, type LotMediaItem } from '../lotMedia'
import { ARENA_AUCTION_CREATE_KIND } from '../constants'

// =========================================================================
// The immutable allow-list (decision §3)
// =========================================================================

/**
 * The fields frozen at first publish. `title` / `description` / `image` /
 * `media` are deliberately absent, because those are the ones a seller may
 * edit, including after the first bid. `auction_id` (the `d` value) is the
 * auction's identity and is enforced separately by the identity check in
 * {@link parseArenaCreateEvent}.
 */
export const ARENA_CREATE_IMMUTABLE_FIELDS = [
	'mode',
	'startPrice',
	'minIncrement',
	'windowSec',
	'durationSec',
	'sellerWallet',
	'v4vSplit',
] as const

export type ArenaCreateImmutableField = (typeof ARENA_CREATE_IMMUTABLE_FIELDS)[number]

/**
 * Which of the frozen fields are numbers on the wire. Compared numerically, so
 * `1000` and `"1000"` are the same value (a producer's type wobble is not a
 * field change); everything else is compared as a trimmed string, and an
 * absent/empty value collapses to `null`. `v4vSplit` is an array of objects and
 * is compared by its canonical JSON serialisation.
 */
const NUMERIC_IMMUTABLE_FIELDS: ReadonlySet<string> = new Set(['startPrice', 'minIncrement', 'windowSec', 'durationSec'])

// =========================================================================
// Shapes
// =========================================================================

/** One committed V4V split row, as read. `role` is untrusted wire text, kept verbatim. */
export interface ArenaCreateV4vSplitRow {
	role: string
	recipientPubkey: string
	allocationBps: number
}

/** The create content, as read — the consolidated protocol's camelCase fields only. */
export interface ArenaCreateContent {
	auctionId: string
	title: string | null
	description: string | null
	/** The lot's image URL (`image` on the wire). */
	image: string | null
	/** Gallery items after `image` (`media` on the wire); unsafe entries are dropped. */
	media: LotMediaItem[]
	/** The opening price (`startPrice` on the wire); `null` when unstated. */
	startPrice: number | null
	minIncrement: number | null
	/** `fixed` | `antisnipe`; `null` when unstated. */
	mode: string | null
	windowSec: number | null
	durationSec: number | null
	sellerWallet: string | null
	v4vSplit: ArenaCreateV4vSplitRow[] | null
}

/**
 * The only fields the parse reads. A `nostr-tools` `NostrEvent` and a
 * relay-store event are both structurally assignable.
 */
export interface ArenaCreateEventLike {
	id: string
	pubkey: string
	created_at: number
	tags: string[][]
	content: string
}

/** One parsed 1440 create. */
export interface ParsedArenaCreate {
	id: string
	pubkey: string
	createdAt: number
	/** The `d` value — the auction's identity within its seller (decision §3). */
	d: string
	/** `content.auction_id`, which must equal `d`; a mismatch is refused, never reconciled. */
	auctionId: string
	/** The `e` tag, when present: the root this version claims to supersede. */
	supersedes: string | null
	content: ArenaCreateContent
	/** The frozen fields as canonical strings — what the immutable check compares. */
	immutable: Record<string, string | null>
}

// =========================================================================
// The parse — one event in, one parsed create or one named refusal out
// =========================================================================

/** The create carries no readable JSON object. */
export const ARENA_REFUSAL_BAD_CONTENT = 'arena.bad_content' as const
/** The create's `d` tag and content `auction_id` disagree — it addresses two auctions at once. */
export const ARENA_REFUSAL_BAD_IDENTITY = 'arena.bad_identity' as const

export type ArenaCreateParseRefusal = typeof ARENA_REFUSAL_BAD_CONTENT | typeof ARENA_REFUSAL_BAD_IDENTITY

export type ArenaCreateParseResult =
	| { ok: true; create: ParsedArenaCreate }
	| { ok: false; reason: ArenaCreateParseRefusal; detail: string }

function tagValue(tags: readonly string[][], name: string): string | null {
	for (const tag of tags) {
		if (tag[0] === name && typeof tag[1] === 'string' && tag[1].length > 0) return tag[1]
	}
	return null
}

/** A number from a JSON value, or `null`. Strings that are not finite numbers are `null`, not `0`. */
function asFiniteNumber(value: unknown): number | null {
	if (typeof value === 'number') return Number.isFinite(value) ? value : null
	if (typeof value === 'string' && value.trim() !== '') {
		const n = Number(value)
		return Number.isFinite(n) ? n : null
	}
	return null
}

function asTrimmedString(value: unknown): string | null {
	return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/**
 * The committed V4V split, or `null`. A row is kept only when its role is a
 * non-empty string, its recipient is a non-empty string, and its allocation is
 * a finite number; anything else is dropped, never coerced. An absent, empty or
 * unparseable split is `null` — "no split stated", not an empty split.
 */
function asV4vSplit(value: unknown): ArenaCreateV4vSplitRow[] | null {
	if (!Array.isArray(value)) return null
	const rows: ArenaCreateV4vSplitRow[] = []
	for (const entry of value) {
		if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue
		const row = entry as Record<string, unknown>
		const role = asTrimmedString(row.role)
		const recipientPubkey = asTrimmedString(row.recipientPubkey)
		const allocationBps = asFiniteNumber(row.allocationBps)
		if (role === null || recipientPubkey === null || allocationBps === null) continue
		rows.push({ role, recipientPubkey, allocationBps })
	}
	return rows.length > 0 ? rows : null
}

function parseJsonObject(content: string): Record<string, unknown> | null {
	let parsed: unknown
	try {
		parsed = JSON.parse(content)
	} catch {
		return null
	}
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
	return parsed as Record<string, unknown>
}

/** Canonical form of one frozen field, for the immutable comparison. */
function canonicalImmutableValue(value: unknown, numeric: boolean): string | null {
	if (value === undefined || value === null) return null
	if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null
	if (typeof value === 'boolean') return String(value)
	if (typeof value === 'string') {
		const trimmed = value.trim()
		if (trimmed === '') return null
		if (numeric) {
			const n = Number(trimmed)
			return Number.isFinite(n) ? String(n) : trimmed
		}
		return trimmed
	}
	return JSON.stringify(value)
}

/** The frozen fields as canonical strings — what {@link resolveArenaCreateVersions} compares. */
export function canonicalImmutableFields(content: Record<string, unknown>): Record<string, string | null> {
	const out: Record<string, string | null> = {}
	for (const field of ARENA_CREATE_IMMUTABLE_FIELDS) {
		out[field] = canonicalImmutableValue(content[field], NUMERIC_IMMUTABLE_FIELDS.has(field))
	}
	return out
}

function createContentOf(content: Record<string, unknown>): ArenaCreateContent {
	return {
		// The identity key stays snake_case on the wire: `MERGED-PROTOCOL-SPEC.md` §8
		// names `auction_id` (the `d` value), the bid and verdict content carry the
		// same key, and the live e2e create does too. Only the money and time fields
		// below are the consolidated protocol's camelCase.
		auctionId: asTrimmedString(content.auction_id) ?? '',
		title: asTrimmedString(content.title),
		description: asTrimmedString(content.description),
		image: asTrimmedString(content.image),
		media: parseLotMedia(content.media),
		startPrice: asFiniteNumber(content.startPrice),
		minIncrement: asFiniteNumber(content.minIncrement),
		mode: asTrimmedString(content.mode),
		windowSec: asFiniteNumber(content.windowSec),
		durationSec: asFiniteNumber(content.durationSec),
		sellerWallet: asTrimmedString(content.sellerWallet),
		v4vSplit: asV4vSplit(content.v4vSplit),
	}
}

/**
 * Parse one raw 1440 create: the identity (`d` vs content `auction_id`), the
 * content, and the frozen-field snapshot. Refuses by name, never guesses.
 *
 * The identity IS the `d` value (`MERGED-PROTOCOL-SPEC.md` §8: `auction_id` is
 * the `d` value). A client may write it twice — the `d` tag and the content key
 * — and must then agree, because a disagreement makes the event address two
 * auctions and neither reading is safe. A client may also write only the tag:
 * the chain's own client does exactly that. A create that names no `d` at all
 * is refused: 1440 is a regular kind, so the `d` is the only stable address for
 * later versions.
 */
export function parseArenaCreateEvent(event: ArenaCreateEventLike): ArenaCreateParseResult {
	const content = parseJsonObject(event.content)
	if (content === null) return { ok: false, reason: ARENA_REFUSAL_BAD_CONTENT, detail: 'create content is not a JSON object' }

	const contentAuctionId = asTrimmedString(content.auction_id)
	const tagD = tagValue(event.tags, 'd')
	if (tagD === null && contentAuctionId === null) {
		return { ok: false, reason: ARENA_REFUSAL_BAD_CONTENT, detail: 'create states no identity (no d tag and no content.auction_id)' }
	}
	if (tagD !== null && contentAuctionId !== null && tagD !== contentAuctionId) {
		return {
			ok: false,
			reason: ARENA_REFUSAL_BAD_IDENTITY,
			detail: `d tag ${JSON.stringify(tagD)} != content.auction_id ${JSON.stringify(contentAuctionId)}`,
		}
	}
	const auctionId = tagD ?? (contentAuctionId as string)

	return {
		ok: true,
		create: {
			id: event.id,
			pubkey: event.pubkey,
			createdAt: event.created_at ?? 0,
			d: tagD ?? auctionId,
			auctionId,
			supersedes: tagValue(event.tags, 'e'),
			content: { ...createContentOf(content), auctionId },
			immutable: canonicalImmutableFields(content),
		},
	}
}

// =========================================================================
// Coordinate, end, and version resolution
// =========================================================================

/**
 * `a = 1440:<seller>:<d>` — our own convention, since 1440 is a regular kind
 * and the relay provides no addressability (decision §4).
 */
export function arenaAuctionCoordinate(seller: string, d: string): string {
	return `${ARENA_AUCTION_CREATE_KIND}:${seller}:${d}`
}

/**
 * The **create-derived** end (`root.created_at + durationSec`), or `null` when
 * the create stated no positive duration. This is the fallback the surfaces
 * label as such; it is never the committed end.
 */
export function createDerivedEndSeconds(create: Pick<ParsedArenaCreate, 'createdAt' | 'content'>): number | null {
	const duration = create.content.durationSec
	if (duration === null || !Number.isFinite(duration) || duration <= 0) return null
	return create.createdAt + duration
}

/** A parsed create reduced to what version resolution needs. */
export interface ArenaCreateVersionLike {
	id: string
	pubkey: string
	createdAt: number
	d: string
	supersedes: string | null
	immutable: Record<string, string | null>
}

/** A deeper 1440 that does not carry `e = <root event id>`: not a supersession of the root (decision §4.3). */
export const ARENA_REFUSAL_NOT_SUPERSEDING_ROOT = 'arena.not_superseding_root' as const
/** A deeper 1440 that changes a field frozen at first publish (decision §3). */
export const ARENA_REFUSAL_IMMUTABLE_CHANGED = 'arena.immutable_field_changed' as const

export type ArenaCreateVersionRefusal =
	| typeof ARENA_REFUSAL_NOT_SUPERSEDING_ROOT
	| typeof ARENA_REFUSAL_IMMUTABLE_CHANGED

/** A create version refused by the supersession rule or the immutable check. */
export interface RejectedArenaCreateVersion<T> {
	event: T
	reason: ArenaCreateVersionRefusal
	/** For `arena.immutable_field_changed`: the field that moved. */
	field: ArenaCreateImmutableField | null
	detail: string
}

export interface ArenaCreateVersions<T> {
	/** The earliest create for `(seller, d)` — the version bids bind to. */
	root: T
	/** The root plus every supersession that passed the immutable check, unordered. */
	accepted: T[]
	/** Versions that are not supersessions of the root, or that change a frozen field. */
	rejected: RejectedArenaCreateVersion<T>[]
}

/** Order: `created_at` ascending, ties to the lexically lowest id. */
function byOldestThenId(a: { createdAt: number; id: string }, b: { createdAt: number; id: string }): number {
	if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt
	return a.id.localeCompare(b.id)
}

/**
 * The immutable check (decision §3): the first frozen field whose value differs
 * from the root's, or `null` when every one is unchanged.
 */
export function findImmutableChange(
	root: Pick<ArenaCreateVersionLike, 'immutable'>,
	update: Pick<ArenaCreateVersionLike, 'immutable'>,
): { field: ArenaCreateImmutableField; from: string | null; to: string | null } | null {
	for (const field of ARENA_CREATE_IMMUTABLE_FIELDS) {
		const before = root.immutable[field] ?? null
		const after = update.immutable[field] ?? null
		if (before !== after) return { field, from: before, to: after }
	}
	return null
}

/**
 * Resolve one `(seller, d)` group of create versions to its root, its accepted
 * supersessions, and its rejects (decision §4). The caller picks the
 * **canonical** version from `accepted` — the latest by `created_at`.
 */
export function resolveArenaCreateVersions<T extends ArenaCreateVersionLike>(versions: readonly T[]): ArenaCreateVersions<T> {
	const ordered = [...versions].sort(byOldestThenId)
	const root = ordered[0]
	const accepted: T[] = [root]
	const rejected: RejectedArenaCreateVersion<T>[] = []

	for (const candidate of ordered.slice(1)) {
		if (candidate.supersedes !== root.id) {
			rejected.push({
				event: candidate,
				reason: ARENA_REFUSAL_NOT_SUPERSEDING_ROOT,
				field: null,
				detail: `e tag ${JSON.stringify(candidate.supersedes)} does not name the root ${root.id}`,
			})
			continue
		}
		const change = findImmutableChange(root, candidate)
		if (change !== null) {
			rejected.push({
				event: candidate,
				reason: ARENA_REFUSAL_IMMUTABLE_CHANGED,
				field: change.field,
				detail: `${change.field}: ${JSON.stringify(change.from)} -> ${JSON.stringify(change.to)}`,
			})
			continue
		}
		accepted.push(candidate)
	}

	return { root, accepted, rejected }
}

/**
 * The **canonical** version of a resolved group: the latest accepted one by
 * `created_at` (ties to the lexically lowest id). One place, so the web read and
 * the worker cannot disagree on which version is current.
 */
export function canonicalArenaCreate<T extends ArenaCreateVersionLike>(versions: ArenaCreateVersions<T>): T {
	return [...versions.accepted].sort((a, b) => {
		if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt
		return a.id.localeCompare(b.id)
	})[0]
}
