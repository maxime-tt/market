/**
 * `platform/web/auctions/relay/arenaBidFunding.ts` — the funding payload a
 * consolidated-protocol 1441 must carry, and the strict parser for it.
 *
 * ## Why this module exists
 *
 * The consolidated protocol does not accept a bare bid. The money is Cashu
 * proofs locked under a NUT-11 **2-of-2 `[bidder, committee]` `SIG_ALL`**
 * condition, and the bid content carries the bidder's **pre-signed settle and
 * refund templates**. If either is missing the validator refuses the bid by
 * name (`chain/sigall.go` in the reference implementation), and the app's old
 * 1441 publisher — which attached no funding payload at all — could only ever
 * produce bids that are refused.
 *
 * The authoritative shapes are not invented here:
 *
 * - the lock is `chain/sigall.go` `checkSigAllLock` / `parseOneSigAllLock`, and
 *   the canonical five-tag form in `MERGED-PROTOCOL-SPEC.md` §1.1;
 * - the digest is the current Cashu layout-B SIG_ALL message, pinned
 *   cross-language by the Go golden vector (`sigAllGoldenDigest`) and by
 *   `web/src/lib/arena.js` (`sigAllHash`, `sigAllTemplateDigest`);
 * - the locktime floor is `chain/app.go` `minLocktime` / `establishedEnd`
 *   (spec §2.1–§2.2);
 * - the templates are `sigAllSignedTemplate` and `verifySigAllBidTemplates`.
 *
 * ## What this module deliberately does NOT do
 *
 * It does not build a refund path, and it does not submit outcomes. Refunds are
 * automatic from the bid's own committed template; `/api/release` no longer
 * exists and `POST /api/settle` is the ops fallback, not the product path
 * (handover §4).
 *
 * It also never derives the Nostr key from the wallet key or vice versa. The
 * caller signs the 1441 with its Nostr identity; the templates here are signed
 * with the wallet spend key, supplied as a callback so this module never holds
 * key material.
 */
import {
	OutputData,
	getPubKeyFromPrivKey,
	hashToCurve,
	pointFromHex,
	schnorrVerifyDigest,
	type P2PKOptions,
} from '@cashu/cashu-ts'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'

// =========================================================================
// The protocol constants (spec §1.1, §2, §10)
// =========================================================================

/** The settlement safety window the locktime floor adds after the established end. */
export const ARENA_SETTLEMENT_SAFETY_SECONDS = 900

/** The bid-to-consensus latency the locktime floor adds on top of the safety window. */
export const ARENA_BID_TO_CONSENSUS_LATENCY_SECONDS = 15

/** NUT-11's `n_sigs` for the escrow: the bidder's half plus the committee's half. */
export const ARENA_ESCROW_REQUIRED_SIGNATURES = 2

/** The canonical tag order, byte for byte (spec §1.1). */
export const ARENA_ESCROW_TAG_ORDER = ['locktime', 'pubkeys', 'n_sigs', 'refund', 'sigflag'] as const

/** The layout-B golden digest from `chain/sigall.go` (`sigAllGoldenDigest`). */
export const ARENA_SIGALL_GOLDEN_DIGEST = 'd3403843d4f3ead4a341f02476b14f140699d346054435fd38d27c294130bec3'

const HEX32 = /^[0-9a-f]{64}$/
const HEX64 = /^[0-9a-f]{128}$/
const COMPRESSED_PUBKEY = /^0[23][0-9a-f]{64}$/
const DECIMAL_INTEGER = /^(0|[1-9][0-9]*)$/

/** secp256k1's generator, compressed. A public curve constant, not key material. */
const SECP256K1_G = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'

// =========================================================================
// Types
// =========================================================================

/** One locked Cashu proof, in the shape the chain commits and the templates spend. */
export interface ArenaEscrowProof {
	id: string
	amount: number
	secret: string
	C: string
}

/** One output the bidder pre-authorises: its opening is committed, not chosen later. */
export interface ArenaTemplateOutput {
	amount: number
	id: string
	/** A NUT-10 `P2PK` secret locked to the destination key. */
	secret: string
	/** The output's blinding factor, 32 bytes of lowercase hex. */
	r: string
}

/** One exact transaction, plus the bidder's signature over its layout-B digest. */
export interface ArenaOutcomeTemplate {
	inputs: ArenaEscrowProof[]
	outputs: ArenaTemplateOutput[]
	/** 32 bytes of lowercase hex — the digest the committee re-derives. */
	digest: string
	/** 128 bytes of lowercase hex — BIP-340 over `digest`, by the wallet spend key. */
	bidder_signature: string
}

