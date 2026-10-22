/**
 * nutzap.ts — the NIP-61 side of the wallet.
 *
 * A nutzap is a P2PK Cashu token in which the payment itself is the receipt: the sender mints (or
 * swaps) proofs locked to a key the recipient named in their `kind:10019`, and publishes them in
 * a `kind:9321`. The event is the proof of payment, so this module refuses anything it cannot
 * vouch for *before* it publishes, and it never reports a locked-but-unpublished send as a
 * refusal — the money has left the wallet either way.
 *
 * This module decides what a nutzap is, and takes the wallet, the signer, the relay read and the
 * publisher as ports. It imports no store: the relay-backed NIP-60 wallet it replaces is gone,
 * and the proof source it needs is exactly the shape
 * a coco-backed source will have when coco can P2PK-lock (`@cashu/coco-core@2.0.0`'s
 * `send.prepare({ target: { type: 'p2pk' } })`); on the pinned coco it has to be a cashu-ts swap
 * over the wallet's proofs, and that adapter lives in the composing app, not here.
 *
 * Kinds, and only these (NIP-61; the revision that named 9324/9325 was a transcription error):
 *   10019 — the recipient's info event (relays, accepted mints, P2PK pubkey)
 *   9321  — the nutzap itself
 *   7376  — the redemption history event the claimer publishes
 *
 * Scope: `sat` only. Other units are refused with `unit-unsupported` rather than guessed at,
 * because the rest of the app prices in sats and a multi-unit nutzap needs a pricing decision
 * this module does not own.
 */
import type { Proof } from '@cashu/cashu-ts'
import { auctionP2pkPubkeysMatch, getAuctionP2pkLockPubkeyFromSecret, toCompressedAuctionP2pkPubkey } from '@/lib/auctionP2pk'

/** NIP-61 kinds this module speaks. Add nothing here without a spec citation. */
export const NUTZAP_INFO_KIND = 10019
export const NUTZAP_KIND = 9321
/** The NIP-60 wallet-history event a claimer publishes; NIP-61 L89. */
export const NUTZAP_REDEMPTION_KIND = 7376

const HEX_64 = /^[0-9a-f]{64}$/
const HEX_66 = /^[0-9a-f]{66}$/

/**
 * The closed refusal vocabulary. A code names the reason and never interpolates a value, so a
 * malformed or hostile input cannot turn a refusal into another error or echo key material.
 */
export type NutzapRefusalReason =
	| 'no-info-event' // recipient has no 10019
	| 'no-nutzap-pubkey' // 10019 has no usable `pubkey` tag
	| 'no-mints' // 10019 lists no mint
	| 'amount-invalid' // non-finite, <= 0, or not an integer number of sats
	| 'no-shared-mint' // none of the recipient's mints has funds
	| 'unit-unsupported' // the recipient's 10019 does not name the unit
	| 'proof-not-p2pk' // a produced proof is not P2PK-locked
	| 'proof-p2pk-mismatch' // locked, but to the wrong key
	| 'proof-no-dleq' // a produced proof carries no NUT-12 DLEQ material
	| 'proof-mint-mismatch' // a produced proof is not from the declared mint

export class NutzapRefusalError extends Error {
	readonly reason: NutzapRefusalReason

	constructor(reason: NutzapRefusalReason) {
		super(`nutzap refused: ${reason}`)
		this.name = 'NutzapRefusalError'
		this.reason = reason
	}
}

/**
 * What a recipient advertised in their `kind:10019`, normalised and validated.
 * `nutzapPubkey` is the CASHU form (compressed, `"02"`-prefixed, 66 hex) — the value that goes
 * into a proof's P2PK secret. `recipientPubkey` is the Nostr identity key that goes into the
 * 9321 `p` tag. Both are re-derived from the event rather than trusted from any caller.
 */
