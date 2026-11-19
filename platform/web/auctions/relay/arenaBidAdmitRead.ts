/**
 * `arenaBidAdmitRead.ts` — the app's read of the chain's **bid-admission fact**
 * (kind 1449, schema `arena.bidadmit.v1`).
 *
 * ## What this is
 *
 * The chain publishes, **once per admitted bid**, a kind-1449 event whose
 * content schema is `arena.bidadmit.v1`: the chain's own record that it
 * ACCEPTED one bid, carrying the position the bid belongs to and the leg that
 * set that position, anchored at **that bid's own committed height**. It is the
 * one fact that turns "the relays have my bid" into "the chain took it", so an
 * app that published a bid reads it instead of guessing from silence.
 *
 * Kind 1449 carries **two** schemas: `arena.lot.v1` (a lot's committed end,
 * read by `arenaLotStateRead.ts`) and `arena.bidadmit.v1` (this module). The
 * kind alone does not say which fact an event is; `content.schema` does, and so
 * every reader here is dispatched on the schema, and each parser refuses the
 * other's shape **by name**.
 *
 * ## The discipline (the same the other anchored readers use)
 *
 * One event in, one parsed fact or one named refusal out, in this order:
 *
 * 1. the **kind** is 1449;
 * 2. the **signature** verifies (fail closed on unauthenticated content);
 * 3. the content is JSON and `schema` is `arena.bidadmit.v1`;
 * 4. the **mandatory anchor** (`height` + `block_hash`) is present, well formed,
 *    and the tag copy agrees with the content copy;
 * 5. the identity tags agree with the content (`e` = the admitted bid id,
 *    `auction` = the coordinate), and the `p` tag names the same validator as
 *    the signer — every one of them is the same fact written twice;
 * 6. the fields the fact exists for (`amount`, `position`, `high_bid`) are
 *    readable — the position is exactly what a surface shows, so an unreadable
 *    one is refused rather than exposed as `null`;
 * 7. the signer is on the caller's **roster**, *where a roster is known* — a
 *    fact does not carry its own validator set, so an absent roster is **not**
 *    a refusal (the same rule `arenaLotStateRead.ts` / `arenaReceiptsRead.ts`
 *    apply).
 *
 * ## Dedupe
 *
 * A bid is announced **once**, keyed on its id: a re-publication at a later
 * height is the same fact, and the earliest anchored height wins (the height the
 * bid was actually admitted at). Ties at one height break to the lexically
 * lowest event id, so the choice is deterministic.
 *
 * Pure: no network, no React, no relay import. A `nostr-tools` `NostrEvent` is
 * assignable to {@link ArenaBidAdmitEventLike}.
 */

import { ARENA_BID_ADMIT_SCHEMA, ARENA_LOT_STATE_KIND } from '@sdk/commerce/auctions/constants'
import { verifyNostrEventSignature } from '@sdk/core/nostr/eventSignature'

// =========================================================================
// Input — the only fields a parser reads. A `nostr-tools` `NostrEvent` (and a
// relay-store event) is structurally assignable.
// =========================================================================

export interface ArenaBidAdmitEventLike {
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
// `arenaLotStateRead.ts` follows.
// =========================================================================

export const ARENA_BID_ADMIT_REFUSAL_BAD_KIND = 'arena.bid_admit.bad_kind' as const
export const ARENA_BID_ADMIT_REFUSAL_BAD_SIGNATURE = 'arena.bid_admit.bad_signature' as const
export const ARENA_BID_ADMIT_REFUSAL_BAD_SCHEMA = 'arena.bid_admit.bad_schema' as const
export const ARENA_BID_ADMIT_REFUSAL_BAD_CONTENT = 'arena.bid_admit.bad_content' as const
export const ARENA_BID_ADMIT_REFUSAL_UNANCHORED = 'arena.bid_admit.unanchored' as const
export const ARENA_BID_ADMIT_REFUSAL_BAD_ANCHOR = 'arena.bid_admit.bad_anchor' as const
export const ARENA_BID_ADMIT_REFUSAL_ANCHOR_MISMATCH = 'arena.bid_admit.anchor_mismatch' as const
export const ARENA_BID_ADMIT_REFUSAL_P_TAG_MISMATCH = 'arena.bid_admit.p_tag_mismatch' as const
export const ARENA_BID_ADMIT_REFUSAL_SIGNER_NOT_IN_ROSTER = 'arena.bid_admit.signer_not_in_roster' as const

export type ArenaBidAdmitRefusalName =
	| typeof ARENA_BID_ADMIT_REFUSAL_BAD_KIND
	| typeof ARENA_BID_ADMIT_REFUSAL_BAD_SIGNATURE
	| typeof ARENA_BID_ADMIT_REFUSAL_BAD_SCHEMA
	| typeof ARENA_BID_ADMIT_REFUSAL_BAD_CONTENT
	| typeof ARENA_BID_ADMIT_REFUSAL_UNANCHORED
	| typeof ARENA_BID_ADMIT_REFUSAL_BAD_ANCHOR
	| typeof ARENA_BID_ADMIT_REFUSAL_ANCHOR_MISMATCH
	| typeof ARENA_BID_ADMIT_REFUSAL_P_TAG_MISMATCH
	| typeof ARENA_BID_ADMIT_REFUSAL_SIGNER_NOT_IN_ROSTER

/** The one error type every refusal throws, carrying its stable `refusal` name. */
export class ArenaBidAdmitError extends Error {
	readonly refusal: ArenaBidAdmitRefusalName