/** The only two spends the escrow may ever make (spec §4). */
export interface ArenaOutcomeTemplates {
	settle: ArenaOutcomeTemplate
	refund: ArenaOutcomeTemplate
}

/** The funding payload the 1441 content carries. */
export interface ArenaBidFunding {
	/** The bidder's wallet spend key, compressed — it owns the lock and signs the templates. */
	wallet: string
	/** The locked proofs, exactly as the mint returned them. */
	proofs: ArenaEscrowProof[]
	outcome_templates: ArenaOutcomeTemplates
	/** The locktime the proofs carry; repeated here for the bidder's own record. */
	locktime: number
}

/** A v4v split row, as committed on the create (spec §6). */
export interface ArenaBidSplitRow {
	role: string
	recipientPubkey: string
	allocationBps: number
}

/** A template destination and its exact amount. */
export interface ArenaTemplateDestination {
	recipient: string
	amount: number
}

// =========================================================================
// Refusals — names, not sentences (the protocol's own names where it has one)
// =========================================================================

export type ArenaBidFundingRefusal =
	| 'lock.no-proofs'
	| 'lock.not-p2pk'
	| 'lock.not-canonical'
	| 'lock.bad-nonce'
	| 'lock.data-not-bidder'
	| 'lock.tag-count'
	| 'lock.tag-shape'
	| 'lock.first-tag-not-locktime'
	| 'lock.locktime-not-integer'
	| 'lock.locktime-below-floor'
	| 'lock.pubkeys-not-committee'
	| 'lock.n-sigs-not-2'
	| 'lock.refund-not-bidder'
	| 'lock.not-sig-all'
	| 'lock.proofs-share-no-lock'
	| 'wallet.not-compressed'
	| 'template.bad-input'
	| 'template.bad-output'
	| 'template.destination'
	| 'template.inputs-not-committed-proofs'
	| 'template.amount'
	| 'template.keyset'
	| 'template.digest'
	| 'template.not-signed-by-bidder'
	| 'template.escrow-relock'
	| 'template.refund-pays-split'
	| 'template.split-omits'
	| 'template.split-adds'
	| 'template.split-unrepresentable'

/**
 * The refusal text is the protocol's own wherever it has one, so a validator
 * log and a client refusal can be matched literally. Where the chain has no
 * fixed sentence the text names the rule.
 */
export const ARENA_BID_FUNDING_REFUSAL_TEXT: Record<ArenaBidFundingRefusal, string> = {
	'lock.no-proofs': 'all proofs must share one lock',
	'lock.not-p2pk': 'the secret is not a P2PK condition',
	'lock.not-canonical': 'the secret is not canonical (an escaped or reordered secret reads differently to the mint)',
	'lock.bad-nonce': 'the condition nonce is not 32 bytes of lowercase hex',
	'lock.data-not-bidder': 'lock data must be the bidder wallet key',
	'lock.tag-count': 'lock carries the wrong number of tags, exactly 5 are required',
	'lock.tag-shape': 'every tag must have exactly one value',
	'lock.first-tag-not-locktime': 'the first tag must be locktime',
	'lock.locktime-not-integer': 'the locktime tag is not a decimal integer',
	'lock.locktime-below-floor': 'locktime below the floor for this lot',
	'lock.pubkeys-not-committee': 'lock pubkeys must be exactly the committee key',
	'lock.n-sigs-not-2': 'lock n_sigs must be 2',
	'lock.refund-not-bidder': 'lock refund must be the bidder wallet key only',
	'lock.not-sig-all': 'lock must use SIG_ALL',
	'lock.proofs-share-no-lock': 'all proofs must share one lock',
	'wallet.not-compressed': 'wallet spend key is not a compressed secp256k1 key',
	'template.bad-input': 'template inputs are not the committed proofs',
	'template.bad-output': 'template output is not a NUT-10 P2PK condition',
	'template.destination': 'template destination is not the committed seller or bidder',
	'template.inputs-not-committed-proofs': 'template inputs are not the committed proofs',
	'template.amount': 'template outputs do not sum to the bid amount',
	'template.keyset': 'template output names a keyset other than the pinned one',
	'template.digest': 'template digest does not match',
	'template.not-signed-by-bidder': 'template is not signed by the bidder',
	'template.escrow-relock': 'template re-locks the escrow to the committee key, which is forbidden',
	'template.refund-pays-split': 'refund template pays a committed v4v split recipient',
	'template.split-omits': 'settle template omits a committed v4v split output',
	'template.split-adds': 'settle template adds an output that is not in the committed v4v split',
	'template.split-unrepresentable': 'template cannot represent the committed v4v split without loss',
}

