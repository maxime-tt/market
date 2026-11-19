/**
 * `depositMints.ts` — the mints a Lightning deposit may be offered at.
 *
 * A deposit mints new ecash at the mint the user picks. When the deposit is funding a bid, that
 * mint must be one the auction accepts; when it is an ordinary top-up, any mint the wallet holds
 * will do. Those are the only two rules — and the second one used to be applied too strictly:
 * the host intersected the wallet's mints with the auction's allowlist, so an allowed mint the
 * wallet did not *yet* hold was filtered out and “Generate Invoice” could never become enabled
 * for a fresh identity. Holding is not a precondition for depositing, because the deposit path
 * registers and trusts the mint on demand (`cashuActions.startDeposit`). So an allowed mint is
 * offerable whether or not the wallet already holds it.
 */

import { normalizeMintUrl } from './display'

export interface DepositMintCandidatesInput {
	/** The mints the wallet holds, from the wallet store's coco projection. */
	walletMints: readonly string[]
	/** The auction's accepted mints, when the deposit is funding a bid. */
	allowedMints?: readonly string[]
}

/** Normalize a mint URL and keep it only when it parses as a URL; `null` otherwise. */
export function normalizeDepositMintUrl(mintUrl: string): string | null {
	const normalized = normalizeMintUrl(mintUrl)
	if (!normalized) return null
	try {
		new URL(normalized)
		return normalized
	} catch {
		return null
	}
}

function normalizeList(mints: readonly string[]): string[] {
	const seen = new Set<string>()
	const out: string[] = []
	for (const mint of mints) {
		const normalized = normalizeDepositMintUrl(mint)
		if (!normalized || seen.has(normalized)) continue
		seen.add(normalized)
		out.push(normalized)
	}
	return out
}

/**
 * The mints a deposit form offers, in preference order.
 *
 * - With an auction allowlist: the allowlist itself, normalized and deduped — held or not.
 * - Without one: the wallet's own mints.
 */
export function depositMintCandidates({ walletMints, allowedMints }: DepositMintCandidatesInput): string[] {
	if (allowedMints?.length) return normalizeList(allowedMints)
	return normalizeList(walletMints)
}
