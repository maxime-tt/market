/**
 * `arenaReceiptsRead.ts` — the app's read of the auction chain's **money
 * receipts**: kind 1443 (`arena.refund.v1`, a refund executed) and kind 1444
 * (`arena.settle.v1`, a settle/payout executed).
 *
 * ## Why this module exists, and why it is not the verdict
 *
 * The app already reads every **claim** the chain makes — creates (1440), bids
 * (1441), verdicts (1445), commitments (1447), params (1448) — and not one
 * **receipt**. A verdict says who *should* win; a receipt says money *moved*:
 * one `out` entry per committed destination, carrying the minted Cashu outputs
 * the chain actually produced. The two must never be conflated. A verdict is a
 * claim; a receipt is a fact of the mint. This module parses the receipts, and
 * every surface that shows them says so in those words.
 *
 * ## The discipline it applies — the same the app already applies elsewhere
 *
 * The chain publishes these events per validator, anchored like a verdict
 * (`notes/REPLY-nostr-verdict-contract.md` §3.2; `arenaAnchor.ts` for
 * commitments, `arenaParamsRead.ts` for params). So a receipt is accepted only
 * when, in this order:
 *
 * 1. it has the right **kind** (1443 or 1444);
 * 2. its **signature verifies** (fail closed on unauthenticated content);
 * 3. its content is a JSON object and its **schema** matches the kind;
 * 4. its content `outcome` agrees with the kind (`refund` / `settle`);
 * 5. its anchor is **mandatory** and the tags' `height`/`hash` **agree** with
 *    the content's `height`/`block_hash`;
 * 6. its signer is a validator the caller's **roster** names — *where a roster
 *    is known*. A roster the caller does not hold cannot refuse a receipt (the
 *    receipt does not carry its own roster the way a params event does), so an
 *    absent roster is **not** a refusal: the gate is the kind, the signature,
 *    the schema and the anchor.
 *
 * Anything else is refused **by name**, never guessed at.
 *
 * ## Two facts the shape carries
 *
 * - **`params_version` is an opaque token.** It is the digest of the 1448
 *   params in force when the move happened. This module **records** it and lets
 *   a caller **flag a mismatch** (see {@link receiptParamsVersionMismatch}), but
 *   it **never refuses** a receipt because of it: refusing on a version change
 *   could hide money that genuinely moved. This is a deliberate difference from
 *   the chain's own unit expectation, and the two halves agree on it.
 * - **Dedupe is by `(bid_id, outcome)` across heights, preferring the EARLIEST
 *   anchored height.** A validator that restarts may re-publish the same move
 *   at a later height; it is one move, not two. {@link dedupeArenaReceipts}
 *   resolves that, so a surface never shows a move twice.
 *
 * ## Honesty rule
 *
 * Every field the event did not carry is `null` — never a default, never a `0`.
 * A missing receipt is *no receipt read*, which is not the same as *not paid*;
 * this module produces nothing, and the surface says so in words.
 *
 * Pure: no network, no React, no relay import. A `nostr-tools` `NostrEvent` is
 * assignable to {@link ArenaReceiptEventLike}.
 */

import {
	ARENA_AUCTION_REFUND_KIND,
	ARENA_AUCTION_SETTLE_KIND,
	ARENA_REFUND_SCHEMA,
	ARENA_SETTLE_SCHEMA,
} from '@sdk/commerce/auctions/constants'
import { verifyNostrEventSignature } from '@sdk/core/nostr/eventSignature'

// =========================================================================
// Input — the only fields a parser reads. A `nostr-tools` `NostrEvent` (and a
// relay-store event) is structurally assignable.
// =========================================================================