export class ArenaBidFundingError extends Error {
	readonly refusal: ArenaBidFundingRefusal
	/** The extra detail the chain includes, e.g. the offending tag count. Never a key. */
	readonly detail?: string

	constructor(refusal: ArenaBidFundingRefusal, detail?: string) {
		super(ARENA_BID_FUNDING_REFUSAL_TEXT[refusal])
		this.name = 'ArenaBidFundingError'
		this.refusal = refusal
		this.detail = detail
	}
}

/**
 * Annotated, not inferred: TypeScript only treats a `never`-returning call as
 * terminating control flow when the declaration carries an explicit type, and
 * every narrowing below (`Array.isArray(outer)`, `recipient === null`, a
 * `typeof … === 'string'` guard) depends on that.
 */
const refuse: (refusal: ArenaBidFundingRefusal, detail?: string) => never = (refusal, detail) => {
	throw new ArenaBidFundingError(refusal, detail)
}

// =========================================================================
// Small helpers
// =========================================================================

const isCompressed = (value: unknown): value is string => typeof value === 'string' && COMPRESSED_PUBKEY.test(value)
const isHex32 = (value: unknown): value is string => typeof value === 'string' && HEX32.test(value)
const isHex64 = (value: unknown): value is string => typeof value === 'string' && HEX64.test(value)

/** x-only comparison, exactly as `xOnlyOf` does it: drop the 0x02/0x03 prefix. */
const xOnly = (compressed: string): string => compressed.toLowerCase().slice(2)

const hex32 = (value: bigint): string => value.toString(16).padStart(64, '0')

// =========================================================================
// The lock (spec §1.1)
// =========================================================================

/**
 * The options `cashu-ts` needs to emit the one accepted escrow secret.
 *
 * `data` is the bidder's wallet key, `pubkeys` is one entry — the committee's
 * FROST group key — `requiredSignatures` is 2, the refund branch is the bidder
 * alone after `locktime`, and the signature flag is `SIG_ALL`. `cashu-ts`
 * writes `n_sigs` only when the lock threshold is greater than 1 and
 * `n_sigs_refund` only when the refund threshold is greater than 1, so these
 * options produce **exactly five tags in canonical order** and never six
 * (`OutputData.createP2PKData`; pinned by the Go `sigAllGoldenTagSet`).
 */
export function buildArenaEscrowLockOptions(input: {
	bidderWallet: string
	committeeKey: string
	locktime: number
}): P2PKOptions {
	if (!isCompressed(input.bidderWallet)) refuse('wallet.not-compressed')
	if (!isCompressed(input.committeeKey)) refuse('lock.pubkeys-not-committee')
	if (!Number.isSafeInteger(input.locktime) || input.locktime <= 0) refuse('lock.locktime-not-integer')
	return {
		kind: 'P2PK',
		data: input.bidderWallet.toLowerCase(),
		pubkeys: [input.committeeKey.toLowerCase()],
		requiredSignatures: ARENA_ESCROW_REQUIRED_SIGNATURES,
		refundKeys: [input.bidderWallet.toLowerCase()],
		locktime: input.locktime,
		sigFlag: 'SIG_ALL',
	}
}

/** The strict parse of one escrow secret: its locktime, canonical tags and nonce. */
export interface ArenaEscrowLock {
	locktime: number
	/** The five tags, canonical order, exactly as they appeared. */
	tags: string[][]
	/** The secret's own nonce (32 bytes lowercase hex). */
	nonce: string
}

/**
 * Parse one proof's secret with the same differential checks as
 * `parseOneSigAllLock`: NUT-10 `P2PK`, canonical bytes, a 32-byte lowercase
 * nonce, the bidder's key in `data`, exactly five one-valued tags in canonical
 * order, and a locktime at or above `minLocktime`. Every near-miss is refused
 * by its own name, because a validator and the mint reading one secret
 * differently is the bug class this parser exists to catch.
 */
