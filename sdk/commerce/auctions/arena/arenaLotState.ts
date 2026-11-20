/**
 * `arenaLotState.ts` — the app's read of the chain's **state half** for one
 * lot: the **committed end** (kind 1449, `arena.lot.v1`) and the **refusals**
 * (kind 1450, `arena.refused.v1`).
 *
 * ## Why this module exists, and why it is not the create
 *
 * The lot page has, until now, derived its end from the create alone
 * (`root.created_at + durationSec`). That is the **create-derived** end, and it
 * is wrong the moment an anti-snipe extension moves it: the chain commits the
 * new end and publishes it as kind 1449 **while the lot is still open** — the
 * field the plan's increment 3 was blocked on. A reader that kept showing the
 * create-derived end after a bid extended the lot would be stating a deadline
 * the chain has already moved.
 *
 * The other half is **refusal**: the chain can refuse a **create** and states
 * its own reason as kind 1450. A lot whose create the chain refused must be
 * named with the chain's own words, not "not found".
 *
 * Both kinds are published **per validator** and anchored exactly as the money
 * receipts are (`arenaReceiptsRead.ts`) and the params are
 * (`arenaParamsRead.ts`). So a fact is accepted only when, in this order:
 *
 * 1. it has the right **kind** (1449 or 1450);
 * 2. its **signature verifies** (fail closed on unauthenticated content);
 * 3. its content is a JSON object and its **schema** matches the kind;
 * 4. its anchor is **mandatory** and the tags' `height`/`hash` **agree** with
 *    the content's `height`/`block_hash`;
 * 5. the 1449 `auction` tag agrees with the content `auction_id`, and the 1450
 *    `e` tag agrees with the content `event_id` — the anchor is one fact
 *    written twice and a disagreement means the event addresses two states;
 * 6. its signer is a validator the caller's **roster** names — *where a roster
 *    is known*. As with a receipt, a fact does not carry its own roster, so an
 *    absent roster is **not** a refusal.
 *
 * Anything else is refused **by name**, never guessed at.
 *
 * ## Three facts the shape carries
 *
 * - **`extensions` is the per-bid ORDINAL, not the lot's running count.** A lot
 *   can be extended more than once, and a reader that joined late needs the
 *   ordinal that belongs to *that* end. This module exposes it as
 *   {@link ParsedArenaLotState.extensionOrdinal} and a surface must never
 *   render it as "extended N times" (`notes/CHAIN-STATE-HALF-2026-11-18-RESULT.md`
 *   §5.2).
 * - **`original_end_time` is the end this state moved away from** — the end
 *   before this bid's extension. It is carried verbatim, never derived.
 * - **Dedupe is by `(auction_id, end_time)` for 1449 and `(event_id, reason)`
 *   for 1450, preferring the EARLIEST anchored height.** Four validators publish
 *   one each; a validator that restarts may re-publish at a later height. It is
 *   one fact, not several.
 *
 * ## Honesty rule
 *
 * Every field the event did not carry is `null` — never a default, never a `0`.
 * A missing 1449 is *no committed end read*, which is not the same as *the
 * create-derived end*; this module produces nothing and the surface says so in
 * words.
 *
 * Pure: no network, no React, no relay import. A `nostr-tools` `NostrEvent` is
 * assignable to {@link ArenaLotStateEventLike}.
 */

import { ARENA_LOT_SCHEMA, ARENA_LOT_STATE_KIND, ARENA_REFUSED_KIND, ARENA_REFUSED_SCHEMA } from '@sdk/commerce/auctions/constants'
import { verifyNostrEventSignature } from '@sdk/core/nostr/eventSignature'

// =========================================================================
// Input — the only fields a parser reads. A `nostr-tools` `NostrEvent` (and a
// relay-store event) is structurally assignable.
// =========================================================================

export interface ArenaLotStateEventLike {
	id: string
	pubkey: string
	kind: number
	created_at: number
	tags: string[][]
	content: string
	sig: string
}

