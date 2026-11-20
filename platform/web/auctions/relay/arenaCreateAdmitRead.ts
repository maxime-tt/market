/**
 * `arenaCreateAdmitRead.ts` — the app's read of the chain's **create-admission
 * fact** (kind 1449, `arena.createadmit.v1`): the chain's own record that it
 * **accepted** one create.
 *
 * ## Why this module exists
 *
 * The state half already names two things a lot can be told: its committed end
 * (`arena.lot.v1`) and a **refusal** of its create (`arena.refused.v1`, kind
 * 1450). Neither is a positive word: an absence of both is *no fact read*, and
 * an app that treated it as "accepted" would follow a create the chain never
 * took. This is the fact that says the chain took it — the positive twin of the
 * refusal — and it is the **gate** the app follows a lot on: an auction the
 * chain has not accepted is not followed at all.
 *
 * ## The discipline is the receipts' — and the bid admission's
 *
 * Kind 1449 carries three schemas, so a fact is accepted only when, in this
 * order:
 *
 * 1. it has the right **kind** (1449);
 * 2. its **signature verifies** (fail closed on unauthenticated content);
 * 3. its content is a JSON object and its **schema** is
 *    `arena.createadmit.v1` — the other two schemas of the kind are refused by
 *    name, never mis-read;
 * 4. its anchor is **mandatory** and the tags' `height`/`hash` **agree** with
 *    the content's `height`/`block_hash`;
 * 5. the `e` tag agrees with the content `root_event_id`, and the `auction` tag
 *    agrees with the content `auction_id` — each is one fact written twice, and
 *    a disagreement means the event addresses two creates;
 * 6. the `p` tag, when present, names the signer itself;
 * 7. its signer is a validator the caller's **roster** names — *where a roster
 *    is known*. As with a receipt, a fact does not carry its own roster, so an
 *    absent roster is **not** a refusal.
 *
 * Anything else is refused **by name**, never guessed at.
 *
 * ## The accepted height, and the anchor height, are two numbers
 *
 * `content.accepted_height` is the chain's own statement of the height it
 * accepted the create at, and it is required: a create-admission that cannot
 * state where it accepted the create is not an acceptance this app will follow.
 * The anchor's `height` is the committed height of the **fact** and is what
 * dedupe uses (the earliest anchored height wins) — a validator that restarts
 * and re-publishes the same acceptance at a later height has still stated one
 * acceptance, at the height it names.
 *
 * ## Honesty rule
 *
 * Every field the event did not carry is `null` — never a default, never a `0`.
 *
 * Pure: no network, no React, no relay import. A `nostr-tools` `NostrEvent` is
 * assignable to {@link ArenaCreateAdmitEventLike}.
 */

import { ARENA_CREATE_ADMIT_SCHEMA, ARENA_LOT_STATE_KIND } from '@sdk/commerce/auctions/constants'
import { verifyNostrEventSignature } from '@sdk/core/nostr/eventSignature'

// =========================================================================
// Input — the only fields a parser reads. A `nostr-tools` `NostrEvent` (and a
// relay-store event) is structurally assignable.
// =========================================================================

export interface ArenaCreateAdmitEventLike {
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
// mode from another on the wire — the discipline `arenaAnchor.ts:39-58` set and
// `arenaLotStateRead.ts` / `arenaBidAdmitRead.ts` follow.
// =========================================================================

export const ARENA_CREATE_ADMIT_REFUSAL_BAD_KIND = 'arena.create_admit.bad_kind' as const
export const ARENA_CREATE_ADMIT_REFUSAL_BAD_SIGNATURE = 'arena.create_admit.bad_signature' as const
export const ARENA_CREATE_ADMIT_REFUSAL_BAD_SCHEMA = 'arena.create_admit.bad_schema' as const
export const ARENA_CREATE_ADMIT_REFUSAL_BAD_CONTENT = 'arena.create_admit.bad_content' as const
export const ARENA_CREATE_ADMIT_REFUSAL_UNANCHORED = 'arena.create_admit.unanchored' as const
export const ARENA_CREATE_ADMIT_REFUSAL_BAD_ANCHOR = 'arena.create_admit.bad_anchor' as const
export const ARENA_CREATE_ADMIT_REFUSAL_ANCHOR_MISMATCH = 'arena.create_admit.anchor_mismatch' as const
export const ARENA_CREATE_ADMIT_REFUSAL_P_TAG_MISMATCH = 'arena.create_admit.p_tag_mismatch' as const
export const ARENA_CREATE_ADMIT_REFUSAL_SIGNER_NOT_IN_ROSTER = 'arena.create_admit.signer_not_in_roster' as const

export type ArenaCreateAdmitRefusalName =
	| typeof ARENA_CREATE_ADMIT_REFUSAL_BAD_KIND
	| typeof ARENA_CREATE_ADMIT_REFUSAL_BAD_SIGNATURE
	| typeof ARENA_CREATE_ADMIT_REFUSAL_BAD_SCHEMA
	| typeof ARENA_CREATE_ADMIT_REFUSAL_BAD_CONTENT
	| typeof ARENA_CREATE_ADMIT_REFUSAL_UNANCHORED
	| typeof ARENA_CREATE_ADMIT_REFUSAL_BAD_ANCHOR
	| typeof ARENA_CREATE_ADMIT_REFUSAL_ANCHOR_MISMATCH
	| typeof ARENA_CREATE_ADMIT_REFUSAL_P_TAG_MISMATCH
	| typeof ARENA_CREATE_ADMIT_REFUSAL_SIGNER_NOT_IN_ROSTER

/** The one error type every refusal throws, carrying its stable `refusal` name. */
export class ArenaCreateAdmitError extends Error {
	readonly refusal: ArenaCreateAdmitRefusalName