	constructor(refusal: ArenaBidAdmitRefusalName, message: string) {
		super(message)
		this.name = 'ArenaBidAdmitError'
		this.refusal = refusal
	}
}

// =========================================================================
// Parsed shape
// =========================================================================

/**
 * One parsed kind-1449 **bid-admission** fact — the chain's own record that it
 * accepted one bid.
 *
 * `amount` is **this leg's delta** (what the leg locked), unchanged semantics
 * from the bid content. `position` is the position the bid **belongs to**: the
 * sum of that bidder's live legs at admission, and the number the floor was
 * compared against (`CheckTx`). It is never below `amount`. `highBid` is the leg
 * that established that position — the same id the chain promotes to `Winner`
 * when the lot closes.
 *
 * The one honest imprecision, from the chain's own docs: a leg that was alone
 * for a moment can carry the position *at publication* rather than *at its
 * admission*. A surface can tell such a leg apart by `highBid === bidId`.
 */
export interface ParsedArenaBidAdmit {
	/** The admission **event id** — the authority this reading is keyed on. */
	eventId: string
	/** The signing validator, from the event's own pubkey. */
	signerPubkey: string
	/** The auction coordinate, exactly as the chain keys it (`1440:<seller>:<d>`). */
	auctionId: string
	/** The admitted bid's event id. */
	bidId: string
	/** The bidder's pubkey. */
	bidder: string
	/** This leg's delta, in sats — a positive integer. */
	amount: number
	/** The position the bid belongs to (≥ `amount`). */
	position: number
	/** The leg that set that position (the chain's `Winner` on close). */
	highBid: string
	/** The bid's own committed height (the anchor). */
	height: number
	/** The anchored block hash (tag and content agree). */
	blockHash: string
}

/** One refusal, tagged with the event it came from. */
export interface ArenaBidAdmitRefusal {
	eventId: string
	refusal: ArenaBidAdmitRefusalName
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
		throw new ArenaBidAdmitError(ARENA_BID_ADMIT_REFUSAL_BAD_CONTENT, 'content is not valid JSON')
	}
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		throw new ArenaBidAdmitError(ARENA_BID_ADMIT_REFUSAL_BAD_CONTENT, 'content JSON is not an object')
	}
	return parsed as Record<string, unknown>
}

/**
 * The schnorr check, at the same parse boundary the params, verdict, receipts
 * and lot-state paths verify at.
 */