// =========================================================================
// Named refusals
//
// Names, never message strings, so a caller (and a test) can tell one failure
// mode from another on the wire — the discipline `arenaAnchor.ts:39-58` set.
// =========================================================================

export const ARENA_LOT_STATE_REFUSAL_BAD_KIND = 'arena.lot_state.bad_kind' as const
export const ARENA_LOT_STATE_REFUSAL_BAD_SIGNATURE = 'arena.lot_state.bad_signature' as const
export const ARENA_LOT_STATE_REFUSAL_BAD_SCHEMA = 'arena.lot_state.bad_schema' as const
export const ARENA_LOT_STATE_REFUSAL_BAD_CONTENT = 'arena.lot_state.bad_content' as const
export const ARENA_LOT_STATE_REFUSAL_UNANCHORED = 'arena.lot_state.unanchored' as const
export const ARENA_LOT_STATE_REFUSAL_BAD_ANCHOR = 'arena.lot_state.bad_anchor' as const
export const ARENA_LOT_STATE_REFUSAL_ANCHOR_MISMATCH = 'arena.lot_state.anchor_mismatch' as const
export const ARENA_LOT_STATE_REFUSAL_SIGNER_NOT_IN_ROSTER = 'arena.lot_state.signer_not_in_roster' as const

export type ArenaLotStateRefusalName =
	| typeof ARENA_LOT_STATE_REFUSAL_BAD_KIND
	| typeof ARENA_LOT_STATE_REFUSAL_BAD_SIGNATURE
	| typeof ARENA_LOT_STATE_REFUSAL_BAD_SCHEMA
	| typeof ARENA_LOT_STATE_REFUSAL_BAD_CONTENT
	| typeof ARENA_LOT_STATE_REFUSAL_UNANCHORED
	| typeof ARENA_LOT_STATE_REFUSAL_BAD_ANCHOR
	| typeof ARENA_LOT_STATE_REFUSAL_ANCHOR_MISMATCH
	| typeof ARENA_LOT_STATE_REFUSAL_SIGNER_NOT_IN_ROSTER

/** The one error type every refusal throws, carrying its stable `refusal` name. */
export class ArenaLotStateError extends Error {
	readonly refusal: ArenaLotStateRefusalName

	constructor(refusal: ArenaLotStateRefusalName, message: string) {
		super(message)
		this.name = 'ArenaLotStateError'
		this.refusal = refusal
	}
}

// =========================================================================
// Parsed shapes
// =========================================================================

/**
 * One parsed kind-1449 **committed end** — the lot's end as the chain committed
 * it, published by the validator that committed the bid which moved it.
 *
 * Every unreadable field is `null`; `endTime` and `originalEndTime` are kept
 * verbatim from the content and never re-derived.
 */
export interface ParsedArenaLotState {
	/** The committed-end **event id** — the authority this reading is keyed on. */
	eventId: string
	/** The signing validator, from the event's own pubkey. */
	signerPubkey: string
	/** The auction coordinate, exactly as state keys it (`1440:<seller>:<d>`). */
	auctionId: string
	/** The committed end (unix seconds). */
	endTime: number
	/** The end this state moved away from, or `null` when unreadable. */
	originalEndTime: number | null
	/**
	 * The **per-bid ordinal** of the extension that produced this end — NOT the
	 * lot's running count. `null` when the event did not state it. A surface
	 * must never render this as "extended N times".
	 */
	extensionOrdinal: number | null
	/** The bid's own committed height (the anchor). */
	height: number
	/** The anchored block hash (tag and content agree). */
	blockHash: string
}

/**
 * One parsed kind-1450 refusal — **a create** the chain refused, with the
 * chain's own reason verbatim.
 */
