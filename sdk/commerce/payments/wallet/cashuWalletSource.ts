/**
 * cashuWalletSource.ts — the wallet object the auction rails spend through, backed by coco's own
 * proof repository instead of the relay-backed NIP-60 wallet.
 *
 * The relay wallet exposed a *synchronous* proof read (`state.getProofs`) and a synchronous
 * `state.dump()`, and the auction money paths (`getSpendableProofsForMint`, `selectProofs`, the
 * lock's balance reconcile) are written against that shape — `WalletProofSource` /
 * `AuctionFundsWallet` in `./proofs.ts` and `./auctionFunds.ts`. coco's repository is async
 * on every method, and the pin exposes it exactly where the app can reach it:
 *
 *   IndexedDbRepositories.proofRepository
 *     saveProofs(mintUrl, proofs) / getReadyProofs(mintUrl) / deleteProofs(mintUrl, secrets)
 *
 * So this module is the mapping the cut needs and nothing more: coco's repository stays the
 * authority, and a per-mint mirror of its ready proofs answers the synchronous reads. The mirror
 * is a *read cache* — every write goes to coco first and the cache follows it — so the two cannot
 * disagree about what the wallet holds; the only thing the cache buys is a sync answer to a
 * question the rails ask synchronously.
 *
 * `publish()` is deliberately a no-op: the relay wallet published a kind-17375 event after every
 * proof write, and there is no relay wallet state left to publish. `hydrate()` is called by the
 * store whenever coco's proofs may have moved (init, mint sync, and every `proofs:*` event), so
 * the mirror is refreshed from the authority rather than patched by guesswork.
 *
 * This module imports no store and no relay-wallet class: the repository and the mint list arrive
 * as ports, which is also what lets a test inject a fake source in their place.
 */
import type { Proof } from '@cashu/cashu-ts'
import type { AuctionFundsWallet } from './auctionFunds'

/** The unit the app's wallet is denominated in. coco's own default; named once here. */
export const WALLET_PROOF_UNIT = 'sat'

/** coco's proof lifecycle states. Declared here for the same structural reason as the port. */
export type CoreProofState = 'inflight' | 'ready' | 'spent'

/**
 * A proof as coco's repository stores it: cashu-ts's `Proof` plus the two fields coco's own
 * `mapProofToCoreProof` attaches (`unit`, `state`). The repository's `saveProofs` runs
 * `normalizeUnit(proof.unit)` and throws "Unit is required" for a cashu-ts proof, which carries
 * neither field; its balance queries only count `ready` proofs. So the write boundary stamps
 * both, and every caller — the dev mint, the receive path, the auction lock — is covered.
 */
export interface StoredProof extends Proof {
	unit: string
	state: CoreProofState
}

/**
 * A proof a caller hands to the boundary: cashu-ts's shape, or one already read back from coco
 * (which carries its own `unit`/`state`). The boundary preserves both when present.
 */
export type IncomingProof = Proof & { unit?: string; state?: CoreProofState }

/**
 * The repository surface this source needs. Declared structurally rather than imported from
 * coco so the pin's `ProofRepository` satisfies it without this module depending on the package
 * name — the same reason `./proofs.ts` declares `WalletProofSource` structurally.
 */
export interface CashuProofRepository {
	saveProofs(mintUrl: string, proofs: StoredProof[]): Promise<void>
	getReadyProofs(mintUrl: string): Promise<StoredProof[]>
	deleteProofs(mintUrl: string, secrets: string[]): Promise<void>
}

/**
 * Everything this source reads from outside itself: coco's mint list, and the proof write path.
 * None of it is the relay wallet.
 */
export interface CashuWalletSourcePorts {
	/** The wallet's mint list, coco's own (`manager.mint`). */
	getMints(): string[]
	/** The proof write path — coco's `proofRepository`. */
	proofs: CashuProofRepository
}

/**
 * The wallet object the rails hold. It is `AuctionFundsWallet` (the sync proof read plus the
 * payment-state write) with the mint list the store's balance helpers read, the publish that is
 * now a no-op, and the hydrate that refreshes the mirror.
 */
