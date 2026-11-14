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
	/**
	 * The signing key, when the caller has the whole event. A verdict must be
	 * signed by the validator whose roster pubkey it carries in its `p` tag, so
	 * when this is present it is checked against that tag.
	 */
	pubkey?: string
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
/**
 * A verdict with no `p` tag, or with an empty one. The `p` tag is the
 * validator's roster pubkey (`chain/verdict.go:BuildVerdictEvent` appends
 * `["p", NostrPubkeyHex(sk)]`); without it a verdict cannot be attributed to
 * anybody, and one shared publisher would make a forged verdict
 * indistinguishable from a real one.
 */
export const ARENA_REFUSAL_NO_VALIDATOR = 'arena.no_validator' as const
/**
 * A verdict whose `p` tag names a different key than the event's signer. The
 * producer signs each verdict under that validator's OWN key and carries the
 * same key in `p`, so a mismatch is a forged attribution, not a formatting
 * quirk.
 */
export const ARENA_REFUSAL_SIGNER_MISMATCH = 'arena.signer_mismatch' as const

export type ArenaRefusalName =
	| typeof ARENA_REFUSAL_UNANCHORED
	| typeof ARENA_REFUSAL_BAD_SCHEMA
	| typeof ARENA_REFUSAL_BAD_HEIGHT
	| typeof ARENA_REFUSAL_BAD_HASH
	| typeof ARENA_REFUSAL_BAD_CONTENT
	| typeof ARENA_REFUSAL_BAD_KIND
	| typeof ARENA_REFUSAL_BAD_OUTCOME
	| typeof ARENA_REFUSAL_NO_VALIDATOR
	| typeof ARENA_REFUSAL_SIGNER_MISMATCH

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
 * The anchor is carried in the tags (`["height","N"]`, `["hash","hex"]` — the
 * indexable fields) **and** in the content (`height` + `block_hash` for a
 * verdict, `height` + `app_hash` for a state commitment); NIP-01 signs both.
 * The producer writes both and cross-checks them (`chain/verdict.go:ParseVerdict`:
 * "so a relay that re-framed one cannot hide the other"), so this parser does
 * the same: a value absent from BOTH sources refuses the event as
 * **unanchored** by name; a value present but malformed or contradictory is
 * refused as such.
 */
function requireAnchor(
	tags: string[][],
	content: Record<string, unknown>,
	contentHashField: string,
	kindLabel: string,
): { height: number; hash: string } {
	const tagHeight = tagValue(tags, 'height')
	const tagHash = tagValue(tags, 'hash')
	const contentHeight = content.height
	const contentHash = content[contentHashField]

	if (tagHeight === null && (contentHeight === undefined || contentHeight === null)) {
		throw new ArenaUnanchoredError(`${kindLabel} is missing the mandatory height anchor`)
	}
	if (tagHash === null && (contentHash === undefined || contentHash === null)) {
		throw new ArenaUnanchoredError(`${kindLabel} is missing the mandatory hash anchor`)
	}

	const height = parseHeight(tagHeight ?? contentHeight)
	if (height === null) {
		throw new ArenaContractError(ARENA_REFUSAL_BAD_HEIGHT, `${kindLabel} height anchor is not a positive integer`)
	}
	const hash = tagHash ?? contentHash
	if (!isWellFormedHash(hash)) {
		throw new ArenaContractError(ARENA_REFUSAL_BAD_HASH, `${kindLabel} hash anchor is not a non-empty hex string`)
	}

	// The two framings must agree. Either one alone is evidence; two that
	// disagree are evidence of tampering, which is not an anchor at all.
	if (tagHeight !== null && contentHeight !== undefined && contentHeight !== null) {
		const contentHeightValue = parseHeight(contentHeight)
		if (contentHeightValue === null || contentHeightValue !== height) {
			throw new ArenaUnanchoredError(
				`${kindLabel} height tag ${JSON.stringify(tagHeight)} disagrees with content ${JSON.stringify(contentHeight)}`,
			)
		}
	}
	if (tagHash !== null && contentHash !== undefined && contentHash !== null) {
		if (typeof contentHash !== 'string' || contentHash.trim().toLowerCase() !== tagHash.toLowerCase()) {
			throw new ArenaUnanchoredError(`${kindLabel} hash tag disagrees with the content's ${contentHashField}`)
		}
	}

	return { height, hash }
}

/**
 * The attribution gate: a verdict carries its signer's roster pubkey in a `p`
 * tag, and is signed by that same key (`chain/verdict.go`, `BuildVerdictEvent`
 * → `["p", NostrPubkeyHex(sk)]` under `sk`). A verdict with no `p` tag cannot
 * be attributed to a validator, and one whose `p` names another key is a forged
 * attribution.
 */
function requireValidator(tags: string[][], signer: string | undefined, kindLabel: string): string {
	const claimed = tagValue(tags, 'p')
	if (claimed === null) {
		throw new ArenaContractError(ARENA_REFUSAL_NO_VALIDATOR, `${kindLabel} carries no p tag naming its validator`)
	}
	if (signer !== undefined && signer !== claimed) {
		throw new ArenaContractError(
			ARENA_REFUSAL_SIGNER_MISMATCH,
			`${kindLabel} is signed by ${signer} but claims p = ${claimed}`,
		)
	}
	return claimed
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
	const validatorPubkey = requireValidator(event.tags, event.pubkey, 'verdict')

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
		validatorPubkey,
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
	const validatorPubkey = requireValidator(event.tags, event.pubkey, 'state commitment')

	return {
		height: anchor.height,
		appHash: anchor.hash,
		time: typeof content.time === 'number' ? content.time : null,
		validatorPubkey,
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
