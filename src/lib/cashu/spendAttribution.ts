/**
 * Spend attribution — *who* spent a proof, from evidence rather than timing.
 *
 * A NUT-11 P2PK proof can be spent by keys in its `data`/`pubkeys` fields (the intended
 * recipient) or, once `locktime` has passed, **additionally** by a key in its `refund` field
 * (NUT-11: refund keys are "additionally spendable", the lock conditions "continue to apply").
 * The mint reports only `SPENT` — but its NUT-07 answer also carries the **witness**: the
 * signatures that were actually presented. Verifying those against the two key sets turns
 * "somebody spent this" into "this key spent it".
 *
 * This module is that verification, and nothing else. It is pure: no I/O, no clock of its own,
 * no relay, no mint. The caller supplies the observation (state + witness + secret) and, when it
 * wants the strict reading, the time to judge the locktime against.
 *
 * ## Why the envelope is not the point
 *
 * NUT-07 responses are **not signed by the mint**, so nothing here proves *who answered* or
 * *when*. What it proves is the claim inside the answer: a valid signature over
 * `sha256(secret)` by a key the mint would accept. Proving the observation's time is a separate
 * concern (OpenTimestamps and friends), deliberately out of scope.
 *
 * ## The verdicts, and the one that is easy to get wrong
 *
 * - `redeemed`   — a witness signature verifies against a lock key: the intended recipient spent it.
 * - `reclaimed`  — a witness signature verifies against a refund key: the payer took it back.
 * - `unattributed` — spent with no usable evidence: no witness, malformed secret, a signature that
 *   verifies against neither set, **or one that verifies against both** (ambiguous, so never
 *   guessed).
 * - `unspent`, `pending`, `unknown` — the state as reported, unchanged.
 *
 * `unattributed` is not failure and not success: it is the honest answer when the evidence does
 * not decide, and every consumer must treat it as its own state rather than folding it into
 * either side. That is the whole reason this module exists — the previous behaviour inferred the
 * spender from *when* a spend was first seen.
 */

import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import type { Nut7ProofState } from '../auction/constants'

/** Who spent a proof, as far as the evidence goes. */
export type SpendAttribution = 'redeemed' | 'reclaimed' | 'unattributed' | 'unspent' | 'pending' | 'unknown'

/** One proof's state answer, plus the evidence the mint returned with it. */
export interface Nut7SpendObservation {
	/** The state as normalised by the NUT-07 client. */
	readonly state: Nut7ProofState
	/** Raw `witness` field of the state answer, when the mint returned one. */
	readonly witness?: string | null
	/** The proof's secret, when the caller has it. Without it nothing can be attributed. */
	readonly secret?: string
	/**
	 * Time to judge the locktime against, in unix seconds. When omitted, both spending paths are
	 * treated as possible (the loosest reading) — pass it when the caller knows the observation
	 * time and wants a refund signature before the locktime treated as evidence of nothing.
	 */
	readonly now?: number
}

/** The key sets a NUT-11 secret publishes, and whether it could be read at all. */
export interface P2pkSecretKeySets {
	readonly lockKeys: readonly string[]
	readonly refundKeys: readonly string[]
	readonly locktime?: number
	/** True when the secret is not a readable NUT-10/11 P2PK secret. */
	readonly malformed: boolean
}

const HEX_64 = /^[0-9a-f]{64}$/
const HEX_66 = /^(02|03)[0-9a-f]{64}$/

/**
 * Reduce a key to the x-only form Schnorr verification and NUT-11 comparisons use.
 *
 * NUT-11 counts keys by x-coordinate, so `02||x` and `x` are the same key here (and the parity
 * twin of an x-only value is not a different key for this purpose — which is exactly the
 * asymmetry the lock side has to live with).
 */
export const toXOnlyPublicKey = (key: string): string | null => {
	const candidate = key.trim().toLowerCase()
	if (HEX_64.test(candidate)) return candidate
	if (HEX_66.test(candidate)) return candidate.slice(2)
	return null
}

/** Read the key sets out of a NUT-10/11 P2PK secret. Malformed input yields `malformed: true`. */
export const readP2pkSecretKeySets = (secret: string): P2pkSecretKeySets => {
	const empty: P2pkSecretKeySets = { lockKeys: [], refundKeys: [], malformed: true }
	if (typeof secret !== 'string' || !secret.trim()) return empty

	let parsed: unknown
	try {
		parsed = JSON.parse(secret)
	} catch {
		return empty
	}
	if (!Array.isArray(parsed) || parsed.length < 2) return empty
	if (parsed[0] !== 'P2PK') return empty

	const body = parsed[1] as Record<string, unknown> | null
	if (!body || typeof body !== 'object') return empty

	const keys = new Set<string>()
	const data = typeof body.data === 'string' ? toXOnlyPublicKey(body.data) : null
	if (data) keys.add(data)

	const tags = Array.isArray(body.tags) ? body.tags : []
	const refundKeys = new Set<string>()
	let locktime: number | undefined

	for (const tag of tags) {
		if (!Array.isArray(tag) || typeof tag[0] !== 'string') continue
		const name = tag[0]
		if (name === 'refund') {
			for (const value of tag.slice(1)) {
				if (typeof value !== 'string') continue
				const key = toXOnlyPublicKey(value)
				if (key) refundKeys.add(key)
			}
		}
		if (name === 'pubkeys') {
			for (const value of tag.slice(1)) {
				if (typeof value !== 'string') continue
				const key = toXOnlyPublicKey(value)
				if (key) keys.add(key)
			}
		}
		if (name === 'locktime' && typeof tag[1] === 'string') {
			const value = Number.parseInt(tag[1], 10)
			if (Number.isFinite(value)) locktime = value
		}
	}

	if (!keys.size && !refundKeys.size) return { ...empty, locktime }
	return {
		lockKeys: [...keys],
		refundKeys: [...refundKeys],
		...(locktime === undefined ? {} : { locktime }),
		malformed: false,
	}
}