export function parseArenaEscrowLock(
	secret: string,
	input: { bidderWallet: string; committeeKey: string; minLocktime: number },
): ArenaEscrowLock {
	let outer: unknown
	try {
		outer = JSON.parse(secret)
	} catch {
		return refuse('lock.not-p2pk')
	}
	if (!Array.isArray(outer) || outer.length !== 2 || outer[0] !== 'P2PK') refuse('lock.not-p2pk')
	const body = outer[1]
	if (typeof body !== 'object' || body === null || Array.isArray(body)) refuse('lock.not-p2pk')
	const condition = body as { nonce?: unknown; data?: unknown; tags?: unknown }
	if (typeof condition.nonce !== 'string' || typeof condition.data !== 'string' || !Array.isArray(condition.tags)) {
		refuse('lock.not-p2pk')
	}
	const tags = condition.tags as unknown[]
	// Re-marshalling only the three known fields must reproduce the secret byte
	// for byte: an escaped, reordered, whitespace-padded or extended secret reads
	// differently to the mint, so it is refused rather than guessed at.
	if (JSON.stringify(['P2PK', { nonce: condition.nonce, data: condition.data, tags }]) !== secret) {
		refuse('lock.not-canonical')
	}
	if (!isHex32(condition.nonce)) refuse('lock.bad-nonce')
	if (!isCompressed(condition.data) || xOnly(condition.data) !== xOnly(input.bidderWallet)) refuse('lock.data-not-bidder')
	if (tags.length !== 5) refuse('lock.tag-count', `${tags.length}`)
	for (const tag of tags) {
		if (!Array.isArray(tag) || tag.length !== 2 || typeof tag[0] !== 'string' || typeof tag[1] !== 'string') {
			refuse('lock.tag-shape')
		}
	}
	const typed = tags as [string, string][]
	const [firstKey, firstValue] = typed[0]
	if (firstKey !== 'locktime') refuse('lock.first-tag-not-locktime')
	if (!DECIMAL_INTEGER.test(firstValue)) refuse('lock.locktime-not-integer')
	const locktime = Number(firstValue)
	if (!Number.isSafeInteger(locktime) || String(locktime) !== firstValue) refuse('lock.locktime-not-integer')
	if (locktime < input.minLocktime) refuse('lock.locktime-below-floor', `${locktime} is under ${input.minLocktime}`)

	// The five tags in canonical order are locktime, pubkeys, n_sigs, refund,
	// sigflag (`lock.first-tag-not-locktime` above pins the first), so the four
	// named ones are the elements AFTER the locktime.
	const [, pubkeysTag, nsigsTag, refundTag, sigflagTag] = typed
	if (pubkeysTag[0] !== 'pubkeys' || !isCompressed(pubkeysTag[1]) || xOnly(pubkeysTag[1]) !== xOnly(input.committeeKey)) {
		refuse('lock.pubkeys-not-committee')
	}
	if (nsigsTag[0] !== 'n_sigs' || nsigsTag[1] !== '2') refuse('lock.n-sigs-not-2')
	if (refundTag[0] !== 'refund' || !isCompressed(refundTag[1]) || xOnly(refundTag[1]) !== xOnly(input.bidderWallet)) {
		refuse('lock.refund-not-bidder')
	}
	if (sigflagTag[0] !== 'sigflag' || sigflagTag[1] !== 'SIG_ALL') refuse('lock.not-sig-all')

	return { locktime, tags: typed, nonce: condition.nonce }
}

/**
 * Parse every proof of a bid, and require them all to share one identical lock
 * (`checkSigAllLock`). Returns the locktime.
 */
export function validateArenaEscrowLock(
	proofs: readonly ArenaEscrowProof[],
	input: { bidderWallet: string; committeeKey: string; minLocktime: number },
): number {
	if (proofs.length === 0) refuse('lock.no-proofs')
	let locktime = 0
	let firstTags = ''
	proofs.forEach((proof, index) => {
		if (typeof proof.secret !== 'string') refuse('lock.not-p2pk')
		const parsed = parseArenaEscrowLock(proof.secret, input)
		const rendered = JSON.stringify(parsed.tags)
		if (index === 0) {
			firstTags = rendered
			locktime = parsed.locktime
		} else if (rendered !== firstTags) {
			refuse('lock.proofs-share-no-lock')
		}
	})
	return locktime
}

// =========================================================================
// The locktime floor (spec §2.1–§2.2)
// =========================================================================

