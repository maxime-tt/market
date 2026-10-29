import { aggregateBidNut7State, checkProofStateBatch } from '@sdk/commerce/payments/cashu/nut7'
import { normalizeMintUrl } from '@sdk/commerce/payments/display'
import type { Nut7ProofState } from '@sdk/commerce/payments/cashu/nut7'
import type { ParsedBidEvent } from './events'

/**
 * Type of the proof-state checker function. Injectable for testing.
 */
export type CheckProofStateFn = (mintUrl: string, proofYs: string[]) => Promise<Map<string, Nut7ProofState>>

export async function fetchBidNut7States(
	bids: ParsedBidEvent[],
	trustedMints: string[],
	checkFn: CheckProofStateFn = checkProofStateBatch,
): Promise<Map<string, Nut7ProofState>> {
	const allowedMints = new Set(trustedMints.map((mint) => normalizeMintUrl(mint)))
	const byMint = new Map<string, { bidId: string; proofYs: string[] }[]>()

	for (const bid of bids) {
		// A bid projection reaching this observer may omit the legacy proofYs
		// array. Runtime-check the boundary instead of trusting the ParsedBidEvent
		// type. Auction validation remains strict; this only prevents an optional
		// observer from dereferencing an absent projection field.
		if (!Array.isArray(bid.proofYs) || bid.proofYs.length === 0 || !bid.proofYs.every((proofY) => typeof proofY === 'string')) {
			continue
		}
		if (!allowedMints.has(normalizeMintUrl(bid.mint))) continue
		const existing = byMint.get(bid.mint) ?? []
		existing.push({ bidId: bid.id, proofYs: bid.proofYs })
		byMint.set(bid.mint, existing)
	}

	const states = new Map<string, Nut7ProofState>()
	await Promise.all(
		Array.from(byMint.entries()).map(async ([mintUrl, bidEntries]) => {
			try {
				const proofStates = await checkFn(
					mintUrl,
					bidEntries.flatMap((entry) => entry.proofYs),
				)
				for (const { bidId, proofYs } of bidEntries) {
					const aggregate = aggregateBidNut7State(proofStates, proofYs)
					if (aggregate) states.set(bidId, aggregate)
				}
			} catch {
				for (const { bidId } of bidEntries) states.set(bidId, 'unknown')
			}
		}),
	)

	return states
}