export interface ParsedArenaRefusal {
	/** The refusal **event id** — the authority this reading is keyed on. */
	eventId: string
	/** The signing validator, from the event's own pubkey. */
	signerPubkey: string
	/** The event id the refusal names (a create's id). */
	refusedEventId: string
	/** The refused event's kind (1440 for a create), or `null` when unreadable. */
	refusedKind: number | null
	/** The chain's own reason, verbatim. */
	reason: string
	/** The anchored height (tag and content agree). */
	height: number
	/** The anchored block hash (tag and content agree). */
	blockHash: string
}

/** One refusal, tagged with the event it came from. */
export interface ArenaLotStateRefusal {
	eventId: string
	refusal: ArenaLotStateRefusalName
	detail: string
}

// =========================================================================
// Helpers
// =========================================================================

const HEX = /^[0-9a-fA-F]+$/

function tagValue(tags: readonly string[][], name: string): string | null {
	for (const tag of tags) {
		if (tag[0] === name && typeof tag[1] === 'string' && tag[1].length > 0) return tag[1]
	}
	return null
}

/** A non-empty string, kept verbatim; anything else is unknown (`null`). */
function asNonEmptyString(value: unknown): string | null {
	return typeof value === 'string' && value.length > 0 ? value : null
}

/** A finite number, or `null`. Strings that are not finite numbers are `null`, not `0`. */
function asFiniteNumber(value: unknown): number | null {
	if (typeof value === 'number') return Number.isFinite(value) ? value : null
	if (typeof value === 'string' && value.trim() !== '') {
		const n = Number(value)
		return Number.isFinite(n) ? n : null
	}
	return null
}

/** A positive integer; anything else is `null`. */
function asPositiveInteger(value: unknown): number | null {
	const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN
	return Number.isInteger(n) && n > 0 ? n : null
}

/** A non-negative integer; anything else is `null`. Used for the extension ordinal. */
function asNonNegativeInteger(value: unknown): number | null {
	const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN
	return Number.isInteger(n) && n >= 0 ? n : null
}

function parseContentObject(content: string): Record<string, unknown> {
	let parsed: unknown
	try {
		parsed = JSON.parse(content)
	} catch {
		throw new ArenaLotStateError(ARENA_LOT_STATE_REFUSAL_BAD_CONTENT, 'content is not valid JSON')
	}
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		throw new ArenaLotStateError(ARENA_LOT_STATE_REFUSAL_BAD_CONTENT, 'content JSON is not an object')
	}
	return parsed as Record<string, unknown>
}

/** The schema and label the kind demands — the single place the pair is written. */
function expectedForKind(kind: number): { schema: string; label: string } {
	if (kind === ARENA_LOT_STATE_KIND) return { schema: ARENA_LOT_SCHEMA, label: 'lot-state event' }
	return { schema: ARENA_REFUSED_SCHEMA, label: 'refused event' }
}

/**
 * The schnorr check, at the same parse boundary the params, verdict and
 * receipts paths verify at.
 */
function requireVerifiedSignature(event: ArenaLotStateEventLike): void {
	if (typeof event.sig !== 'string' || event.sig.length === 0) {
		throw new ArenaLotStateError(ARENA_LOT_STATE_REFUSAL_BAD_SIGNATURE, 'event carries no signature')
	}
	let verified = false
	try {
		verified = verifyNostrEventSignature({
			id: event.id,
			pubkey: event.pubkey,
			kind: event.kind,
			created_at: event.created_at,
			tags: event.tags,
			content: event.content,
			sig: event.sig,
		} as Parameters<typeof verifyNostrEventSignature>[0])
	} catch {
		verified = false
	}
	if (!verified) throw new ArenaLotStateError(ARENA_LOT_STATE_REFUSAL_BAD_SIGNATURE, 'event signature does not verify')
}

/**
 * The mandatory anchor, verifying the tag copy **against** the content copy.
 *
 * The tags carry `["height","N"]` and `["hash","<hex>"]`; the content carries
 * `height` and `block_hash`. A value missing from **both** sources is
 * `unanchored` (the client MUST ignore it); present-but-malformed is
 * `bad_anchor`; present on both sides but **unequal** is `anchor_mismatch`.
 */
