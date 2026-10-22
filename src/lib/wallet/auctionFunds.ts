/**
 * auctionFunds.ts — the P2PK spend of an auction leg: receiving a locked Cashu token with the
 * key that unlocks it.
 *
 * This is the one money movement of the auction rails that coco cannot do, on the pinned
 * version or on 2.0: a NUT-11 P2PK-locked token is spent by `cashu-ts`'s `receive()` with the
 * spending `privkey` supplied by the caller (the bidder's HD child key at settlement, the
 * refund key at reclaim). coco's native reclaim is a plain receive with no spending key, so
 * this leg stays on `cashu-ts` and the key stays with the caller.
 *
 * The store reaches the wallet, the mint and the payment state through three things, and this
 * module names each as an injected port rather than importing any of them:
 *
 *   - the proof read and the payment-state write — {@link AuctionFundsWallet}, a structural
 *     contract in the same style as `WalletProofSource` (`./proofs.ts`), so a coco-backed
 *     source can satisfy it without this module importing the relay wallet;
 *   - mint/keyset access — {@link AuctionFundsMintAccess}, which answers a `cashu-ts`
 *     `CashuWallet` for a mint URL plus the keyset id a short-ID token needs to decode.
 *
 * Nothing here holds the relay wallet, the store or the signing key: the caller passes the
 * key in. The behaviour — mint resolution order, validation, error propagation and the order
 * of the receive and the state write — is identical to the store helper this replaces,
 * because it moves money.
 */
import { getDecodedToken, type CashuWallet, type Proof } from '@cashu/cashu-ts'
import { getProofsForMint, type WalletProofSource } from './proofs'

/**
 * The store's mint normalization, kept byte-identical (one trailing slash, not all of them):
 * the mint URL keys the proof read and the state write, so a different trim would address a
 * different key.
 */
const normalizeMintUrl = (mintUrl: string): string => mintUrl.trim().replace(/\/$/, '')

/**
 * What the receive needs from the wallet: the proof read (`WalletProofSource`) plus the
 * payment-state write that records the freshly received proofs. Declared structurally, so a
 * coco-backed source can satisfy it later.
 */
export interface AuctionFundsWallet extends WalletProofSource {
	state: WalletProofSource['state'] & {
		update(update: { store: Proof[]; mint: string }): Promise<unknown>
	}
}

/**
 * Mint/keyset access as a port. A short keyset ID (NUT-2 v2, cashu-ts ≥2.x default) cannot be
 * expanded without the mint's keysets, so the port also answers the keyset id the receive
 * should decode against — and `undefined` when the caller should decode without one.
 */
export interface AuctionFundsMintAccess {
	cashuWalletForMint(mintUrl: string): Promise<{ cashuWallet: CashuWallet; keysetId?: string }>
}

export interface ReceiveTokenDeps {
	wallet: AuctionFundsWallet
	mint: AuctionFundsMintAccess
	token: string
	/**
	 * The spending key. Omitted or empty for an unsigned receive (a plain sendEcash token the
	 * recipient never claimed); present for a P2PK lock, where it is the leg's only authority.
	 */
	privkey?: string
	/**
	 * Caller-supplied mint URL. When provided we skip the top-level `getDecodedToken(token)`
	 * call entirely. Necessary when the token carries NUT-2 v2 short keyset IDs (cashu-ts ≥2.x
	 * default) — without a keyset map cashu-ts cannot decode and the call would throw "A short
	 * keyset ID v2 was encountered, but got no keysets to map it to." The seller settlement
	 * path knows the mint from the bid event, so it can pass it in.
	 */
	mintUrl?: string
}

/**
 * Receive a Cashu token into the wallet source, optionally unlocking it with `privkey`.
 *
 * Mint resolution, proof read, the `cashu-ts` receive and the payment-state write happen in
 * this order, and a failure at any step propagates unchanged — the caller owns retry and the
 * leg's outcome classification.
 */
export const receiveTokenIntoWallet = async (deps: ReceiveTokenDeps): Promise<{ amount: number; mintUrl: string }> => {
	// Resolve mint URL up front. Prefer the caller's explicit value to avoid the v2-short-ID
	// decode trap (see the option doc above). Fall back to decoding the token only if no
	// override was provided.
	let mintUrl: string
	if (deps.mintUrl) {
		mintUrl = normalizeMintUrl(deps.mintUrl)
	} else {
		mintUrl = normalizeMintUrl(getDecodedToken(deps.token).mint)
	}
	const proofsWeHave = getProofsForMint(deps.wallet, mintUrl)
	const { cashuWallet, keysetId } = await deps.mint.cashuWalletForMint(mintUrl)
	try {
		const receivedProofs = await cashuWallet.receive(deps.token, {
			proofsWeHave,
			...(deps.privkey ? { privkey: deps.privkey } : {}),
			...(keysetId ? { keysetId } : {}),
		})

		await deps.wallet.state.update({
			store: receivedProofs,
			mint: mintUrl,
		})

		return {
			amount: receivedProofs.reduce((sum, proof) => sum + proof.amount, 0),
			mintUrl,
		}
	} catch (error) {
		throw error
	}
}

/**
 * The P2PK spend: receive a locked token into the wallet source with the caller-supplied
 * spending key. This is the leg the store's `receiveLockedEcash` (settlement) and `reclaimToken`
 * (timelock refund) both need, and the reason this module exists.
 */
export const receiveTokenWithPrivkey = async (
	deps: Omit<ReceiveTokenDeps, 'privkey'> & { privkey: string },
): Promise<{ amount: number; mintUrl: string }> => receiveTokenIntoWallet(deps)
