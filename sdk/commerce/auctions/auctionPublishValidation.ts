/**
 * `sdk/commerce/auctions/auctionPublishValidation.ts` — the create rule for a 1440.
 *
 * One pure function turns the form's strings into the protocol's numbers, or refuses
 * **by name**. Every refusal is a distinct `ArenaCreateRefusal`, so a test (and the UI)
 * can tell "no duration" from "duration out of range" from "no seller wallet" without
 * matching message text — the discipline `arenaAnchor.ts` and `arenaAuctionRead.ts` set
 * for their own refusal names.
 *
 * The rules are the settled protocol's (MERGED-PROTOCOL-SPEC §8) and nothing else:
 *
 * | field         | rule                                                      |
 * | ------------- | --------------------------------------------------------- |
 * | `auctionId`   | the `d`: 1…64 of `[A-Za-z0-9_-]`                           |
 * | `startPrice`  | a positive safe integer of sats                            |
 * | `minIncrement`| a positive safe integer of sats                            |
 * | `mode`        | `fixed` or `antisnipe`                                     |
 * | `durationSec` | 20 … 259200 (the protocol's window)                        |
 * | `windowSec`   | 60 … 900, and only for `antisnipe`                         |
 * | `v4vSplit`    | rows ≤ 10000 bps in total, no repeated recipient           |
 * | `sellerWallet`| required, and refused when absent — never substituted      |
 *
 * There is no `reserve` rule because the protocol has no reserve: the owner has deferred
 * it, and a knob that silently does nothing is worse than no knob.
 */
import type { ArenaAuctionMode, AuctionFormData, AuctionV4vSplitRowInput, ArenaV4vSplitRole } from './auctionForm'

/** Shortest auction the protocol accepts, in seconds. */
export const AUCTION_MIN_DURATION_SEC = 20

/** Longest auction the protocol accepts, in seconds (three days). */
export const AUCTION_MAX_DURATION_SEC = 259_200

/** Shortest anti-snipe window the protocol accepts, in seconds. */
export const AUCTION_MIN_ANTISNIPE_WINDOW_SEC = 60

/** Longest anti-snipe window the protocol accepts, in seconds. */
export const AUCTION_MAX_ANTISNIPE_WINDOW_SEC = 900

/** The whole of the split, in basis points. Sum of rows may not exceed it. */
export const AUCTION_V4V_TOTAL_BPS = 10_000

/** The protocol's `d`/`auction_id` charset and length. */
export const AUCTION_AUCTION_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

/** One V4V split row, as it is written into the create content. */
export interface ArenaV4vSplitRow {
	role: ArenaV4vSplitRole
	recipientPubkey: string
	allocationBps: number
}

// =========================================================================
// Refusals: names, never sentences
// =========================================================================

export type ArenaCreateRefusal =
	/** The form carries no `d`. */
	| 'create.no-auction-id'
	/** The `d` is outside the protocol's charset/length. */
	| 'create.bad-auction-id'
	| 'create.no-title'
	| 'create.no-description'
	| 'create.no-image'
	/** No duration was supplied at all. */
	| 'create.no-duration'
	/** A duration was supplied but is outside 20…259200. */
	| 'create.duration-out-of-range'
	/** No start price was supplied at all. */
	| 'create.no-start-price'
	/** The start price was supplied but is not a positive integer. */
	| 'create.start-price-not-positive'
	/** The increment was supplied but is not a positive integer (this includes "absent"). */
	| 'create.increment-not-positive'
	/** `mode` is neither `fixed` nor `antisnipe`. */
	| 'create.unknown-mode'
	/** `antisnipe` with a window outside 60…900. */
	| 'create.window-out-of-range'
	/** A split row's allocation is not a positive integer of basis points. */
	| 'create.split-bps-not-positive'
	/** The rows allocate more than 10000 bps between them. */
	| 'create.split-exceeds-total'
	/** Two rows name the same recipient: one payee, one row. */
	| 'create.duplicate-split-recipient'
	/** A split row's role is neither `validator` nor `v4v`. */
	| 'create.unknown-split-role'
	/** A split row's recipient is not a 64-hex Nostr pubkey. */
	| 'create.bad-split-recipient'
	/** No wallet spend key was available. The create is refused, never faked. */
	| 'create.no-seller-wallet'