function requireVerifiedSignature(event: ArenaBidAdmitEventLike): void {
	if (typeof event.sig !== 'string' || event.sig.length === 0) {
		throw new ArenaBidAdmitError(ARENA_BID_ADMIT_REFUSAL_BAD_SIGNATURE, 'event carries no signature')
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
	if (!verified) throw new ArenaBidAdmitError(ARENA_BID_ADMIT_REFUSAL_BAD_SIGNATURE, 'event signature does not verify')
}

/**
 * The mandatory anchor, verifying the tag copy **against** the content copy —
 * byte for byte what `arenaLotStateRead.ts:requireAgreeingAnchor` does, so the
 * two schemas of kind 1449 share one anchor rule.
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
		throw new ArenaBidAdmitError(ARENA_BID_ADMIT_REFUSAL_UNANCHORED, `${label} is missing the mandatory height anchor`)
	}
	if (tagHash === null && contentHash === null) {
		throw new ArenaBidAdmitError(ARENA_BID_ADMIT_REFUSAL_UNANCHORED, `${label} is missing the mandatory hash anchor`)
	}

	const height = asPositiveInteger(tagHeight ?? contentHeight)
	if (height === null) {
		throw new ArenaBidAdmitError(ARENA_BID_ADMIT_REFUSAL_BAD_ANCHOR, `${label} height anchor is not a positive integer`)
	}
	const hash = tagHash ?? contentHash
	if (hash === null || !HEX.test(hash)) {
		throw new ArenaBidAdmitError(ARENA_BID_ADMIT_REFUSAL_BAD_ANCHOR, `${label} hash anchor is not a non-empty hex string`)
	}

	if (contentHeight !== null && String(height) !== contentHeight.trim()) {
		throw new ArenaBidAdmitError(
			ARENA_BID_ADMIT_REFUSAL_ANCHOR_MISMATCH,
			`tag height ${JSON.stringify(tagHeight)} != content height ${JSON.stringify(contentHeight)}`,
		)
	}
	if (contentHash !== null && tagHash !== null && contentHash.toLowerCase() !== tagHash.toLowerCase()) {
		throw new ArenaBidAdmitError(
			ARENA_BID_ADMIT_REFUSAL_ANCHOR_MISMATCH,
			`tag hash ${JSON.stringify(tagHash)} != content block_hash ${JSON.stringify(contentHash)}`,
		)
	}

	return { height, hash: hash.toLowerCase() }
}

/**
 * Enforce roster membership where a roster is known. An absent/empty roster
 * cannot refuse (the fact does not carry its own validator set), so it is
 * skipped — the same rule `arenaLotStateRead.ts` applies.
 */
function requireRosterMembership(event: ArenaBidAdmitEventLike, roster: readonly string[] | null | undefined): void {
	if (!Array.isArray(roster) || roster.length === 0) return
	const signer = event.pubkey.toLowerCase()
	if (!roster.some((pubkey) => pubkey.toLowerCase() === signer)) {
		throw new ArenaBidAdmitError(
			ARENA_BID_ADMIT_REFUSAL_SIGNER_NOT_IN_ROSTER,
			`signer ${event.pubkey} is not on the known validator roster`,
		)
	}
}

// =========================================================================
// The parser — one event in, one parsed fact or one named refusal out
// =========================================================================

export interface ParseBidAdmitOptions {
	/**
	 * The committed validator roster, when the caller holds one (from a 1448
	 * params read). A non-empty array enforces membership; an absent/empty roster
	 * cannot refuse a fact and is therefore skipped.
	 */
	roster?: readonly string[] | null
}

/**
 * Parse one kind-1449 bid-admission event: **signature first** (fail closed on
 * unauthenticated content), then the kind, the schema, the mandatory agreeing
 * anchor, the identity cross-checks, the fields the fact exists for, then roster
 * membership where a roster is known.
 *
 * A `arena.lot.v1` event (the other shape of kind 1449) is refused as
 * `arena.bid_admit.bad_schema`, never mis-read as an admission.
 */
export function parseArenaBidAdmitEvent(
	event: ArenaBidAdmitEventLike,
	options: ParseBidAdmitOptions = {},
): ParsedArenaBidAdmit {
	if (event.kind !== ARENA_LOT_STATE_KIND) {
		throw new ArenaBidAdmitError(
			ARENA_BID_ADMIT_REFUSAL_BAD_KIND,
			`expected kind ${ARENA_LOT_STATE_KIND}, got ${event.kind}`,
		)
	}
	const label = 'bid-admission event'

	requireVerifiedSignature(event)

	const content = parseContentObject(event.content)
	if (content.schema !== ARENA_BID_ADMIT_SCHEMA) {
		throw new ArenaBidAdmitError(
			ARENA_BID_ADMIT_REFUSAL_BAD_SCHEMA,
			`content.schema must be ${JSON.stringify(ARENA_BID_ADMIT_SCHEMA)} for kind ${event.kind}, got ${JSON.stringify(content.schema)}`,
		)
	}

	const anchor = requireAgreeingAnchor(event.tags, content, label)

	// The `e` tag and the content `bid_id` are the same fact written twice; a
	// disagreement means the admission names two bids.
	const tagBid = tagValue(event.tags, 'e')
	const contentBidId = asNonEmptyString(content.bid_id)
	if (tagBid === null && contentBidId === null) {
		throw new ArenaBidAdmitError(ARENA_BID_ADMIT_REFUSAL_BAD_CONTENT, 'bid-admission event names no bid')
	}
	if (tagBid !== null && contentBidId !== null && tagBid !== contentBidId) {
		throw new ArenaBidAdmitError(
			ARENA_BID_ADMIT_REFUSAL_BAD_CONTENT,
			`e tag ${JSON.stringify(tagBid)} != content bid_id ${JSON.stringify(contentBidId)}`,
		)
	}
	const bidId = tagBid ?? (contentBidId as string)

	// The `auction` tag and the content `auction_id` are the same coordinate
	// written twice; a disagreement means the admission names two lots.
	const tagAuction = tagValue(event.tags, 'auction')
	const contentAuctionId = asNonEmptyString(content.auction_id)
	if (tagAuction === null && contentAuctionId === null) {
		throw new ArenaBidAdmitError(ARENA_BID_ADMIT_REFUSAL_BAD_CONTENT, 'bid-admission event names no auction')
	}
	if (tagAuction !== null && contentAuctionId !== null && tagAuction !== contentAuctionId) {
		throw new ArenaBidAdmitError(
			ARENA_BID_ADMIT_REFUSAL_BAD_CONTENT,
			`auction tag ${JSON.stringify(tagAuction)} != content auction_id ${JSON.stringify(contentAuctionId)}`,
		)
	}
	const auctionId = tagAuction ?? (contentAuctionId as string)

	// The `p` tag names the validator, and the signer IS the validator: the same
	// identity written twice. A `p` tag naming someone else is refused rather
	// than silently ignored (the roster, when held, checks the signer).
	const tagP = tagValue(event.tags, 'p')
	if (tagP !== null && tagP.toLowerCase() !== event.pubkey.toLowerCase()) {
		throw new ArenaBidAdmitError(
			ARENA_BID_ADMIT_REFUSAL_P_TAG_MISMATCH,
			`p tag ${JSON.stringify(tagP)} != signer ${JSON.stringify(event.pubkey)}`,
		)
	}

	// The fields the fact exists for: the position is exactly what a surface
	// shows, so an unreadable one is refused, never exposed as `null`.
	const bidder = asNonEmptyString(content.bidder)
	if (bidder === null) {
		throw new ArenaBidAdmitError(ARENA_BID_ADMIT_REFUSAL_BAD_CONTENT, 'bid-admission event names no bidder')
	}
	const amount = asPositiveInteger(content.amount)
	if (amount === null) {
		throw new ArenaBidAdmitError(ARENA_BID_ADMIT_REFUSAL_BAD_CONTENT, 'bid-admission event states no readable amount')
	}
	const position = asPositiveInteger(content.position)
	if (position === null) {
		throw new ArenaBidAdmitError(ARENA_BID_ADMIT_REFUSAL_BAD_CONTENT, 'bid-admission event states no readable position')
	}
	const highBid = asNonEmptyString(content.high_bid)
	if (highBid === null) {
		throw new ArenaBidAdmitError(ARENA_BID_ADMIT_REFUSAL_BAD_CONTENT, 'bid-admission event names no leading leg')
	}

	requireRosterMembership(event, options.roster)

	return {
		eventId: event.id,
		signerPubkey: event.pubkey,
		auctionId,
		bidId,
		bidder,
		amount,
		position,
		highBid,
		height: anchor.height,
		blockHash: anchor.hash,
	}
}

/** A refusal predicate, for the edge that must "ignore, not merely distrust". */
export function isVerifiedArenaBidAdmitEvent(event: ArenaBidAdmitEventLike, options: ParseBidAdmitOptions = {}): boolean {
	try {
		parseArenaBidAdmitEvent(event, options)
		return true
	} catch {
		return false
	}
}

/** Does this event's content carry the bid-admission schema? The dispatch predicate for kind 1449. */
export function isArenaBidAdmitSchema(content: string): boolean {
	let parsed: unknown
	try {
		parsed = JSON.parse(content)
	} catch {
		return false
	}
	return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) && (parsed as Record<string, unknown>).schema === ARENA_BID_ADMIT_SCHEMA
}