/**
 * `minLocktime = max(EndAt, now + WindowSec) + settlement_safety + bid_to_consensus_latency`,
 * evaluated against the end **this bid establishes**.
 *
 * For a fixed lot the end never moves and `WindowSec` is 0, so the floor is the
 * lot's own `EndAt`. For an anti-snipe bid arriving with less than `WindowSec`
 * left, the bid itself sets `EndAt = now + WindowSec`, so the floor is
 * `now + WindowSec`; checking against the old end would collapse the post-end
 * safety margin from 900 s to as little as 15 s (spec §2.2).
 */
export function arenaBidLocktimeFloor(input: {
	mode: 'fixed' | 'antisnipe' | string
	endAt: number
	windowSec?: number | null
	now: number
	settlementSafetySec?: number
	bidToConsensusLatencySec?: number
}): number {
	const safety = input.settlementSafetySec ?? ARENA_SETTLEMENT_SAFETY_SECONDS
	const latency = input.bidToConsensusLatencySec ?? ARENA_BID_TO_CONSENSUS_LATENCY_SECONDS
	const window = input.mode === 'antisnipe' ? Math.max(0, Math.floor(input.windowSec ?? 0)) : 0
	const establishedEnd = input.mode === 'antisnipe' ? Math.max(input.endAt, input.now + window) : input.endAt
	return Math.ceil(establishedEnd + safety + latency)
}

// =========================================================================
// The outcome templates (spec §1.2, §4, §6)
// =========================================================================

/** The wallet spend key's signing surface — injected, so this module never holds it. */
export interface ArenaWalletSpendSigner {
	/** Compressed secp256k1 public key of the wallet spend key. */
	pubkey: string
	/** BIP-340 sign a 32-byte lowercase-hex digest. Returns 128 bytes of lowercase hex. */
	signDigest(digestHex: string): string | Promise<string>
}

/** The exact amounts and destinations a settle template pays (spec §6's rounding). */
export function arenaSettleDestinations(input: {
	amount: number
	sellerWallet: string
	v4vSplit?: readonly ArenaBidSplitRow[]
}): ArenaTemplateDestination[] {
	const split = input.v4vSplit ?? []
	if (split.length === 0) return [{ recipient: input.sellerWallet.toLowerCase(), amount: input.amount }]
	const out: ArenaTemplateDestination[] = []
	let allocated = 0
	for (const row of split) {
		const share = Math.floor((input.amount * row.allocationBps) / 10_000)
		if (share <= 0) refuse('template.split-unrepresentable', row.role)
		allocated += share
		out.push({ recipient: row.recipientPubkey.toLowerCase(), amount: share })
	}
	const remainder = input.amount - allocated
	if (remainder > 0) out.push({ recipient: input.sellerWallet.toLowerCase(), amount: remainder })
	return out
}

/**
 * The layout-B SIG_ALL digest, byte for byte:
 *
 * ```
 * sha256( concat(input secret ‖ input C) ‖ concat(str(output amount) ‖ output B_) )
 * ```
 *
 * This is the current Cashu NUT-11 message (spec PR #302) and the one the
 * reference chain implements in `sigAllDigest`. The Go golden vector is
 * asserted in this module's test, so a drift fails before a bid is published.
 */
export function arenaSigAllDigest(
	inputs: readonly Pick<ArenaEscrowProof, 'secret' | 'C'>[],
	outputs: readonly { amount: number; B_: string }[],
): string {
	const message =
		inputs.map((proof) => proof.secret + proof.C).join('') + outputs.map((output) => String(output.amount) + output.B_).join('')
	return bytesToHex(sha256(new TextEncoder().encode(message)))
}

/** `B_ = hash_to_curve(secret) + r*G`, recomputed from a committed opening. */
export function arenaOutputBPoint(output: Pick<ArenaTemplateOutput, 'secret' | 'r'>): string {
	if (!isHex32(output.r)) refuse('template.bad-output')
	const Y = pointFromHex(hashToCurve(new TextEncoder().encode(output.secret)).toHex(true))
	const B = Y.add(pointFromHex(SECP256K1_G).multiply(BigInt('0x' + output.r)))
	return B.toHex(true)
}

/**
 * Build one signed outcome template for a set of destinations.
 *
 * Each output is a fresh NUT-11 `P2PK` secret locked to its destination with a
 * random 32-byte blinding factor. The opening (`secret` + `r`) is committed
 * inside the template, so the committee can submit exactly the output the
 * bidder authorised without ever choosing a destination itself; the digest is
 * recomputed from the inputs and outputs and signed with the wallet key.
 */