/** The form field a refusal belongs to, for inline messages in the editor. */
export type AuctionPublishValidationField =
	| 'auctionId'
	| 'title'
	| 'description'
	| 'image'
	| 'startPrice'
	| 'minIncrement'
	| 'mode'
	| 'windowSec'
	| 'durationSec'
	| 'v4vSplit'
	| 'sellerWallet'

export interface ArenaCreateValidationIssue {
	field: AuctionPublishValidationField
	refusal: ArenaCreateRefusal
	message: string
	/** The split row's index, when the issue is about one row. */
	index?: number
}

/** What the validator receives. `sellerWallet` is the wallet seam's answer, or null. */
export interface ArenaCreateValidationInput {
	auctionId?: string | null
	title?: string | null
	description?: string | null
	imageUrl?: string | null
	category?: string | null
	name?: string | null
	startPrice?: string | number | null
	minIncrement?: string | number | null
	mode?: string | null
	windowSec?: string | number | null
	durationSec?: string | number | null
	v4vSplit?: readonly AuctionV4vSplitRowInput[] | null
}

export interface ArenaCreateValidationContext {
	/** The wallet spend key's pubkey (`sellerWallet` in the content), or null when unavailable. */
	sellerWallet: string | null
}

/** The protocol-ready create fields. Numbers are numbers, and the split is parsed. */
export interface ArenaCreateValue {
	auctionId: string
	title: string
	description: string
	image: string
	category: string
	name: string
	startPrice: number
	minIncrement: number
	mode: ArenaAuctionMode
	windowSec: number
	durationSec: number
	sellerWallet: string
	v4vSplit: ArenaV4vSplitRow[]
}

export class ArenaCreateRefusalError extends Error {
	readonly refusal: ArenaCreateRefusal
	readonly issues: ArenaCreateValidationIssue[]

	constructor(refusal: ArenaCreateRefusal, message: string, issues: ArenaCreateValidationIssue[] = []) {
		super(message)
		this.name = 'ArenaCreateRefusalError'
		this.refusal = refusal
		this.issues = issues
	}
}

// =========================================================================
// Parsing helpers
// =========================================================================

const HEX64 = /^[0-9a-f]{64}$/
const UNSIGNED_INTEGER = /^\d+$/

const text = (value: string | number | null | undefined): string =>
	value === null || value === undefined ? '' : String(value).trim()

/** A non-negative safe integer from a string/number, or null. Never rounds, never coerces junk to 0. */
const parseInteger = (value: string | number | null | undefined): number | null => {
	if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null
	const trimmed = text(value)
	if (!UNSIGNED_INTEGER.test(trimmed)) return null
	const parsed = Number(trimmed)
	return Number.isSafeInteger(parsed) ? parsed : null
}

/**
 * Normalise the form's split rows. Blank rows are dropped (the editor seeds one empty
 * row); a typed row is kept as-is so validation can refuse it by name rather than
 * silently discarding a seller's allocation.
 */
function splitRowsOf(rows: readonly AuctionV4vSplitRowInput[] | null | undefined): {
	rows: { index: number; role: string; recipientPubkey: string; allocationBps: string }[]
} {
	const out: { index: number; role: string; recipientPubkey: string; allocationBps: string }[] = []
	for (const [index, row] of (rows ?? []).entries()) {
		const recipientPubkey = text(row.recipientPubkey)
		const allocationBps = text(row.allocationBps)
		if (recipientPubkey === '' && allocationBps === '') continue
		out.push({ index, role: text(row.role), recipientPubkey, allocationBps })
	}
	return { rows: out }
}