function requireAgreeingAnchor(tags: string[][], content: Record<string, unknown>, label: string): { height: number; hash: string } {
	const tagHeight = tagValue(tags, 'height')
	const tagHash = tagValue(tags, 'hash')
	const contentHeight = content.height === undefined || content.height === null ? null : String(content.height)
	const contentHash = asNonEmptyString(content.block_hash)

	if (tagHeight === null && contentHeight === null) {
		throw new ArenaLotStateError(ARENA_LOT_STATE_REFUSAL_UNANCHORED, `${label} is missing the mandatory height anchor`)
	}
	if (tagHash === null && contentHash === null) {
		throw new ArenaLotStateError(ARENA_LOT_STATE_REFUSAL_UNANCHORED, `${label} is missing the mandatory hash anchor`)
	}

	const height = asPositiveInteger(tagHeight ?? contentHeight)
	if (height === null) {
		throw new ArenaLotStateError(ARENA_LOT_STATE_REFUSAL_BAD_ANCHOR, `${label} height anchor is not a positive integer`)
	}
	const hash = tagHash ?? contentHash
	if (hash === null || !HEX.test(hash)) {
		throw new ArenaLotStateError(ARENA_LOT_STATE_REFUSAL_BAD_ANCHOR, `${label} hash anchor is not a non-empty hex string`)
	}

	// The tag and content copies are the same fact written twice; a disagreement
	// means the event addresses two chain states and neither reading is safe.
	if (contentHeight !== null && String(height) !== contentHeight.trim()) {
		throw new ArenaLotStateError(
			ARENA_LOT_STATE_REFUSAL_ANCHOR_MISMATCH,
			`tag height ${JSON.stringify(tagHeight)} != content height ${JSON.stringify(contentHeight)}`,
		)
	}
	if (contentHash !== null && tagHash !== null && contentHash.toLowerCase() !== tagHash.toLowerCase()) {
		throw new ArenaLotStateError(
			ARENA_LOT_STATE_REFUSAL_ANCHOR_MISMATCH,
			`tag hash ${JSON.stringify(tagHash)} != content block_hash ${JSON.stringify(contentHash)}`,
		)
	}

	return { height, hash: hash.toLowerCase() }
}

/**
 * Enforce roster membership where a roster is known. An absent/empty roster
 * cannot refuse (the fact does not carry its own validator set), so it is
 * skipped — the same rule `arenaReceiptsRead.ts` applies.
 */
function requireRosterMembership(event: ArenaLotStateEventLike, roster: readonly string[] | null | undefined): void {
	if (!Array.isArray(roster) || roster.length === 0) return
	const signer = event.pubkey.toLowerCase()
	if (!roster.some((pubkey) => pubkey.toLowerCase() === signer)) {
		throw new ArenaLotStateError(
			ARENA_LOT_STATE_REFUSAL_SIGNER_NOT_IN_ROSTER,
			`signer ${event.pubkey} is not on the known validator roster`,
		)
	}
}

// =========================================================================
// The parsers — one event in, one parsed fact or one named refusal out
// =========================================================================

export interface ParseLotStateOptions {
	/**
	 * The committed validator roster, when the caller holds one (from a 1448
	 * params read). A non-empty array enforces membership; an absent/empty roster
	 * cannot refuse a fact and is therefore skipped.
	 */
	roster?: readonly string[] | null
}

/**
 * Parse one kind-1449 committed-end event, verifying it the way the app
 * verifies a kind-1443/1444 receipt or a kind-1448 params event: **signature
 * first** (fail closed on unauthenticated content), then the kind, the schema,
 * the mandatory agreeing anchor, then roster membership where a roster is known.
 */