export interface NutzapRecipientInfo {
	/** x-only, 64 hex. The 10019's author — NIP-61 L40 forbids using this as the lock key. */
	readonly recipientPubkey: string
	/** 66 hex, starts `"02"`. */
	readonly nutzapPubkey: string
	/** Normalized and deduped (NIP-65, NIP-61 L124). */
	readonly mints: readonly string[]
	/** Mint URL (as the recipient wrote it) → the units it accepts there. */
	readonly units: Readonly<Record<string, readonly string[]>>
	/** The recipient's read relays, in order, deduped. */
	readonly relays: readonly string[]
	/** The 10019 we parsed. */
	readonly infoEventId: string
	/** Seconds — a staleness policy input. */
	readonly infoCreatedAt: number
}

/** The token a sender produced for one nutzap: one mint, one unit, N proofs. */
export interface NutzapProofSet {
	readonly mintUrl: string
	readonly unit: string
	readonly proofs: readonly Proof[]
}

/** A fully-built but unsigned `kind:9321` draft. Pure data. */
export interface NutzapEventTemplate {
	readonly kind: typeof NUTZAP_KIND
	readonly content: string
	readonly tags: string[][]
	readonly created_at: number
}

/**
 * The states a nutzap send moves through. Deliberately not a boolean and not two states: "no
 * funds locked" and "funds locked but nothing published" are different for the user and
 * differently recoverable.
 */
export type NutzapSendState =
	| { readonly state: 'refused'; readonly reason: NutzapRefusalReason }
	/**
	 * Funds are locked at the mint and nothing was published. `rejected` is set when the locked
	 * proofs failed a post-lock check (unlocked / wrong key / no DLEQ / wrong mint): the send is
	 * NOT a refusal — the mint has burned inputs — and the caller must reclaim, not retry.
	 */
	| {
			readonly state: 'locked'
			readonly proofs: NutzapProofSet
			readonly lockOperationId?: string
			readonly rejected?: NutzapRefusalReason
	  }
	| {
			readonly state: 'published'
			readonly eventId: string
			readonly proofs: NutzapProofSet
			readonly relays: readonly string[]
	  }
	| {
			readonly state: 'publish-failed'
			readonly proofs: NutzapProofSet
			readonly template: NutzapEventTemplate
			readonly error: Error
	  }
	| { readonly state: 'indeterminate'; readonly lockOperationId?: string; readonly error: Error }

// ============================================================================
// Ports — every network or secret-touching operation enters through one of these
// ============================================================================

/** Where a recipient's `kind:10019` comes from. */
export interface NutzapInfoSource {
	fetchInfo(recipientPubkey: string): Promise<{ id: string; created_at: number; pubkey: string; tags: string[][] } | null>
}

/**
 * Locks `amount` of the wallet's funds to `lockPubkey` and returns the locked proofs. THE ONLY
 * PLACE the module touches the mint. The module does the `"02"` prefixing and the post-lock
 * assertions; the implementation owns the mint call and where the proofs live.
 */
export interface NutzapProofSource {
	/** Candidate mints the wallet can currently fund from, in the wallet's own order. */
	fundableMints(): Promise<readonly string[]>
	lockProofs(request: {
		mintUrl: string
		unit: string
		amountSats: number
		/** Already `"02"`-prefixed, compressed. */
		lockPubkey: string
		/** NUT-11 tags written into the proof secret: the `e`/`P` binding. */
		proofTags: readonly (readonly [string, string])[]
	}): Promise<NutzapProofSet>
	/** Reclaim a locked set that was never claimed. Optional: not every source can. */
	reclaim?(handle: string): Promise<void>
}

/** Produces the signed 9321. Never sees the proofs beyond what it must sign over. */
export interface NutzapSigner {
	pubkey(): Promise<string>
	sign(template: NutzapEventTemplate): Promise<{ id: string; event: unknown }>
}

