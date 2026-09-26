/**
 * NUT-7 proof-state client helper.
 *
 * Cashu mints expose a "check state" endpoint that takes a list of
 * `Y = hash_to_curve(secret)` values and returns the spend state of
 * each (`UNSPENT` / `PENDING` / `SPENT`). The bid event publishes
 * `proof_y` precisely so any third-party validator can run this check
 * without holding the full proof.
 *
 * Reference: https://github.com/cashubtc/nuts/blob/main/07.md
 *
 * What this module provides:
 *
 * - {@link checkProofState}     — query the state of one proof by its Y.
 * - {@link checkProofStateBatch} — batch lookup for multiple Ys, one mint.
 * - {@link checkProofStateDetails} / {@link checkProofStateDetailsBatch} — the same reads **keeping
 *   the `witness`** the mint returns alongside the state. The witness is the signatures that were
 *   actually presented to spend the proof, i.e. the only evidence of *who* spent it
 *   (`src/lib/cashu/spendAttribution.ts` attributes it). The two state-only helpers delegate here, so
 *   there is one request path and one parser.
 *
 * Both return a normalized {@link Nut7ProofState} (`'unspent' | 'pending'
 * | 'spent' | 'missing' | 'unknown'`) — `'unknown'` is reserved for
 * mint-side errors / network failures, while `'missing'` means the mint
 * answered successfully but omitted a requested Y from the response.
 *
 * Bounded timeout + non-throwing semantics by design: validators poll
 * many proofs across many auctions and a single mint hiccup should
 * downgrade individual readings to `'unknown'`, not crash the loop.
 */

import { CashuMint, CheckStateEnum, type CheckStateResponse } from '@cashu/cashu-ts'
import type { Nut7ProofState } from '../auction/constants'
import type { Nut7SpendObservation } from './spendAttribution'

// ---------- Configuration ------------------------------------------------

/** Default per-mint request timeout in milliseconds. */
export const DEFAULT_NUT7_TIMEOUT_MS = 8_000

/** Default batch size — most mints accept a few hundred Ys per call. */
export const DEFAULT_NUT7_BATCH_SIZE = 100

/** Valid compressed secp256k1 generator point used for a cheap NUT-7 probe. */
export const NUT7_REACHABILITY_PROBE_Y = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'

// ---------- Public API ---------------------------------------------------

export interface CheckProofStateOptions {
	/** Per-request timeout in ms. Defaults to {@link DEFAULT_NUT7_TIMEOUT_MS}. */
	timeoutMs?: number
	/**
	 * Pre-built CashuMint instance. When provided, no fresh client is
	 * constructed — useful for callers that already maintain mint
	 * pools (e.g. the validator process subscribed to many mints).
	 */
	mintClient?: CashuMint
	/**
	 * Policy-enforcing custom request transport for the CashuMint
	 * constructor (`_customRequest`). When provided and no `mintClient`
	 * is supplied, every NUT-7 request — including each redirect hop —
	 * is validated against the outbound destination policy before
	 * contact. See `createPolicyEnforcedRequest`.
	 */
	customRequest?: CashuCustomRequest
}

/**
 * Shape of cashu-ts's `request` options (subset). `endpoint` is the full
 * request URL. Used to type the custom request transport without
 * importing cashu-ts's internal `RequestOptions`.
 */
export type CashuCustomRequest = (options: {
	endpoint: string
	method?: string
	requestBody?: unknown
	headers?: Record<string, string>
	signal?: AbortSignal
}) => Promise<unknown>

/** Options for the witness-keeping reads: the state options plus the secrets to attach. */
export interface CheckProofStateDetailsOptions extends CheckProofStateOptions {
	/**
	 * Secrets by `Y`, so the returned observations can be handed straight to `attributeSpend`.
	 * The mint never sees these — `Y` is derived from the secret, not the reverse — so a caller
	 * that holds the proofs passes them here rather than correlating the answers afterwards.
	 */
	secretsByY?: ReadonlyMap<string, string>
}

/**
 * Query the state of a single proof at a mint.
 *
 * Returns `'unknown'` on:
 *   - network errors
 *   - response timeout
 *   - mint returning a state the spec doesn't define
 *
 * Returns `'missing'` when the mint responds successfully but returns
 * no entry for the requested Y.
 *
 * Callers MUST treat `'unknown'` as "no signal, retry" — not "safe".
 */
export const checkProofState = async (mintUrl: string, proofY: string, options: CheckProofStateOptions = {}): Promise<Nut7ProofState> => {
	const observation = await checkProofStateDetails(mintUrl, proofY, options)
	return observation.state
}

/**
 * Query one proof's state **keeping the witness**.
 *
 * The witness is what makes the answer attributable — see `spendAttribution.ts`. Callers that only
 * need the state should keep using {@link checkProofState}; this one exists so the evidence is
 * available where it is asked for instead of being discarded at the only place it arrives.
 */
export const checkProofStateDetails = async (
	mintUrl: string,
	proofY: string,
	options: CheckProofStateDetailsOptions = {},
): Promise<Nut7SpendObservation> => {
	const details = await checkProofStateDetailsBatch(mintUrl, [proofY], options)
	return details.get(proofY.toLowerCase()) ?? { state: 'missing' }
}

export const checkMintReachability = async (mintUrl: string, options: CheckProofStateOptions = {}): Promise<boolean> => {
	const timeoutMs = options.timeoutMs ?? DEFAULT_NUT7_TIMEOUT_MS
	const mint = options.mintClient ?? new CashuMint(mintUrl, options.customRequest as never)

	try {
		const response = await withTimeout(mint.check({ Ys: [NUT7_REACHABILITY_PROBE_Y] }), timeoutMs, `NUT-7 reachability ${mintUrl}`)
		return !!response && Array.isArray(response.states)
	} catch {
		return false
	}
}