// =========================================================================
// Dedupe — one fact, however many heights a validator re-published it at
// =========================================================================

/** The identity of an admission: the bid id. It is announced once, keyed on the bid. */
export function bidAdmitKey(admit: Pick<ParsedArenaBidAdmit, 'bidId'>): string {
	return admit.bidId
}

/**
 * Reduce a set of parsed admissions to **one per bid id**, keeping the
 * **earliest anchored height** (the height the bid was admitted at). Ties at one
 * height break to the lexically lowest event id, so the choice is deterministic.
 * Ordered by anchored height ascending, then bid id.
 */
export function dedupeArenaBidAdmits(admits: readonly ParsedArenaBidAdmit[]): ParsedArenaBidAdmit[] {
	const byKey = new Map<string, ParsedArenaBidAdmit>()
	for (const admit of admits) {
		const key = bidAdmitKey(admit)
		const prior = byKey.get(key)
		if (prior === undefined) {
			byKey.set(key, admit)
			continue
		}
		if (admit.height < prior.height || (admit.height === prior.height && admit.eventId.localeCompare(prior.eventId) < 0)) {
			byKey.set(key, admit)
		}
	}
	return [...byKey.values()].sort((a, b) => a.height - b.height || a.bidId.localeCompare(b.bidId))
}

