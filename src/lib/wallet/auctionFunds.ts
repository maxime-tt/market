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
import { executeAuctionBidReclaimWorkflow, planAuctionBidReclaimTiming } from '@sdk/commerce/auctions'
import {
	findBidderRecordByRefundPubkey,
	findPreLockRecoveryRecordByRefundPubkey,
	removePreLockRecoveryRecord,
} from '@/lib/auction/bidderRecords'
import { getP2PKLocktime } from '@/lib/utils/cashu'
import { getProofsForMint, type WalletProofSource } from './proofs'
import type { AuctionBidPendingTokenContext, PendingToken } from './types'

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

/**
 * Wall-clock skew buffer added on top of a proof's embedded P2PK locktime before the client
 * attempts a refund-path reclaim. Guards against the local clock briefly racing ahead of the
 * mint's, which would produce a "Witness is missing for p2pk signature" error from the mint.
 */
export const AUCTION_RECLAIM_SKEW_BUFFER_SECONDS = 30
/**
 * Minimum wall-clock gap between auto-reclaim sweeps. Without this the sweep would fire on
 * every wallet refresh (and every bid) and hammer the mint with /swap calls per pending token,
 * causing HTTP 429s that block the bid flow.
 */
const AUCTION_AUTO_RECLAIM_MIN_INTERVAL_MS = 60_000
/** Exponential backoff (seconds) between successive reclaim retries per token. */
const AUCTION_RECLAIM_BACKOFF_SECONDS = [30, 120, 600, 1800, 7200]
/**
 * Substrings in a mint error message that indicate the refund path will never work for this
 * token — retrying burns rate-limit budget for no reason. These come from cashu-ts / mint
 * responses when the proof's lock secret can't be satisfied with any key the wallet holds.
 */
const AUCTION_RECLAIM_PERMANENT_ERROR_KEYWORDS = ['witness is missing', 'signature is not valid', 'spending conditions not met']

/**
 * Resolve the earliest-reclaim timestamp for a bid token. We prefer the authoritative locktime
 * embedded in each proof's NUT-11 P2PK secret, but fall back to the caller-supplied
 * `contextLocktime` (the value the bidder stashed when they placed the bid) when the secret
 * parse turns up no usable value — otherwise a token whose secret isn't parseable would look
 * "never ready" and produce the misleading "in a moment" error. A small buffer is always added
 * on top to ride out client/mint clock drift.
 */
export const getAuctionReclaimReadyAt = (token: string, contextLocktime?: number): number => {
	const fallback = contextLocktime && contextLocktime > 0 ? contextLocktime : 0
	let maxLocktime = fallback
	try {
		const decoded = getDecodedToken(token)
		if (decoded?.proofs?.length) {
			for (const proof of decoded.proofs) {
				try {
					const locktime = getP2PKLocktime(proof.secret)
					if (Number.isFinite(locktime) && locktime > maxLocktime) maxLocktime = locktime
				} catch {
					// Proof isn't a P2PK secret — doesn't contribute a locktime.
				}
			}
		}
	} catch {
		// Token won't decode — rely on the context fallback below.
	}
	return maxLocktime + AUCTION_RECLAIM_SKEW_BUFFER_SECONDS
}

/** Human-readable "Xs / Xm / Xh" label for a pending-reclaim wait period. */
export const formatReclaimWaitSeconds = (seconds: number): string => {
	if (!Number.isFinite(seconds) || seconds <= 0) return 'a moment'
	if (seconds < 60) return `${Math.ceil(seconds)}s`
	const minutes = Math.ceil(seconds / 60)
	if (minutes < 60) return `${minutes}m`
	const hours = Math.ceil(seconds / 3600)
	return `${hours}h`
}

/** Helper for UI: compute the ready-at across every pending leg of a bid group. */
export const getAuctionReclaimReadyAtForGroup = (tokens: { token: string; context?: { locktime?: number } }[]): number => {
	if (!tokens.length) return 0
	return tokens.reduce((max, entry) => {
		const readyAt = getAuctionReclaimReadyAt(entry.token, entry.context?.locktime)
		return readyAt > max ? readyAt : max
	}, 0)
}

const getReclaimBackoffSeconds = (previousAttempts: number): number => {
	if (previousAttempts <= 0) return 0
	const index = Math.min(previousAttempts - 1, AUCTION_RECLAIM_BACKOFF_SECONDS.length - 1)
	return AUCTION_RECLAIM_BACKOFF_SECONDS[index]
}

const isPermanentReclaimFailure = (err: unknown): boolean => {
	const message = (err instanceof Error ? err.message : String(err)).toLowerCase()
	return AUCTION_RECLAIM_PERMANENT_ERROR_KEYWORDS.some((keyword) => message.includes(keyword))
}

const resolveAuctionBidPendingContext = (pendingToken: PendingToken): AuctionBidPendingTokenContext | null =>
	pendingToken.context?.kind === 'auction_bid' ? pendingToken.context : null

/**
 * What the reclaim pair needs from the store it came from. Every member is a read or write the
 * store already performs; none of it is the relay wallet class, so this module stays free of it.
 */