/** Publishes to exactly these relays (the recipient's). Returns which relays accepted. */
export interface NutzapPublisher {
	publish(event: unknown, relays: readonly string[]): Promise<{ relays: readonly string[] }>
}

/** Optional injected clock, so tests never depend on a host clock. */
export interface NutzapClock {
	now?: () => number
}

// ============================================================================
// Pure functions — no ports, trivially testable
// ============================================================================

const isHex = (value: string, pattern: RegExp): boolean => pattern.test(value)

/**
 * Nostr → cashu pubkey form, NIP-61 L45: "Clients MUST prefix the public key they P2PK-lock with
 * "02"". An x-only key gains the prefix; an already-`"02"`-prefixed key passes through; a `"03"`
 * key is refused because only `02` is prescribed.
 */
export const toCashuP2pkPubkey = (xOnlyHex: string): string => {
	const normalized = xOnlyHex.trim().toLowerCase()
	if (isHex(normalized, HEX_64)) return `02${normalized}`
	if (isHex(normalized, HEX_66)) {
		if (!normalized.startsWith('02')) throw new NutzapRefusalError('no-nutzap-pubkey')
		return normalized
	}
	throw new NutzapRefusalError('no-nutzap-pubkey')
}

/** cashu → Nostr pubkey form: strips a leading `"02"` and nothing else. */
export const toNostrPubkey = (cashuPubkey: string): string => {
	const normalized = cashuPubkey.trim().toLowerCase()
	if (isHex(normalized, HEX_64)) return normalized
	if (isHex(normalized, HEX_66) && normalized.startsWith('02')) return normalized.slice(2)
	throw new NutzapRefusalError('no-nutzap-pubkey')
}

/** One trailing slash, not all of them — the same normalization the mint keys use. */
const normalizeMintUrl = (mintUrl: string): string => mintUrl.trim().replace(/\/$/, '')

/**
 * Parse and validate a `kind:10019` into {@link NutzapRecipientInfo}, or refuse with a code.
 *
 * The `pubkey` tag is required: NIP-61 L40 says it MUST NOT be the recipient's main Nostr key, and
 * a sender that silently fell back to the author key would lock funds to a key the recipient may
 * never scan with. Refusing is the safe direction (§1.8: a nutzap published on a mint the
 * recipient did not list may be donated to the mint).
 */
export const parseNutzapRecipientInfo = (event: {
	id: string
	pubkey: string
	created_at: number
	tags: string[][]
}): NutzapRecipientInfo => {
	const tags = Array.isArray(event.tags) ? event.tags : []
	const tagValues = (name: string): string[][] => tags.filter((tag) => tag[0] === name)

	const pubkeyTag = tagValues('pubkey').find((tag) => typeof tag[1] === 'string' && tag[1].trim() !== '')
	if (!pubkeyTag) throw new NutzapRefusalError('no-nutzap-pubkey')

	let nutzapPubkey: string
	try {
		nutzapPubkey = toCashuP2pkPubkey(pubkeyTag[1])
	} catch {
		throw new NutzapRefusalError('no-nutzap-pubkey')
	}

	const mints: string[] = []
	const units: Record<string, readonly string[]> = {}
	for (const tag of tagValues('mint')) {
		const raw = typeof tag[1] === 'string' ? tag[1].trim() : ''
		if (!raw) continue
		// The `u` tag must be byte-identical to what the recipient wrote (L67), so the URL is kept
		// as written and only the dedupe key is normalized.
		const key = normalizeMintUrl(raw).toLowerCase()
		const accepted = tag.slice(2).filter((value) => typeof value === 'string' && value.trim() !== '')
		const existing = mints.find((mint) => normalizeMintUrl(mint).toLowerCase() === key)
		if (existing) {
			units[existing] = Array.from(new Set([...(units[existing] ?? []), ...accepted]))
			continue
		}
		mints.push(raw)
		units[raw] = accepted
	}

	if (mints.length === 0) throw new NutzapRefusalError('no-mints')

	const relays: string[] = []
	for (const tag of tagValues('relay')) {
		const raw = typeof tag[1] === 'string' ? tag[1].trim() : ''
		if (!raw) continue
		if (!relays.includes(raw)) relays.push(raw)
	}

	return {
		recipientPubkey: event.pubkey.trim().toLowerCase(),
		nutzapPubkey,
		mints,
		units,
		relays,
		infoEventId: event.id,
		infoCreatedAt: event.created_at,
	}
}