// =========================================================================
// The selection — parse a batch, refuse by name, dedupe the survivors
// =========================================================================

export interface ArenaBidAdmitSelection {
	/** The deduped admissions, earliest anchored height first. */
	admits: ParsedArenaBidAdmit[]
	/** Every event that was refused, with its stable name — never silently dropped. */
	eventRefusals: ArenaBidAdmitRefusal[]
}

/**
 * Parse a batch of raw kind-1449 events as bid admissions: keep the ones that
 * verify, dedupe the survivors by bid id, and record every refusal by name.
 * Deduped by event id first, because two relays can only agree on an id.
 *
 * A `arena.lot.v1` event in the batch is refused as `arena.bid_admit.bad_schema`
 * and recorded — this reader reads admissions only; the lot reader reads ends.
 */
export function readArenaBidAdmits(
	events: readonly ArenaBidAdmitEventLike[],
	options: ParseBidAdmitOptions = {},
): ArenaBidAdmitSelection {
	const byId = new Map<string, ArenaBidAdmitEventLike>()
	for (const event of events) {
		if (typeof event?.id === 'string' && event.id.length > 0 && event.kind === ARENA_LOT_STATE_KIND) byId.set(event.id, event)
	}

	const eventRefusals: ArenaBidAdmitRefusal[] = []
	const parsed: ParsedArenaBidAdmit[] = []
	for (const event of byId.values()) {
		try {
			parsed.push(parseArenaBidAdmitEvent(event, options))
		} catch (error) {
			if (error instanceof ArenaBidAdmitError) {
				eventRefusals.push({ eventId: event.id, refusal: error.refusal, detail: error.message })
			} else {
				throw error
			}
		}
	}

	return { admits: dedupeArenaBidAdmits(parsed), eventRefusals }
}

// =========================================================================
// The selection for one lot — the admissions of a lot's bids
// =========================================================================

/**
 * Every admission read for one lot, deduped by bid id at the earliest anchored
 * height, ordered by anchored height ascending — so a surface can see the
 * admission history without recomputing it, and can look one up by bid id.
 *
 * `bidId` is the key a bid panel holds (the signed event's id), so
 * {@link admissionForBid} is the one lookup a submission needs.
 */
export function admitsForLot(selection: Pick<ArenaBidAdmitSelection, 'admits'>, auctionId: string): ParsedArenaBidAdmit[] {
	return dedupeArenaBidAdmits(selection.admits.filter((admit) => admit.auctionId === auctionId)).sort(
		(a, b) => a.height - b.height || a.bidId.localeCompare(b.bidId),
	)
}

/** The admission that names a bid, or `null` when no fact read names it. */
export function admissionForBid(admits: readonly ParsedArenaBidAdmit[], bidId: string): ParsedArenaBidAdmit | null {
	return admits.find((admit) => admit.bidId === bidId) ?? null
}