export async function buildArenaOutcomeTemplate(input: {
	proofs: readonly ArenaEscrowProof[]
	destinations: readonly ArenaTemplateDestination[]
	keysetId: string
	signer: ArenaWalletSpendSigner
}): Promise<ArenaOutcomeTemplate> {
	if (input.proofs.length === 0) refuse('lock.no-proofs')
	if (input.destinations.length === 0) refuse('template.bad-output')
	const inputs = input.proofs.map((proof) => {
		if (!Number.isSafeInteger(proof.amount) || proof.amount <= 0 || typeof proof.secret !== 'string' || typeof proof.C !== 'string') {
			refuse('template.bad-input')
		}
		return { amount: proof.amount, id: proof.id, secret: proof.secret, C: proof.C }
	})
	const total = inputs.reduce((sum, proof) => sum + proof.amount, 0)
	const outputs = input.destinations.map((destination) => {
		if (!isCompressed(destination.recipient)) refuse('template.destination')
		if (!Number.isSafeInteger(destination.amount) || destination.amount <= 0) refuse('template.amount')
		const data = OutputData.createSingleP2PKData(
			{ kind: 'P2PK', data: destination.recipient.toLowerCase() },
			destination.amount,
			input.keysetId,
		)
		return {
			amount: destination.amount,
			id: data.blindedMessage.id,
			secret: new TextDecoder().decode(data.secret),
			r: hex32(data.blindingFactor),
			B_: data.blindedMessage.B_,
		}
	})
	if (outputs.reduce((sum, output) => sum + output.amount, 0) !== total) refuse('template.amount')
	if (outputs.some((output) => output.id !== input.keysetId)) refuse('template.keyset')
	const digest = arenaSigAllDigest(inputs, outputs)
	const signature = await input.signer.signDigest(digest)
	if (!isHex64(signature)) refuse('template.not-signed-by-bidder')
	return {
		inputs,
		outputs: outputs.map(({ amount, id, secret, r }) => ({ amount, id, secret, r })),
		digest,
		bidder_signature: signature,
	}
}

/** The auction terms a funding payload is checked against. */
export interface ArenaBidFundingTerms {
	bidderWallet: string
	sellerWallet: string
	committeeKey: string
	keysetId: string
	minLocktime: number
	v4vSplit?: readonly ArenaBidSplitRow[]
}

/**
 * The whole funding payload, checked the way consensus checks it
 * (`verifySigAllBidTemplates` + `checkSigAllLock`): the lock is one identical
 * five-tag 2-of-2, the inputs are the committed proofs, the settle template
 * pays the committed seller (and the committed v4v split, exactly), the refund
 * template pays the bidder alone, both digests derive from their own contents,
 * and both signatures verify over those digests with the wallet spend key.
 */
