/**
 * `arenaReceiptClaimState.ts` — the claim state of one wallet receipt, as a pure
 * function: the read's receipt + the persisted at-most-once record + the wallet's
 * own P2PK key in, one state out.
 *
 * It is the **pre-state** the wins surface renders before any claim runs — the
 * same selection the service performs (`arenaReceiptClaims.ts`'s
 * `planArenaReceiptClaims`) lifted to a pure function so the surface can say
 * "Claim" vs "Claimed" vs a named refusal without touching a mint.
 *
 * `foreign mint` is decided the same way the service's first step does: the
 * candidate mints are the chain's when the app holds one, else the mints the
 * wallet holds; when there is no candidate at all the move cannot be claimed.
 * The service's second step — asking a mint whether it serves the keyset — is
 * async, so it is injected here as a synchronous predicate the caller resolves
 * (an unknown answer is *not* a refusal, mirroring the service's `null`).
 *
 * Pure: no React, no relay, no mint.
 */

import {
	ARENA_CLAIM_REFUSAL_ALREADY_CLAIMED,
	ARENA_CLAIM_REFUSAL_FOREIGN_MINT,
	ARENA_CLAIM_REFUSAL_MALFORMED_P2PK,
	planArenaReceiptClaims,
} from './arenaReceiptClaims'
import type { ArenaReceiptClaimRecord, ArenaReceiptClaimRefusalName } from './arenaReceiptClaims'
import type { ParsedArenaReceipt } from './arenaReceiptsRead'

/**
 * What the wins surface says and offers for one receipt.
 *
 * - `no-receipt` — the read delivered no receipt for the move; the surface keeps
 *   its "no receipt read" wording, never "not paid".
 * - `wallet-unavailable` — the wallet's own P2PK key is not known yet, so no
 *   entry can be matched and no action is offered (never a spinner).
 * - `claimed` — the move is recorded in the persisted at-most-once record.
 * - `claimable` — entries addressed to this wallet key remain to be claimed.
 * - `refused` — a named refusal; the surface shows the name (and the detail).
 */
export type ArenaReceiptClaimState =
	| { readonly kind: 'no-receipt' }
	| { readonly kind: 'wallet-unavailable' }
	| { readonly kind: 'claimed' }
	| { readonly kind: 'claimable'; readonly amountSats: number; readonly moveKey: string; readonly keysetId: string }
	| { readonly kind: 'refused'; readonly refusal: ArenaReceiptClaimRefusalName; readonly detail: string }

export interface ArenaReceiptClaimStateInput {
	/** The receipt for this row's move, from the read, or `null` when the read delivered none. */
	receipt: ParsedArenaReceipt | null
	/** The persisted at-most-once record for the signed-in identity. */
	record: ArenaReceiptClaimRecord
	/** This wallet's own P2PK key (compressed secp256k1 hex), or `null` when it is not known yet. */
	walletP2pk: string | null
	/** The keyset the chain's params name, or `null` to skip the keyset check. */
	expectedKeysetId?: string | null
	/** The mint the chain's params name, when the app holds one. */
	expectedMintUrl?: string | null
	/** The mints this wallet holds. */
	walletMints?: readonly string[]
	/**
	 * Which of the candidate mints serve a keyset — the async mint answer the
	 * caller resolved. Absent or answering `true` is "unknown, not a refusal",
	 * mirroring the service's `mintServesKeyset` returning `null`.
	 */
	mintServesKeyset?: (mintUrl: string, keysetId: string) => boolean
}

/**
 * The claim state for one receipt.
 *
 * The order is the honesty order: a missing receipt and a missing wallet key are
 * stated before anything is claimed or refused, an already-recorded move reads
 * "Claimed" whatever else the entries would say, and only a genuinely unclaimable
 * move earns a refusal name.
 */
export function arenaReceiptClaimStateFor(input: ArenaReceiptClaimStateInput): ArenaReceiptClaimState {
	const { receipt, record, walletP2pk } = input
	if (receipt === null) return { kind: 'no-receipt' }
	if (walletP2pk === null || walletP2pk === '') return { kind: 'wallet-unavailable' }

	const claimedMoveKeys = new Set(record.map((move) => move.moveKey))
	const { moves, refusals } = planArenaReceiptClaims([receipt], {
		walletP2pk,
		expectedKeysetId: input.expectedKeysetId ?? null,
		isClaimed: (moveKey) => claimedMoveKeys.has(moveKey),
	})

	const move = moves[0]
	if (move === undefined) {
		if (refusals.some((refusal) => refusal.refusal === ARENA_CLAIM_REFUSAL_ALREADY_CLAIMED)) return { kind: 'claimed' }
		const first = refusals[0]
		if (first !== undefined) return { kind: 'refused', refusal: first.refusal, detail: first.detail }
		// Unreachable for a verified receipt: the read refuses a receipt with no
		// `out` entries, so every output yields a claimable entry or a refusal.
		return { kind: 'refused', refusal: ARENA_CLAIM_REFUSAL_MALFORMED_P2PK, detail: 'the receipt carries no destination this wallet can claim' }
	}

	const candidates = input.expectedMintUrl ? [input.expectedMintUrl] : (input.walletMints ?? [])
	const serves = input.mintServesKeyset ?? (() => true)
	if (candidates.length === 0) {
		return {
			kind: 'refused',
			refusal: ARENA_CLAIM_REFUSAL_FOREIGN_MINT,
			detail: 'the app holds no mint the receipt names, so this move is not claimable',
		}
	}
	if (!candidates.some((mintUrl) => serves(mintUrl, move.keysetId))) {
		return {
			kind: 'refused',
			refusal: ARENA_CLAIM_REFUSAL_FOREIGN_MINT,
			detail: `no mint this wallet holds serves the receipt's keyset ${move.keysetId}`,
		}
	}

	return { kind: 'claimable', amountSats: move.amount, moveKey: move.moveKey, keysetId: move.keysetId }
}