/**
 * Build the 9321 tag set. Pure; takes what the ports already produced. One `proof` tag per proof,
 * exactly one `u`/`unit`/`p`; `e`/`k` only when zapping an event. The `u` value is the recipient's
 * mint string **byte-identical** (NIP-61 L67: "the mint … EXACTLY as specified by the recipient's
 * kind:10019").
 */
export const buildNutzapTags = (input: {
	recipient: NutzapRecipientInfo
	proofs: NutzapProofSet
	zappedEvent?: { id: string; kind: number; relayHint?: string }
}): string[][] => {
	const tags: string[][] = []
	for (const proof of input.proofs.proofs) {
		tags.push(['proof', JSON.stringify(proof)])
	}
	tags.push(['unit', input.proofs.unit])
	tags.push(['u', input.proofs.mintUrl])
	if (input.zappedEvent) {
		tags.push(input.zappedEvent.relayHint ? ['e', input.zappedEvent.id, input.zappedEvent.relayHint] : ['e', input.zappedEvent.id])
		tags.push(['k', String(input.zappedEvent.kind)])
	}
	tags.push(['p', input.recipient.recipientPubkey])
	return tags
}

/** Build the unsigned 9321. Pure; `createdAt` is injected so tests are deterministic. */
export const buildNutzapTemplate = (input: { tags: string[][]; comment?: string; createdAt: number }): NutzapEventTemplate => ({
	kind: NUTZAP_KIND,
	content: input.comment ?? '',
	tags: input.tags,
	created_at: input.createdAt,
})

/** The REQ filter of NIP-61 L85. Pure. */
export const buildNutzapFilter = (input: {
	recipientPubkey: string
	mints: readonly string[]
	since?: number
}): { kinds: [typeof NUTZAP_KIND]; '#p': string[]; '#u': string[]; since?: number } => ({
	kinds: [NUTZAP_KIND],
	'#p': [input.recipientPubkey],
	'#u': [...input.mints],
	...(input.since === undefined ? {} : { since: input.since }),
})

/** A non-fatal problem with a nutzap — the sender may still publish it. */
export type NutzapWarningCode = 'no-e-on-event' | 'proof-missing-e' | 'proof-e-mismatch' | 'proof-missing-p' | 'proof-p-mismatch'
/** A fatal problem: a compliant observer would not count this nutzap. */
export type NutzapErrorCode =
	| 'no-proofs'
	| 'no-p-tag'
	| 'multiple-p-tags'
	| 'no-u-tag'
	| 'multiple-u-tags'
	| 'multiple-e-tags'
	| 'malformed-proof-secret'
	| 'mint-not-listed'
	| 'proof-locked-to-other-key'

export interface NutzapValidationIssue<T> {
	readonly code: T
	readonly severity: 'error' | 'warning'
}

export interface NutzapValidationResult {
	readonly valid: boolean
	readonly issues: readonly (NutzapValidationIssue<NutzapErrorCode> | NutzapValidationIssue<NutzapWarningCode>)[]
}

/**
 * The NIP-61 L112-120 verification checklist — what a third-party observer runs on our events, so
 * our sender must satisfy it too. Severity follows NDK's own split: a missing/mismatched `e` or
 * `P` inside a proof secret is a WARNING; structural faults are ERRORS.
 */