/** Signatures inside a NUT-11 witness. Returns `[]` for anything unexpected — never throws. */
export const readWitnessSignatures = (witness: string | null | undefined): string[] => {
	if (typeof witness !== 'string' || !witness.trim()) return []
	let parsed: unknown
	try {
		parsed = JSON.parse(witness)
	} catch {
		return []
	}
	const signatures = (parsed as { signatures?: unknown } | null)?.signatures
	if (!Array.isArray(signatures)) return []
	return signatures.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
}

const messageHashForSecret = (secret: string): Uint8Array => sha256(new TextEncoder().encode(secret))

/**
 * Hex-decode, because `@noble/curves` 2.x takes bytes and **throws** on a hex string.
 *
 * This is not a nicety: `schnorr.verify(hexString, …)` throws `"signature" expected Uint8Array of
 * length 64`, and a try/catch around it turns every genuine signature into "does not match" — which
 * would make every spend `unattributed` and the whole module quietly useless. Found by the tests
 * written against this module (which used real signatures and failed for exactly this reason).
 */
const hexToBytes = (hex: string): Uint8Array | null => {
	const clean = hex.trim().toLowerCase()
	if (clean.length % 2 !== 0 || !/^[0-9a-f]*$/.test(clean)) return null
	const out = new Uint8Array(clean.length / 2)
	for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16)
	return out
}

const signatureMatchesAny = (signatures: readonly string[], keys: readonly string[], messageHash: Uint8Array): boolean => {
	const decodedKeys = keys.map(hexToBytes).filter((key): key is Uint8Array => key !== null)
	if (!decodedKeys.length) return false
	return signatures.some((signature) => {
		const decoded = hexToBytes(signature)
		if (!decoded || decoded.length !== 64) return false
		return decodedKeys.some((key) => {
			try {
				return schnorr.verify(decoded, messageHash, key)
			} catch {
				return false
			}
		})
	})
}

/**
 * Attribute one observation.
 *
 * The both-sets case is deliberate: when a signature verifies against a lock key **and** another
 * against a refund key, the evidence does not say which path the mint accepted, so the verdict is
 * `unattributed` rather than a guess in either direction.
 */
export const attributeSpend = (observation: Nut7SpendObservation): SpendAttribution => {
	if (observation.state === 'unspent') return 'unspent'
	if (observation.state === 'pending') return 'pending'
	if (observation.state !== 'spent') return 'unknown'

	const secret = observation.secret
	if (typeof secret !== 'string' || !secret.trim()) return 'unattributed'

	const signatures = readWitnessSignatures(observation.witness)
	if (!signatures.length) return 'unattributed'

	const keySets = readP2pkSecretKeySets(secret)
	if (keySets.malformed) return 'unattributed'

	const messageHash = messageHashForSecret(secret)
	const lockMatched = keySets.lockKeys.length ? signatureMatchesAny(signatures, keySets.lockKeys, messageHash) : false

	// A refund signature before the locktime has passed cannot be the path the mint accepted.
	const refundPathAvailable =
		keySets.refundKeys.length > 0 &&
		(observation.now === undefined || keySets.locktime === undefined || observation.now >= keySets.locktime)
	const refundMatched = refundPathAvailable ? signatureMatchesAny(signatures, keySets.refundKeys, messageHash) : false

	if (lockMatched && refundMatched) return 'unattributed'
	if (refundMatched) return 'reclaimed'
	if (lockMatched) return 'redeemed'
	return 'unattributed'
}

/**
 * Reduce a leg's per-proof verdicts to one.
 *
 * Precedence, most significant first: `reclaimed` (a payer took value back — never hide it behind
 * a healthier sibling), `unattributed` (evidence does not decide), `unknown` (no answer), `pending`
 * (in flight), `unspent` (nothing moved), `redeemed` (every proof, by the intended key).
 *
 * The asymmetry is the point: `redeemed` is the only verdict that requires *all* proofs, because it
 * is the only one that claims a leg completed.
 */
export const aggregateSpendAttribution = (verdicts: readonly SpendAttribution[]): SpendAttribution => {
	if (!verdicts.length) return 'unknown'
	if (verdicts.includes('reclaimed')) return 'reclaimed'
	if (verdicts.includes('unattributed')) return 'unattributed'
	if (verdicts.includes('unknown')) return 'unknown'
	if (verdicts.includes('pending')) return 'pending'
	if (verdicts.includes('unspent')) return 'unspent'
	return 'redeemed'
}

/** One sentence per verdict, so surfaces word it the same way (D14). */
export const describeSpendAttribution = (attribution: SpendAttribution): string => {
	switch (attribution) {
		case 'redeemed':
			return 'The intended recipient spent these proofs.'
		case 'reclaimed':
			return 'The payer reclaimed these proofs after the lock expired.'
		case 'unattributed':
			return 'These proofs are spent, but the evidence does not show which key spent them.'
		case 'unspent':
			return 'These proofs have not been spent yet.'
		case 'pending':
			return 'These proofs are in flight at the mint.'
		case 'unknown':
			return 'The mint has not answered for these proofs.'
	}
}
