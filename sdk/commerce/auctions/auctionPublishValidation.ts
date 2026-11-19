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
import { LOT_MEDIA_MAX_EXTRA, parseLotMediaItem, type LotMediaItem } from './lotMedia'
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
	/** A gallery item has an unknown type or an unsafe URL. */
	| 'create.bad-media'
	/** More gallery items than `LOT_MEDIA_MAX_EXTRA`. */
	| 'create.too-much-media'
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
	/** The title is longer than the chain's published `max_title_chars`. */
	| 'create.title-too-long'
	/** The description is longer than the chain's published `max_description_chars`. */
	| 'create.description-too-long'
	/** The image URL is longer than the chain's published `max_image_chars`. */
	| 'create.image-too-long'
	/** The category is longer than the chain's published `max_category_chars`. */
	| 'create.category-too-long'
	/** The name is longer than the chain's published `max_name_chars`. */
	| 'create.name-too-long'
	/** The image URL does not satisfy the chain's published `image_rule`. */
	| 'create.image-rule-violated'
	/** The starting price is below the chain's published `start_price_min`. */
	| 'create.start-price-below-min'
	/** The starting price is above the chain's published `start_price_max`. */
	| 'create.start-price-above-max'
	/** The increment is below the chain's published `increment_min`. */
	| 'create.increment-below-min'
	/** The increment is above the chain's published `increment_max`. */
	| 'create.increment-above-max'

/** The form field a refusal belongs to, for inline messages in the editor. */
export type AuctionPublishValidationField =
	| 'auctionId'
	| 'title'
	| 'description'
	| 'image'
	| 'category'
	| 'name'
	| 'media'
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
	/** Gallery items after the primary image (`media` in the create content). */
	media?: readonly { type: string; url: string }[] | null
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
	/**
	 * The **create-content rules** the chain publishes in kind 1448
	 * (`arenaParamsRead.ts` terms), or `null` when the app holds no params
	 * reading. These are the chain's own rules, read from the wire, **not** a
	 * second hardcoded copy: a rule change on the chain reaches this pre-flight
	 * with no client edit. A rule that is `null` here is **not checked** (never
	 * defaulted), because the app cannot enforce a rule it was not given.
	 */
	rules?: ArenaCreateRules | null
}

/**
 * The create-content rules the chain publishes, in the wire's own snake_case.
 * Every field is optional and nullable: a rule the app was not given is not
 * enforced, because a rule the app was not given could be anything.
 */
export interface ArenaCreateRules {
	max_title_chars?: number | null
	max_description_chars?: number | null
	max_image_chars?: number | null
	max_category_chars?: number | null
	max_name_chars?: number | null
	image_rule?: string | null
	start_price_min?: number | null
	start_price_max?: number | null
	increment_min?: number | null
	increment_max?: number | null
}

/**
 * The one image rule the chain names today (`image_rule: "same-site-or-https"`).
 * The rule is a **name**, not a pattern: it tells the app which rule to apply —
 * empty, an `https://…` URL, or a `./…` / `/…` same-site path with a single
 * leading slash and a fixed URI-safe byte set. It does not parametrise one.
 */
export const ARENA_IMAGE_RULE_SAME_SITE_OR_HTTPS = 'same-site-or-https'