// =========================================================================
// The rule
// =========================================================================

/**
 * Validate the form and return the protocol-ready value, or the full issue list.
 * Exported as a `Result` so the editor can render every message at once while the
 * publish path throws on the first refusal.
 */
export function normalizeArenaCreateInput(
	input: ArenaCreateValidationInput,
	context: ArenaCreateValidationContext,
): { ok: true; value: ArenaCreateValue } | { ok: false; issues: ArenaCreateValidationIssue[] } {
	const issues: ArenaCreateValidationIssue[] = []
	const refuse = (field: AuctionPublishValidationField, refusal: ArenaCreateRefusal, message: string, index?: number) => {
		issues.push(index === undefined ? { field, refusal, message } : { field, refusal, message, index })
	}

	const auctionId = text(input.auctionId)
	if (auctionId === '') refuse('auctionId', 'create.no-auction-id', 'An auction id is required.')
	else if (!AUCTION_AUCTION_ID_PATTERN.test(auctionId)) {
		refuse('auctionId', 'create.bad-auction-id', 'The auction id must be 1–64 characters of A–Z, a–z, 0–9, `_` or `-`.')
	}

	const title = text(input.title)
	if (title === '') refuse('title', 'create.no-title', 'Auction title is required')

	const description = text(input.description)
	if (description === '') refuse('description', 'create.no-description', 'Auction description is required')

	const image = text(input.imageUrl)
	if (image === '') refuse('image', 'create.no-image', 'At least one image is required')

	// --- money ---------------------------------------------------------
	const startPriceText = text(input.startPrice)
	const startPrice = parseInteger(input.startPrice)
	if (startPriceText === '') refuse('startPrice', 'create.no-start-price', 'A starting price is required')
	else if (startPrice === null || startPrice <= 0) {
		refuse('startPrice', 'create.start-price-not-positive', 'The starting price must be a whole number of sats above zero')
	}

	const minIncrement = parseInteger(input.minIncrement)
	if (minIncrement === null || minIncrement <= 0) {
		refuse('minIncrement', 'create.increment-not-positive', 'The bid increment must be a whole number of sats above zero')
	}

	// --- time ----------------------------------------------------------
	const durationText = text(input.durationSec)
	const durationSec = parseInteger(input.durationSec)
	if (durationText === '' || durationSec === null) {
		refuse('durationSec', 'create.no-duration', 'An auction duration is required')
	} else if (durationSec < AUCTION_MIN_DURATION_SEC || durationSec > AUCTION_MAX_DURATION_SEC) {
		refuse(
			'durationSec',
			'create.duration-out-of-range',
			`The auction duration must be between ${AUCTION_MIN_DURATION_SEC} seconds and ${AUCTION_MAX_DURATION_SEC} seconds (3 days).`,
		)
	}

	const modeRaw = text(input.mode)
	const mode: ArenaAuctionMode | null = modeRaw === 'fixed' || modeRaw === 'antisnipe' ? modeRaw : null
	if (mode === null) refuse('mode', 'create.unknown-mode', 'The auction mode must be `fixed` or `antisnipe`.')

	// A fixed-time auction has no window: the field is zeroed rather than carried, so
	// the immutable `windowSec` cannot read as a knob that does nothing. An anti-snipe
	// auction must state a window inside the protocol's range.
	let windowSec = 0
	if (mode === 'antisnipe') {
		const windowText = text(input.windowSec)
		const parsedWindow = parseInteger(input.windowSec)
		if (windowText === '' || parsedWindow === null || parsedWindow < AUCTION_MIN_ANTISNIPE_WINDOW_SEC || parsedWindow > AUCTION_MAX_ANTISNIPE_WINDOW_SEC) {
			refuse(
				'windowSec',
				'create.window-out-of-range',
				`An anti-snipe window must be between ${AUCTION_MIN_ANTISNIPE_WINDOW_SEC} and ${AUCTION_MAX_ANTISNIPE_WINDOW_SEC} seconds.`,
			)
		} else {
			windowSec = parsedWindow
		}
	}

	// --- the committed split -------------------------------------------
	const { rows } = splitRowsOf(input.v4vSplit)
	const v4vSplit: ArenaV4vSplitRow[] = []
	const seenRecipients = new Set<string>()
	let totalBps = 0
	for (const row of rows) {
		if (row.role !== 'validator' && row.role !== 'v4v') {
			refuse('v4vSplit', 'create.unknown-split-role', 'A split row role must be `validator` or `v4v`.', row.index)
			continue
		}
		if (!HEX64.test(row.recipientPubkey)) {
			refuse('v4vSplit', 'create.bad-split-recipient', 'A split recipient must be a 64-character hex Nostr pubkey.', row.index)
			continue
		}
		if (seenRecipients.has(row.recipientPubkey)) {
			refuse('v4vSplit', 'create.duplicate-split-recipient', 'A recipient appears in more than one split row.', row.index)
			continue
		}
		const allocationBps = parseInteger(row.allocationBps)
		if (allocationBps === null || allocationBps <= 0) {
			refuse('v4vSplit', 'create.split-bps-not-positive', 'A split allocation must be a whole number of basis points above zero.', row.index)
			continue
		}
		seenRecipients.add(row.recipientPubkey)
		totalBps += allocationBps
		v4vSplit.push({ role: row.role, recipientPubkey: row.recipientPubkey, allocationBps })
	}
	if (totalBps > AUCTION_V4V_TOTAL_BPS) {
		refuse('v4vSplit', 'create.split-exceeds-total', `The split rows allocate ${totalBps} bps of the ${AUCTION_V4V_TOTAL_BPS} available.`)
	}

	// --- the seller's wallet -------------------------------------------
	const sellerWallet = (context.sellerWallet ?? '').trim()
	if (sellerWallet === '') {
		refuse('sellerWallet', 'create.no-seller-wallet', 'The wallet spend key is not available, so the auction cannot name a seller wallet.')
	}

	if (issues.length > 0) return { ok: false, issues }

	return {
		ok: true,
		value: {
			auctionId,
			title,
			description,
			image,
			category: text(input.category),
			name: text(input.name),
			startPrice: startPrice as number,
			minIncrement: minIncrement as number,
			mode: mode as ArenaAuctionMode,
			windowSec,
			durationSec: durationSec as number,
			sellerWallet,
			v4vSplit,
		},
	}
}