export function parseArenaLotStateEvent(event: ArenaLotStateEventLike, options: ParseLotStateOptions = {}): ParsedArenaLotState {
	if (event.kind !== ARENA_LOT_STATE_KIND) {
		throw new ArenaLotStateError(ARENA_LOT_STATE_REFUSAL_BAD_KIND, `expected kind ${ARENA_LOT_STATE_KIND}, got ${event.kind}`)
	}
	const expected = expectedForKind(event.kind)

	requireVerifiedSignature(event)

	const content = parseContentObject(event.content)
	if (content.schema !== expected.schema) {
		throw new ArenaLotStateError(
			ARENA_LOT_STATE_REFUSAL_BAD_SCHEMA,
			`content.schema must be ${JSON.stringify(expected.schema)} for kind ${event.kind}, got ${JSON.stringify(content.schema)}`,
		)
	}

	const anchor = requireAgreeingAnchor(event.tags, content, expected.label)

	// The `auction` tag and the content `auction_id` are the same coordinate
	// written twice; a disagreement means the event names two lots.
	const tagAuction = tagValue(event.tags, 'auction')
	const contentAuctionId = asNonEmptyString(content.auction_id)
	if (tagAuction === null && contentAuctionId === null) {
		throw new ArenaLotStateError(ARENA_LOT_STATE_REFUSAL_BAD_CONTENT, 'lot-state event names no auction')
	}
	if (tagAuction !== null && contentAuctionId !== null && tagAuction !== contentAuctionId) {
		throw new ArenaLotStateError(
			ARENA_LOT_STATE_REFUSAL_BAD_CONTENT,
			`auction tag ${JSON.stringify(tagAuction)} != content auction_id ${JSON.stringify(contentAuctionId)}`,
		)
	}
	const auctionId = tagAuction ?? (contentAuctionId as string)

	// The end is load-bearing: a committed end that cannot be read is not a
	// committed end, and refusing here is safer than exposing `null` and letting
	// a surface substitute the create-derived end for it.
	const endTime = asFiniteNumber(content.end_time)
	if (endTime === null) {
		throw new ArenaLotStateError(ARENA_LOT_STATE_REFUSAL_BAD_CONTENT, 'lot-state event states no readable end_time')
	}

	requireRosterMembership(event, options.roster)

	return {
		eventId: event.id,
		signerPubkey: event.pubkey,
		auctionId,
		endTime,
		originalEndTime: asFiniteNumber(content.original_end_time),
		extensionOrdinal: asNonNegativeInteger(content.extensions),
		height: anchor.height,
		blockHash: anchor.hash,
	}
}

/**
 * Parse one kind-1450 refusal event, the same discipline as
 * {@link parseArenaLotStateEvent}. The `e` tag must name the same event id the
 * content does — a refusal that names two events refuses neither safely.
 */
export function parseArenaRefusalEvent(event: ArenaLotStateEventLike, options: ParseLotStateOptions = {}): ParsedArenaRefusal {
	if (event.kind !== ARENA_REFUSED_KIND) {
		throw new ArenaLotStateError(ARENA_LOT_STATE_REFUSAL_BAD_KIND, `expected kind ${ARENA_REFUSED_KIND}, got ${event.kind}`)
	}
	const expected = expectedForKind(event.kind)

	requireVerifiedSignature(event)

	const content = parseContentObject(event.content)
	if (content.schema !== expected.schema) {
		throw new ArenaLotStateError(
			ARENA_LOT_STATE_REFUSAL_BAD_SCHEMA,
			`content.schema must be ${JSON.stringify(expected.schema)} for kind ${event.kind}, got ${JSON.stringify(content.schema)}`,
		)
	}

	const anchor = requireAgreeingAnchor(event.tags, content, expected.label)

	const tagEvent = tagValue(event.tags, 'e')
	const contentEventId = asNonEmptyString(content.event_id)
	if (tagEvent === null && contentEventId === null) {
		throw new ArenaLotStateError(ARENA_LOT_STATE_REFUSAL_BAD_CONTENT, 'refusal names no event')
	}
	// The `e` tag and the content `event_id` are the same fact written twice; a
	// disagreement means the refusal addresses two events.
	if (tagEvent !== null && contentEventId !== null && tagEvent !== contentEventId) {
		throw new ArenaLotStateError(
			ARENA_LOT_STATE_REFUSAL_BAD_CONTENT,
			`e tag ${JSON.stringify(tagEvent)} != content event_id ${JSON.stringify(contentEventId)}`,
		)
	}
	const refusedEventId = tagEvent ?? (contentEventId as string)

	const reason = asNonEmptyString(content.reason)
	if (reason === null) {
		throw new ArenaLotStateError(ARENA_LOT_STATE_REFUSAL_BAD_CONTENT, 'refusal states no reason')
	}

	requireRosterMembership(event, options.roster)

	return {
		eventId: event.id,
		signerPubkey: event.pubkey,
		refusedEventId,
		refusedKind: asPositiveInteger(content.kind),
		reason,
		height: anchor.height,
		blockHash: anchor.hash,
	}
}