export const validateNutzap = (input: {
	event: { kind: number; pubkey: string; tags: string[][] }
	recipient: NutzapRecipientInfo
}): NutzapValidationResult => {
	const issues: Array<NutzapValidationIssue<NutzapErrorCode> | NutzapValidationIssue<NutzapWarningCode>> = []
	const tags = Array.isArray(input.event.tags) ? input.event.tags : []
	const of = (name: string) => tags.filter((tag) => tag[0] === name)

	const proofTags = of('proof')
	if (proofTags.length === 0) issues.push({ code: 'no-proofs', severity: 'error' })

	const pTags = of('p')
	if (pTags.length === 0) issues.push({ code: 'no-p-tag', severity: 'error' })
	if (pTags.length > 1) issues.push({ code: 'multiple-p-tags', severity: 'error' })

	const uTags = of('u')
	if (uTags.length === 0) issues.push({ code: 'no-u-tag', severity: 'error' })
	if (uTags.length > 1) issues.push({ code: 'multiple-u-tags', severity: 'error' })

	const eTags = of('e')
	if (eTags.length > 1) issues.push({ code: 'multiple-e-tags', severity: 'error' })
	if (eTags.length === 0) issues.push({ code: 'no-e-on-event', severity: 'warning' })

	// L117: the `u` mint must be one the recipient listed.
	const listedMints = new Set(input.recipient.mints.map((mint) => normalizeMintUrl(mint).toLowerCase()))
	for (const tag of uTags) {
		const mint = typeof tag[1] === 'string' ? tag[1] : ''
		if (!listedMints.has(normalizeMintUrl(mint).toLowerCase())) issues.push({ code: 'mint-not-listed', severity: 'error' })
	}

	const zappedEventId = eTags[0]?.[1]
	const senderPubkey = input.event.pubkey.trim().toLowerCase()

	for (const tag of proofTags) {
		const raw = typeof tag[1] === 'string' ? tag[1] : ''
		let proof: { secret?: unknown }
		try {
			proof = JSON.parse(raw)
		} catch {
			issues.push({ code: 'malformed-proof-secret', severity: 'error' })
			continue
		}
		if (typeof proof.secret !== 'string') {
			issues.push({ code: 'malformed-proof-secret', severity: 'error' })
			continue
		}

		let lockPubkey: string | null
		try {
			lockPubkey = toCompressedAuctionP2pkPubkey(getAuctionP2pkLockPubkeyFromSecret(proof.secret))
		} catch {
			lockPubkey = null
		}
		if (!lockPubkey) {
			issues.push({ code: 'malformed-proof-secret', severity: 'error' })
			continue
		}
		// L116: the token must be locked to the pubkey the recipient listed.
		if (!auctionP2pkPubkeysMatch(lockPubkey, input.recipient.nutzapPubkey)) {
			issues.push({ code: 'proof-locked-to-other-key', severity: 'error' })
		}

		// NUT-11 tags inside the secret: `e` (the nutzapped event) and `P` (the sender).
		const secretTags = parseNutzapSecretTags(proof.secret)
		const proofEventId = secretTags.find(([name]) => name === 'e')?.[1]
		const proofSender = secretTags.find(([name]) => name === 'P')?.[1]

		if (zappedEventId) {
			if (!proofEventId) issues.push({ code: 'proof-missing-e', severity: 'warning' })
			else if (proofEventId !== zappedEventId) issues.push({ code: 'proof-e-mismatch', severity: 'warning' })
		}
		if (!proofSender) issues.push({ code: 'proof-missing-p', severity: 'warning' })
		else if (proofSender.toLowerCase() !== senderPubkey) issues.push({ code: 'proof-p-mismatch', severity: 'warning' })
	}

	return { valid: !issues.some((issue) => issue.severity === 'error'), issues }
}