export interface ArenaReceiptEventLike {
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

export const ARENA_RECEIPT_REFUSAL_BAD_KIND = 'arena.receipt.bad_kind' as const
export const ARENA_RECEIPT_REFUSAL_BAD_SIGNATURE = 'arena.receipt.bad_signature' as const
export const ARENA_RECEIPT_REFUSAL_BAD_SCHEMA = 'arena.receipt.bad_schema' as const
export const ARENA_RECEIPT_REFUSAL_BAD_CONTENT = 'arena.receipt.bad_content' as const
export const ARENA_RECEIPT_REFUSAL_UNANCHORED = 'arena.receipt.unanchored' as const
export const ARENA_RECEIPT_REFUSAL_BAD_ANCHOR = 'arena.receipt.bad_anchor' as const
export const ARENA_RECEIPT_REFUSAL_ANCHOR_MISMATCH = 'arena.receipt.anchor_mismatch' as const
export const ARENA_RECEIPT_REFUSAL_SIGNER_NOT_IN_ROSTER = 'arena.receipt.signer_not_in_roster' as const

export type ArenaReceiptRefusalName =
	| typeof ARENA_RECEIPT_REFUSAL_BAD_KIND
	| typeof ARENA_RECEIPT_REFUSAL_BAD_SIGNATURE
	| typeof ARENA_RECEIPT_REFUSAL_BAD_SCHEMA
	| typeof ARENA_RECEIPT_REFUSAL_BAD_CONTENT
	| typeof ARENA_RECEIPT_REFUSAL_UNANCHORED
	| typeof ARENA_RECEIPT_REFUSAL_BAD_ANCHOR
	| typeof ARENA_RECEIPT_REFUSAL_ANCHOR_MISMATCH
	| typeof ARENA_RECEIPT_REFUSAL_SIGNER_NOT_IN_ROSTER

/** The one error type every refusal throws, carrying its stable `refusal` name. */
export class ArenaReceiptError extends Error {
	readonly refusal: ArenaReceiptRefusalName

	constructor(refusal: ArenaReceiptRefusalName, message: string) {
		super(message)
		this.name = 'ArenaReceiptError'
		this.refusal = refusal
	}
}

// =========================================================================
// Parsed shapes
// =========================================================================

/** The two outcomes a receipt can carry — one per kind. */
export type ArenaReceiptOutcome = 'refund' | 'settle'

/** One DLEQ proof, carried through for the claim work; never rendered. */
export interface ArenaReceiptDleq {
	e: string | null
	s: string | null
	r: string | null
}

/**
 * One committed destination of a move. `recipient`/`amount`/`id` are what a
 * surface renders; `secret`/`C`/`dleq` are the Cashu proof the recipient needs
 * to claim the value, carried through so a later claim flow does not have to
 * re-read the relay. The view layer reads only the first three.
 */
export interface ArenaReceiptOutput {
	/** Compressed 33-byte wallet pubkey, or `null` when unreadable. */
	recipient: string | null
	amount: number | null
	/** The mint's keyset id, or `null`. */
	id: string | null
	/** The proof secret, for the claim work; never rendered. */
	secret: string | null
	/** The proof `C` point, for the claim work; never rendered. */
	C: string | null
	/** The DLEQ proof, for the claim work; never rendered. */
	dleq: ArenaReceiptDleq | null
}

/** One parsed receipt, as the read exposes it. Every unreadable field is `null`. */
export interface ParsedArenaReceipt {
	/** The receipt **event id** — the authority this reading is keyed on. */
	eventId: string
	/** The signing validator, from the event's own pubkey. */
	signerPubkey: string
	kind: number
	/** The auction coordinate, exactly as state keys it (`1440:<seller>:<d>`). */
	auctionId: string
	/** The 1441 event id whose escrow moved. */
	bidId: string
	outcome: ArenaReceiptOutcome
	/** The anchored height (tag and content agree). */
	height: number
	/** The anchored block hash (tag and content agree). */
	blockHash: string
	/** The chain time the move recorded, or `null`. */
	settledAt: number | null
	/** The params digest in force; an opaque token, recorded and never refused on. */
	paramsVersion: string | null
	outputs: ArenaReceiptOutput[]
	/** `Σ out[].amount` over the readable amounts; `null` when none was readable. */
	total: number | null
	/** Outputs whose `amount` was unreadable — the total is a partial sum when > 0. */
	outputsWithoutAmount: number
}

/** One refusal, tagged with the event it came from. */
export interface ArenaReceiptRefusal {
	eventId: string
	refusal: ArenaReceiptRefusalName
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
		throw new ArenaReceiptError(ARENA_RECEIPT_REFUSAL_BAD_CONTENT, 'content is not valid JSON')
	}
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		throw new ArenaReceiptError(ARENA_RECEIPT_REFUSAL_BAD_CONTENT, 'content JSON is not an object')
	}
	return parsed as Record<string, unknown>
}