/** A refusal predicate, for the edge that must "ignore, not merely distrust". */
export function isVerifiedArenaLotStateEvent(event: ArenaLotStateEventLike, options: ParseLotStateOptions = {}): boolean {
	try {
		parseArenaLotStateEvent(event, options)
		return true
	} catch {
		return false
	}
}

/** A refusal predicate, for the 1450 sibling. */
export function isVerifiedArenaRefusalEvent(event: ArenaLotStateEventLike, options: ParseLotStateOptions = {}): boolean {
	try {
		parseArenaRefusalEvent(event, options)
		return true
	} catch {
		return false
	}
}

// =========================================================================
// Dedupe — one fact, however many heights a validator re-published it at
// =========================================================================

/** The identity of a committed end: `(auction_id, end_time)`. `\0` cannot appear in either. */
export function lotStateKey(state: Pick<ParsedArenaLotState, 'auctionId' | 'endTime'>): string {
	return `${state.auctionId}\u0000${state.endTime}`
}

/** The identity of a refusal: `(event_id, reason)`. */
export function refusalKey(refusal: Pick<ParsedArenaRefusal, 'refusedEventId' | 'reason'>): string {
	return `${refusal.refusedEventId}\u0000${refusal.reason}`
}

/**
 * Reduce a set of parsed committed ends to **one per `(auction_id, end_time)`**,
 * keeping the **earliest anchored height**. Ties at one height break to the
 * lexically lowest event id, so the choice is deterministic. Ordered by anchored
 * height ascending, then auction id.
 */
export function dedupeArenaLotStates(states: readonly ParsedArenaLotState[]): ParsedArenaLotState[] {
	const byKey = new Map<string, ParsedArenaLotState>()
	for (const state of states) {
		const key = lotStateKey(state)
		const prior = byKey.get(key)
		if (prior === undefined) {
			byKey.set(key, state)
			continue
		}
		if (state.height < prior.height || (state.height === prior.height && state.eventId.localeCompare(prior.eventId) < 0)) {
			byKey.set(key, state)
		}
	}
	return [...byKey.values()].sort((a, b) => a.height - b.height || a.auctionId.localeCompare(b.auctionId))
}

/**
 * Reduce a set of parsed refusals to **one per `(event_id, reason)`**, keeping
 * the **earliest anchored height**. Ties at one height break to the lexically
 * lowest event id. Ordered by anchored height ascending, then refused event id.
 */
export function dedupeArenaRefusals(refusals: readonly ParsedArenaRefusal[]): ParsedArenaRefusal[] {
	const byKey = new Map<string, ParsedArenaRefusal>()
	for (const refusal of refusals) {
		const key = refusalKey(refusal)
		const prior = byKey.get(key)
		if (prior === undefined) {
			byKey.set(key, refusal)
			continue
		}
		if (refusal.height < prior.height || (refusal.height === prior.height && refusal.eventId.localeCompare(prior.eventId) < 0)) {
			byKey.set(key, refusal)
		}
	}
	return [...byKey.values()].sort((a, b) => a.height - b.height || a.refusedEventId.localeCompare(b.refusedEventId))
}