export interface CashuWalletSource extends AuctionFundsWallet {
	/** coco's mint list for this wallet. A getter, so it never goes stale. */
	readonly mints: string[]
	/** The relay-wallet publish is gone; kept so the rails' best-effort call sites compile. */
	publish(): Promise<unknown>
	/** Re-read coco's ready proofs for every known mint into the mirror. */
	hydrate(): Promise<void>
}

/** The store's mint normalization: one trailing slash, not all of them. */
const normalizeMintUrl = (mintUrl: string): string => mintUrl.trim().replace(/\/$/, '')

/** Dedupe by secret — the same proof cannot be held twice. */
const dedupeBySecret = <T extends Proof>(proofs: T[]): T[] => {
	const bySecret = new Map<string, T>()
	for (const proof of proofs) bySecret.set(proof.secret, proof)
	return Array.from(bySecret.values())
}

/**
 * Stamp the two fields coco's repository requires, without overwriting a proof that already
 * carries them. A cashu-ts proof has neither `unit` nor `state`; coco's `saveProofs` rejects
 * it (`normalizeUnit(proof.unit)` throws "Unit is required") and its balance only counts
 * `ready`. A proof read back from coco arrives with its own unit and lifecycle state, so
 * preserving those is what keeps a re-written proof from being corrupted.
 */
const stampProof = (proof: IncomingProof): StoredProof => ({
	...proof,
	unit: proof.unit ?? WALLET_PROOF_UNIT,
	state: proof.state ?? 'ready',
})

/**
 * Build the coco-backed wallet source.
 *
 * The mirror starts empty and is filled by `hydrate()`; an un-hydrated source answers "no
 * proofs", which fails closed (a lock refuses for lack of balance) rather than inventing money.
 */
export const createCocoWalletSource = (ports: CashuWalletSourcePorts): CashuWalletSource => {
	const readyByMint = new Map<string, StoredProof[]>()

	const read = (mintUrl: string): StoredProof[] => readyByMint.get(normalizeMintUrl(mintUrl)) ?? []

	const source: CashuWalletSource = {
		get mints(): string[] {
			return ports.getMints()
		},

		state: {
			dump: () => ({
				proofs: Array.from(readyByMint.entries()).flatMap(([mint, proofs]) => proofs.map((proof) => ({ ...proof, mint }))),
			}),

			// Every proof in the mirror is one coco reports as ready, so `onlyAvailable` and
			// `includeDeleted: false` are already satisfied: a spent or deleted proof is not here.
			getProofs: (filter) => read(filter.mint),

			// The one write boundary between cashu-ts and coco: every caller — the dev mint,
			// the receive path, the auction lock — hands its proofs here, and this is where
			// the unit and state coco's repository requires are stamped. Callers never have
			// to remember either field, and a proof that already carries them is preserved.
			update: async (update) => {
				const mint = normalizeMintUrl(update.mint)
				const stored = (update.store ?? []).map(stampProof)
				if (stored.length) {
					await ports.proofs.saveProofs(mint, stored)
				}
				if (update.destroy?.length) {
					await ports.proofs.deleteProofs(
						mint,
						update.destroy.map((proof) => proof.secret),
					)
				}
				const destroyed = new Set((update.destroy ?? []).map((proof) => proof.secret))
				const kept = read(mint).filter((proof) => !destroyed.has(proof.secret))
				// The mirror answers "what is spendable", so it holds only what coco would
				// report as ready: a proof stamped (or already) inflight/spent is not here.
				const ready = stored.filter((proof) => proof.state === 'ready')
				readyByMint.set(mint, dedupeBySecret([...kept, ...ready]))
			},
		},

		publish: async () => undefined,

		hydrate: async () => {
			for (const mint of ports.getMints()) {
				const url = normalizeMintUrl(mint)
				try {
					readyByMint.set(url, dedupeBySecret(await ports.proofs.getReadyProofs(url)))
				} catch (err) {
					console.warn('[wallet] Failed to hydrate proofs for mint:', url, err)
				}
			}
		},
	}

	return source
}