/** The NUT-11 tags inside a proof secret, or an empty list when the secret is not a P2PK secret. */
const parseNutzapSecretTags = (secret: string): string[][] => {
	try {
		const parsed = JSON.parse(secret)
		if (!Array.isArray(parsed) || parsed[0] !== 'P2PK') return []
		const data = parsed[1] as { data?: unknown; tags?: unknown } | undefined
		if (!data || !Array.isArray(data.tags)) return []
		return (data.tags as unknown[]).filter((tag): tag is string[] => Array.isArray(tag) && tag.every((v) => typeof v === 'string'))
	} catch {
		return []
	}
}

/** The recipient's own `kind:10019` draft. Pure data. */
export interface NutzapInfoTemplate {
	readonly kind: typeof NUTZAP_INFO_KIND
	readonly content: string
	readonly tags: string[][]
	readonly created_at: number
}

/** The recipient's own `kind:10019` to publish, so others can nutzap us. Pure. */
export const buildNutzapInfoTemplate = (input: {
	mints: readonly string[]
	units: Readonly<Record<string, readonly string[]>>
	relays: readonly string[]
	/** The wallet's P2PK pubkey (compressed, 66 hex) — from the key store, never the identity key. */
	nutzapPubkey: string
	createdAt: number
}): NutzapInfoTemplate => {
	const tags: string[][] = []
	for (const relay of input.relays) tags.push(['relay', relay])
	for (const mint of input.mints) tags.push(['mint', mint, ...(input.units[mint] ?? [])])
	tags.push(['pubkey', toCashuP2pkPubkey(input.nutzapPubkey)])
	return { kind: NUTZAP_INFO_KIND, content: '', tags, created_at: input.createdAt }
}

/**
 * The `7376` outer tags a claimer publishes for the nutzaps it claimed. The content is NIP-44
 * encrypted and is the signer's concern, so this returns only the public tag list.
 */
export const buildRedemptionTags = (input: { claimedNutzapEventIds: readonly string[]; senderPubkey: string }): string[][] => {
	const tags: string[][] = input.claimedNutzapEventIds.map((id) => ['e', id, '', 'redeemed'])
	tags.push(['p', input.senderPubkey])
	return tags
}

// ============================================================================
// The sender
// ============================================================================

export interface NutzapSenderOptions extends NutzapClock {
	infoSource: NutzapInfoSource
	proofSource: NutzapProofSource
	signer: NutzapSigner
	publisher: NutzapPublisher
}

export interface NutzapSendRequest {
	recipientPubkey: string
	amountSats: number
	comment?: string
	zappedEvent?: { id: string; kind: number; relayHint?: string }
}

export interface NutzapSender {
	/** Never throws for a refusal or a payment-stage failure: it returns a state. */
	send(request: NutzapSendRequest): Promise<NutzapSendState>
}

/**
 * The send orchestration. Each step's boundary is a state boundary:
 *
 *   1. amount validation — before any network.
 *   2. fetch + parse the recipient's 10019.
 *   3. fundable-mint ∩ the recipient's mints (normalized URLs).
 *   4. lock the proofs (the ONLY mint call; a throw here is `indeterminate`).
 *   5. post-lock assertions in pure code — a failure is `locked` with `rejected`, never `refused`,
 *      because the mint has already burned inputs and telling the user "nothing happened" would
 *      be a lie about money.
 *   6. sign + publish; zero relays accepted is `publish-failed` and the template is retained so
 *      the caller can retry the publish without re-locking.
 */