/** The schema and outcome the kind demands — the single place the pair is written. */
function expectedForKind(kind: number): { schema: string; outcome: ArenaReceiptOutcome; label: string } {
	if (kind === ARENA_AUCTION_REFUND_KIND) return { schema: ARENA_REFUND_SCHEMA, outcome: 'refund', label: 'refund receipt' }
	return { schema: ARENA_SETTLE_SCHEMA, outcome: 'settle', label: 'settle receipt' }
}

/**
 * The schnorr check, at the same parse boundary the params and verdict paths
 * verify at.
 */
function requireVerifiedSignature(event: ArenaReceiptEventLike): void {
	if (typeof event.sig !== 'string' || event.sig.length === 0) {
		throw new ArenaReceiptError(ARENA_RECEIPT_REFUSAL_BAD_SIGNATURE, 'receipt event carries no signature')
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
	if (!verified) throw new ArenaReceiptError(ARENA_RECEIPT_REFUSAL_BAD_SIGNATURE, 'receipt event signature does not verify')
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
		throw new ArenaReceiptError(ARENA_RECEIPT_REFUSAL_UNANCHORED, `${label} is missing the mandatory height anchor`)
	}
	if (tagHash === null && contentHash === null) {
		throw new ArenaReceiptError(ARENA_RECEIPT_REFUSAL_UNANCHORED, `${label} is missing the mandatory hash anchor`)
	}

	const height = asPositiveInteger(tagHeight ?? contentHeight)
	if (height === null) {
		throw new ArenaReceiptError(ARENA_RECEIPT_REFUSAL_BAD_ANCHOR, `${label} height anchor is not a positive integer`)
	}
	const hash = tagHash ?? contentHash
	if (hash === null || !HEX.test(hash)) {
		throw new ArenaReceiptError(ARENA_RECEIPT_REFUSAL_BAD_ANCHOR, `${label} hash anchor is not a non-empty hex string`)
	}

	// The tag and content copies are the same fact written twice; a disagreement
	// means the event addresses two chain states and neither reading is safe.
	if (contentHeight !== null && String(height) !== contentHeight.trim()) {
		throw new ArenaReceiptError(
			ARENA_RECEIPT_REFUSAL_ANCHOR_MISMATCH,
			`tag height ${JSON.stringify(tagHeight)} != content height ${JSON.stringify(contentHeight)}`,
		)
	}
	if (contentHash !== null && tagHash !== null && contentHash.toLowerCase() !== tagHash.toLowerCase()) {
		throw new ArenaReceiptError(
			ARENA_RECEIPT_REFUSAL_ANCHOR_MISMATCH,
			`tag hash ${JSON.stringify(tagHash)} != content block_hash ${JSON.stringify(contentHash)}`,
		)
	}

	return { height, hash: hash.toLowerCase() }
}

/** One parsed output, or `bad_content` when the entry is not an object. */
function parseOutput(entry: unknown, label: string): ArenaReceiptOutput {
	if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
		throw new ArenaReceiptError(ARENA_RECEIPT_REFUSAL_BAD_CONTENT, `${label} has an out entry that is not an object`)
	}
	const record = entry as Record<string, unknown>
	const dleqRaw = record.dleq
	let dleq: ArenaReceiptDleq | null = null
	if (typeof dleqRaw === 'object' && dleqRaw !== null && !Array.isArray(dleqRaw)) {
		const d = dleqRaw as Record<string, unknown>
		dleq = { e: asNonEmptyString(d.e), s: asNonEmptyString(d.s), r: asNonEmptyString(d.r) }
	}
	return {
		recipient: asNonEmptyString(record.recipient),
		amount: asFiniteNumber(record.amount),
		id: asNonEmptyString(record.id),
		secret: asNonEmptyString(record.secret),
		C: asNonEmptyString(record.C),
		dleq,
	}
}

// =========================================================================
// The parser — one event in, one parsed receipt or one named refusal out
// =========================================================================

export interface ParseReceiptOptions {
	/**
	 * The committed validator roster, when the caller holds one (from a 1448
	 * params read). A non-empty array enforces membership; an absent/empty roster
	 * cannot refuse a receipt and is therefore skipped — the receipt does not
	 * carry its own roster.
	 */
	roster?: readonly string[] | null
}