/**
 * Batch state lookup. Returns a Map keyed by the lower-cased input Y
 * (mints have historically been case-sensitive but field-normalising
 * here lets callers compare without worrying about it).
 *
 * Inputs the caller passes that don't appear in the mint's response
 * land in the returned map as `'missing'` when the request succeeded.
 * Transport failures still leave them as `'unknown'`.
 */
export const checkProofStateBatch = async (
	mintUrl: string,
	proofYs: string[],
	options: CheckProofStateOptions = {},
): Promise<Map<string, Nut7ProofState>> => {
	const details = await checkProofStateDetailsBatch(mintUrl, proofYs, options)
	const out = new Map<string, Nut7ProofState>()
	for (const [y, observation] of details) out.set(y, observation.state)
	return out
}

/**
 * Batch state lookup **keeping the witness**.
 *
 * Same request path as {@link checkProofStateBatch} (which delegates here), same normalization and
 * the same non-throwing semantics — the difference is that each entry carries the mint's `witness`
 * alongside the state, and the caller's secrets when it passes them. That pair is what
 * `attributeSpend` needs; the state alone is what made "spent" ambiguous between the lock owner and
 * the refund path.
 *
 * `secretsByY` is matched case-insensitively, like the Ys themselves.
 */
export const checkProofStateDetailsBatch = async (
	mintUrl: string,
	proofYs: string[],
	options: CheckProofStateDetailsOptions = {},
): Promise<Map<string, Nut7SpendObservation>> => {
	const out = new Map<string, Nut7SpendObservation>()
	if (!proofYs.length) return out

	const secrets = new Map<string, string>()
	for (const [y, secret] of options.secretsByY ?? []) secrets.set(y.toLowerCase(), secret)

	const withSecret = (y: string): Nut7SpendObservation => ({
		state: 'unknown',
		...(secrets.has(y) ? { secret: secrets.get(y) } : {}),
	})

	for (const y of proofYs) out.set(y.toLowerCase(), withSecret(y.toLowerCase()))

	const timeoutMs = options.timeoutMs ?? DEFAULT_NUT7_TIMEOUT_MS
	const mint = options.mintClient ?? new CashuMint(mintUrl, options.customRequest as never)

	const batches: string[][] = []
	for (let i = 0; i < proofYs.length; i += DEFAULT_NUT7_BATCH_SIZE) {
		batches.push(proofYs.slice(i, i + DEFAULT_NUT7_BATCH_SIZE))
	}

	for (const batch of batches) {
		let response: CheckStateResponse | undefined
		try {
			response = await withTimeout(mint.check({ Ys: batch }), timeoutMs, `NUT-7 check ${mintUrl}`)
		} catch (err) {
			// Network / timeout / mint error. Leave this batch's Ys as
			// 'unknown' so the validator can retry later. Don't log here —
			// callers know which mint/proofs they queried and can decide
			// whether the failure is interesting.
			void err
			continue
		}

		if (!response || !Array.isArray(response.states)) continue

		for (const y of batch) out.set(y.toLowerCase(), { ...withSecret(y.toLowerCase()), state: 'missing' })

		for (const entry of response.states) {
			if (!entry || typeof entry.Y !== 'string') continue
			const y = entry.Y.toLowerCase()
			// Only answer for Ys we asked about: the mint is untrusted input, and a response that
			// injects entries of its own must not shape the caller's map.
			if (!out.has(y)) continue
			out.set(y, {
				state: normaliseState(entry.state),
				...(typeof entry.witness === 'string' && entry.witness.length > 0 ? { witness: entry.witness } : {}),
				...(secrets.has(y) ? { secret: secrets.get(y) } : {}),
			})
		}
	}

	return out
}

// ---------- Internals ----------------------------------------------------

/**
 * Map the cashu-ts {@link CheckStateEnum} value to our `Nut7ProofState`.
 * Unknown / unexpected values fall through to `'unknown'`.
 */
const normaliseState = (state: unknown): Nut7ProofState => {
	if (state === CheckStateEnum.UNSPENT || state === 'UNSPENT') return 'unspent'
	if (state === CheckStateEnum.PENDING || state === 'PENDING') return 'pending'
	if (state === CheckStateEnum.SPENT || state === 'SPENT') return 'spent'
	return 'unknown'
}

/**
 * Race a promise against a timeout. The timeout rejects with a labelled
 * Error so callers' logs can pinpoint which mint stalled.
 */
const withTimeout = <T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`${label}: timed out after ${timeoutMs}ms`)), timeoutMs)
		promise.then(
			(value) => {
				clearTimeout(timer)
				resolve(value)
			},
			(err) => {
				clearTimeout(timer)
				reject(err)
			},
		)
	})
}

/**
 * Aggregate per-proof NUT-7 states into a single worst-case state per bid
 * (fraud-oriented): any spent proof → `spent`, all unspent → `unspent`,
 * otherwise `pending`. Returns `undefined` for an empty expected-proof list.
 *
 * This is the CLIENT-side aggregate used for winner derivation — the
 * pre-settlement fraud signal ("any spent invalidates"), distinct from the
 * settlement-completeness aggregate (all-spent) used on the validator's
 * post-settlement path.
 */
export const aggregateBidNut7State = (proofStates: Map<string, Nut7ProofState>, proofYs: string[]): Nut7ProofState | undefined => {
	if (!proofYs.length) return undefined
	let allUnspent = true
	for (const y of proofYs) {
		const state = proofStates.get(y.toLowerCase())
		if (state === 'spent') return 'spent'
		if (state !== 'unspent') allUnspent = false
	}
	return allUnspent ? 'unspent' : 'pending'
}
