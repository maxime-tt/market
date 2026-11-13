/**
 * Pure parsers for the arena 1440-series *verdict* (kind 1445) and *state
 * commitment* (kind 1447), enforcing the frozen contract's mandatory anchor.
 *
 * Source of truth: `notes/REPLY-nostr-verdict-contract.md` §3.2/§3.3/§3.5 and
 * `notes/DECISION-auction-kinds-and-editable-allowlist.md`.
 *
 * The load-bearing rule: **the relay notifies, the chain decides, the anchor
 * proves.** A verdict without `(height, block_hash)` — and a state commitment
 * without `(height, app_hash)` — must be **ignored by the client**, not merely
 * distrusted. This module refuses one *by name* (`ArenaUnanchoredError`),
 * mirroring the producer's refusal, so a caller can tell an unanchored event
 * apart from a merely malformed one.
 *
 * Pure: no network, no React, no Nostr SDK import. The input is structural, so
 * a `nostr-tools` `NostrEvent` satisfies it with no cast.
 */

import {
	ARENA_STATE_COMMITMENT_KIND,
	ARENA_STATE_COMMITMENT_SCHEMA,
	ARENA_VERDICT_KIND,
	ARENA_VERDICT_OUTCOMES,
	ARENA_VERDICT_SCHEMA,
	type ArenaVerdictOutcome,
} from '@sdk/commerce/auctions/constants'

// ---------- Input ----------------------------------------------------------

/** The only fields a parser reads. A `nostr-tools` `NostrEvent` is assignable. */
export interface ArenaEventLike {
	kind: number
	tags: string[][]
	content: string
}

// ---------- Named refusals -------------------------------------------------

/**
 * Stable machine names for a refusal. A test asserts on the *name*, never on a
 * bare "it throws", so each failure mode is distinguishable on the wire.
 */
export const ARENA_REFUSAL_UNANCHORED = 'arena.unanchored' as const
export const ARENA_REFUSAL_BAD_SCHEMA = 'arena.bad_schema' as const
export const ARENA_REFUSAL_BAD_HEIGHT = 'arena.bad_height' as const
export const ARENA_REFUSAL_BAD_HASH = 'arena.bad_hash' as const
export const ARENA_REFUSAL_BAD_CONTENT = 'arena.bad_content' as const
export const ARENA_REFUSAL_BAD_KIND = 'arena.bad_kind' as const
export const ARENA_REFUSAL_BAD_OUTCOME = 'arena.bad_outcome' as const

export type ArenaRefusalName =
	| typeof ARENA_REFUSAL_UNANCHORED
	| typeof ARENA_REFUSAL_BAD_SCHEMA
	| typeof ARENA_REFUSAL_BAD_HEIGHT
	| typeof ARENA_REFUSAL_BAD_HASH
	| typeof ARENA_REFUSAL_BAD_CONTENT
	| typeof ARENA_REFUSAL_BAD_KIND
	| typeof ARENA_REFUSAL_BAD_OUTCOME

/** The one error type every refusal throws, carrying its stable `name`. */
export class ArenaContractError extends Error {
	readonly refusal: ArenaRefusalName

	constructor(refusal: ArenaRefusalName, message: string) {
		super(message)
		this.refusal = refusal
		this.name = 'ArenaContractError'
	}
}

/**
 * The distinct, catch-and-recognise error for an event that lacks a complete,
 * well-formed anchor. Kept as its own class so a caller (or a test) can refuse
 * an unanchored verdict specifically without matching on a message string.
 */
export class ArenaUnanchoredError extends ArenaContractError {
	constructor(message: string) {
		super(ARENA_REFUSAL_UNANCHORED, message)
		this.name = 'ArenaUnanchoredError'
	}
}

// ---------- Parsed shapes --------------------------------------------------

export interface ParsedArenaVerdict {
	auctionId: string
	/** null when the auction had no bid (no-bid / aborted). */
	bidId: string | null
	outcome: ArenaVerdictOutcome
	/** null when no payout exists. A *claim*, not a receipt (see note §4.2). */
	payoutTokenSha256: string | null
	height: number
	blockHash: string
	/** Always `"committed_state"` in the frozen contract; surfaced verbatim. */
	derivedFrom: string
	/** The signing validator, from the `p` tag when present. */
	validatorPubkey: string | null
}

export interface ParsedArenaStateCommitment {
	height: number
	appHash: string
	/** The content's `time` (unix seconds) when present. */
	time: number | null
	validatorPubkey: string | null
}

// ---------- Helpers --------------------------------------------------------

const HEX = /^[0-9a-fA-F]+$/

/** First value of the named tag, or null. */
function tagValue(tags: string[][], name: string): string | null {
	for (const tag of tags) {
		if (tag[0] === name && typeof tag[1] === 'string' && tag[1].length > 0) return tag[1]
	}
	return null
}

/** Parse the JSON content into a plain object, or refuse with `bad_content`. */
function parseContentObject(content: string): Record<string, unknown> {
	let parsed: unknown
	try {
		parsed = JSON.parse(content)
	} catch {
		throw new ArenaContractError(ARENA_REFUSAL_BAD_CONTENT, 'content is not valid JSON')
	}
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		throw new ArenaContractError(ARENA_REFUSAL_BAD_CONTENT, 'content JSON is not an object')
	}
	return parsed as Record<string, unknown>
}

function requireSchema(content: Record<string, unknown>, expected: string): void {
	if (content.schema !== expected) {
		throw new ArenaContractError(
			ARENA_REFUSAL_BAD_SCHEMA,
			`content.schema must be ${JSON.stringify(expected)}, got ${JSON.stringify(content.schema)}`,
		)
	}
}