export function verifyArenaBidFunding(funding: ArenaBidFunding, terms: ArenaBidFundingTerms): number {
	if (!isCompressed(funding.wallet)) refuse('wallet.not-compressed')
	if (xOnly(funding.wallet) !== xOnly(terms.bidderWallet)) refuse('lock.data-not-bidder')
	const locktime = validateArenaEscrowLock(funding.proofs, {
		bidderWallet: terms.bidderWallet,
		committeeKey: terms.committeeKey,
		minLocktime: terms.minLocktime,
	})
	if (funding.locktime !== locktime) refuse('lock.locktime-below-floor', 'the payload and the proofs disagree')
	const amount = funding.proofs.reduce((sum, proof) => sum + proof.amount, 0)
	const settleDestinations = arenaSettleDestinations({
		amount,
		sellerWallet: terms.sellerWallet,
		v4vSplit: terms.v4vSplit,
	})
	const refundDestinations: ArenaTemplateDestination[] = [{ recipient: terms.bidderWallet.toLowerCase(), amount }]
	const splitRecipients = new Set((terms.v4vSplit ?? []).map((row) => row.recipientPubkey.toLowerCase()))

	const check = (outcome: 'settle' | 'refund', template: ArenaOutcomeTemplate, expected: readonly ArenaTemplateDestination[]) => {
		if (template.inputs.length !== funding.proofs.length) refuse('template.inputs-not-committed-proofs')
		template.inputs.forEach((proof, index) => {
			if (proof.secret !== funding.proofs[index].secret) refuse('template.inputs-not-committed-proofs')
		})
		if (template.outputs.length === 0) refuse('template.bad-output')
		if (template.outputs.length !== expected.length) {
			refuse(outcome === 'settle' && (terms.v4vSplit?.length ?? 0) > 0 && template.outputs.length < expected.length
				? 'template.split-omits'
				: outcome === 'settle' && (terms.v4vSplit?.length ?? 0) > 0
					? 'template.split-adds'
					: 'template.amount')
		}
		let total = 0
		template.outputs.forEach((output, index) => {
			if (!Number.isSafeInteger(output.amount) || output.amount <= 0) refuse('template.amount')
			total += output.amount
			if (output.id !== terms.keysetId) refuse('template.keyset')
			let recipient: string | null = null
			try {
				const parsed = JSON.parse(output.secret)
				if (Array.isArray(parsed) && parsed.length === 2 && parsed[0] === 'P2PK' && typeof parsed[1] === 'object' && parsed[1] !== null) {
					const data = (parsed[1] as { data?: unknown }).data
					recipient = isCompressed(data) ? data.toLowerCase() : null
				}
			} catch {
				recipient = null
			}
			if (recipient === null) refuse('template.bad-output')
			if (xOnly(recipient) === xOnly(terms.committeeKey)) refuse('template.escrow-relock')
			if (outcome === 'refund' && splitRecipients.has(recipient)) refuse('template.refund-pays-split')
			if (xOnly(recipient) !== xOnly(expected[index].recipient)) refuse('template.destination')
			if (output.amount !== expected[index].amount) refuse('template.amount')
		})
		if (total !== amount) refuse('template.amount')
		const digest = arenaSigAllDigest(
			template.inputs,
			template.outputs.map((output) => ({ amount: output.amount, B_: arenaOutputBPoint(output) })),
		)
		if (digest !== template.digest) refuse('template.digest')
		if (!schnorrVerifyDigest(template.bidder_signature, digest, terms.bidderWallet)) refuse('template.not-signed-by-bidder')
	}

	check('settle', funding.outcome_templates.settle, settleDestinations)
	check('refund', funding.outcome_templates.refund, refundDestinations)
	return locktime
}

/**
 * Build the whole funding payload from freshly locked proofs.
 *
 * The caller has already locked `amount` under the options from
 * {@link buildArenaEscrowLockOptions}; this derives both templates, signs them
 * with the wallet key, and returns the object the 1441 content carries. It does
 * not lock anything itself, so the money movement stays in one place.
 */
export async function buildArenaBidFunding(input: {
	proofs: readonly ArenaEscrowProof[]
	sellerWallet: string
	bidderWallet: string
	committeeKey: string
	keysetId: string
	minLocktime: number
	signer: ArenaWalletSpendSigner
	v4vSplit?: readonly ArenaBidSplitRow[]
}): Promise<ArenaBidFunding> {
	if (xOnly(input.signer.pubkey) !== xOnly(input.bidderWallet)) refuse('lock.data-not-bidder')
	const amount = input.proofs.reduce((sum, proof) => sum + proof.amount, 0)
	if (!Number.isSafeInteger(amount) || amount <= 0) refuse('template.amount')
	const settle = await buildArenaOutcomeTemplate({
		proofs: input.proofs,
		destinations: arenaSettleDestinations({ amount, sellerWallet: input.sellerWallet, v4vSplit: input.v4vSplit }),
		keysetId: input.keysetId,
		signer: input.signer,
	})
	const refund = await buildArenaOutcomeTemplate({
		proofs: input.proofs,
		destinations: [{ recipient: input.bidderWallet.toLowerCase(), amount }],
		keysetId: input.keysetId,
		signer: input.signer,
	})
	const locktime = validateArenaEscrowLock(input.proofs, {
		bidderWallet: input.bidderWallet,
		committeeKey: input.committeeKey,
		minLocktime: input.minLocktime,
	})
	return {
		wallet: input.bidderWallet.toLowerCase(),
		proofs: [...input.proofs],
		outcome_templates: { settle, refund },
		locktime,
	}
}

/** Compressed public key for a 32-byte private key — used by producers and tests. */
export const arenaWalletPubkey = (walletPrivkeyHex: string): string =>
	bytesToHex(getPubKeyFromPrivKey(hexToBytes(walletPrivkeyHex)))