/**
 * The issues only — what the editor renders as inline messages. Never throws: a form
 * with an empty title must still render.
 */
export const getArenaCreateIssues = (
	input: ArenaCreateValidationInput,
	context: ArenaCreateValidationContext,
): ArenaCreateValidationIssue[] => {
	const result = normalizeArenaCreateInput(input, context)
	return result.ok ? [] : result.issues
}

/**
 * The value, or a throw carrying the first refusal's **name**. The publish path uses
 * this: it refuses with a name, never with prose it has to re-parse.
 */
export const validateArenaCreateInput = (
	input: ArenaCreateValidationInput,
	context: ArenaCreateValidationContext,
): ArenaCreateValue => {
	const result = normalizeArenaCreateInput(input, context)
	if (result.ok) return result.value
	const first = result.issues[0]
	throw new ArenaCreateRefusalError(first.refusal, first.message, result.issues)
}

/** The form's own fields, as the validator's input. One mapping, one place. */
export const auctionFormToCreateInput = (formData: AuctionFormData): ArenaCreateValidationInput => ({
	auctionId: formData.auctionId,
	title: formData.title,
	description: formData.description,
	imageUrl: formData.imageUrl,
	category: formData.category,
	name: formData.name,
	startPrice: formData.startPrice,
	minIncrement: formData.minIncrement,
	mode: formData.mode,
	windowSec: formData.windowSec,
	durationSec: formData.durationSec,
	v4vSplit: formData.v4vSplit,
})