/** A positive integer (no fraction, no zero, no negative, no NaN). */
function parseHeight(value: unknown): number | null {
	const n =
		typeof value === 'number'
			? value
			: typeof value === 'string' && value.trim() !== ''
				? Number(value)
				: Number.NaN
	if (!Number.isInteger(n) || n <= 0) return null
	return n
}

function isWellFormedHash(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0 && HEX.test(value)
}

/**
 * The anchor gate, shared by both event types.
 *
 * The anchor may be carried in the tags (`["height","N"]`, `["hash","hex"]`,
 * the indexable/identity fields) and/or in the content (`height` + `block_hash`
 * for a verdict, `height` + `app_hash` for a state commitment); NIP-01 signs
 * both. A value that is *present but malformed* is refused as such; a value
 * *absent from both sources* refuses the event as **unanchored** by name.
 */
function requireAnchor(
	tags: string[][],
	content: Record<string, unknown>,
	contentHashField: string,
	kindLabel: string,
): { height: number; hash: string } {
	const rawHeight = tagValue(tags, 'height') ?? content.height
	const rawHash = tagValue(tags, 'hash') ?? content[contentHashField]

	if (rawHeight === undefined || rawHeight === null) {
		throw new ArenaUnanchoredError(`${kindLabel} is missing the mandatory height anchor`)
	}
	if (rawHash === undefined || rawHash === null) {
		throw new ArenaUnanchoredError(`${kindLabel} is missing the mandatory hash anchor`)
	}

	const height = parseHeight(rawHeight)
	if (height === null) {
		throw new ArenaContractError(ARENA_REFUSAL_BAD_HEIGHT, `${kindLabel} height anchor is not a positive integer`)
	}
	if (!isWellFormedHash(rawHash)) {
		throw new ArenaContractError(ARENA_REFUSAL_BAD_HASH, `${kindLabel} hash anchor is not a non-empty hex string`)
	}

	return { height, hash: rawHash }
}

// ---------- Parsers --------------------------------------------------------

/**
 * Parse a kind-1445 validator verdict. Throws `ArenaUnanchoredError` (refusal
 * `arena.unanchored`) for an event without a complete `(height, block_hash)`
 * anchor — a client MUST ignore such an event.
 */
export function parseArenaVerdict(event: ArenaEventLike): ParsedArenaVerdict {
	if (event.kind !== ARENA_VERDICT_KIND) {
		throw new ArenaContractError(ARENA_REFUSAL_BAD_KIND, `expected kind ${ARENA_VERDICT_KIND}, got ${event.kind}`)
	}
	const content = parseContentObject(event.content)
	requireSchema(content, ARENA_VERDICT_SCHEMA)
	const anchor = requireAnchor(event.tags, content, 'block_hash', 'verdict')

	const outcome = content.outcome
	if (typeof outcome !== 'string' || !(ARENA_VERDICT_OUTCOMES as readonly string[]).includes(outcome)) {
		throw new ArenaContractError(ARENA_REFUSAL_BAD_OUTCOME, `verdict outcome ${JSON.stringify(outcome)} is not a known outcome`)
	}

	const auctionId = tagValue(event.tags, 'auction') ?? (typeof content.auction_id === 'string' ? content.auction_id : null)
	if (!auctionId) {
		throw new ArenaContractError(ARENA_REFUSAL_BAD_CONTENT, 'verdict has no auction id')
	}

	const bidIdTag = tagValue(event.tags, 'bid')
	const bidId = bidIdTag ?? (typeof content.bid_id === 'string' && content.bid_id.length > 0 ? content.bid_id : null)
	const payout = content.payout_token_sha256

	return {
		auctionId,
		bidId,
		outcome: outcome as ArenaVerdictOutcome,
		payoutTokenSha256: typeof payout === 'string' && payout.length > 0 ? payout : null,
		height: anchor.height,
		blockHash: anchor.hash,
		derivedFrom: typeof content.derived_from === 'string' ? content.derived_from : '',
		validatorPubkey: tagValue(event.tags, 'p'),
	}
}

/**
 * Parse a kind-1447 state commitment. Same anchor discipline as the verdict:
 * throws `ArenaUnanchoredError` when `(height, app_hash)` is incomplete.
 */
export function parseArenaStateCommitment(event: ArenaEventLike): ParsedArenaStateCommitment {
	if (event.kind !== ARENA_STATE_COMMITMENT_KIND) {
		throw new ArenaContractError(ARENA_REFUSAL_BAD_KIND, `expected kind ${ARENA_STATE_COMMITMENT_KIND}, got ${event.kind}`)
	}
	const content = parseContentObject(event.content)
	requireSchema(content, ARENA_STATE_COMMITMENT_SCHEMA)
	const anchor = requireAnchor(event.tags, content, 'app_hash', 'state commitment')

	return {
		height: anchor.height,
		appHash: anchor.hash,
		time: typeof content.time === 'number' ? content.time : null,
		validatorPubkey: tagValue(event.tags, 'p'),
	}
}

/**
 * A filter predicate: does this event carry a complete, well-formed anchor?
 * Handy as the "ignore, do not merely distrust" gate at the subscription edge.
 */
export function isAnchoredArenaEvent(event: ArenaEventLike): boolean {
	try {
		if (event.kind === ARENA_VERDICT_KIND) parseArenaVerdict(event)
		else if (event.kind === ARENA_STATE_COMMITMENT_KIND) parseArenaStateCommitment(event)
		else return false
		return true
	} catch {
		return false
	}
}