/**
 * Parse one kind-1443/1444 receipt event, verifying it the way the app verifies
 * a kind-1448 params event: **signature first** (fail closed on unauthenticated
 * content), then the schema, the kind/outcome agreement, the mandatory agreeing
 * anchor, then roster membership where a roster is known.
 */
export function parseArenaReceiptEvent(event: ArenaReceiptEventLike, options: ParseReceiptOptions = {}): ParsedArenaReceipt {
	if (event.kind !== ARENA_AUCTION_REFUND_KIND && event.kind !== ARENA_AUCTION_SETTLE_KIND) {
		throw new ArenaReceiptError(
			ARENA_RECEIPT_REFUSAL_BAD_KIND,
			`expected kind ${ARENA_AUCTION_REFUND_KIND} or ${ARENA_AUCTION_SETTLE_KIND}, got ${event.kind}`,
		)
	}
	const expected = expectedForKind(event.kind)

	requireVerifiedSignature(event)

	const content = parseContentObject(event.content)
	if (content.schema !== expected.schema) {
		throw new ArenaReceiptError(
			ARENA_RECEIPT_REFUSAL_BAD_SCHEMA,
			`content.schema must be ${JSON.stringify(expected.schema)} for kind ${event.kind}, got ${JSON.stringify(content.schema)}`,
		)
	}

	// The outcome is the kind written a second time; a disagreement means the
	// event names a move it is not (a 1443 that claims to be a settle).
	if (content.outcome !== expected.outcome) {
		throw new ArenaReceiptError(
			ARENA_RECEIPT_REFUSAL_BAD_CONTENT,
			`content.outcome ${JSON.stringify(content.outcome)} does not match kind ${event.kind} (${expected.outcome})`,
		)
	}

	const anchor = requireAgreeingAnchor(event.tags, content, expected.label)

	const auctionId = tagValue(event.tags, 'auction') ?? asNonEmptyString(content.auction_id)
	if (auctionId === null) {
		throw new ArenaReceiptError(ARENA_RECEIPT_REFUSAL_BAD_CONTENT, 'receipt has no auction id')
	}
	const bidId = tagValue(event.tags, 'bid') ?? asNonEmptyString(content.bid_id)
	if (bidId === null) {
		throw new ArenaReceiptError(ARENA_RECEIPT_REFUSAL_BAD_CONTENT, 'receipt has no bid id')
	}

	// Roster membership: enforced only when the caller holds a roster. An absent
	// roster is not a refusal — the receipt does not carry its own validator set,
	// and the gate is the signature, the schema and the anchor.
	const roster = options.roster
	if (Array.isArray(roster) && roster.length > 0) {
		const signer = event.pubkey.toLowerCase()
		if (!roster.some((pubkey) => pubkey.toLowerCase() === signer)) {
			throw new ArenaReceiptError(ARENA_RECEIPT_REFUSAL_SIGNER_NOT_IN_ROSTER, `signer ${event.pubkey} is not on the known validator roster`)
		}
	}

	const outRaw = content.out
	if (!Array.isArray(outRaw) || outRaw.length === 0) {
		throw new ArenaReceiptError(ARENA_RECEIPT_REFUSAL_BAD_CONTENT, 'receipt content has no out entries')
	}
	const outputs: ArenaReceiptOutput[] = outRaw.map((entry) => parseOutput(entry, expected.label))

	let total: number | null = null
	let outputsWithoutAmount = 0
	for (const output of outputs) {
		if (output.amount === null) {
			outputsWithoutAmount += 1
			continue
		}
		total = (total ?? 0) + output.amount
	}

	return {
		eventId: event.id,
		signerPubkey: event.pubkey,
		kind: event.kind,
		auctionId,
		bidId,
		outcome: expected.outcome,
		height: anchor.height,
		blockHash: anchor.hash,
		settledAt: asFiniteNumber(content.settled_at) ?? asPositiveInteger(content.settled_at),
		paramsVersion: asNonEmptyString(content.params_version),
		outputs,
		total,
		outputsWithoutAmount,
	}
}