export interface AuctionReclaimHost {
	/** The wallet source the receive leg spends into, or null when there is none. */
	getWallet(): AuctionFundsWallet | null
	/** Whether the wallet is ready — the auto-sweep's precondition. */
	isWalletReady(): boolean
	/** Mint/keyset access for the receive leg. */
	mint: AuctionFundsMintAccess
	/**
	 * The wallet's own private key for a pubkey, if it holds one. The legacy refund-key
	 * fallback: the authoritative per-bid refund key lives in the bidder records, not here.
	 */
	getWalletPrivkey(pubkey: string): string | null
	/** How many private keys the wallet holds — diagnostic only (the no-refund-key warning). */
	getWalletPrivkeyCount(): number
	/** The current pending tokens. */
	getPendingTokens(): PendingToken[]
	/** Persist and publish a new pending-token list (user-scoped storage + store). */
	setPendingTokens(tokens: PendingToken[]): void
	/** Reconcile wallet state after a successful reclaim. */
	refresh(): Promise<void>
}

export interface AuctionReclaim {
	reclaimToken(tokenId: string, options?: { manual?: boolean }): Promise<void>
	autoReclaimTimelockedBids(): Promise<void>
}

/**
 * The timelock-refund reclaim of an unclaimed bid, and the throttled sweep that runs it for
 * every ready token — the pair `nip60Actions.reclaimToken` + `nip60Actions.autoReclaimTimelockedBids`
 * moved out of the store behind {@link AuctionReclaimHost}.
 *
 * This is a money path, so the body is the store's, unchanged: the same readiness check
 * (proof-secret locktime first, cached context second, skew buffer always), the same refund-key
 * preference (bidder record → pre-lock recovery record → the wallet's key map), the same
 * `receiveTokenWithPrivkey` mint call, the same pending-token bookkeeping and the same error
 * semantics on every branch. The sweep's throttle state is per instance, so the caller must
 * hold one instance to keep the "at most one sweep per minute" rule.
 */