export const createNutzapSender = (options: NutzapSenderOptions): NutzapSender => {
	const now = options.now ?? (() => Math.floor(Date.now() / 1000))

	return {
		send: async (request: NutzapSendRequest): Promise<NutzapSendState> => {
			const amount = Math.floor(request.amountSats)
			if (!Number.isFinite(amount) || amount <= 0 || amount !== request.amountSats) {
				return { state: 'refused', reason: 'amount-invalid' }
			}

			let recipient: NutzapRecipientInfo
			try {
				const info = await options.infoSource.fetchInfo(request.recipientPubkey)
				if (!info) return { state: 'refused', reason: 'no-info-event' }
				recipient = parseNutzapRecipientInfo(info)
			} catch (error) {
				if (error instanceof NutzapRefusalError) return { state: 'refused', reason: error.reason }
				throw error
			}

			const fundable = await options.proofSource.fundableMints()
			const fundableKeys = new Set(fundable.map((mint) => normalizeMintUrl(mint).toLowerCase()))
			const mintUrl = recipient.mints.find((mint) => fundableKeys.has(normalizeMintUrl(mint).toLowerCase()))
			if (!mintUrl) return { state: 'refused', reason: 'no-shared-mint' }

			const unit = 'sat'
			const mintUnits = (recipient.units[mintUrl] ?? []).map((value) => value.toLowerCase())
			if (mintUnits.length > 0 && !mintUnits.includes(unit)) {
				return { state: 'refused', reason: 'unit-unsupported' }
			}

			const senderPubkey = await options.signer.pubkey()
			const proofTags: Array<readonly [string, string]> = [['P', senderPubkey]]
			if (request.zappedEvent) proofTags.push(['e', request.zappedEvent.id])

			let proofs: NutzapProofSet
			try {
				proofs = await options.proofSource.lockProofs({
					mintUrl,
					unit,
					amountSats: amount,
					lockPubkey: recipient.nutzapPubkey,
					proofTags,
				})
			} catch (error) {
				// The mint may have consumed inputs and/or issued outputs — do NOT retry.
				return { state: 'indeterminate', error: error instanceof Error ? error : new Error(String(error)) }
			}

			const rejection = assertLockedProofs(proofs, recipient.nutzapPubkey, mintUrl)
			if (rejection) {
				// Funds are locked; nothing is published. The caller must reclaim, not retry.
				return { state: 'locked', proofs, rejected: rejection }
			}

			const tags = buildNutzapTags({ recipient, proofs, zappedEvent: request.zappedEvent })
			const template = buildNutzapTemplate({ tags, comment: request.comment, createdAt: now() })

			let signed: { id: string; event: unknown }
			try {
				signed = await options.signer.sign(template)
			} catch (error) {
				return {
					state: 'publish-failed',
					proofs,
					template,
					error: error instanceof Error ? error : new Error(String(error)),
				}
			}

			const published = await options.publisher.publish(signed.event, recipient.relays)
			if (published.relays.length === 0) {
				return {
					state: 'publish-failed',
					proofs,
					template,
					error: new Error('no relay accepted the nutzap'),
				}
			}

			return { state: 'published', eventId: signed.id, proofs, relays: published.relays }
		},
	}
}

/**
 * The post-lock checks, in pure code. A nutzap whose proofs are unlocked, locked to the wrong key,
 * from another mint, or without NUT-12 DLEQ material would be dropped by a compliant observer
 * (NIP-61 L116/L118), so it must not be published. Returns the reason, or null when every proof is
 * good.
 */
const assertLockedProofs = (proofs: NutzapProofSet, expectedLockPubkey: string, mintUrl: string): NutzapRefusalReason | null => {
	if (proofs.proofs.length === 0) return 'proof-not-p2pk'
	if (normalizeMintUrl(proofs.mintUrl).toLowerCase() !== normalizeMintUrl(mintUrl).toLowerCase()) return 'proof-mint-mismatch'

	for (const proof of proofs.proofs) {
		if (!proof.dleq) return 'proof-no-dleq'
		let lockPubkey: string | null
		try {
			lockPubkey = toCompressedAuctionP2pkPubkey(getAuctionP2pkLockPubkeyFromSecret(proof.secret))
		} catch {
			lockPubkey = null
		}
		if (!lockPubkey) return 'proof-not-p2pk'
		if (!auctionP2pkPubkeysMatch(lockPubkey, expectedLockPubkey)) return 'proof-p2pk-mismatch'
	}

	return null
}