	constructor(refusal: ArenaCreateAdmitRefusalName, message: string) {
		super(message)
		this.name = 'ArenaCreateAdmitError'
		this.refusal = refusal
	}
}

// =========================================================================
// Parsed shape
// =========================================================================

/**
 * One parsed kind-1449 **create-admission** fact — the chain's own record that
 * it accepted a create.
 *
 * `acceptedHeight` is the height the chain says it accepted the create at, and
 * `height`/`blockHash` are the mandatory anchor of the fact itself (what dedupe
 * uses). `endTime`/`originalEndTime`/`mode`/`seller` are carried verbatim when
 * the event stated them, and are `null` when it did not.
 */
export interface ParsedArenaCreateAdmit {
	/** The create-admission **event id** — the authority this reading is keyed on. */
	eventId: string
	/** The signing validator, from the event's own pubkey. */
	signerPubkey: string
	/** The auction coordinate, exactly as the chain keys it (`1440:<seller>:<d>`). */
	auctionId: string
	/** The seller the content named, verbatim; `null` when the event stated none. */
	seller: string | null
	/** The create's **root event id** — the create this acceptance is about. */
	rootEventId: string
	/** The height the chain states it accepted the create at (the positive fact). */
	acceptedHeight: number
	/** The end the chain named for the lot, or `null` when the event stated none. */
	endTime: number | null
	/** The end the create named before any extension, or `null` when unstated. */
	originalEndTime: number | null
	/** The lot's closing mode as the chain named it, or `null` when unstated. */
	mode: string | null
	/** The committed height of the fact itself (the anchor). */
	height: number
	/** The anchored block hash (tag and content agree). */
	blockHash: string
}

/** One refusal, tagged with the event it came from. */
export interface ArenaCreateAdmitRefusal {
	eventId: string
	refusal: ArenaCreateAdmitRefusalName
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

function parseContentObject(content: string): Record<string, unknown> {
	let parsed: unknown
	try {
		parsed = JSON.parse(content)
	} catch {
		throw new ArenaCreateAdmitError(ARENA_CREATE_ADMIT_REFUSAL_BAD_CONTENT, 'content is not valid JSON')
	}
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		throw new ArenaCreateAdmitError(ARENA_CREATE_ADMIT_REFUSAL_BAD_CONTENT, 'content JSON is not an object')
	}
	return parsed as Record<string, unknown>
}

/**
 * The schnorr check, at the same parse boundary the params, verdict, receipts,
 * lot-state and bid-admission paths verify at.
 */
function requireVerifiedSignature(event: ArenaCreateAdmitEventLike): void {
	if (typeof event.sig !== 'string' || event.sig.length === 0) {
		throw new ArenaCreateAdmitError(ARENA_CREATE_ADMIT_REFUSAL_BAD_SIGNATURE, 'event carries no signature')
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
	if (!verified) throw new ArenaCreateAdmitError(ARENA_CREATE_ADMIT_REFUSAL_BAD_SIGNATURE, 'event signature does not verify')
}

/**
 * The mandatory anchor, verifying the tag copy **against** the content copy —
 * byte for byte what `arenaLotStateRead.ts:requireAgreeingAnchor` and
 * `arenaBidAdmitRead.ts` do, so all three schemas of kind 1449 share one anchor
 * rule.
 *
 * A value missing from **both** sources is `unanchored` (the client MUST ignore
 * it); present-but-malformed is `bad_anchor`; present on both sides but
 * **unequal** is `anchor_mismatch`.
 */
function requireAgreeingAnchor(
	tags: string[][],
	content: Record<string, unknown>,
	label: string,
): { height: number; hash: string } {
	const tagHeight = tagValue(tags, 'height')
	const tagHash = tagValue(tags, 'hash')
	const contentHeight = content.height === undefined || content.height === null ? null : String(content.height)
	const contentHash = asNonEmptyString(content.block_hash)

	if (tagHeight === null && contentHeight === null) {
		throw new ArenaCreateAdmitError(ARENA_CREATE_ADMIT_REFUSAL_UNANCHORED, `${label} is missing the mandatory height anchor`)
	}
	if (tagHash === null && contentHash === null) {
		throw new ArenaCreateAdmitError(ARENA_CREATE_ADMIT_REFUSAL_UNANCHORED, `${label} is missing the mandatory hash anchor`)
	}

	const height = asPositiveInteger(tagHeight ?? contentHeight)
	if (height === null) {
		throw new ArenaCreateAdmitError(ARENA_CREATE_ADMIT_REFUSAL_BAD_ANCHOR, `${label} height anchor is not a positive integer`)
	}
	const hash = tagHash ?? contentHash
	if (hash === null || !HEX.test(hash)) {
		throw new ArenaCreateAdmitError(ARENA_CREATE_ADMIT_REFUSAL_BAD_ANCHOR, `${label} hash anchor is not a non-empty hex string`)
	}

	if (contentHeight !== null && String(height) !== contentHeight.trim()) {
		throw new ArenaCreateAdmitError(
			ARENA_CREATE_ADMIT_REFUSAL_ANCHOR_MISMATCH,
			`tag height ${JSON.stringify(tagHeight)} != content height ${JSON.stringify(contentHeight)}`,
		)
	}
	if (contentHash !== null && tagHash !== null && contentHash.toLowerCase() !== tagHash.toLowerCase()) {
		throw new ArenaCreateAdmitError(
			ARENA_CREATE_ADMIT_REFUSAL_ANCHOR_MISMATCH,
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
function requireRosterMembership(event: ArenaCreateAdmitEventLike, roster: readonly string[] | null | undefined): void {
	if (!Array.isArray(roster) || roster.length === 0) return
	const signer = event.pubkey.toLowerCase()
	if (!roster.some((pubkey) => pubkey.toLowerCase() === signer)) {
		throw new ArenaCreateAdmitError(
			ARENA_CREATE_ADMIT_REFUSAL_SIGNER_NOT_IN_ROSTER,
			`signer ${event.pubkey} is not on the known validator roster`,
		)
	}
}

// =========================================================================
// The parser — one event in, one parsed fact or one named refusal out
// =========================================================================

export interface ParseCreateAdmitOptions {
	/**
	 * The committed validator roster, when the caller holds one (from a 1448
	 * params read). A non-empty array enforces membership; an absent/empty roster
	 * cannot refuse a fact and is therefore skipped.
	 */
	roster?: readonly string[] | null
}

/**
 * Parse one kind-1449 create-admission event: **signature first** (fail closed
 * on unauthenticated content), then the kind, the schema, the mandatory
 * agreeing anchor, the identity cross-checks, the accepted height the fact
 * exists for, then roster membership where a roster is known.
 *
 * A `arena.lot.v1` or `arena.bidadmit.v1` event (the other two shapes of kind
 * 1449) is refused as `arena.create_admit.bad_schema`, never mis-read as an
 * acceptance.
 */
export function parseArenaCreateAdmitEvent(
	event: ArenaCreateAdmitEventLike,
	options: ParseCreateAdmitOptions = {},
): ParsedArenaCreateAdmit {
	if (event.kind !== ARENA_LOT_STATE_KIND) {
		throw new ArenaCreateAdmitError(
			ARENA_CREATE_ADMIT_REFUSAL_BAD_KIND,
			`expected kind ${ARENA_LOT_STATE_KIND}, got ${event.kind}`,
		)
	}
	const label = 'create-admission event'

	requireVerifiedSignature(event)

	const content = parseContentObject(event.content)
	if (content.schema !== ARENA_CREATE_ADMIT_SCHEMA) {
		throw new ArenaCreateAdmitError(
			ARENA_CREATE_ADMIT_REFUSAL_BAD_SCHEMA,
			`content.schema must be ${JSON.stringify(ARENA_CREATE_ADMIT_SCHEMA)} for kind ${event.kind}, got ${JSON.stringify(content.schema)}`,
		)
	}

	const anchor = requireAgreeingAnchor(event.tags, content, label)

	// The `e` tag and the content `root_event_id` are the same fact written
	// twice; a disagreement means the acceptance names two creates.
	const tagRoot = tagValue(event.tags, 'e')
	const contentRoot = asNonEmptyString(content.root_event_id)
	if (tagRoot === null && contentRoot === null) {
		throw new ArenaCreateAdmitError(ARENA_CREATE_ADMIT_REFUSAL_BAD_CONTENT, 'create-admission event names no create')
	}
	if (tagRoot !== null && contentRoot !== null && tagRoot !== contentRoot) {
		throw new ArenaCreateAdmitError(
			ARENA_CREATE_ADMIT_REFUSAL_BAD_CONTENT,
			`e tag ${JSON.stringify(tagRoot)} != content root_event_id ${JSON.stringify(contentRoot)}`,
		)
	}
	const rootEventId = tagRoot ?? (contentRoot as string)

	// The `auction` tag and the content `auction_id` are the same coordinate
	// written twice; a disagreement means the acceptance names two lots.
	const tagAuction = tagValue(event.tags, 'auction')
	const contentAuctionId = asNonEmptyString(content.auction_id)
	if (tagAuction === null && contentAuctionId === null) {
		throw new ArenaCreateAdmitError(ARENA_CREATE_ADMIT_REFUSAL_BAD_CONTENT, 'create-admission event names no auction')
	}
	if (tagAuction !== null && contentAuctionId !== null && tagAuction !== contentAuctionId) {
		throw new ArenaCreateAdmitError(
			ARENA_CREATE_ADMIT_REFUSAL_BAD_CONTENT,
			`auction tag ${JSON.stringify(tagAuction)} != content auction_id ${JSON.stringify(contentAuctionId)}`,
		)
	}
	const auctionId = tagAuction ?? (contentAuctionId as string)

	// The `p` tag names the validator, and the signer IS the validator: the same
	// identity written twice. A `p` tag naming someone else is refused rather
	// than silently ignored (the roster, when held, checks the signer).
	const tagP = tagValue(event.tags, 'p')
	if (tagP !== null && tagP.toLowerCase() !== event.pubkey.toLowerCase()) {
		throw new ArenaCreateAdmitError(
			ARENA_CREATE_ADMIT_REFUSAL_P_TAG_MISMATCH,
			`p tag ${JSON.stringify(tagP)} != signer ${JSON.stringify(event.pubkey)}`,
		)
	}

	// The height the fact exists to state: an acceptance that cannot say where it
	// accepted the create is refused here, never exposed as `null` and never
	// silently replaced by the anchor height.
	const acceptedHeight = asPositiveInteger(content.accepted_height)
	if (acceptedHeight === null) {
		throw new ArenaCreateAdmitError(ARENA_CREATE_ADMIT_REFUSAL_BAD_CONTENT, 'create-admission event states no readable accepted_height')
	}

	requireRosterMembership(event, options.roster)

	return {
		eventId: event.id,
		signerPubkey: event.pubkey,
		auctionId,
		seller: asNonEmptyString(content.seller),
		rootEventId,
		acceptedHeight,
		endTime: asFiniteNumber(content.end_time),
		originalEndTime: asFiniteNumber(content.original_end_time),
		mode: asNonEmptyString(content.mode),
		height: anchor.height,
		blockHash: anchor.hash,
	}
}

/** A refusal predicate, for the edge that must "ignore, not merely distrust". */
export function isVerifiedArenaCreateAdmitEvent(
	event: ArenaCreateAdmitEventLike,
	options: ParseCreateAdmitOptions = {},
): boolean {
	try {
		parseArenaCreateAdmitEvent(event, options)
		return true
	} catch {
		return false
	}
}

/** Does this event's content carry the create-admission schema? The dispatch predicate for kind 1449. */
export function isArenaCreateAdmitSchema(content: string): boolean {
	let parsed: unknown
	try {
		parsed = JSON.parse(content)
	} catch {
		return false
	}
	return (
		typeof parsed === 'object' &&
		parsed !== null &&
		!Array.isArray(parsed) &&
		(parsed as Record<string, unknown>).schema === ARENA_CREATE_ADMIT_SCHEMA
	)
}

// =========================================================================
// Dedupe — one fact, however many heights a validator re-published it at
// =========================================================================

/**
 * The identity of an acceptance: the coordinate. The chain accepts one create per
 * coordinate, and it says so once; a re-publication at a later height is the
 * same fact.
 */
export function createAdmitKey(admit: Pick<ParsedArenaCreateAdmit, 'auctionId'>): string {
	return admit.auctionId
}

/**
 * Reduce a set of parsed acceptances to **one per coordinate**, keeping the
 * **earliest anchored height** (the height the acceptance was first published
 * at). Ties at one height break to the lexically lowest event id, so the choice
 * is deterministic. Ordered by anchored height ascending, then coordinate.
 */
export function dedupeArenaCreateAdmits(admits: readonly ParsedArenaCreateAdmit[]): ParsedArenaCreateAdmit[] {
	const byKey = new Map<string, ParsedArenaCreateAdmit>()
	for (const admit of admits) {
		const key = createAdmitKey(admit)
		const prior = byKey.get(key)
		if (prior === undefined) {
			byKey.set(key, admit)
			continue
		}
		if (admit.height < prior.height || (admit.height === prior.height && admit.eventId.localeCompare(prior.eventId) < 0)) {
			byKey.set(key, admit)
		}
	}
	return [...byKey.values()].sort((a, b) => a.height - b.height || a.auctionId.localeCompare(b.auctionId))
}

// =========================================================================
// The selection — parse a batch, refuse by name, dedupe the survivors
// =========================================================================

export interface ArenaCreateAdmitSelection {
	/** The deduped acceptances, earliest anchored height first. */
	admits: ParsedArenaCreateAdmit[]
	/** Every event that was refused, with its stable name — never silently dropped. */
	eventRefusals: ArenaCreateAdmitRefusal[]
}

/**
 * Parse a batch of raw kind-1449 events as create admissions: keep the ones that
 * verify, dedupe the survivors by coordinate, and record every refusal by name.
 * Deduped by event id first, because two relays can only agree on an id.
 *
 * A `arena.lot.v1` or `arena.bidadmit.v1` event in the batch is refused as
 * `arena.create_admit.bad_schema` and recorded — this reader reads acceptances
 * only; the lot reader reads ends and the admission reader reads bids.
 */
export function readArenaCreateAdmits(
	events: readonly ArenaCreateAdmitEventLike[],
	options: ParseCreateAdmitOptions = {},
): ArenaCreateAdmitSelection {
	const byId = new Map<string, ArenaCreateAdmitEventLike>()
	for (const event of events) {
		if (typeof event?.id === 'string' && event.id.length > 0 && event.kind === ARENA_LOT_STATE_KIND) byId.set(event.id, event)
	}

	const eventRefusals: ArenaCreateAdmitRefusal[] = []
	const parsed: ParsedArenaCreateAdmit[] = []
	for (const event of byId.values()) {
		try {
			parsed.push(parseArenaCreateAdmitEvent(event, options))
		} catch (error) {
			if (error instanceof ArenaCreateAdmitError) {
				eventRefusals.push({ eventId: event.id, refusal: error.refusal, detail: error.message })
			} else {
				throw error
			}
		}
	}

	return { admits: dedupeArenaCreateAdmits(parsed), eventRefusals }
}

// =========================================================================
// The selection for one lot — the acceptance of a coordinate
// =========================================================================

/**
 * Every acceptance read for one coordinate, deduped at the earliest anchored
 * height. More than one entry means validators published **different**
 * acceptances for the same coordinate, which a surface can see without
 * recomputing it.
 */
export function createAdmitsForLot(selection: Pick<ArenaCreateAdmitSelection, 'admits'>, auctionId: string): ParsedArenaCreateAdmit[] {
	return dedupeArenaCreateAdmits(selection.admits.filter((admit) => admit.auctionId === auctionId)).sort(
		(a, b) => a.height - b.height || a.eventId.localeCompare(b.eventId),
	)
}

/**
 * The acceptance that decides a coordinate: the earliest-anchored one, or `null`
 * when no create-admission fact was read. `null` is **no acceptance read** —
 * never "refused" (that is the kind-1450 refusal's word) and never "accepted".
 */
export function createAdmitForLot(
	selection: Pick<ArenaCreateAdmitSelection, 'admits'>,
	auctionId: string,
): ParsedArenaCreateAdmit | null {
	return createAdmitsForLot(selection, auctionId)[0] ?? null
}