export const createAuctionReclaim = (host: AuctionReclaimHost): AuctionReclaim => {
	let lastSweepMs = 0

	const reclaimToken = async (tokenId: string, options?: { manual?: boolean }): Promise<void> => {
		const wallet = host.getWallet()
		if (!wallet) {
			throw new Error('Wallet not initialized')
		}

		const pendingToken = host.getPendingTokens().find((t) => t.id === tokenId)
		if (!pendingToken) {
			throw new Error('Pending token not found')
		}

		const auctionContext = resolveAuctionBidPendingContext(pendingToken)
		const now = Math.floor(Date.now() / 1000)
		const reclaimReadyAt = getAuctionReclaimReadyAt(pendingToken.token, auctionContext?.locktime)
		const reclaimPlan = planAuctionBidReclaimTiming({ tokenId, readyAt: reclaimReadyAt, now })
		if (reclaimPlan.status === 'waiting') {
			throw new Error(`Bid refund opens in ${formatReclaimWaitSeconds(reclaimPlan.waitSeconds)}`)
		}

		// Look up the refund privkey from three sources in order of preference:
		//
		//   1. The auction's BidderBidRecord (`refundPrivateKey`). This is THE authoritative
		//      store under cashu_p2pk_bidder_path_v1 — each bid leg generates a fresh refund
		//      keypair at lock time and persists the privkey there. Refund keys are
		//      intentionally NOT added to the wallet's key map because that map is for the
		//      wallet's general signing keys; mixing in per-bid throwaway keys would bloat it.
		//   2. The pre-lock recovery record (#1235 round-3 B1). A leg whose lock outcome was
		//      UNCERTAIN never got a full bidder record, but its refund privkey was durably
		//      persisted before the mint call — that record is exactly the recovery authority
		//      for the pending token the swap may have left behind.
		//   3. The wallet's key map. Legacy path; covers older bids placed before the
		//      BidderBidRecord scheme existed and provides a safety net if the local record is
		//      missing but the user happens to also hold the privkey in their wallet.
		//   4. None → stop. Without the privkey the timelock refund branch can't be signed;
		//      falling through would just spam the mint with "witness missing" 4xx responses.
		const bidderRecord = auctionContext ? findBidderRecordByRefundPubkey(auctionContext.refundPubkey) : null
		const preLockRecoveryRecord = auctionContext ? findPreLockRecoveryRecordByRefundPubkey(auctionContext.refundPubkey) : null
		const refundPrivkey =
			bidderRecord?.refundPrivateKey ??
			(auctionContext ? (preLockRecoveryRecord?.refundPrivateKey ?? host.getWalletPrivkey(auctionContext.refundPubkey)) : null)

		if (auctionContext && !refundPrivkey) {
			const walletPrivkeyCount = host.getWalletPrivkeyCount()
			console.warn(
				`[nip60] Reclaim aborted: no refund privkey found for refundPubkey ${auctionContext.refundPubkey} ` +
					`(checked BidderBidRecord + wallet.privkeys; wallet holds ${walletPrivkeyCount} privkey(s)). ` +
					`The bid was likely placed with a different browser/profile or local storage was cleared.`,
			)
			const reason =
				"This device does not hold the refund private key for this bid. The key only exists in the wallet that originally placed the bid (per-bid refund keys are stored in localStorage and aren't synced). Locked sats stay at the mint until that device reclaims them."
			const updatedTokens = host.getPendingTokens().map((t) =>
				t.id === tokenId
					? {
							...t,
							reclaimAttempts: (t.reclaimAttempts ?? 0) + 1,
							lastReclaimAttemptAt: now,
							reclaimFailureReason: reason,
							// Key mismatch is permanent — a new privkey won't appear. Mark so
							// auto-reclaim skips forever. A manual retry from the UI will clear
							// the flag in case the user imports the original wallet later.
							reclaimPermanentlyFailed: !options?.manual,
						}
					: t,
			)
			host.setPendingTokens(updatedTokens)
			throw new Error(reason)
		}

		try {
			const reclaimOutcome = await executeAuctionBidReclaimWorkflow(
				{ tokenId, readyAt: reclaimReadyAt, now },
				{
					reclaim: async () => {
						if (refundPrivkey) {
							await receiveTokenWithPrivkey({
								wallet,
								mint: host.mint,
								token: pendingToken.token,
								privkey: refundPrivkey,
								mintUrl: pendingToken.mintUrl,
							})
						} else {
							// Non-auction pending token (e.g. a regular sendEcash token the
							// recipient hasn't claimed). Best-effort unsigned receive.
							await receiveTokenIntoWallet({ wallet, mint: host.mint, token: pendingToken.token })
						}
					},
				},
			)
			if (reclaimOutcome.status === 'waiting') {
				throw new Error(`Bid refund opens in ${formatReclaimWaitSeconds(reclaimOutcome.waitSeconds)}`)
			}
			if (reclaimOutcome.status === 'failed') throw reclaimOutcome.cause

			// Mark reclaimed so auto-reclaim won't retry it.
			const pendingTokens = host.getPendingTokens().map((t) =>
				t.id === tokenId
					? {
							...t,
							status: 'reclaimed' as const,
							lastReclaimAttemptAt: now,
							reclaimFailureReason: undefined,
							reclaimPermanentlyFailed: false,
						}
					: t,
			)
			host.setPendingTokens(pendingTokens)

			// #1235 round-3 B1 — the leg is recovered: drop its pre-lock recovery record (GC).
			// The record held the refund authority while the leg was in limbo; a successful
			// reclaim makes it obsolete.
			if (preLockRecoveryRecord) {
				removePreLockRecoveryRecord(preLockRecoveryRecord.refundPubkey)
			}

			await host.refresh()
		} catch (err) {
			const attempts = (pendingToken.reclaimAttempts ?? 0) + 1
			const permanent = isPermanentReclaimFailure(err)
			const reason = err instanceof Error ? err.message : String(err)
			const pendingTokens = host.getPendingTokens().map((t) =>
				t.id === tokenId
					? {
							...t,
							reclaimAttempts: attempts,
							lastReclaimAttemptAt: now,
							reclaimFailureReason: reason,
							// Manual retry resets the "permanent" flag so the user can try again.
							reclaimPermanentlyFailed: options?.manual ? false : permanent || t.reclaimPermanentlyFailed,
						}
					: t,
			)
			host.setPendingTokens(pendingTokens)

			console.error('[nip60] Failed to reclaim token:', err)
			throw err
		}
	}

	/**
	 * Silently reclaim every pending auction bid whose P2PK timelock has expired. Throttled to
	 * at most one sweep per AUCTION_AUTO_RECLAIM_MIN_INTERVAL_MS and skips tokens that are in
	 * cooldown or marked permanently-failed, so a bad token can't loop the bid flow into 429s
	 * from the mint.
	 */
	const autoReclaimTimelockedBids = async (): Promise<void> => {
		const wallet = host.getWallet()
		if (!wallet || !host.isWalletReady()) return

		const nowMs = Date.now()
		if (nowMs - lastSweepMs < AUCTION_AUTO_RECLAIM_MIN_INTERVAL_MS) return
		lastSweepMs = nowMs

		const now = Math.floor(nowMs / 1000)
		const candidates = host.getPendingTokens().filter((token) => {
			if (token.status !== 'pending') return false
			if (token.reclaimPermanentlyFailed) return false
			const context = resolveAuctionBidPendingContext(token)
			if (!context) return false
			if (getAuctionReclaimReadyAt(token.token, context.locktime) > now) return false
			// Exponential backoff per token so a transient mint error doesn't turn into a tight
			// retry loop.
			const cooldown = getReclaimBackoffSeconds(token.reclaimAttempts ?? 0)
			const last = token.lastReclaimAttemptAt ?? 0
			return now - last >= cooldown
		})

		for (const token of candidates) {
			try {
				await reclaimToken(token.id)
			} catch (err) {
				console.warn(`[nip60] Auto-reclaim skipped for token ${token.id}:`, err instanceof Error ? err.message : err)
			}
		}
	}

	return { reclaimToken, autoReclaimTimelockedBids }
}