/** The URI-safe byte set the same-site image rule accepts, from `chain`'s `safeImage`. */
const SAME_SITE_IMAGE_PATH = /^\/(?!\/)[A-Za-z0-9\-._~!$&'()*+,;=:@%/]*$/

/** The protocol-ready create fields. Numbers are numbers, and the split is parsed. */
export interface ArenaCreateValue {
	auctionId: string
	title: string
	description: string
	image: string
	/** Gallery items after `image`; empty means the lot has one photo. */
	media: LotMediaItem[]
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

/**
 * A rule from the chain's published params as an integer, or `null` when the
 * rule was not given. A non-integer or negative value is treated as "not
 * given" — the app will not enforce a malformed rule as if it were a rule.
 */
const asRuleInt = (value: number | null | undefined): number | null =>
	typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null

/**
 * The chain's `same-site-or-https` image rule, implemented: empty, an
 * absolute `https://` URL, or a same-site path (`/…` or `./…`) with a single
 * leading slash and only URI-safe bytes. The rule name tells the app **which**
 * rule to apply; it does not parametrise it.
 */
function sameSiteOrHttpsImage(url: string): boolean {
	if (url === '') return true
	if (url.startsWith('https://')) return true
	if (url.startsWith('./')) return SAME_SITE_IMAGE_PATH.test(url.slice(1))
	return SAME_SITE_IMAGE_PATH.test(url)
}

const text = (value: string | number | null | undefined): string => (value === null || value === undefined ? '' : String(value).trim())

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

	// --- gallery: blank rows are ignored, anything else must be safe ------
	const media: LotMediaItem[] = []
	const mediaRows = (input.media ?? []).filter((row) => text(row?.url) !== '')
	mediaRows.forEach((row, index) => {
		const item = parseLotMediaItem(row)
		if (item) media.push(item)
		else refuse('media', 'create.bad-media', 'Each gallery item needs an https:// URL and a type of photo, video or live.', index)
	})
	if (mediaRows.length > LOT_MEDIA_MAX_EXTRA) {
		refuse('media', 'create.too-much-media', `A lot can have up to ${LOT_MEDIA_MAX_EXTRA} gallery items after the main photo.`)
	}

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
		if (
			windowText === '' ||
			parsedWindow === null ||
			parsedWindow < AUCTION_MIN_ANTISNIPE_WINDOW_SEC ||
			parsedWindow > AUCTION_MAX_ANTISNIPE_WINDOW_SEC
		) {
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
			refuse(
				'v4vSplit',
				'create.split-bps-not-positive',
				'A split allocation must be a whole number of basis points above zero.',
				row.index,
			)
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
		refuse(
			'sellerWallet',
			'create.no-seller-wallet',
			'The wallet spend key could not be prepared, so the auction cannot name a seller wallet. Open the wallet, make sure it is ready, and try again.',
		)
	}

	// --- the chain's own published rules (kind 1448) --------------------
	// Read from the wire, never a second hardcoded copy. A rule the app was not
	// given is not checked: refusing against a guessed rule is worse than saying
	// the app cannot check it.
	const rules = context.rules ?? null
	if (rules !== null) {
		const titleLimit = asRuleInt(rules.max_title_chars)
		if (titleLimit !== null && title.length > titleLimit) {
			refuse('title', 'create.title-too-long', `The title is ${title.length} characters; the chain publishes a limit of ${titleLimit}.`)
		}
		const descriptionLimit = asRuleInt(rules.max_description_chars)
		if (descriptionLimit !== null && description.length > descriptionLimit) {
			refuse(
				'description',
				'create.description-too-long',
				`The description is ${description.length} characters; the chain publishes a limit of ${descriptionLimit}.`,
			)
		}
		const imageLimit = asRuleInt(rules.max_image_chars)
		if (imageLimit !== null && image.length > imageLimit) {
			refuse('image', 'create.image-too-long', `The image URL is ${image.length} characters; the chain publishes a limit of ${imageLimit}.`)
		}
		const categoryLimit = asRuleInt(rules.max_category_chars)
		const category = text(input.category)
		if (categoryLimit !== null && category.length > categoryLimit) {
			refuse(
				'category',
				'create.category-too-long',
				`The category is ${category.length} characters; the chain publishes a limit of ${categoryLimit}.`,
			)
		}
		const nameLimit = asRuleInt(rules.max_name_chars)
		const name = text(input.name)
		if (nameLimit !== null && name.length > nameLimit) {
			refuse('name', 'create.name-too-long', `The name is ${name.length} characters; the chain publishes a limit of ${nameLimit}.`)
		}
		// `image_rule` is a name, not a pattern: only the one rule the chain names
		// is enforced. An empty image passes (the rule accepts empty); anything
		// the named rule does not accept is refused.
		if (rules.image_rule === ARENA_IMAGE_RULE_SAME_SITE_OR_HTTPS && image !== '' && !sameSiteOrHttpsImage(image)) {
			refuse('image', 'create.image-rule-violated', 'The image must be an https:// URL or a same-site path (a single leading slash).')
		}
		const startMin = asRuleInt(rules.start_price_min)
		if (startMin !== null && startPrice !== null && startPrice > 0 && startPrice < startMin) {
			refuse(
				'startPrice',
				'create.start-price-below-min',
				`The starting price must be at least ${startMin} sats; the chain publishes a minimum of ${startMin}.`,
			)
		}
		const startMax = asRuleInt(rules.start_price_max)
		if (startMax !== null && startPrice !== null && startPrice > startMax) {
			refuse(
				'startPrice',
				'create.start-price-above-max',
				`The starting price must be at most ${startMax} sats; the chain publishes a maximum of ${startMax}.`,
			)
		}
		const incrementMin = asRuleInt(rules.increment_min)
		if (incrementMin !== null && minIncrement !== null && minIncrement > 0 && minIncrement < incrementMin) {
			refuse(
				'minIncrement',
				'create.increment-below-min',
				`The bid increment must be at least ${incrementMin} sats; the chain publishes a minimum of ${incrementMin}.`,
			)
		}
		const incrementMax = asRuleInt(rules.increment_max)
		if (incrementMax !== null && minIncrement !== null && minIncrement > incrementMax) {
			refuse(
				'minIncrement',
				'create.increment-above-max',
				`The bid increment must be at most ${incrementMax} sats; the chain publishes a maximum of ${incrementMax}.`,
			)
		}
	}

	if (issues.length > 0) return { ok: false, issues }

	return {
		ok: true,
		value: {
			auctionId,
			title,
			description,
			image,
			media,
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
export const validateArenaCreateInput = (input: ArenaCreateValidationInput, context: ArenaCreateValidationContext): ArenaCreateValue => {
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
	media: formData.media ?? [],
	category: formData.category,
	name: formData.name,
	startPrice: formData.startPrice,
	minIncrement: formData.minIncrement,
	mode: formData.mode,
	windowSec: formData.windowSec,
	durationSec: formData.durationSec,
	v4vSplit: formData.v4vSplit,
})