// =========================================================================
// The selection — parse a batch, refuse by name, dedupe the survivors
// =========================================================================

export interface ArenaLotStateSelection {
	/** The deduped committed ends, earliest anchored height first. */
	lotStates: ParsedArenaLotState[]
	/** The deduped refusals, earliest anchored height first. */
	refusals: ParsedArenaRefusal[]
	/** Every event that was refused, with its stable name — never silently dropped. */
	eventRefusals: ArenaLotStateRefusal[]
}

const LOT_STATE_KINDS: readonly number[] = [ARENA_LOT_STATE_KIND, ARENA_REFUSED_KIND]

/**
 * Parse a batch of raw kind-1449/1450 events: keep the ones that verify, dedupe
 * the survivors, and record every refusal by name. Deduped by event id first,
 * because two relays can only agree on an id.
 */
export function readArenaLotState(events: readonly ArenaLotStateEventLike[], options: ParseLotStateOptions = {}): ArenaLotStateSelection {
	const byId = new Map<string, ArenaLotStateEventLike>()
	for (const event of events) {
		if (typeof event?.id === 'string' && event.id.length > 0 && LOT_STATE_KINDS.includes(event.kind)) byId.set(event.id, event)
	}

	const eventRefusals: ArenaLotStateRefusal[] = []
	const parsedStates: ParsedArenaLotState[] = []
	const parsedRefusals: ParsedArenaRefusal[] = []
	for (const event of byId.values()) {
		try {
			if (event.kind === ARENA_LOT_STATE_KIND) parsedStates.push(parseArenaLotStateEvent(event, options))
			else parsedRefusals.push(parseArenaRefusalEvent(event, options))
		} catch (error) {
			if (error instanceof ArenaLotStateError) {
				eventRefusals.push({ eventId: event.id, refusal: error.refusal, detail: error.message })
			} else {
				throw error
			}
		}
	}

	return {
		lotStates: dedupeArenaLotStates(parsedStates),
		refusals: dedupeArenaRefusals(parsedRefusals),
		eventRefusals,
	}
}

// =========================================================================
// The selection for one lot — the committed end, and the create's refusal
// =========================================================================

export interface ArenaLotStateForLot {
	/**
	 * The committed end for this lot: the state with the **highest anchored
	 * height** (the newest chain fact about where the end is), or `null` when no
	 * 1449 named it. `null` is *no committed end read*, never the create-derived
	 * end.
	 */
	committedEnd: ParsedArenaLotState | null
	/**
	 * Every committed end read for this lot, ordered by anchored height
	 * ascending — so a surface can see the ordinal history without recomputing
	 * it, and can say "extension 2 of this lot" when it reads several.
	 */
	committedEnds: ParsedArenaLotState[]
	/** The refusal of this lot's create, when the chain published one. */
	createRefusal: ParsedArenaRefusal | null
}

/**
 * Reduce a lot's deduped state to the committed end that decides it, plus the
 * refusal of its create.
 *
 * The committed end is the one at the **highest anchored height**: the chain's
 * latest word on the end wins, and a lower re-publication can never shadow it.
 * `createEventId` is the root create's event id (a 1449 names the coordinate; a
 * 1450 names the create's event id).
 */
export function lotStateForLot(
	selection: Pick<ArenaLotStateSelection, 'lotStates' | 'refusals'>,
	auctionId: string,
	createEventId: string | null,
): ArenaLotStateForLot {
	const states = selection.lotStates.filter((state) => state.auctionId === auctionId).sort((a, b) => a.height - b.height)
	const committedEnd = states.length === 0 ? null : states[states.length - 1]
	const createRefusal =
		createEventId === null ? null : (selection.refusals.find((refusal) => refusal.refusedEventId === createEventId) ?? null)
	return { committedEnd, committedEnds: states, createRefusal }
}