/** A refusal predicate, for the edge that must "ignore, not merely distrust". */
export function isVerifiedArenaReceiptEvent(event: ArenaReceiptEventLike, options: ParseReceiptOptions = {}): boolean {
	try {
		parseArenaReceiptEvent(event, options)
		return true
	} catch {
		return false
	}
}

// =========================================================================
// Dedupe — one move, however many heights a validator re-published it at
// =========================================================================

/** The identity of a move: `(bid_id, outcome)`. `\0` cannot appear in either. */
export function receiptMoveKey(receipt: Pick<ParsedArenaReceipt, 'bidId' | 'outcome'>): string {
	return `${receipt.bidId}\u0000${receipt.outcome}`
}

/**
 * Reduce a set of parsed receipts to **one per `(bid_id, outcome)`**, keeping the
 * **earliest anchored height** — a validator that restarts may re-publish the
 * same move later, and it is the same move. Ties at one height break to the
 * lexically lowest event id, so the choice is deterministic. The result is
 * ordered by anchored height ascending, then bid id, then outcome.
 */
export function dedupeArenaReceipts(receipts: readonly ParsedArenaReceipt[]): ParsedArenaReceipt[] {
	const byKey = new Map<string, ParsedArenaReceipt>()
	for (const receipt of receipts) {
		const key = receiptMoveKey(receipt)
		const prior = byKey.get(key)
		if (prior === undefined) {
			byKey.set(key, receipt)
			continue
		}
		if (receipt.height < prior.height || (receipt.height === prior.height && receipt.eventId.localeCompare(prior.eventId) < 0)) {
			byKey.set(key, receipt)
		}
	}
	return [...byKey.values()].sort((a, b) => a.height - b.height || a.bidId.localeCompare(b.bidId) || a.outcome.localeCompare(b.outcome))
}

// =========================================================================
// params_version — an opaque token, flagged and never refused on
// =========================================================================

/**
 * Whether a receipt's `params_version` differs from a params reading the caller
 * holds.
 *
 * `true` — the app holds a params version and it differs: **flag it**, but the
 * receipt still stands (money moved; the signature, the roster and the anchor
 * are the gate). `false` — the digest agrees. `null` — the comparison cannot be
 * made (the app holds no params reading, or the receipt carried no digest): an
 * unknown stays `null`, never a defaulted `false`.
 */
export function receiptParamsVersionMismatch(receipt: ParsedArenaReceipt, heldParamsVersion: string | null | undefined): boolean | null {
	if (heldParamsVersion === null || heldParamsVersion === undefined || heldParamsVersion === '') return null
	if (receipt.paramsVersion === null) return null
	return receipt.paramsVersion !== heldParamsVersion
}

// =========================================================================
// The selection — parse a batch, refuse by name, dedupe the survivors
// =========================================================================

export interface ArenaReceiptsSelection {
	/** The deduped receipts, earliest anchored height first. */
	receipts: ParsedArenaReceipt[]
	/** Every event that was refused, with its stable name — never silently dropped. */
	refusals: ArenaReceiptRefusal[]
}

const RECEIPT_KINDS: readonly number[] = [ARENA_AUCTION_REFUND_KIND, ARENA_AUCTION_SETTLE_KIND]

/**
 * Parse a batch of raw receipt events: keep the ones that verify and dedupe the
 * survivors, recording every refusal by name. Deduped by event id first, because
 * two relays can only agree on an id.
 */
export function readArenaReceipts(events: readonly ArenaReceiptEventLike[], options: ParseReceiptOptions = {}): ArenaReceiptsSelection {
	const byId = new Map<string, ArenaReceiptEventLike>()
	for (const event of events) {
		if (typeof event?.id === 'string' && event.id.length > 0 && RECEIPT_KINDS.includes(event.kind)) byId.set(event.id, event)
	}

	const refusals: ArenaReceiptRefusal[] = []
	const parsed: ParsedArenaReceipt[] = []
	for (const event of byId.values()) {
		try {
			parsed.push(parseArenaReceiptEvent(event, options))
		} catch (error) {
			if (error instanceof ArenaReceiptError) {
				refusals.push({ eventId: event.id, refusal: error.refusal, detail: error.message })
			} else {
				throw error
			}
		}
	}

	return { receipts: dedupeArenaReceipts(parsed), refusals }
}
